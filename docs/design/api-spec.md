# API 規格

Extends: system-design.md §10（API 介面草案）

NTOUER Academic Planner｜Iteration 2｜2026/11/16

本文件是**HTTP 介面契約的唯一真相**：統一回應 envelope、錯誤碼、版本策略、認證標頭，以及三個進入 OpenAPI 的端點規格。機器可讀版本是 [openapi.yaml](openapi.yaml)，兩者衝突時以 `openapi.yaml` 為準並回頭修本文件。

前置決策見 [ADR-0003](adr/0003-google-oidc-identity.md)（Google OIDC、後端工作階段）、[ADR-0006](adr/0006-deployment-platform-and-ci.md)（同源單一服務、CI 不連外部服務）。

---

## 1. 通則

| 項目 | 規則 |
| --- | --- |
| 傳輸 | 僅 HTTPS（NFR-04）；HTTP 一律 308 導向 HTTPS |
| 格式 | JSON，`Content-Type: application/json; charset=utf-8` |
| 編碼 | UTF-8；中文直接輸出，不逃逸 |
| 時間 | ISO 8601 帶時區偏移，如 `2026-11-16T03:20:41+08:00`；資料庫存 UTC |
| 識別碼 | 版本用 `bundleId@versionNo`（如 `cse-113-day@3`）；使用者用 UUID |
| 欄位命名 | `camelCase`（與前端 TypeScript 一致）；資料庫的 `snake_case` 只存在於 DB 層 |
| 未知欄位 | 請求：拒絕（`additionalProperties: false`）；回應：可增加，客戶端必須忽略未知欄位 |
| 空值 | 缺資料一律用 `null`，不用空字串冒充「沒有」；`null` 與 `unknown` 狀態的意義不同 |

## 2. 認證與授權

**只支援 cookie 工作階段，不使用 `Authorization` 標頭。** 理由見 ADR-0003：token 若進到前端可讀的儲存空間，就無法在登出時可靠撤銷。

| 項目 | 規則 |
| --- | --- |
| 工作階段 cookie | `planner_session=<opaque>`；`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/` |
| 伺服器端 | 只存 cookie 內容的 SHA-256 於 `sessions.token_hash`（[database-design.md](database-design.md) §3.3） |
| 到期 | 7 天滑動或固定到期（實作細節由 AP-I2-03 決定），到期即 401 `AUTH_REQUIRED` |
| 登出 | `DELETE /auth/session` 寫入 `revoked_at`，該 cookie 立刻失效 |
| CSRF | 變更類請求（POST／PUT／PATCH／DELETE）必須帶同源 `Origin`；不同源回 403 `AUTH_ORIGIN_MISMATCH`。`SameSite=Lax` 已擋掉跨站攜帶，這兩層是縱深防禦 |
| 權限判斷 | 一律在後端以「主體 ＋ 動作 ＋ 資源（系所）」三元組判斷；前端送來的角色或系所不採信（system-design.md §8） |

`GET /auth/session` 是前端唯一需要的「我現在是誰」查詢：回傳角色與可管理的系所範圍，畫面據此顯示或隱藏入口——但**隱藏不是授權**，每個端點仍各自驗權。

## 3. 統一回應 envelope

所有回應（含錯誤）都是同一個外層形狀，客戶端只需要寫一次解析：

### 3.1 成功

```json
{
  "data": { "…": "端點各自的內容" },
  "meta": {
    "requestId": "b7f3c2a1-4e8d-4f6b-9a1e-2c5d7e9f0a12",
    "ruleVersionId": "cse-113-day@3",
    "generatedAt": "2026-11-16T03:20:41+08:00"
  }
}
```

| 欄位 | 型別 | 必要 | 說明 |
| --- | --- | --- | --- |
| `data` | object | 是 | 端點內容。**成功一定有 `data`**，空結果給 `{}` 或 `[]` 而不是省略 |
| `meta.requestId` | string | 是 | 伺服器產生；與 `X-Request-Id` 回應標頭相同，供排查與回報 |
| `meta.ruleVersionId` | string | 否 | 只在結果與規則版本有關時出現（檢核、進度、規則查詢） |
| `meta.generatedAt` | string | 是 | 伺服器產生回應的時間 |

### 3.2 失敗

```json
{
  "error": {
    "code": "RULE_VERSION_NOT_FOUND",
    "message": "找不到規則版本 cse-113-day@9。",
    "details": [{ "field": "versionId", "reason": "not found" }],
    "retryable": false
  },
  "meta": {
    "requestId": "b7f3c2a1-4e8d-4f6b-9a1e-2c5d7e9f0a12",
    "generatedAt": "2026-11-16T03:20:41+08:00"
  }
}
```

| 欄位 | 型別 | 必要 | 說明 |
| --- | --- | --- | --- |
| `error.code` | string | 是 | 穩定的機器可讀代碼（見 §4）。**前端依 code 分支，不依 message** |
| `error.message` | string | 是 | 給人看的中文訊息；可調整措辭，不算契約 |
| `error.details` | array | 否 | 逐欄位或逐項原因（驗證失敗、測試未過時使用） |
| `error.retryable` | boolean | 是 | 客戶端可否原樣重試；`false` 時重試只會再失敗 |
| `meta` | object | 是 | 與成功相同 |

**為什麼要 envelope 而不是直接回物件：** 錯誤與成功必須能用同一個解析路徑處理，否則每個呼叫點都要先判斷 HTTP 狀態再猜 body 形狀。`meta` 也讓「這個結果是哪一版規則算的」與「這次請求的 id 是什麼」有固定位置，不必每個端點各自設計。

**成功與失敗的區分不看 HTTP 狀態碼，看有沒有 `data`／`error`。** HTTP 狀態仍正確設定（200／4xx／5xx）以便快取、監控與中介層判斷。

## 4. 錯誤碼表

`code` 是契約的一部分，新增可以，**改名或改語意必須走 API 版本策略（§5）**。

| `code` | HTTP | 何時回 | 客戶端該做什麼 | 可重試 |
| --- | --- | --- | --- | --- |
| `AUTH_REQUIRED` | 401 | 沒有 cookie、cookie 無效、已過期或已撤銷 | 導向登入，不顯示錯誤細節 | 否 |
| `AUTH_FORBIDDEN` | 403 | 已登入但這個角色不能做這件事 | 顯示「沒有權限」並隱藏入口 | 否 |
| `AUTH_DEPT_OUT_OF_SCOPE` | 403 | 操作的系所不在被指派的範圍內 | 同上；同時記一筆稽核 | 否 |
| `AUTH_ORIGIN_MISMATCH` | 403 | 變更類請求的 `Origin` 與站台不同源 | 視為程式錯誤，不提示使用者 | 否 |
| `REQUEST_INVALID` | 400 | 查詢參數或 body 格式錯誤（型別、必填、列舉值） | 修正後重送；`details` 指出欄位 | 否 |
| `RESOURCE_NOT_FOUND` | 404 | 路徑本身不存在（打錯網址） | 顯示 404 頁 | 否 |
| `RULE_BUNDLE_NOT_FOUND` | 404 | `bundleId` 不存在 | 提示「此系所／年度尚無規則」 | 否 |
| `RULE_VERSION_NOT_FOUND` | 404 | `versionId` 不存在 | 同上，並提供「改用最新已發布版」連結 | 否 |
| `RULE_VERSION_NOT_PUBLISHED` | 409 | 學生端請求了 `draft` 或其他非 `published` 版本 | 改抓最新已發布版 | 否 |
| `RULE_VERSION_IMMUTABLE` | 409 | 對已發布／已取代的版本做內容修改 | 建立新草稿 | 否 |
| `RULE_VALIDATION_FAILED` | 422 | 結構驗證失敗（管理端送審前） | 顯示逐條錯誤，修正規則 | 否 |
| `RULE_TEST_FAILED` | 422 | 測試案例未全數通過，不能送審 | 顯示失敗案例 | 否 |
| `SYNC_FAILED` | 502 | 教務（AIS）同步失敗，或外部回應逾時 | 保留前次快照並提供重試（TC-12） | 是 |
| `SYNC_ALREADY_RUNNING` | 409 | 同一使用者已有一個未完成的同步 | 先完成或取消既有同步 | 否 |
| `SYNC_NOT_FOUND` | 404 | `syncId` 不存在、已完成、已取消或已過期 | 重新開始同步 | 否 |
| `SYNC_EXPIRED` | 409 | 驗證碼輸入期限已過（預設 5 分鐘） | 重新開始同步 | 是 |
| `SYNC_CAPTCHA_INVALID` | 400 | 驗證碼不是四碼英數字 | 修正後重送 | 否 |
| `AIS_CREDENTIALS_NOT_CONFIGURED` | 400 | 伺服器沒有 `AIS_ACCOUNT`／`AIS_PASSWORD`，請求也沒帶 | 在 `.env.local` 補設定或帶入臨時憑證 | 否 |
| `AIS_LOGIN_REJECTED` | 502 | AIS 拒絕登入（帳密或驗證碼錯誤） | 重新開始同步並重新輸入驗證碼 | 是 |
| `CAPTCHA_RECOGNITION_EXHAUSTED` | 502 | 驗證碼連續錯誤達上限 | 重新開始同步 | 是 |
| `AIS_TIMEOUT`／`AIS_UNAVAILABLE` | 502 | AIS 逾時或連不上 | 稍後重試；前次快照仍在 | 是 |
| `AIS_STUDENT_IDENTITY_MISMATCH` | 502 | 成績頁學號與登入帳號不一致 | 停止，不要重試；確認帳號 | 否 |
| `RATE_LIMITED` | 429 | 超過速率限制（I2 未啟用，保留代碼） | 依 `Retry-After` 重試 | 是 |
| `INTERNAL` | 500 | 未預期的伺服器錯誤 | 顯示 `requestId` 並請使用者回報 | 不一定 |

**錯誤訊息的三條規矩**（NFR-06）：訊息不得只有「發生錯誤」；不得洩漏帳密、SQL、stack 或內部路徑；不得把未知當成失敗或成功（狀態不明的資料要用 `unknown` 呈現，不是 5xx）。

## 5. 版本策略

這裡有**兩種版本**，不要混在一起：

| 版本 | 識別 | 誰管 | 例子 |
| --- | --- | --- | --- |
| 規則版本 | `versionId`＝`bundleId@versionNo` | 發布流程（ADR-0001） | `cse-113-day@3` |
| API 版本 | 路徑前綴 | 後端（本節） | 目前＝v1（省略前綴） |

**API 版本規則**

1. **現行路徑就是 v1，前綴省略。** `/api/rules/{versionId}` 等於 `/api/v1/rules/{versionId}`。理由：目前只有一個同源前端，強制寫出 `/v1` 只會讓 `system-design.md` §10 與 `openapi.yaml` 兩處各維護一套路徑。
2. **第一次破壞性變更時才引入 `/api/v2`**，v1 至少保留一個 Iteration 並在回應加 `Sunset` 標頭。破壞性變更指：改欄位名、改型別、移除欄位、改錯誤碼語意、改必填。
3. **非破壞性變更不升版**：新增回應欄位、新增端點、新增錯誤碼（客戶端要能容忍未知 `code`）、放寬驗證。
4. **`openapi.yaml` 的 `info.version` 從 `0.1.0` 起**，與 Iteration 對齊，不代表對外承諾。
5. **規則版本不是 API 版本**：`/api/rules/{versionId}` 換 `versionId` 不是 API 變更。

## 6. 端點清單

本批 OpenAPI 收 8 個 path：§7.1–§7.4（`/auth/session`、`/api/me/progress`、`/api/rules/{versionId}`）加上 §7.6–§7.7 的 AIS 同步三支與學籍補齊。其餘管理端端點已在下方登記但尚未進 `openapi.yaml`，避免一次擴充太多而失去審閱意義。`GET /healthz` 是維運檢查，刻意不進（§7.5）。

| 方法 | 路徑 | 用途 | 權限 | 本批 openapi |
| --- | --- | --- | --- | --- |
| GET | `/auth/session` | 目前工作階段（角色、系所範圍、到期） | 已登入 | ✅ |
| DELETE | `/auth/session` | 登出並撤銷工作階段 | 已登入 | ✅ |
| GET | `/api/me/progress` | 三情境進度與缺額 | 學生本人 | ✅ |
| POST | `/api/me/sync/ais` | 開始 AIS 同步（回驗證碼圖片與 `syncId`） | 學生本人 | ✅ |
| POST | `/api/me/sync/ais/{syncId}` | 送出驗證碼完成同步並寫入快照 | 學生本人 | ✅ |
| DELETE | `/api/me/sync/ais/{syncId}` | 取消未完成的同步 | 學生本人 | ✅ |
| PATCH | `/api/me/profile` | 補齊系所／入學年度／學制 | 學生本人 | ✅ |
| GET | `/api/rules/{versionId}` | 取特定版本（含來源與條文） | 已登入 | ✅ |
| GET | `/auth/google/start` | 開始 Google OIDC（302 到 Google） | 匿名 | 待擴充 |
| GET | `/auth/callback` | OIDC 回呼；交換 token、建立工作階段 | 匿名 | 待擴充 |
| GET | `/healthz` | 健康檢查（DB 連線、`select 1`） | 匿名 | 規格見 §7.5（刻意不進 openapi） |
| POST | `/api/check` | 帶入情境與狀態執行檢核 | 學生本人 | 待擴充 |
| GET | `/api/rules` | 依 `dept`／`year` 取最新已發布版本 | 已登入 | 待擴充 |
| POST | `/api/admin/rules/{bundleId}/draft` | 建立草稿（201；省略 payload 時複製最新版） | 系所管理員 | 已實作（§7.8，未進 openapi） |
| GET | `/api/admin/rules/{versionId}` | 讀取任一狀態的版本（含 payload 與 `allowedActions`） | 系所管理員 | 已實作（§7.8） |
| PUT | `/api/admin/rules/{versionId}` | 更新草稿 | 系所管理員 | 已實作（§7.8） |
| POST | `/api/admin/rules/{versionId}/validate` | 結構驗證（422 `RULE_VALIDATION_FAILED`） | 系所管理員 | 已實作（§7.8） |
| POST | `/api/admin/rules/{versionId}/test` | 以測試紀錄跑引擎（422 `RULE_TEST_FAILED`） | 系所管理員 | 已實作（§7.8） |
| POST | `/api/admin/rules/{versionId}/submit` | 送審 → `in-review` | 系所管理員 | 已實作（§7.8） |
| POST | `/api/admin/rules/{versionId}/approve` | 核准 → `approved` | 系所管理員 | 已實作（§7.8） |
| POST | `/api/admin/rules/{versionId}/reject` | 退回 → `draft`（`reason` 必填） | 系所管理員 | 已實作（§7.8） |
| POST | `/api/admin/rules/{versionId}/publish` | 發布 → `published`（`proxy` 依 §8） | 系所管理員／系統管理員 | 已實作（§7.8） |
| GET | `/api/admin/rules/{versionId}/diff` | 與前一版差異 | 系所管理員 | 已實作（§7.8） |
| GET | `/api/admin/audit` | 稽核紀錄（`limit`／`cursor`／`versionId`，禁 `offset`） | 系所管理員／系統管理員 | 已實作（§7.8） |
| POST | `/api/admin/departments/{deptId}/admins` | 指派／撤銷管理員 | 系統管理員 | 待擴充（I3） |

### 6.1 `/auth/google/start` 與 `/auth/callback`（已設計，未進 openapi）

依 ADR-0003 的授權碼 ＋ PKCE 流程：

1. 瀏覽器前往 `/auth/google/start`。伺服器產生 `state` 與 `code_verifier`，把兩者放進短效（5 分鐘）簽章 cookie，302 到 Google 授權端點。
2. Google 導回 `/auth/callback?code=…&state=…`。伺服器比對 `state`、用 `code_verifier` 向 Google 換 token、驗 ID token（簽章／`iss`／`aud`／`exp`／`nonce`／`sub`），以 `sub` upsert `users`、建立 `sessions` 列，設 `planner_session` cookie，302 回前端。
3. 失敗（`state` 不符、`code` 過期、`sub` 缺失）一律導回前端的登入失敗頁，**不**在網址帶錯誤細節。

`code_verifier` 與 client secret 都不出現在前端可讀的位置；client secret 只在部署環境的環境變數裡（ADR-0006）。

## 7. 端點規格（§7.1–§7.4 進 openapi；§7.5 是維運檢查，暫不進）

### 7.1 `GET /auth/session`

回傳目前工作階段。前端啟動時呼叫一次，用來決定顯示學生端或管理端入口。

**回應 200**

```json
{
  "data": {
    "user": { "userId": "6f1c…", "email": "student@example.com", "displayName": null },
    "role": "student",
    "deptScopes": [],
    "expiresAt": "2026-11-23T03:20:41+08:00"
  },
  "meta": { "requestId": "…", "generatedAt": "2026-11-16T03:20:41+08:00" }
}
```

| 欄位 | 說明 |
| --- | --- |
| `role` | `student` 或 `sysadmin`。**系所管理員看 `deptScopes` 是否非空**，不另立角色 |
| `deptScopes` | 可管理的系所代碼陣列；系統管理員為空陣列（代表不受系所限制） |
| `displayName` | Google 未提供時為 `null`，不以前端猜測填充 |

**狀態碼**：200、401（`AUTH_REQUIRED`）。
**回應標頭**：`Cache-Control: no-store`（下同，個人資料一律不快取）。

### 7.2 `DELETE /auth/session`

撤銷目前工作階段並清除 cookie。**狀態碼**：204（成功，無 body）、401（`AUTH_REQUIRED`）。

刻意回 204 而非 200 envelope：這是唯一沒有內容的成功回應，避免為了「一定有 `data`」而回一個空物件。

### 7.3 `GET /api/me/progress`

回傳指定情境下的畢業進度。資料來源：學生目前快照 ＋ 個人修正 ＋ 個人覆蓋 ＋ 指定的已發布規則版本。

**查詢參數**

| 參數 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `scenario` | enum | 否 | `completed`（預設）／`inProgress`／`planned`；對應 system-design.md §5.2 的篩選 |
| `bundleId` | string | 否 | 指定規則包；省略時用「該學生所屬系所與入學年度的最新已發布版本」 |
| `includeTrace` | boolean | 否 | 預設 `true`；關閉可縮小回應（畫面清單不需要 trace） |

**回應 200**

```json
{
  "data": {
    "bundleId": "cse-113-day",
    "versionId": "cse-113-day@3",
    "scenario": "completed",
    "overall": "unconfirmed",
    "totalCredits": 135,
    "requirements": [
      { "id": "R06", "name": "系內選修 46", "state": "met", "credits": 46, "min": 46, "gap": 0 },
      { "id": "R15", "name": "英文畢業門檻", "state": "unknown", "statusKey": "englishThreshold" }
    ],
    "openConflicts": ["X01"],
    "trace": [
      { "courseCode": "電資共通1", "courseName": "電資共通課程", "pool": "inner", "credits": 3, "cappedBy": "CAP-COLLEGE", "excludedReason": null }
    ],
    "dataSyncedAt": "2026-11-16T02:00:00+08:00"
  },
  "meta": { "requestId": "…", "ruleVersionId": "cse-113-day@3", "generatedAt": "…" }
}
```

`overall` 三態（`complete`／`unconfirmed`／`incomplete`）與 `requirements[].state` 三態（`met`／`notMet`／`unknown`）的語意依 system-design.md §5.2 第 6 步：有 `notMet` 即 `incomplete`；否則有 `unknown` 或未解衝突即 `unconfirmed`；其餘才是 `complete`。**未解衝突與未知狀態不得顯示為已完成。**

**狀態碼**：200；400 `REQUEST_INVALID`（`scenario` 非法）；401 `AUTH_REQUIRED`；403 `AUTH_DEPT_OUT_OF_SCOPE`（`bundleId` 不屬於該學生）；404 `RULE_BUNDLE_NOT_FOUND`／`RULE_VERSION_NOT_FOUND`；409 `RULE_VERSION_NOT_PUBLISHED`。

### 7.4 `GET /api/rules/{versionId}`

取得指定版本的中繼資料、來源卡與條文卡。學生端的條件詳情頁（AP-UI-03）與管理端的來源回溯都靠這支。

**查詢參數**

| 參數 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `include` | enum | 否 | `payload`：一併回傳整份規則包（管理端編輯用）。學生端不需要 |

**路徑參數**

| 參數 | 說明 |
| --- | --- |
| `versionId` | `bundleId@versionNo`，如 `cse-113-day@3`。以 `/` 分隔的版本號不合法，需回 400 |

**回應 200**

```json
{
  "data": {
    "versionId": "cse-113-day@3",
    "bundleId": "cse-113-day",
    "versionNo": 3,
    "status": "published",
    "schemaVersion": "1.0",
    "contentHash": "sha256:9f2a…",
    "publishedAt": "2026-11-10T10:00:00+08:00",
    "publishedBy": { "userId": "…", "email": "…" },
    "proxy": false,
    "sources": [
      { "sourceId": "S113-01", "title": "113 學年度大學部新生手冊", "url": "https://…", "locator": "印刷頁 8–12", "retrievedAt": "2026-10-14" }
    ],
    "clauses": [
      { "clauseId": "R06", "sourceId": "S113-01", "locator": "PDF 第 11 頁", "text": "系內選修至少 46 學分。", "reading": "系內選修…" }
    ]
  },
  "meta": { "requestId": "…", "ruleVersionId": "cse-113-day@3", "generatedAt": "…" }
}
```

`proxy: true` 代表由系統管理員代理發布、**未經系所管理者審核**；前端必須原樣顯示這個標示（FR-12、NFR-06）。

**狀態碼**：200；400 `REQUEST_INVALID`；401 `AUTH_REQUIRED`；404 `RULE_VERSION_NOT_FOUND`。學生端請求非 `published` 版本時回 409 `RULE_VERSION_NOT_PUBLISHED`（管理端可讀自己的草稿，第二批擴充時加權限判斷）。

### 7.5 `GET /healthz`（維運檢查，未進 openapi）

給本機、CI 與部署的健康檢查用，不是給前端呼叫的；成功也要有 `meta`（§3.1 沒有例外）。

**回應 200**

```json
{
  "data": { "db": "ok" },
  "meta": { "requestId": "…", "generatedAt": "2026-11-17T02:00:51.263+08:00" }
}
```

**回應 503**（資料庫連不上）

```json
{
  "error": { "code": "INTERNAL", "message": "資料庫目前無法連線，請稍後再試。", "retryable": true },
  "meta": { "requestId": "…", "generatedAt": "…" }
}
```

| 項目 | 規則 |
| --- | --- |
| 狀態碼 | 200（`select 1` 成功）、503（連線失敗或逾時） |
| `data.db` | 目前只有 `ok` 一個值；要加欄位是向後相容的擴充 |
| 錯誤碼 | 一律 `INTERNAL`；`retryable: true`，因為資料庫恢復後重試就會成功 |
| 標頭 | `X-Request-Id`、`Cache-Control: no-store` |
| 未匹配路徑 | 404 `RESOURCE_NOT_FOUND`，形狀同 §3.2（`data` → `error`） |

**為什麼 503 也用 envelope：** 監控與前端共用同一個解析路徑；`/healthz` 若例外回純文字，維運腳本就得為它寫第二套判斷。

### 7.6 AIS 同步（三段：開始／送驗證碼／取消）

**為什麼是三段而不是一支端點：** AIS 登入需要圖形驗證碼，且只有人能讀。開始的請求拿到驗證碼圖片後就結束，使用者看完圖再送出四碼；伺服器在記憶體裡保存「等待驗證碼」的登入狀態（預設 5 分鐘），不保存到資料庫。

**帳密的存放位置（NFR-04）：** 優先使用部署環境的 `AIS_ACCOUNT`／`AIS_PASSWORD`（`.env.local` 或平台環境變數），請求 body 也可臨時帶 `account`／`password`。兩者都**不**寫入資料庫、**不**寫入日誌、**不**回傳給前端（回應只給 `accountMasked`）。資料庫只存同步後的正規化快照與 `student_sync_state`。

**單一 AIS 身分的限制：** I2 的部署是「一個學生、一份 AIS 憑證」。多使用者上線前必須改成每人各自的 AIS 憑證（見 §11 待確認第 5 點），在那之前 `AIS_ACCOUNT` 只能是部署者本人。

#### 7.6.1 `POST /api/me/sync/ais`

**請求 body**（`additionalProperties: false`；全部選填）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `account` | string | 臨時覆蓋的 AIS 學號；與 `password` 必須成對出現 |
| `password` | string | 臨時覆蓋的 AIS 密碼；只存在記憶體，登入後立刻丟棄 |

**回應 202**

```json
{
  "data": {
    "syncId": "k3Jd…",
    "captchaImage": "data:image/png;base64,iVBORw0…",
    "expiresAt": "2026-11-17T04:35:00+08:00",
    "accountMasked": "B12****78",
    "source": "env"
  },
  "meta": { "requestId": "…", "generatedAt": "…" }
}
```

| 欄位 | 說明 |
| --- | --- |
| `captchaImage` | PNG data URL；前端直接當 `<img src>`，不要另外存檔 |
| `expiresAt` | 驗證碼輸入期限；過了就必須重新開始 |
| `source` | `env`（用部署設定）或 `request`（用這次帶入的憑證） |

**狀態碼**：202；400 `AIS_CREDENTIALS_NOT_CONFIGURED`（兩邊都沒有帳密）、400 `REQUEST_INVALID`（只帶一半憑證）；401 `AUTH_REQUIRED`；403 `AUTH_ORIGIN_MISMATCH`；409 `SYNC_ALREADY_RUNNING`；502 `SYNC_FAILED`（連 AIS 就失敗，例如 `AIS_UNAVAILABLE`）。

#### 7.6.2 `POST /api/me/sync/ais/{syncId}`

**請求 body**

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `captcha` | string | 是 | 四碼英數字；大小寫不拘，伺服器轉大寫 |

**回應 200**

```json
{
  "data": {
    "status": "succeeded",
    "counts": { "total": 63, "passed": 58, "failed": 2, "inProgress": 5, "unknown": 1 },
    "dataSyncedAt": "2026-11-17T04:32:10+08:00",
    "unmatched": [
      { "courseCode": "B9999", "courseName": "機器學習", "reason": "AIS 只標示「選修」，沒有開課系所，無法判定系內或外系選修" }
    ],
    "profile": { "deptId": "cse", "entryYear": 113, "program": "day", "missing": [] },
    "warnings": ["未設定 AIS_TIMETABLE_YEAR／AIS_TIMETABLE_TERM，這次同步不含本學期修課中資料。"],
    "persisted": { "insertedOrUpdated": 63, "removed": 0 }
  },
  "meta": { "requestId": "…", "generatedAt": "…" }
}
```

| 欄位 | 說明 |
| --- | --- |
| `counts` | 寫入快照的紀錄數（依狀態分）；`total` 不一定等於修課門數（同一門課重修會是多筆） |
| `unmatched` | **分類未確認**的課程。前端必須列出筆數，不得把未知說成已通過或已排除 |
| `profile.missing` | `deptId`／`entryYear`；非空時前端要引導使用者用 §7.7 補齊，否則 `/api/me/progress` 會找不到規則包 |
| `persisted.removed` | AIS 已經沒有、因此被移除的舊紀錄數（只清 `ais:` 開頭的紀錄，個人修正不動） |

**狀態碼**：200；400 `SYNC_CAPTCHA_INVALID`／`REQUEST_INVALID`；401 `AUTH_REQUIRED`；403 `AUTH_ORIGIN_MISMATCH`；404 `SYNC_NOT_FOUND`；409 `SYNC_EXPIRED`；502 `SYNC_FAILED`——`error.code` 會是上游的具體原因（`AIS_LOGIN_REJECTED`、`CAPTCHA_RECOGNITION_EXHAUSTED`、`AIS_TIMEOUT`、`AIS_STUDENT_IDENTITY_MISMATCH` 等），`error.message` 是中文說明，**不含帳密、HTML 或 Cookie**。

**失敗時的行為**：不清空既有快照、不改 `student_sync_state.last_success_at`；只把 `last_result='failed'` 與穩定的 `last_error_code` 寫進去，畫面因此還能顯示「上次成功同步時間」。

#### 7.6.3 `DELETE /api/me/sync/ais/{syncId}`

取消尚未完成的同步（例如使用者關掉對話框）。**狀態碼**：204（無 body）；401；403 `AUTH_ORIGIN_MISMATCH`；404 `SYNC_NOT_FOUND`。

### 7.7 `PATCH /api/me/profile`

補齊 `/api/me/progress` 決定規則包所需的學籍屬性。AIS 成績頁若帶系所名稱，同步時會自動對應 `departments.name`；入學年度**不會**自動推論（年級不等於入學年度），一律由學生填寫。

**請求 body**（`additionalProperties: false`；至少一個欄位）

| 欄位 | 型別 | 限制 |
| --- | --- | --- |
| `deptId` | string | 必須存在於 `departments.dept_id` |
| `entryYear` | integer | 100–130（民國年；與 `users.entry_year` 的 CHECK 一致） |
| `program` | enum | `day`／`night` |

**回應 200**：`{ "data": { "deptId": "cse", "entryYear": 113, "program": "day" } }`
**狀態碼**：200；400 `REQUEST_INVALID`（`details` 指出欄位與原因）；401 `AUTH_REQUIRED`；403 `AUTH_ORIGIN_MISMATCH`。

### 7.8 管理端發布流程（已實作，未進 openapi）

實作在 `server/routes/admin.ts`；狀態機、權限矩陣與稽核欄位以 [system-design.md](system-design.md) §7、§8 為準，本節只固定 HTTP 形狀。**這批刻意不進 `openapi.yaml`**：管理端路徑與錯誤碼還會隨 I3 的 UI 整合調整。

**共同規則**

- 身分：`planner_session` → `resolveIdentity()`；沒有身分 401 `AUTH_REQUIRED`。
- 權限：`loadDeptScopes()` ＋ `can()`（24 格矩陣）；不在範圍 403 `AUTH_DEPT_OUT_OF_SCOPE`，完全沒有管理權 403 `AUTH_FORBIDDEN`。
- CSRF：所有 POST／PUT／PATCH／DELETE 檢查同源 `Origin`，不同源 403 `AUTH_ORIGIN_MISMATCH`（沒有 `Origin` 的 curl 放行）。
- 一律 `Cache-Control: no-store`；成功 `{data,meta}`、失敗 `{error,meta}`。
- 請求 body 上限 1 MiB；未知欄位拒絕（400 `REQUEST_INVALID` ＋ `details`）。

| 端點 | 請求 | 成功（200／201） | 主要錯誤 |
| --- | --- | --- | --- |
| `POST /api/admin/rules/{bundleId}/draft` | `{ payload? }`；省略時複製最新版本 | **201** `{ versionId, bundleId, versionNo, status, schemaVersion, contentHash, createdAt }` | 400、404 `RULE_BUNDLE_NOT_FOUND` |
| `GET /api/admin/rules/{versionId}` | — | `{ versionId, bundleId, versionNo, status, schemaVersion, contentHash, publishedAt, proxy, payload, allowedActions }` | 400、401、403、404 `RULE_VERSION_NOT_FOUND` |
| `PUT /api/admin/rules/{versionId}` | `{ payload }` | `{ versionId, status, contentHash, updatedAt }` | 400、409 `RULE_VERSION_IMMUTABLE`（非 draft） |
| `POST …/validate` | `{}` | `{ versionId, valid: true, errors: [], checkedAt }` | 422 `RULE_VALIDATION_FAILED`（`details` 逐條，狀態留在 draft） |
| `POST …/test` | `{ records?, scenario?, statuses? }` | `{ versionId, suite, scenario, passed, failed, overall, totalCredits, results }` | 422 `RULE_TEST_FAILED` |
| `POST …/submit` | `{}` | `{ versionId, status: in-review, submittedAt }` | 409（狀態不是 draft） |
| `POST …/approve` | `{}` | `{ versionId, status: approved, reviewedBy, reviewedAt }` | 409（狀態不是 in-review） |
| `POST …/reject` | `{ reason }`（必填，≤2000 字） | `{ versionId, status: draft, notes, reviewedBy, reviewedAt }` | 400、409 |
| `POST …/publish` | `{}` | `{ versionId, status: published, publishedAt, publishedBy, proxy, superseded[] }` | 422（投影／驗證失敗）、403（代理發布條件不符）、409（狀態不是 approved） |
| `GET …/diff` | — | `{ versionId, bundleId, versionNo, status, previousVersionId, summary, requirements, clauses, sources }` | 404 |
| `GET /api/admin/audit` | `limit?`（預設 50）、`cursor?`（`record_id`）、`versionId?` | `{ items[], nextCursor, limit }` | 400（拒 `offset`）、403 |

**`allowedActions`**：由狀態與 `can()` 共同決定——`draft`→`validate`／`test`（需 `validateDraft`）、`submit`（需 `editDraft`）；`in-review`→`approve`／`reject`（需 `reviewDraft`）；`approved`→`publish`（需 `publishVersion`）；`published`／`superseded`／暫態→`[]`。

**diff 形狀**：`requirements`／`clauses`／`sources` 三個區塊，各自是 `{ added[], removed[], changed[] }`；`changed` 的每一筆附 `before`／`after` 與逐欄位 `changes[]`。`summary` 是三區塊的計數總和；第一版的 `previousVersionId` 為 `null`、全部列為 `added`。

**`/test` 的語意**：有帶 `records` 就用 provided-records 跑；沒帶就用空資料檢核，檢查三態、缺額與門檻的一致性、`and`/`or` 與子節點一致、`overall` 與三態一致。**空資料的缺額不算失敗**（缺資料不等於規則錯）。

**交易邊界**：`QueryFn` 是 `pool.query`，跨 statement 的 `BEGIN/COMMIT` 會落在不同連線，因此所有狀態轉移都寫成**單一 statement 的 data-modifying CTE**（狀態更新 ＋ `review_records` 一起成立或一起不成立）。發布前先把 payload 投影到 `rule_sources`／`rule_clauses`（0017 的 trigger 要求 published 前完成），再 supersede 舊版。

**已知限制（不假裝）**

1. `review_records.action` 的 CHECK 目前只有八個值，沒有 `updated`，所以 `PUT` 改草稿內容**不會**單獨留一列稽核；`validate`／`submit` 會帶新的 `content_hash`，事後可從版本內容與發布紀錄追。
2. 跨系所的拒絕沒有專屬 action 可寫，因此只回 403、不寫 `review_records`（不用 `rejected` 冒充）。
3. `POST /api/admin/departments/{deptId}/admins` 尚未實作；I2 的系所管理員以受控 SQL／種子設定（符合 SRS FR-12 的「受控設定」）。
4. `validateBundle()` 只驗結構與參照，不驗語意（例如 selector 指到不存在的 tag 仍會通過）；`/test` 的空資料檢核與發布前的投影檢查才是第二、三道關卡。

## 8. 分頁、排序與速率

- **分頁**：本批三個端點都不需要（單一版本、單一學生的資料量有上限）。清單型端點（稽核、規則包）導入時統一用 `?limit=&cursor=`，不用 `offset`：稽核紀錄會持續新增，offset 會重複或漏資料。
- **排序**：由伺服器決定（版本時間軸用 `at asc`、條文用 `clauseId`）；不開放客戶端指定，避免回應語意隨參數改變。
- **速率限制**：I2 不啟用（單一校內部署、無對外 API）。代碼 `RATE_LIMITED` 先保留，實作時一併加 `Retry-After`。

## 9. 回應標頭

| 標頭 | 何時 | 說明 |
| --- | --- | --- |
| `X-Request-Id` | 全部 | 與 `meta.requestId` 相同；客戶端回報問題時附上 |
| `Cache-Control: no-store` | 全部個人端點 | 個人資料不得被瀏覽器或中介快取 |
| `Content-Type: application/json; charset=utf-8` | 有 body 時 | — |
| `Sunset` | API 版本淘汰期 | 依 §5 第 2 點 |

## 10. 與其他文件的界線

| 事實 | Owner | 其他文件 |
| --- | --- | --- |
| 請求／回應形狀、錯誤碼、標頭 | **本文件 ＋ [openapi.yaml](openapi.yaml)** | — |
| 資料表與欄位型別 | [database-design.md](database-design.md) | 本文件只說「回傳什麼欄位」 |
| 權限矩陣（誰能做什麼） | [system-design.md](system-design.md) §8 | 本文件只引用 |
| 引擎三態與演算法 | [system-design.md](system-design.md) §5 | 本文件只定義輸出形狀 |
| 端點清單的原始草案 | [system-design.md](system-design.md) §10 | 本文件是展開後的契約；§10 保留概覽並連回本文件 |

## 11. 待確認

1. **`/api/check` 是否真的需要**：`GET /api/me/progress` 加上 `scenario` 參數已能涵蓋三情境；`POST /api/check` 若要支援「帶入假設資料試算」（規劃情境），需要另一個請求 body 形狀。目前保留在待擴充清單，等 Step 6 的 UI flow 確定後再定。
2. **`deptScopes` 對系統管理員回空陣列的語意**：空陣列容易被誤讀成「什麼都不能管」。實作時是否改回 `deptScopes: "*"` 或加 `isSysadmin: true` 旗標，需在 AP-I2-03 定案（本文件先採「空陣列 ＋ `role: sysadmin`」）。
3. **工作階段到期時間**：7 天是暫定值；若考慮校園公用電腦，可能需要更短（如 12 小時）並加「記住我」。
4. **`includeTrace` 的預設值**：目前預設 `true`（方便除錯），但畫面清單用不到；若回應大小成為問題再改預設 `false`。

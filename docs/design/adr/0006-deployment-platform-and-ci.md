# ADR-0006：部署平台與 CI 邊界

Extends: system-design.md §3（容器到元件）、§12.2（風險）

- **狀態**：**CI 部分 Accepted（已實作並綠燈）／部署平台部分 Proposed（待確認）**
- **日期**：2026/11/16
- **決策者**：第七組（tky-kevin 彙整）
- **對應需求**：NFR-04（身分與資料安全）、NFR-08（儲存可靠性）、NFR-09（可維護與可測試）
- **上游依據**：SRS §2.5「部署｜Linux 主機上的網站與後端服務，對外採 HTTPS」

## 背景

兩件事必須分開講，因為它們的成熟度不同：

1. **CI 已經存在且跑過了。** [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) 在 2026/11/16 首次於 `main` 綠燈（run [43753967327](https://github.com/tky-kevin/ntouer-academic-planner/actions/runs/43753967327)：`web` 11 秒、`docs` 6 秒）。
2. **部署平台還沒有任何決定。** SRS 只寫「Linux 主機、HTTPS」，沒有說誰的主機、怎麼進版、環境有幾個。

同時，CI 的**邊界**必須寫下來，否則後面每個人都會想「順便把資料庫塞進 CI」。這條邊界是：**CI 不得使用 secrets、不得連外部服務**。它直接影響了 [ADR-0004](0004-migration-tooling.md)（遷移不進 CI）與 [ADR-0005](0005-test-framework-and-e2e.md)（E2E 不進 CI）。

## 決策

### CI（已定案，已實作）

1. **GitHub Actions**，觸發 `push`（main）與 `pull_request`；`permissions: contents: read`；同分支 `concurrency` 取消舊作業；每個 job `timeout-minutes: 10`。
2. **兩個 job，職責不重疊**：
   - `web`：`npm ci` → `npm run build` → `npm test`（Node 22.x）
   - `docs`：`node docs/design/spike/run-cases.mjs`（27 項須全過）→ `node scripts/check-doc-links.mjs` → `docs/design/openapi.yaml` 存在時跑 OpenAPI lint
3. **沒有 secrets、沒有外部服務、沒有 `continue-on-error`。** 紅燈就修到綠，不用「先跳過」掩蓋。
4. **`main` 的合併條件**：PR ＋ 1 個 approving review ＋ 兩個 required status checks（`web`、`docs`）。
   - 現況（2026/11/16 以 API 查得）：PR 與 1 個 review 已啟用、`enforce_admins: false`；**required status checks 尚未設定**，需由 repo owner 在設定頁加上 `web` 與 `docs`。

### 分支策略

| 分支 | 用途 | 規則 |
| --- | --- | --- |
| `main` | 唯一長命分支，隨時可部署 | 只能經 PR 合併；需要 `web`、`docs` 綠燈 |
| `feat/*`、`fix/*`、`docs/*` | 短命工作分支 | 一個 PR 一件事；合併後刪除 |

不採 Git Flow（`develop`／`release` 分支）：5 人、單一交付線，多一層分支只會多一次合併。

### 部署單元（建議）

1. **一個 Node 服務同時提供 API 與前端靜態檔**（同源）。理由：避免 CORS 與跨網域 cookie（ADR-0003 的 `SameSite=Lax` session 需要同源），也少一組部署設定。
2. **PostgreSQL 由託管服務或同機容器提供**；`rule_versions.payload` 與稽核表不可遺失（NFR-08），備份策略是部署的必要條件，不是加分項。
3. **HTTPS 終結在反向代理或平台層**（Caddy／Nginx／平台自帶）；應用程式只信任 proxy 轉來的 `X-Forwarded-*`。
4. **Secrets 只存在部署環境的環境變數**：OIDC client secret、資料庫連線字串。不進 repo、不進 CI、不進前端 bundle（`verify-client-boundary.mjs` 已在 build 階段檢查前端不得含 AIS 憑證與 fixture）。
5. **I2 不做 CD。** 先手動部署；自動部署要等環境穩定、有回滾流程之後再說。

### 環境

| 環境 | 用途 | I2 是否必要 |
| --- | --- | --- |
| Dev | 本機開發：Vite dev server ＋ 本機 PostgreSQL（容器）；CI 只驗 build 與測試 | **是** |
| Staging | 部署前驗收：同一份 artifact、獨立資料庫 | 待確認（見下） |
| Prod | 正式提供學生與管理者使用 | 待確認（見下） |

## 為什麼不是其他作法

| 替代方案 | 為何不採用 |
| --- | --- |
| 在 CI 裡起 PostgreSQL 跑整合測試 | 會把資料庫與（若含登入）憑證帶進 CI，違反本 ADR 的邊界；且與 `web` job 目前的 11 秒回饋差距太大。整合測試留在本機／I3 的獨立 job。 |
| 前端與後端分開部署（兩個網域） | 跨網域 cookie 需要 `SameSite=None` ＋ CORS 白名單，等於自己拆掉 ADR-0003 的保護。 |
| 只在 `main` 上直接開發（無 PR） | 現有的 1 review 保護會被迫關掉；且 required checks 沒有 PR 就沒有意義。 |
| 自動部署（CD）到 I2 | 還沒有穩定的環境與回滾流程；自動化一個不穩定的流程只會放大錯誤。 |
| **GitHub Actions ＋ 手動部署 ＋ 同源單一服務（採用）** | 工具鏈單一、無 secrets、回饋快；部署成本低。 |

## 後果

**好處**

- CI 不需要任何 secret，任何人 fork 都能跑；這也是它能公開綠燈的原因。
- 兩個 job 合計不到 20 秒，紅燈回饋快，開發者不會想繞過。
- 分支策略只有 `main` ＋ 短命分支，5 人團隊的合併成本最低。

**代價與風險**

- **CI 綠燈不等於系統可用。** 它不驗資料庫、不驗登入、不驗部署；這是刻意的邊界，必須在報告與 Issue 說清楚（NFR-06 的誠實呈現）。
- **required status checks 未設定前，保護是殘缺的。** 目前 `enforce_admins: false`，owner 可以直接推 `main`（本次兩個 commit 就是如此）；設定 checks 後仍可被 owner 繞過，需另外決定是否 `enforce_admins`。
- **沒有環境就沒有真實的部署驗收。** I2 的「可部署」在沒有主機前只是「可建置」。
- **`ubuntu-latest` 會漂移。** GitHub 已預告 label 將遷移到 Ubuntu 26；需要時鎖 `ubuntu-24.04`。

## 驗證方式

- CI：`main` 上 run 43753967327 兩個 job 皆 success；`web` 的日誌可見 `Test Files 5 passed`，`docs` 可見 `27 通過、0 失敗` 與 `check-doc-links: 0 個壞連結`。
- 邊界：`grep -n "secrets\." .github/workflows/ci.yml` 應無結果；`grep -n "continue-on-error"` 亦應無結果。
- 保護：`gh api repos/tky-kevin/ntouer-academic-planner/branches/main/protection` 應出現 `required_status_checks` 含 `web`、`docs`。

## 待確認

1. **有沒有可用的主機？** 校內 VM、雲端免費層（Render／Railway／Fly.io）或自架。這決定 Staging／Prod 能不能在 I2 落地；沒有主機前，I2 的部署產出僅到「可建置 ＋ 有 Dockerfile／啟動腳本」。
2. **Staging 是否必要？** 建議先只做 Dev ＋ 一個 Prod（或稱 Demo 環境），5 人團隊不需要三環境；但評閱若要求分環境，再補。
3. **要不要 `enforce_admins: true`？** 開了 owner 也不能直推 `main`；好處是流程一致，壞處是急修時多一道手續。
4. **`ubuntu-latest` 是否鎖版本？** 建議鎖 `ubuntu-24.04` 避免映像漂移，本輪先維持 `ubuntu-latest`。

## 相關

- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)：CI 實作本體。
- [ADR-0003 Google OIDC](0003-google-oidc-identity.md)：同源 cookie 與 secret 邊界。
- [ADR-0004 migration 工具](0004-migration-tooling.md)、[ADR-0005 測試框架](0005-test-framework-and-e2e.md)：兩者都受限於「CI 不用 secrets」。
- `system-design.md`（Step 4 補章）：Dev／Staging／Prod、部署流程、日誌欄位、監控指標與告警。

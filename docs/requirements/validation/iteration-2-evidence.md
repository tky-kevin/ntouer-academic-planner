# Iteration 2 驗證證據（2026/11/17）

> 本檔只記錄**這次真的跑過的指令與輸出**，以及「還沒驗證」的部分。
> I1 的檢查紀錄保留在 [doc-implementation-check.md](doc-implementation-check.md)，不改寫。

檢查時間：2026/11/17 04:00–05:00（Asia/Taipei）
環境：Windows、Node v24.11.1、npm 11.6.2、Docker Desktop、PostgreSQL 16（`docker compose` 的 `db`，127.0.0.1:5433）

## 1. 自動化證據

| 檢查 | 指令 | 實際輸出 | 判定 |
| --- | --- | --- | --- |
| 單元／元件 | `npm test` | 33 檔、323 測試通過 | ✅ |
| DB 整合 | `npm run test:db` | 6 檔、21 測試通過 | ✅ |
| 建置 | `npm run build` | `tsc -b` ＋ Vite 三入口成功；client boundary `PASS` | ✅ |
| spike | `node docs/design/spike/run-cases.mjs` | `結果：27 通過、0 失敗（共 27 項）` | ✅ |
| 規則覆蓋對照 | `node scripts/verify-rule-coverage.mjs` | `46/46 mapped（6 筆 clauseId:null 已附理由）` | ✅ |
| 文件連結 | `node scripts/check-doc-links.mjs` | 25 個 Markdown、222 個相對連結、0 壞連結 | ✅ |
| OpenAPI | `npx @redocly/cli lint docs/design/openapi.yaml` | `Your API description is valid` | ✅ |

## 2. 真實系統證據（本機同源 3000）

服務：`npm run start:api`（API 同時服務 `dist/`）＋ compose 的 `db`。

| 檢查 | 指令 | 實際結果 |
| --- | --- | --- |
| 健康檢查 | `curl /healthz` | 200 `{"data":{"db":"ok"},…}` |
| 前端同源 | `curl /` | 200 `text/html` |
| 未登入 | `curl /auth/session` | 401 `AUTH_REQUIRED` |
| 學生進度（dev 身分） | `curl '/api/me/progress?scenario=completed'` | 200；`cse-113-day@1`、總學分 135、`overall=unconfirmed`（X01 未解衝突） |
| 管理端未授權 | `POST /api/admin/rules/cse-113-day/draft` | 403 `AUTH_FORBIDDEN`（dev 學生沒有系所管理權） |
| 管理端讀取版本 | `GET /api/admin/rules/{versionId}`（dev-admin 身分） | 200；published 的 `allowedActions=[]`、payload 19 個 requirement；跨系所（mmd）回 403 `AUTH_DEPT_OUT_OF_SCOPE` |
| **發布流程（真實 DB，dev-admin）** | `create draft → validate → test → submit → approve → publish` | `cse-113-day@2` published、`superseded=cse-113-day@1`；`/api/me/progress` 立即改用 @2（135 學分、19 條件） |
| 稽核紀錄 | `GET /api/admin/audit` | 7 筆：`created, validated, tested, submitted, approved, superseded, published` |
| **AIS 登入頁可達** | `POST /api/me/sync/ais`（帶 `.env.local` 的真實帳密） | **202**、`captchaImage` 為真的 PNG data URL、851 ms；AIS 已回登入表單與驗證碼 |

## 3. 真人流程（已用真實帳號完成）

| 步驟 | 狀態 | 證據 |
| --- | --- | --- |
| Google OIDC 登入（`/auth/google/start` → callback → cookie） | ✅ 完成 | `users` 有真實帳號（非 `dev-*`）、`last_login_at` 有值、`sessions` 有一筆未撤銷且未到期的列 |
| 學籍補齊（系所／入學年度） | ✅ 完成 | 該帳號 `dept_id=cse`、`entry_year=113`（由使用者在進度頁填寫） |
| AIS 登入 → 驗證碼 → 讀成績 → 寫入 `student_records` | ✅ 完成（2026/11/17 05:22:29） | `student_sync_state.last_result=ok`、`student_records` 有 **59 筆** `ais:` 紀錄、`/api/me/progress` 回 `dataSyncedAt=2026-11-17T05:22:29+08:00` |
| 真實資料檢核 | ✅ 完成 | `cse-113-day@1`、`overall=incomplete`、`totalCredits=94`（含採計上限）、R08 國文 4/4、R09 大一英文 4/4、R11 海洋 2/2、R12 人工智慧 2/2 為 `met` |

**打通過程中修掉的兩個真實問題**（都已用 AIS 實際回應驗證）：

1. **選單改版**：AIS 的 `MenuTree.aspx` 從 `TreeView_PopulateNode` 改成 `__doPostBack('Menu_TreeView','t…')`，舊解析直接 `contractChanged`。已支援兩種格式（用真實回應驗證：根選單 30 節點、展開教務系統後 41 節點、`成績系統 = NTOU\STU\STU$0002`）。
2. **選單不可靠**：連續 postback 會讓 TreeView 收起子樹並回 403 系統錯誤頁。改成**先直接 GET 成績查詢頁**（同一份 session cookie），失敗才退回選單導覽；實際成功路徑是 `try_direct_grades_query_page` → `query_grades_history` → `open_grades_detail` → `query_grades_detail`（Crystal Reports，首次較慢，放寬到 45 秒）。

**分類對照（真實資料）**：`data/rules/113-cse-classification.json` 依實際課名與課號補了 `英文(大一英文)`（contains）、裸 `微積分`、`B57`＝資工系開課（ELE＋inner／program）、`B92`＝體育（CE＋pe）。已同步的 59 筆用 `npm run db:reclassify` 重新分類（29 筆變更），不需要重新登入 AIS。

**仍然對不上、且刻意不猜的**：

| 項目 | 原因 | 目前行為 |
| --- | --- | --- |
| R04 的 `微積分(上)`／`(下)` | AIS 課名只寫「微積分」，沒有上／下 | 計入系訂必修學分（R03），R04 仍列為缺少，等課程目錄的完整課名 |
| R07 核心選修 12 | 核心選修清單在課程地圖（PDF），未數位化 | `unknown` |
| 部分通識／外語選修（例如 `資料探勘` M57、`社會企業經營與行銷〈全球〉`） | 課名不在官方清單、課號非 B57 | `unknown`，同步結果的 `unmatched` 會列出 |
| R15～R19（英文門檻、操行、體育四學期、游泳、進階英文資格） | AIS 成績頁沒有這些欄位 | `unknown`，需人工修正或 I3 補資料來源 |


## 4. 文件與實作一致性

| 文件 | 對應實作 | 驗證方式 |
| --- | --- | --- |
| `api-spec.md` §7.3／§7.6／§7.7 | `server/routes/progress.ts`、`sync.ts` | `server/routes/*.test.ts` 打真實 HTTP；openapi lint |
| `openapi.yaml`（8 個 path） | 同上 | redocly valid |
| `system-design.md` §5.5（未分類 → unknown） | `src/engine/ruleEngine.ts` | `ruleEngine.unclassified.test.ts`（5 案例） |
| `system-design.md` §14.4（AIS 同步與帳密邊界） | `server/ais/sync.ts`、`server/ais/persist.ts` | `server/ais/sync.test.ts`（12 案例） |
| `system-design.md` §15.3（部署） | `Dockerfile`、`compose.yaml`、`scripts/docker-entrypoint.sh` | `docker compose up -d --build` → `/healthz` 200 |
| `database-design.md` §3.11／§3.15 | `student_records`、`student_sync_state`（無 schema 變更） | `test:db` |
| `test-plan.md` TC 對照 | 上表 28＋5 檔測試 | `npm test`／`test:db` |

## 5. 仍然不成立的宣稱（不要寫進報告）

- **多使用者**：目前一個部署只有一份 AIS 憑證（`AIS_ACCOUNT`），不是每人各自的憑證。
- **系內／外系選修自動判定**：AIS 沒有開課系所欄位；未分類課程會進 `unmatched`，相關條件回 `unknown`。
- **管理端草稿編輯器**：兩頁已接真 API（驗證／測試／送審／核准／退回／發布／diff／稽核），但沒有 payload 編輯器（UI-08／09 的線稿本來就沒有；`PUT` 與 `updateDraft()` 已備好給 I3）。
- **學期計畫、缺額篩選、衝堂、AI PDF 整合**：屬 I3，未實作。
- **可部署 ≠ 已部署**：只有本機 Docker 驗證，沒有對外主機與 HTTPS。

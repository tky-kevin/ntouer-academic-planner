# Iteration 2 驗證證據（2026/11/17）

> 本檔只記錄**這次真的跑過的指令與輸出**，以及「還沒驗證」的部分。
> I1 的檢查紀錄保留在 [doc-implementation-check.md](doc-implementation-check.md)，不改寫。

檢查時間：2026/11/17 04:00–05:00（Asia/Taipei）
環境：Windows、Node v24.11.1、npm 11.6.2、Docker Desktop、PostgreSQL 16（`docker compose` 的 `db`，127.0.0.1:5433）

## 1. 自動化證據

| 檢查 | 指令 | 實際輸出 | 判定 |
| --- | --- | --- | --- |
| 單元／元件 | `npm test` | 29 檔、286 測試通過 | ✅ |
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
| **AIS 登入頁可達** | `POST /api/me/sync/ais`（帶 `.env.local` 的真實帳密） | **202**、`captchaImage` 為真的 PNG data URL、851 ms；AIS 已回登入表單與驗證碼 |

## 3. 真人流程（需要使用者本人）

| 步驟 | 狀態 | 證據 |
| --- | --- | --- |
| Google OIDC 登入（`/auth/google/start` → callback → cookie） | 待使用者執行 | 完成後檢查 `sessions` 資料列與 `GET /auth/session` 200 |
| AIS 驗證碼輸入 → 寫入 `student_records` | 待使用者執行 | 完成後檢查 `student_records` 筆數、`student_sync_state.last_success_at`、`/api/me/progress` 的 `dataSyncedAt` |
| 學籍補齊（系所／入學年度） | 待使用者執行 | 新帳號第一次登入時 `profile.missing` 非空，補完後進度頁應載入 |

**為什麼不能自動：** AIS 登入需要圖形驗證碼，只有人能讀（`AIS_OCR_URL` 未設定）。Google 登入需要使用者本人的帳號授權。兩者都不該由代理代勞。

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
- **管理端 UI 已接真 API**：後端端點與測試完成，兩頁仍吃 `src/data/mockAdmin.ts`。
- **學期計畫、缺額篩選、衝堂、AI PDF 整合**：屬 I3，未實作。
- **可部署 ≠ 已部署**：只有本機 Docker 驗證，沒有對外主機與 HTTPS。

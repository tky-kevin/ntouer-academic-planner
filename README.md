# NTOUER Academic Planner — Iteration 2

[![CI](https://github.com/tky-kevin/ntouer-academic-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/tky-kevin/ntouer-academic-planner/actions/workflows/ci.yml)

海大智慧修課與畢業規劃系統。I2 交付三件事：

1. **學生端畢業進度頁**（`/`）：三情境（已完成／修課中／規劃中）、總學分、條件卡三態（已達成／未達成／尚未確認）、未解衝突、四種狀態（Loading／Empty／Error／無權限）。
2. **管理端**：`/admin-validate.html`（結構驗證與測試）、`/admin-review.html`（版本差異與審核）。
3. **後端**：`node:http`＋`pg`（沒有 ORM），統一回應 envelope、`/healthz`、`GET /api/rules/{versionId}`、`GET /api/me/progress`、Google OIDC 登入與資料庫工作階段。

需求與設計的入口是 [docs/README.md](docs/README.md)；API 契約是 [api-spec.md](docs/design/api-spec.md)＋[openapi.yaml](docs/design/openapi.yaml)。

I1 的 demo 畫面保存在 git tag **`i1-demo`**（`git show i1-demo:src/App.tsx`），不再出現在產品程式碼裡。

## 安裝與執行

需要 Node.js 22.12 以上（建議 Node 24 LTS）、npm、Docker（PostgreSQL 16）。

```powershell
git clone https://github.com/tky-kevin/ntouer-academic-planner.git
cd ntouer-academic-planner
npm ci

# 1. 資料庫
docker run -d --name planner-db -e POSTGRES_USER=planner -e POSTGRES_PASSWORD=planner `
  -e POSTGRES_DB=planner -p 5433:5432 postgres:16-alpine
npm run db:migrate
npm run db:seed

# 2. 環境變數
cp .env.example .env.local   # 填 GOOGLE_CLIENT_ID/SECRET 與 SESSION_SECRET（不進 repo）

# 3. 前端與 API（兩個終端機）
npm run dev      # http://localhost:5173
npm run start:api # http://localhost:3000
```

`GET /healthz` 應回 `{"data":{"db":"ok"},"meta":{…}}`；資料庫停止時回 503 `INTERNAL`。

### 登入與開發身分

- 瀏覽器登入：`GET /auth/google/start` → Google → `GET /auth/callback` → 設 `planner_session` cookie（HttpOnly、SameSite=Lax，資料庫只存 SHA-256）。
- 還沒完成 Google 設定時：`GET /api/me/progress` 會用 `.env.local` 的 `DEV_USER_SUB`（預設 `dev-student`）當登入者。`npm run db:seed` 會建立這個學生（113 資工、52 筆紀錄、135 學分、5 個條件覆蓋）。

### demo 資料

- `dev-student`：113 資工，資料與 spike 的 `cseComplete()` 同一組，`overall = unconfirmed`（X01 未解衝突）。
- `cse-113-day@1`：published；`mmd-115-day@1`：draft（seed 預設種 draft，若需要 published 由測試或手動設定）。
- 規則包樣本：`docs/design/examples/113-cse.json`、`115-mmd.json`。

## 驗證指令

```powershell
npm test                                  # 單元／元件測試（含 27＋5 項引擎案例）
npm run test:db                           # 需要 PostgreSQL 的整合測試（session、routes、progress）
npm run build                             # tsc -b ＋ Vite 多入口建置 ＋ client boundary 檢查
node docs/design/spike/run-cases.mjs      # spike 27 項（歷史證據，CI docs job 也會跑）
node scripts/check-doc-links.mjs          # 文件相對連結
npx --yes @redocly/cli@latest lint docs/design/openapi.yaml
```

CI 有三個 job：`web`（build ＋ 單元測試）、`docs`（spike、連結、OpenAPI lint）、`api`（Postgres service ＋ migrate ＋ seed ＋ `test:db`）。

## 程式碼地圖

| 路徑 | 內容 |
| --- | --- |
| `server/index.ts` | 進入點：環境、`pg` pool、graceful shutdown |
| `server/app.ts` | 路由表、`X-Request-Id`、404／500 envelope |
| `server/routes/` | `rules.ts`、`progress.ts`、`auth.ts` |
| `server/auth/` | OIDC（PKCE、ID token 驗證）與 session |
| `src/engine/ruleEngine.ts` | 規則引擎（六型節點、池與上限、三態、trace） |
| `src/pages/` | 學生進度頁與管理端兩頁 |
| `src/data/` | `mockProgress`（學生頁 mock）、`mockAdmin`（管理端 mock） |
| `db/migrations/` | 21 個遷移；`db/seed/` 種子與 dev-student fixture |
| `docs/design/` | 系統設計、API、DB、UI/UX、規則模型、ADR、spike |

學生端目前吃 `src/data/mockProgress.ts`；`GET /api/me/progress` 已是真實引擎輸出，接線時只要把 loader 換成 fetch（Issue #20 的說明）。管理端兩頁同理吃 mock，真端點屬 #14。

## 已知邊界

- 管理端的發布流程端點（validate／test／submit／approve／publish／diff／audit）尚未實作；#14 已關閉並拆分，屬 I3。
- AIS 同步（`server/ais/`）是既有 adapter，尚未寫入 `student_records`；`category` 的 AIS→CE/REQ/ELE 映射需與系所確認（見 [database-design.md](docs/design/database-design.md) §3.11）。
- 完整 Google 登入需要瀏覽器與 Google 帳號，CI 只覆蓋純函式與 session 路由。

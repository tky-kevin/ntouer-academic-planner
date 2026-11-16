# NTOUER Academic Planner — Iteration 2

[![CI](https://github.com/tky-kevin/ntouer-academic-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/tky-kevin/ntouer-academic-planner/actions/workflows/ci.yml)

海大智慧修課與畢業規劃系統。I2 交付：

1. **學生端畢業進度頁**（`/`）：三情境（已完成／修課中／規劃中）、總學分、條件卡三態（已達成／未達成／尚未確認）、未解衝突、四種狀態（Loading／Empty／Error／無權限），以及**真的打 API**（不再吃 mock）。
2. **AIS 教務資料同步**：驗證碼兩段式（顯示驗證碼圖 → 輸入四碼 → 寫入快照）；帳密只存在伺服器記憶體，不落庫、不進日誌、不回前端。見 [api-spec.md §7.6](docs/design/api-spec.md)。
3. **管理端**：`/admin-validate.html`（結構驗證、測試、送審）、`/admin-review.html`（版本差異、核准／退回／發布、稽核紀錄）。兩頁都打真 API，需帶 `?versionId=…`。
4. **後端**：`node:http`＋`pg`（沒有 ORM）、統一回應 envelope、`/healthz`、`GET /api/rules/{versionId}`、`GET /api/me/progress`、Google OIDC 工作階段、AIS 同步、規則發布流程。

需求與設計的入口是 [docs/README.md](docs/README.md)；API 契約是 [api-spec.md](docs/design/api-spec.md)＋[openapi.yaml](docs/design/openapi.yaml)。

I1 的 demo 畫面保存在 git tag **`i1-demo`**（`git show i1-demo:src/App.tsx`）。

## 安裝與執行

需要 Node.js 22.12 以上（建議 Node 24 LTS）、npm、Docker。

### 方式 A：一鍵起整套（同源，推薦）

```powershell
Copy-Item .env.example .env.local   # 至少填 SESSION_SECRET、Google OIDC；要同步再填 AIS_ACCOUNT/AIS_PASSWORD
docker compose up -d --build        # db: 127.0.0.1:5433、app: 127.0.0.1:3000
curl.exe -s http://127.0.0.1:3000/healthz
```

- entrypoint 會自動等資料庫 → 套用遷移 →（`SEED_ON_START=1`，compose 預設）種子資料 → 啟動 API。
- API 同時服務 `dist/`，所以 Google OIDC 的 `http://localhost:3000/auth/callback` 與 cookie 都在同一個 origin。
- `docker compose down` 保留資料 volume；`down -v` 才是重置。
- 映像以非 root `node` 執行、不掛原始碼；`SEED_ON_START` 預設 `0`（正式環境不要自動寫種子）。

### 方式 B：本機開發（兩個終端機）

```powershell
npm ci
docker compose up -d db
npm run db:migrate
npm run db:seed
Copy-Item .env.example .env.local   # 填值

npm run start:api    # API http://localhost:3000（同源時也服務 dist/）
npm run dev          # Vite http://localhost:5173，/api 與 /auth 會 proxy 到 3000
```

`GET /healthz` 應回 `{"data":{"db":"ok"},"meta":{…}}`；資料庫停止時回 503 `INTERNAL`。

### 環境變數

完整清單與註解在 [.env.example](.env.example)。最常動的幾個：

| 變數 | 用途 |
| --- | --- |
| `DATABASE_URL` | 本機預設 `postgres://planner:planner@localhost:5433/planner` |
| `SESSION_SECRET` | 必填；session cookie 與 OIDC state cookie 的簽章金鑰 |
| `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`／`GOOGLE_REDIRECT_URI` | Google OIDC；redirect URI 需與 Console 完全一致 |
| `AIS_ACCOUNT`／`AIS_PASSWORD` | AIS 帳密；只在伺服器上，不進資料庫／日誌／前端 |
| `AIS_GRADE_PASSING_SCORE` | 數字成績及格門檻；留空則數字成績一律 `unknown`（不假設） |
| `AIS_TIMETABLE_YEAR`／`AIS_TIMETABLE_TERM` | 選填；設定後同步會含「本學期修課中」 |
| `DEV_USER_SUB` | 沒有 session 且 `NODE_ENV != production` 時的本機替身身分 |

### 登入與開發身分

- **瀏覽器登入**：`http://localhost:3000/auth/google/start` → Google → `/auth/callback` → 設 `planner_session`（HttpOnly、SameSite=Lax；資料庫只存 SHA-256）。
- **本機替身**：還沒設定 Google 時，`GET /api/me/progress` 會用 `DEV_USER_SUB`（預設 `dev-student`，113 資工、52 筆紀錄）。`production` 一律忽略這個值。
- **補學籍**：真實帳號第一次登入時沒有系所／入學年度，進度頁會顯示表單（`PATCH /api/me/profile`）。AIS 成績頁若帶系所名稱會自動對應；入學年度**不推論**，一律由學生填。

### 真實 AIS 同步怎麼運作

1. 進度頁按「同步教務資料」→ `POST /api/me/sync/ais`，伺服器用 `AIS_ACCOUNT`／`AIS_PASSWORD` 登入到「需要驗證碼」為止，回傳驗證碼圖片（5 分鐘內有效）。
2. 輸入四碼 → `POST /api/me/sync/ais/{syncId}`；伺服器讀歷年成績（設定時加讀當學期課表）、正規化、分類、寫入 `student_records`。
3. 回應包含 `counts`、`unmatched`（**分類未確認**的課程）、`profile.missing`、`warnings`；失敗時**不動前次成功快照**。

**驗證碼一定要人工輸入**（AIS 沒有提供免驗證碼的登入）。若設了 `AIS_OCR_URL` 會先試 OCR，失敗自動退回人工。

### demo 資料

- `dev-student`：113 資工，135 學分，`overall = unconfirmed`（X01 未解衝突）。
- `dev-admin`：cse 系所管理員（`google_sub='dev-admin'`）；要做管理端 demo，把 `.env.local` 的 `DEV_USER_SUB` 設成 `dev-admin` 再重啟 API。
- `cse-113-day@1`：seed 預設種成 draft；本機要看進度頁需先發布（CI 的 `test:db` 會自己轉 published）。
- 規則包樣本：`docs/design/examples/113-cse.json`、`115-mmd.json`。

## 驗證指令

```powershell
npm test                                  # 單元／元件測試（33 檔 323 測試）
npm run test:db                           # 需要 PostgreSQL 的整合測試
npm run build                             # tsc -b ＋ Vite 多入口建置 ＋ client boundary 檢查
node docs/design/spike/run-cases.mjs      # spike 27 項（歷史證據，CI docs job 也會跑）
node scripts/verify-rule-coverage.mjs     # 46 條覆蓋清單 → clauseId 對照（#18）
node scripts/check-doc-links.mjs          # 文件相對連結
npm run db:reclassify                     # 分類表修正後，重新分類已同步的 AIS 紀錄（不需重登 AIS）
npx --yes @redocly/cli@latest lint docs/design/openapi.yaml
```

> Windows 上在 agent shell 跑 `npm run build` 若出現 esbuild 刪不掉暫存檔（`Access is denied`），把 `TEMP`／`TMP` 指到工作區即可；CI（ubuntu）正常。

CI 有三個 job：`web`（build ＋ 單元測試）、`docs`（spike、覆蓋對照、連結、OpenAPI lint）、`api`（Postgres service ＋ migrate ＋ seed ＋ `test:db`）。

## 程式碼地圖

| 路徑 | 內容 |
| --- | --- |
| `server/index.ts` | 進入點：環境、`pg` pool、路由組裝、graceful shutdown |
| `server/app.ts` | 路由表、`X-Request-Id`、404／500 envelope、靜態檔回應 |
| `server/static.ts` | 服務 `dist/`（同源 SPA，含兩個管理端 HTML） |
| `server/routes/` | `rules.ts`、`progress.ts`、`auth.ts`、`sync.ts`、`admin.ts` |
| `server/auth/` | OIDC（PKCE、ID token 驗證）、session、`identity.ts`（session → dev 替身） |
| `server/authz/` | 權限矩陣（8×3＝24 格）與中介層 |
| `server/ais/` | AIS adapter（上游 protocol 快照）、`classify.ts`、`sync.ts`、`persist.ts` |
| `server/admin/` | 發布流程的驗證、diff、store |
| `src/engine/ruleEngine.ts` | 規則引擎（六型節點、池與上限、三態、trace） |
| `src/api/` | 前端 fetch 層（envelope 解析、progress／sync／profile） |
| `src/pages/`、`src/components/` | 學生進度頁、同步對話框、學籍表單、管理端兩頁 |
| `db/migrations/` | 21 個遷移；`db/seed/` 種子與 dev-student fixture |
| `data/rules/` | 113 資工覆蓋清單、覆蓋對照、課程分類、官方來源快照 |
| `docs/design/` | 系統設計、API、DB、UI/UX、規則模型、ADR、spike |

## 已知邊界（不假裝完成）

- **管理端沒有 payload 編輯器**：兩頁已接真 API（驗證／測試／送審／核准／退回／發布／diff／稽核），但草稿內容編輯要等 I3；`PUT /api/admin/rules/{versionId}` 與 `updateDraft()` 已備好。
- **管理端 demo 需要管理員身分**：本機把 `DEV_USER_SUB` 設成 `dev-admin`（cse 系所管理員）再重啟；正式環境用真的 Google 帳號 ＋ `department_admins` 設定。
- **AIS 同步是「一個部署、一份 AIS 憑證」**：多使用者上線前要改成每人各自憑證（見 [system-design.md §14.4](docs/design/system-design.md)）。
- **系內／外系選修**：AIS 只給「必修／選修／通識」，沒有開課系所欄位；分類表用 **AIS 課號前綴**（`B57`＝資工系、`B92`＝體育）補足，並在 `data/rules/113-cse-classification.json` 逐條寫明依據。課號非 B57 的選修（例如 `M57` 的資料探勘）一律保持 `unknown`。
- **微積分上／下**：AIS 課名只寫「微積分」，因此只計入系訂必修學分（R03）；R04 的 `微積分(上)`／`(下)` 仍顯示缺少，等課程目錄的完整課名對應。
- **核心選修 12 學分**：清單在課程地圖 PDF，尚未數位化 → 條件維持 `unknown`。
- **R15～R19 的狀態條件**（英文門檻、操行、體育四學期、游泳、進階英文資格）：AIS 成績頁沒有這些欄位 → `unknown`，需個人修正或 I3 補資料來源。
- **Google 登入需要真人走一次**；CI 只覆蓋純函式、路由與 session 資料表。
- 學期計畫、缺額篩選、衝堂、AI PDF 整合屬 I3。

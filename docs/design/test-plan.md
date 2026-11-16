# 測試計畫

Extends: system-design.md §6（邊緣案例與測試設計）

NTOUER Academic Planner｜Iteration 2｜2026/11/16

本文件是**測試落點的唯一真相**：每一條驗收案例（`TC-01`～`TC-34`）由哪一層、用什麼工具、目前有沒有實際證據。案例的內容與預期結果仍以 [SRS](../requirements/srs.md) §10 為準，本文件不重複定義。

工具選型的前置決策見 [ADR-0005](adr/0005-test-framework-and-e2e.md)；CI 的邊界見 [ADR-0006](adr/0006-deployment-platform-and-ci.md)。

---

## 1. 測試層級

| 層 | 名稱 | 工具 | 跑什麼 | 進 CI |
| --- | --- | --- | --- | --- |
| L0 | 純函式 | Vitest | 規則引擎、結構驗證器、normalize／parser | ✅ `web` |
| L1 | 元件 | Vitest ＋ Testing Library ＋ jsdom | 畫面互動、提示文字、空資料、去重呈現 | ✅ `web` |
| L2 | 整合 | Vitest ＋ 真實 PostgreSQL（`docker compose up db`） | API 端點、權限、交易、遷移 | ❌ 本機 |
| L3 | E2E | Playwright（Chrome／Edge） | 登入 → 同步 → 進度 → 管理端發布全流程 | ❌ 本機 |
| M | 人工／資料檢核 | 腳本 ＋ 人眼 | 規則覆蓋清單、來源追溯、版面 | 部分 ✅ `docs` |

**分工原則**（來自 ADR-0005）：

- 引擎只在 L0 測，不在 L1／L3 重複測同一件事。
- 權限與交易只在 L2 測：用真的資料庫驗外鍵、唯一約束與「A 不能讀 B」。
- L3 只驗「流程走不走得完、畫面有沒有說實話」，不驗算術。
- 沒有任何一層可以用截圖代替證據（SRS §10.2 末段明訂）。

## 2. CI 執行方式

| Job | 指令 | 涵蓋 |
| --- | --- | --- |
| `web` | `npm ci` → `npm run build` → `npm test` | L0、L1（目前 30 檔 303 測試） |
| `docs` | `node docs/design/spike/run-cases.mjs` | spike 27 項（歷史證據；已移植到 `ruleEngine.test.ts`） |
| `docs` | `node scripts/verify-rule-coverage.mjs` | 46 條覆蓋清單 → `clauseId` 對照（#18） |
| `docs` | `node scripts/check-doc-links.mjs` | 文件相對連結 |
| `docs` | `npx @redocly/cli lint docs/design/openapi.yaml` | OpenAPI 可解析 |

實際觀測（2026/11/16，共 6 次 run）：`web` job **16–21 秒**、`docs` job **7–11 秒**，兩者都含 checkout 與 `setup-node`；`npm test` 本身約 3–6 秒。這個速度是刻意維持的：CI 一旦變慢，紅燈就沒人看。

**為什麼 L2／L3 不進 CI**：兩者都需要資料庫與（L3）真實登入，會把外部依賴與 secret 帶進 CI，違反 ADR-0006 的邊界。I3 再評估以容器化資料庫 ＋ 專用測試帳號導入。

## 3. Fixtures 策略

| 來源 | 位置 | 性質 | 誰維護 |
| --- | --- | --- | --- |
| 系所規則包樣本 | `docs/design/examples/113-cse.json`、`115-mmd.json` | `status: draft` 的可驗證樣本，非正式規則 | 規則維護者；改動需通過結構驗證 |
| 引擎案例 | `docs/design/spike/run-cases.mjs`（27 項） | 可執行的事實來源，正式實作時**逐項改寫**成 Vitest 案例並保留編號 | 實作 |
| 教務（AIS）回應 | `server/ais/fixtures/`（HTML 與 callback 快照） | **人工撰寫的合成資料**，不是真實帳號的抓取結果 | 教務 adapter 負責人 |
| 教務情境 | `server/ais/testing/scenarios.ts` ＋ `scripted-transport.ts` | 以腳本化 transport 模擬登入、成績、課表 | 同上 |
| 學生修課紀錄 | `src/data/sampleRecords.ts`（I1 七組樣本） | 模擬資料，不含任何真實學號 | I1 交付，I2 起由真實資料取代 |

**硬規則**

1. **不得放真實個資**：學號、姓名、成績、AIS 帳密一律不可進 fixtures。NFR-04 要求帳密不進持久儲存與日誌；fixture 同理。
2. **fixture 必須能說明來源**：合成資料在檔頭註明「人工撰寫」；若來自官方文件，附上 `data/rules/sources-manifest.json` 的來源 ID 與 SHA256。
3. **fixture 不可「順著程式碼寫」**：預期結果要獨立寫出（`src/data/sampleExpectations.ts` 的作法：直接寫常數，不用同一套演算法再算一次）。
4. **`verify-client-boundary.mjs` 會把關**：`fixture-pass`、`AIS_PASSWORD` 等字串若出現在前端 bundle，build 直接失敗。

## 4. 覆蓋率目標

| 範圍 | 行覆蓋 | 分支覆蓋 | 理由 |
| --- | --- | --- | --- |
| 規則引擎（`engine/`） | ≥ 95% | ≥ 90% | 唯一「算錯就毀掉信任」的模組，不值得省 |
| 規則結構驗證器 | ≥ 95% | ≥ 90% | 錯誤的規則包不得形成可發布版本 |
| API 與權限（`server/`） | ≥ 80% | ≥ 70% | 每個錯誤碼至少一個案例；交易與權限靠 L2 補 |
| UI 元件（`components/`） | 不設百分比 | 不設 | 覆蓋率對畫面意義低，以 TC 對照表為準 |
| 全域 | 不設門檻 | 不設 | 避免為數字寫無意義的測試 |

**現況**：**未量測**。`@vitest/coverage-v8` 尚未安裝，所以 CI 沒有覆蓋率數字。

要啟用的話是三個步驟：`npm i -D @vitest/coverage-v8`、`vitest run --coverage`、在 `vite.config.ts` 設 `coverage.thresholds`。這會讓 `web` job 多約 3 秒。**I2 不啟用**，理由：目前 303 個測試的分佈不是照覆蓋率長的，先量數字只會誘導去補無關的檔案。

## 5. TC-01～TC-34 自動化對照表

層級代碼見 §1；「現況」只有四種：**自動**（有可執行的測試且進 CI）、**部分**（核心有測試，但某一層或某個情境還沒驗）、**spike**（由 `run-cases.mjs` 覆蓋，CI 會跑）、**未實作**。把「有測試」寫成自動、但其實只驗了 fake DB 的，一律標部分。

| TC | 情境 | 層級 | 現況 | 落點／缺口 |
| --- | --- | --- | --- | --- |
| TC-01 | 不足 | L0 | 自動 | `ruleEngine.test.ts` 案例 3（缺額 6） |
| TC-02 | 等於門檻 | L0 | 自動 | `ruleEngine.edge.test.ts`（剛好等於門檻） |
| TC-03 | 超過門檻 | L0 | 自動 | `ruleEngine.edge.test.ts`（超過門檻、缺額不為負） |
| TC-04 | 空資料 | L0＋L1 | 自動 | `ruleEngine.edge.test.ts`（空資料）＋ `ProgressPage.test.tsx`（空狀態） |
| TC-05 | 不及格排除 | L0 | 自動 | `ruleEngine.edge.test.ts`（不及格不採計） |
| TC-06 | 重複紀錄 | L0＋L1 | 自動 | `ruleEngine.test.ts` 案例 5 ＋ `ruleEngine.edge.test.ts`（重修只計一次） |
| TC-07 | 簡單重修 | L0 | 自動 | `ruleEngine.edge.test.ts`（先不及格後及格） |
| TC-08 | 部分範圍 | L1 | 自動 | `ProgressPage.test.tsx`（持續顯示部分檢核提示） |
| TC-09 | 三情境 | L0 | 自動 | `ruleEngine.test.ts` 案例 9（completed／inProgress 切換） |
| TC-10 | 條件覆蓋 | L0＋L2 | 部分 | `progress.test.ts`（節點覆蓋與上層重算）；端點以 fake DB 覆蓋，缺真實 DB 端到端 |
| TC-11 | 個人修正 | L0＋L2 | 部分 | `progress.test.ts`（`toEngineRecords` 套用 credits／status／category）；修正的寫入與還原端點未實作 |
| TC-12 | 同步失敗及變更 | L0＋L2 | 自動 | `sync.test.ts`（登入失敗不動 `student_records`、只寫 `last_result=failed`；成功才 upsert ＋ `previous_raw`）（[database-design.md](database-design.md) §3.11、§3.15） |
| TC-13 | 身分與儲存 | L2＋L3 | 部分 | `oidc.test.ts`、`cookies.test.ts`、`session.db.test.ts`、`can.test.ts`；**真人 Google 登入待驗**（見 validation 紀錄） |
| TC-14 | 必修及未知 | L0 | 自動 | `ruleEngine.test.ts` 案例 2（必修）與 7（未知狀態） |
| TC-15 | 免修與重複分類 | L0 | 自動 | `ruleEngine.test.ts` 案例 6（免修不給學分）；「兩類互斥」待補 |
| TC-16 | 查詢與缺額 | L2 | 未實作 | I3：課程查詢 API（Step 5 清單中的待擴充端點） |
| TC-17 | 衝堂與未知 | L2 | 未實作 | I3：正式班別資料 |
| TC-18 | 發布權限 | L2 | 自動 | `admin.test.ts`（401／403／跨系所／代理發布） |
| TC-19 | 版本更新 | L2 | 自動 | `admin.test.ts`（draft→…→published 全程、非法轉移 409；`superseded` 未觸發） |
| TC-20 | 覆蓋遷移 | L0＋L2 | 未實作 | I2：節點 ID 穩定 ＋ `retired`（system-design §4.2） |
| TC-21 | PDF 草稿 | M | 未實作 | I2 可行性試作：只驗「草稿不自動發布」 |
| TC-22 | AI 與先修 | M | 未實作 | S 階段（MVP 後） |
| TC-23 | 寫入失敗 | L2 | 部分 | 發布與快照 upsert 都用單一 statement（`persist.ts`）；**故障注入測試未做** |
| TC-24 | 覆蓋與上層重算 | L0 | 自動 | `ruleEngine.test.ts` 案例 7（未知 → 衝突解除）；OR 分支待補 |
| TC-25 | 指定必修缺漏 | L0 | 自動 | `ruleEngine.edge.test.ts`（學分足夠但缺一門必修 → notMet；全到齊 → met） |
| TC-26 | 規則覆蓋範圍 | M | 自動 | `scripts/verify-rule-coverage.mjs`（CI `docs` job；46 條皆有對照或附理由） |
| TC-27 | 管理員生命週期 | L2 | 自動 | `admin.test.ts`（有無有效系所管理員決定代理發布）、`can.test.ts`（24 格矩陣） |
| TC-28 | 修正輸入與還原 | L2 | 未實作 | I2：輸入驗證與零學分免修 |
| TC-29 | 採計上限 | L0 | 自動 | `ruleEngine.test.ts` 案例 4（9 學分只認 6、博雅單領域上限） |
| TC-30 | 重複採計 | L0 | 自動 | `ruleEngine.test.ts` 案例 5（同課只計一次、單一池） |
| TC-31 | 抵免與免修 | L0 | 自動 | `ruleEngine.test.ts` 案例 6（抵免給學分、免修不給） |
| TC-32 | 例外衝突 | L0 | 自動 | `ruleEngine.test.ts` 案例 7（未解衝突停在待確認） |
| TC-33 | 多系所格式 | L0 | 自動 | `ruleEngine.test.ts` 案例 8（135／136、子集合不重複計入） |
| TC-34 | 稽核追溯 | L2 | 自動 | `admin.test.ts`（每一步狀態變更都寫 `review_records`；cursor 分頁） |

### 5.1 統計

| 狀態 | 條數 | 佔比 | 證據來源 |
| --- | --- | --- | --- |
| 自動（`npm test` 或 CI 腳本） | **24**（TC-01～09、12、14、15、18、19、24～27、29～34） | 71% | 30 檔 303 測試；另加 `scripts/verify-rule-coverage.mjs` |
| 部分 | **4**（TC-10、11、13、23） | 12% | 見上表逐條說明 |
| 未實作 | **6**（TC-16、17、20、21、22、28） | 18% | I3 或 MVP 後 |
| 合計 | 34 | 100% | — |

> 誠實說明：TC-01～08 現在由正式引擎（`ruleEngine`）與學生端頁面承接；引擎的 27＋5 項案例是 113 資工與商船的真實規則，不是 I1 的三條測試門檻。

## 6. 缺陷處理與停止條件

| 嚴重度 | 定義 | 處理 |
| --- | --- | --- |
| S1 | 算錯學分、把未知顯示為達標、發布了不該發布的版本 | 立刻修；S1 未修 CI 不得綠 |
| S2 | 權限或稽核紀錄不正確 | 當 Iteration 內修 |
| S3 | 文案、版面、非關鍵提示 | 排入下一個 Iteration |

**停止條件**：`npm test` 紅燈、spike 未達 27 項、`check-doc-links` 有壞連結、OpenAPI lint 失敗 → 不得合併。

## 7. 與其他文件的界線

| 事實 | Owner |
| --- | --- |
| 案例的內容與預期結果（TC-01～34） | [SRS](../requirements/srs.md) §10 |
| 案例落在哪一層、目前是否有證據 | **本文件** |
| 引擎演算法與三態判定 | [system-design.md](system-design.md) §5 |
| 錯誤碼與回應形狀 | [api-spec.md](api-spec.md) |
| 資料表與約束 | [database-design.md](database-design.md) |
| 工具選型的理由 | [ADR-0005](adr/0005-test-framework-and-e2e.md) |

## 8. 待確認

1. **要不要在 I2 啟用覆蓋率門檻？** 我建議不要（§4）。若要，需要多一個 devDependency 與 3 秒 CI。
2. **L2 整合測試要不要進 CI？** 目前不進。若 I3 有容器化資料庫，可考慮加第三個 job。
3. **TC-15／TC-24 的「待補」子項**（兩類互斥、OR 分支）要不要在 I2 補進 spike？目前 spike 已通過 27 項，補了會變成 29 項，需同步改 `SPIKE_EXPECTED_CASES`。

# ADR-0005：測試框架分層（Vitest 為單元／整合，E2E 建議 Playwright）

Extends: system-design.md §6（邊緣案例與測試設計）、§13（I2 完成定義）

- **狀態**：**Vitest 部分 Accepted（已在使用）／E2E 部分 Proposed（待確認）**
- **日期**：2026/11/16
- **決策者**：第七組（tky-kevin 彙整，Yili-code 覆蓋測試與 CI）
- **對應需求**：NFR-01（正確性）、NFR-07（可用性與相容性）、NFR-09（可維護與可測試）
- **對應驗收**：TC-01～TC-34（對照表由 `test-plan.md` 定義）

## 背景

目前的測試只有一層：Vitest 跑 5 個測試檔、47 個測試（`src/engine/checkCredits.test.ts`、`src/App.test.tsx`、`server/ais/*.test.ts`），涵蓋 I1 的學分引擎與教務 adapter。I2 會多出三種需要不同測試手法的東西：

1. **規則引擎**（六型節點、採計上限、衝突）：純函式，適合大量案例驅動的單元測試，且必須能脫離 UI 執行（NFR-09）。
2. **API 與權限**（跨使用者、跨系所）：需要資料庫與身分，屬於整合測試。
3. **流程與狀態**（草稿→驗證→測試→審核→發布、11 張線稿對應的畫面）：需要真的瀏覽器與登入流程，屬於 E2E。

若不分層，會出現兩種壞結果：所有東西都塞 E2E（慢、脆、錯誤定位差），或全部用單元測試假裝驗過（權限與流程根本沒跑）。

## 決策

1. **單元與整合測試一律用 Vitest**（已採用，維持）。含 `@testing-library/react` 與 `jsdom` 測元件互動。不自 Jest 重來。
2. **規則引擎以「純函式 + 案例表」測**：引擎不得碰資料庫、網路或 `Date.now()`。案例來源有三類：
   - `docs/design/examples/*.json`（資工 113、商船 115 兩份樣本）
   - `docs/design/spike/run-cases.mjs` 的 27 項情境（正式實作時改寫成回歸測試，見 system-design.md §6.2）
   - TC-29～TC-34 的邊緣案例（上限、重複採計、抵免／免修、未解衝突）
3. **API／權限用整合測試**：對真的 PostgreSQL 測 FK、唯一約束與「A 不能讀 B」。這一層**不在本輪 CI 執行**（CI 不連外部服務，見 ADR-0006），以本機或 I3 的整合 job 執行。
4. **E2E 建議採 Playwright**：涵蓋 Chrome 與 Edge，viewport 至少 `390×844` 與 `1366×768`（NFR-07）。
5. **TC-01～TC-34 自動化對照表是 `test-plan.md`（Step 7）的唯一真相**：本 ADR 只定「用什麼工具、哪一層」，不在這裡重複列出每個 TC 的落點。
6. **不用 `continue-on-error` 或「先跳過」讓 CI 變綠**；還沒實作的案例以明確的 `skip` 加 Issue 編號，並在 `test-plan.md` 標為未自動化。

## 為什麼不是其他工具

| 層級 | 採用 | 替代方案與否決理由 |
| --- | --- | --- |
| 單元／整合 | **Vitest**（已在使用） | **Jest**：與 Vite／ESM／TS 的設定摩擦（需 `ts-jest` 或 babel 轉譯），且現有 47 個測試得全部改寫；沒有換的理由。 |
| 元件互動 | **Testing Library**（已在使用） | Enzyme：已停止維護，且測法偏向實作細節。 |
| E2E | **建議 Playwright** | **Cypress**：以 Chromium 為主，Edge 需額外設定；並行執行需另起服務；在 CI 的資源成本較高。**Puppeteer**：只支援 Chromium，無法滿足 NFR-07 要求的 Edge 檢查。 |
| 規則案例 | **`run-cases.mjs` 轉回歸測試** | 另寫一套案例：會與 spike 的 27 項分歧，兩邊各說各話。 |

## 後果

**好處**

- 引擎的正確性用便宜、可重複的純函式測試守住；spike 的 27 項直接變成回歸底線，不浪費既有的驗證成果。
- 權限與流程用對的方式驗：權限用整合測試（真的資料庫）、流程用 E2E（真的瀏覽器）。
- 測試分層後 CI 只跑快的那一層（`npm test` 目前 < 4 秒），紅燈回饋快。

**代價與風險**

- **多一套工具（Playwright）就多一份 CI 時間與維護成本。** 因此本輪 E2E 不進 CI（見待確認 1）。
- **整合測試需要資料庫。** 開發者要能起 PostgreSQL；這由 ADR-0004 的遷移腳本＋容器支撐。
- **`jsdom` 不是真的瀏覽器。** 版面、捲動與 CSS 相關的驗收（NFR-07 的「無頁面橫向溢位」）只能靠 E2E 或人工，單元測試不能冒充。
- **覆蓋率數字不等於品質。** 本 ADR 不設「X% 才算過」的閘門；覆蓋率目標由 `test-plan.md` 定義並以實際風險為依據。

## 驗證方式

- 現況：`npm test` → 5 個測試檔、47 個測試全過；`node docs/design/spike/run-cases.mjs` → 27 項全過。
- 引擎測試可在無網路、無資料庫的環境單獨執行（NFR-09）：以 `npm test` 在 CI 的 `web` job 即為證明。
- TC 對照表在 `test-plan.md` 完成後，每一條 TC 都能指出「哪個測試檔、哪一層、目前是自動／手動／未實作」。

## 待確認

1. **E2E 要不要納入 I2 的 CI？** 建議 **I2 只在本機／手動跑**，理由：需要起資料庫與真實登入流程，會把外部依賴引進 CI（違反 ADR-0006 的「CI 不用 secrets」。若要用測試帳號登入 Google，就必須有 secret）。I3 再評估以容器化資料庫 ＋ 專用測試帳號導入。
2. **E2E 的工具是否就用 Playwright？** 若團隊成員只熟 Cypress，可改用 Cypress；本 ADR 的決策點是「E2E 只覆蓋流程與版面，不重複驗引擎」。
3. **整合測試的資料庫怎麼起？** 建議 `docker compose up db`（與 ADR-0006 的開發環境一致）；待部署平台定案後再確認。

## 相關

- [ADR-0006 部署平台與 CI](0006-deployment-platform-and-ci.md)：CI 只跑哪一層。
- [system-design.md](../system-design.md) §6 案例對照；`test-plan.md`（Step 7）補上層級、覆蓋率目標與 TC 對照表。
- [spike/README.md](../spike/README.md)：27 項案例的清單與限制。

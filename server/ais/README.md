# Planner 教務 adapter

此模組把既有 NTOUer 的 AIS 解析與查詢流程整理為 Planner 可使用的伺服器端 TypeScript 介面。先以 synthetic／sanitized fixture 驗證；目前沒有連線真實 AIS，也沒有宣稱已完成正式登入或資料整合驗收。

## 執行

在專案根目錄：

```powershell
npm ci
npm run demo:ais
npm test
npm run typecheck:ais
npm run build
```

`demo:ais` 真正走過 fixture 登入、驗證碼、選單、查詢表單、歷年成績、課表、公開課程及 detail，然後呼叫 I1 的 `checkCredits`。所有 request 使用 ScriptedTransport，不發送網路請求。

人工 grading fixture 門檻為 60，明確標為開發測試政策；學分規則仍為 test-v0.1（12／6／6）。10 筆歷年紀錄包含 A 重修、不及格、暫存分數已公布但正式成績未公布、未知分類、退選及抵免。預期總／必修／選修為 11／6／3，缺額 1／0／3；U 的已及格 2 學分只增加總學分，不增加必修或選修。

課表 fixture 有 2 次修課、2 個開課班別與 3 個上課時段；一門課有多個時段時，修課筆數及學分不重複增加。公開清單有 2 筆開課；本專案另外建立身份一致的 planner-course-detail fixture，原始來源的兩份獨立 fixture 不能直接假設為同一門課。

## 介面

```ts
import { PlannerAisClient, auditGradeSnapshot } from './server/ais/index.js'

const client = new PlannerAisClient({
  captchaSolver, // solve(png): Promise<string | null>，可注入人工或 OCR 辨識
  gradePolicy: { version: 'verified-policy-version', source: '已核對的來源' },
})
await client.login({ account, password })
const grades = await client.readGrades({ kind: 'history' })
const report = auditGradeSnapshot(grades, rules)
await client.logout()
```

| 介面 | 結果 |
| --- | --- |
| login／logout | 登入／登出；AIS Cookie 與 session 在伺服器記憶體，不輸出給 consumer |
| readGrades(query) | 支援 semester、academic_year、history；輸出具版本、來源、時間、政策、修課紀錄及待確認原因的 GradeSnapshot |
| readTimetable(year, term) | 課程定義、開課班別、個人修課、會議時段與節次分開，當期修課狀態為 inProgress |
| readCatalogPage(year, page) | 公開課程分頁；不使用私人登入 Cookie |
| readCourseDetail(offeringId) | 先載入清單，再取得同班別 detail；核對學期、課號、課名、系所與班別；保留中英課綱、教師、時段、教室、教材、先修文字、時間完整度及 warnings |
| parseGradeDetails(raw) | 伺服器解析入口：期中、期末、扣考、平時成績；目前只驗證 parser，尚無實際 detail 查詢導覽 |
| auditGradeSnapshot(snapshot, rules) | 直接使用共用引擎，附待確認項目及部分檢核範圍 |

所有 exports 都由 server/ais/index.ts 提供；不得從 React import。模組的執行期防護與正式建置檢查會阻止或偵測 AIS 帳密／協定進入前端產物。尚未建立 HTTP API，未部署後端；目前 consumer 是 fixture CLI、live CLI 及自動測試。

## 採計語意

- semesterScore 才是最終成績來源；provisionalScore 僅保存原值。
- 沒有預設數字及格門檻。只有傳入 numericPassingScore 才能將數字判為 passed／failed；否則為 unknown，附 gradingPolicyMissing。
- 通過為 passed；不通過或星號失敗結果為 failed。未知文字、未公布、抵免原則上保留待確認。
- 退選保存 outcome=withdrawn，明確不採計；為相容 I1 的三態 status 投影為 unknown，顯示與業務判斷須同時讀 outcome，不把它當不及格。
- 抵免必須明確設定 countExemptCredits 才採計；不推論正式抵免或免修規則。
- 原始 AIS 選別保留；required／elective 以外的類別為 unknown。已及格未知分類可以計入總學分，分類缺額仍保留；原始選別不等同正式系所的畢業採計分類。
- 同來源紀錄及同課及格依既有 engine 去重。識別依學期、課號、班別，沒有用課名合併；尚不處理跨課號等價、替代與可重複取得學分的例外。
- AIS 學分摘要單獨保存在 sourceSummary，沒有直接拿摘要替代引擎結果。
- 若成績 profile 帶學號，需符合登入帳號，身份不符拒絕並清除 session；profile 無學號時明示 identityVerification=sessionOnly，沒有宣稱已完成 profile 身份核對。

## 真實測試準備

之後提供帳密時，存入 Git 忽略的 `.env.local`，欄位格式參考根目錄 `.env.example`。不把帳密寫入 source、fixture 或 README。

```powershell
npm run verify:ais:live
```

這個指令會在缺少帳密時立即結束；有帳密後才連線。驗證碼圖片寫入 tmp/ais-live/captcha.png，需在互動終端機查看並輸入四碼。目前未移植 OCR 服務。若經已核對規則確認數字及格門檻，可明確設定 AIS_PASSING_SCORE；不設定時數字成績維持待確認。

可選設定 AIS_TIMETABLE_YEAR／AIS_TIMETABLE_TERM 查個人課表，AIS_CATALOG_YEAR 查公開課程第一頁及一門 detail。個人結果寫入被 Git 忽略的 tmp/ais-live/normalized-snapshot.json。登入 Cookie／密碼不寫入快照，錯誤只顯示安全代碼；查詢結束會嘗試登出並清除本機 session。

## 測試與限制

涵蓋正常／空資料／表單或欄位漂移、歷年及學年投影、特殊成績、政策更換、重修去重、未知分類、課表時段去重、分頁 postback、detail 身份不符、驗證碼 bootstrap、登入拒絕、session 到期與登出失敗。transport 額外驗證 Cookie 隔離、不轉送跨來源資料、redirect 上限、大小上限與 timeout。一般測試沒有真實帳密或網路依賴。

仍待真實帳號驗證登入、人工驗證碼與實際頁面形狀；不同帳號或學期可能觸發未涵蓋的分支。成績明細的 live 導覽、正式畢業規則、課程等價、衝堂、持久儲存、Google 登入與 UI 同步入口未完成。

## 來源與維護

upstream/ 保留 NTOUer 本機 project-voyager 的 protocol/application snapshot，來源 revision 與每檔原始 SHA-256 記錄在 upstream/SOURCE.json；來源 LICENSE 原文保存在 upstream/LICENSE。本次依使用者要求在本專案整理模組，沒有修改來源專案，也不另行授予來源軟體的授權。

Planner 修改的來源檔：grades-service.ts 新增 typed readSnapshot，讓歷年與學年資料不經僅接受 semester 的舊 API projection；timetable-service.ts 新增 typed readSnapshot，保留時段與節次，readSemester 維持舊 projection 行為；ais-feature-navigation.ts 把選單導覽失敗拆成可診斷代碼（`menu_group_not_found`／`menu_target_not_found`／`menu_target_ambiguous`／`menu_loader_mismatch`），並在 `AIS_DEBUG_DUMP` 開啟時把當下選單節點存檔（只寫標題與 loader 路徑，不含個資）。其餘來源檔保持 snapshot 原文。Cookie transport、Planner DTO、轉換、client、fixture consumer 及測試由本專案管理。

更新來源時先比對 SOURCE.json，再手動合併這兩處差異並重跑 fixture 測試；不執行會覆寫本地修改的自動同步腳本。

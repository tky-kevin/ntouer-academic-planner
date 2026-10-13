# Iteration 1 驗證紀錄

I1 初次驗證日期：2026/10/13（Asia/Taipei）。規則版本：test-v0.1。範圍：開發測試規則的部分條件檢核。

## 執行環境

- Windows；Node.js v24.11.1；npm 11.6.2。
- React 19.3、TypeScript 7、Vite 7.3、Vitest 5。實際相依版本鎖定於 package-lock.json。
- UI 測試：Testing Library / user-event / jsdom。
- 瀏覽器：Playwright CLI 啟動的 Chromium。

## 自動測試與建置

| 指令 | 結果 |
| --- | --- |
| npm install | 成功；建立 package-lock.json |
| npm test | 通過；2 個測試檔，17 項測試 |
| npm run build | 通過；修正清理方式後連續兩次成功，TypeScript 檢查與 Vite 正式建置成功 |

測試包含：七組樣本精確學分、缺額與狀態（AP-TC-01 至 AP-TC-07）；未知狀態排除；修改門檻；採計紀錄；相同課號兩筆及格去重；不及格在前的重修；不修改輸入。UI 測試驗證七個入口、規則來源／提醒、執行檢核、切換清除及提示、空資料、去重顯示及採計明細展開（AP-TC-08 與 AP-I1-04）。

本機重複建置曾在清除舊 dist 時出現 Node 程序退出碼 -1073740791；Vite 8 與 7 都能重現，略過自動清除及使用逐檔清除可成功。最終使用 Vite 7.3 與受限於本專案輸出的 clean-dist 腳本，並設定 `build.emptyOutDir: false`。此設定方式見 [Vite 官方建置設定](https://vite.dev/config/build-options#build-emptyoutdir)。清理仍會執行，不累積舊的雜湊產物。

## 實際瀏覽器驗證

以 scripts/verify-ui.js 實際操作頁面；所有七組樣本的三項學分、缺額與文字狀態均與明列常數一致。切換後結果變回待檢核，重新執行才顯示新結果。每組操作後皆確認「部分條件已檢核」與持續可見的開發測試提示。

- 桌面寬 1440px：完整流程與三張結果卡可讀，頁面無水平溢出。
- 手機寬 375px：樣本選取、空資料執行、達標執行均成功；結果卡垂直排列，頁面無水平溢出。
- 手機紀錄表格可水平滑動；全頁捲動後範圍提醒仍置頂。
- Chromium 主控台：0 errors、0 warnings；React 開發工具建議屬資訊訊息。
- 以 npm run preview 啟動最終 dist（127.0.0.1:4173）後再次操作全部七組樣本及手機檢查，全部通過。最終 JavaScript 約 235.56 kB／gzip 73.69 kB，CSS 約 14.04 kB／gzip 3.70 kB。
- 截圖保存於 output/playwright/desktop.png 與 mobile.png（產出檔已列入 .gitignore）。

可重現瀏覽器檢查的方法（先讓開發伺服器在 127.0.0.1:5173 執行）：

```powershell
New-Item -ItemType Directory -Force -Path output/playwright
npx --yes --package @playwright/cli playwright-cli -s=ntouer-i1 open http://127.0.0.1:5173/
npx --yes --package @playwright/cli playwright-cli -s=ntouer-i1 run-code --filename=scripts/verify-ui.js
npx --yes --package @playwright/cli playwright-cli -s=ntouer-i1 close
```

Playwright CLI 是額外的驗證工具，不是 Demo 執行的必要相依套件；瀏覽器未安裝時可依 CLI 的 install-browser 指令安裝。

## 仍未驗證

- 真實 iOS／Android 裝置及 Safari／Firefox 相容性；手機檢查使用 Chromium 視窗尺寸模擬。
- 真人使用者測試、螢幕閱讀器實機測試與完整 WCAG 稽核。
- 正式部署、真實 AIS 紀錄與海大正式畢業規則；這些不屬於 I1 實作範圍。
- 外部看板、影片與提交頁；GitHub 原始碼提交不等同完成這些外部提交項目。

## 教務 adapter fixture 驗證（2026/10/14）

| 指令 | 結果 |
| --- | --- |
| npm test | 5 個測試檔，47 項測試通過；包含 I1 與教務 adapter |
| npm run typecheck:ais | 通過；伺服器模組與 CLI 型別檢查 |
| npm run demo:ais | fixture 登入、歷年成績、課表、課程清單及身份一致的 detail 均通過；沒有網路請求 |
| npm run build | TypeScript、Vite 及前端／教務模組邊界檢查通過 |

教務 fixture 的 10 筆成績由同一引擎計算出 11／6／3 學分、1／0／3 缺額；沒有讀取樣本答案。課表為 2 次修課與 3 個時段；公開課程為 2 筆。詳細測試包括分頁 postback、表單更新、數字及格政策、特殊成績、未知分類、重修、detail 身份、學生 profile 身份、登入失敗、驗證碼 bootstrap、session TTL、登出失敗、Cookie 隔離、跨來源導向、大小上限及 timeout。

真實測試 CLI 的缺少帳密 preflight 經獨立子程序確認會在網路前安全結束。帳密、私人結果與驗證碼圖片的路徑已列入 Git 忽略。尚未提供或使用真實帳號；成績明細目前只測 parser，未驗證 live 導覽。Fixture 並不代表真實 AIS 整合已通過，亦不代表已完成正式畢業規則。

# NTOUER Academic Planner

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

依使用者指定：React、TypeScript、Vite；Iteration 1 全部在前端執行。

## Product Purpose

展示「選取模擬修課紀錄 → 執行學分檢核 → 顯示結果」的第一次迭代。

## Operating Context

海大智慧修課與畢業規劃系統的開發 Demo。一般電腦與手機皆須可閱讀，繁體中文介面。

## Capabilities and Constraints

- 規則 test-v0.1：總學分 12、必修類 6、選修類 6，來源為人工建立的開發測試規則。
- 七組模擬資料涵蓋不足、達標、超標、空資料、不及格、重複紀錄與簡單重修。
- 只採計及格，依 recordId 與 courseCode 去重，結果由引擎實際計算。
- 規則僅涵蓋部分條件，不能推論正式畢業資格。
- 本次不包含 Google 登入、AIS 串接、資料庫、AI、修課計畫及衝堂檢查。

## Brand Commitments

產品名稱為 NTOUER Academic Planner；持續顯示「開發測試規則，僅檢核部分條件」。

## Evidence on Hand

使用者提供的 I1 規則與七組明確預期值。沒有正式畢業規則或真實教務資料。

## Open Decisions

主要展示受眾推定為專案開發者與評閱者；未提供官方品牌資產。以上是本次實作假設。

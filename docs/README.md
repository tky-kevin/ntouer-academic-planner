# NTOUER Academic Planner 專案文件

更新日期：2026/11/16（Iteration 2 設計基準建立）

## 目前階段

- **Iteration 1 已完成**：需求文件、前端 Demo、7 分鐘報告。
- **Iteration 2 進行中**：需求文件更新至 SRS v0.9／URD v1.3，完成系統設計文件與規則格式，開始後端、資料庫與正式畢業規則。
- Iter1 的簡報、講稿與簡報建置產物已刪除；留存下來的是 Iter2 會用到的輸入。

## 資料夾結構（repo 內）

```text
ntouer-academic-planner/
├─ docs/
│   ├─ README.md                        ← 本檔
│   ├─ requirements/
│   │   ├─ urd.md                       使用者需求文件 v1.3
│   │   ├─ srs.md                       系統需求文件 v0.9
│   │   ├─ wireframes/                  SRS 內嵌圖表的來源與產生器
│   │   └─ validation/                  文件檢查、實作驗證、Trello／Miro 同步紀錄
│   └─ design/                          Iter2 設計層：SDD、規則格式、樣本、可行性 spike 與 C4 圖
├─ data/rules/                          113 學年度官方來源與規則覆蓋對照
└─ （程式碼：src/、server/、scripts/、public/）
```

## 需求文件（Iter2 基準，隨迭代改版）

- [使用者需求文件 v1.3](requirements/urd.md)：使用者角色與權限層級（系統管理員／系所管理員／學生）、目標、需求與範圍。
- [系統需求文件 v0.9](requirements/srs.md)：系統行為、功能與品質需求、使用者故事及驗收依據（含 TC-29 至 TC-34）。
- [需求圖庫](requirements/wireframes/index.html)：SRS 引用的 11 張介面線稿（學生 7、管理 4）與 2 張故事地圖；維護方式見[圖庫說明](requirements/wireframes/README.md)。

## 設計文件（Iter2 實作依據）

- [系統設計文件](design/system-design.md)：容器到元件、引擎演算法、發布流程、權限、資料表、API 與 I2 交付定義。
- [規則描述模型](design/rule-model.md)：規則的三層紀錄方式、六型節點、採計配置與多系所驗證矩陣。
- [規則包 schema](design/rule-bundle.schema.json) 與[系所樣本](design/examples/)：資工 113、商船 115 兩份可驗證樣本。
- [規則引擎 spike](design/spike/)：可執行的可行性驗證，`node docs/design/spike/run-cases.mjs` 目前 27 項通過。
- 設計層導覽見[design/README.md](design/README.md)。

## 架構設計

- [C4 Context（1400×990）](design/diagrams/c4-context.png)、[C4 Container（1400×990）](design/diagrams/c4-container.png)
- 可編輯來源：[c4-design.drawio](design/diagrams/c4-design.drawio)。改圖一律改此檔再匯出 PNG，不在文件中重畫。
- Lab 2 作業的兩份 PDF（5 頁文字版、10 頁含圖版）與 DOCX 已於 2026/11/16 移除：內容已由[系統設計文件](design/system-design.md)承接，原檔另有雲端備份；同日移除的還有 5 個 diagrams.net 轉址 HTML 與 2 張重複匯出的 diagramsnet PNG。

## 規則資料

- [113 資工規則覆蓋清單](../data/rules/113-cse-coverage-list.md)：46 項規定、必核對的來源定位與處理方式。
- [113-cse-coverage.json](../data/rules/113-cse-coverage.json)：同一份內容的機器可讀登錄。
- [sources-manifest.json](../data/rules/sources-manifest.json)：每份官方來源的網址、定位、取得日期與 SHA256。
- [data/rules/sources/](../data/rules/sources/)：113 新生手冊、修業規定、檢核表、英文門檻、通識圖、抵免辦法、學則、共同教育課程須知等官方快照。
- [113 資工規則覆蓋查核報告](../data/rules/113-cse-coverage-audit-2026-11-16.md)：2026/11/16 對官方現行版本的逐份重驗、缺口 G1–G9 與修補紀錄。

> 程式碼目前只有 `src/data/testRules.ts` 的 12／6／6 開發測試規則與 `src/engine/checkCredits.ts` 的三條學分門檻；正式規則還沒進程式碼。I2 的作法是依[規則描述模型](design/rule-model.md)把 `data/rules/` 的條文轉成規則包，並用[系統設計文件](design/system-design.md)第 5.4 節的差異表替換引擎。

## 程式碼

- [repo 根目錄](../)：React + TypeScript + Vite 前端 Demo 與教務 adapter。操作、測試與已知限制見 [README](../README.md)。
- I2 程式碼工作：`engine` 換成規則包驅動（支援六型節點與三態）、新增規則 API 與 PostgreSQL 遷移、管理端驗證／審核介面。完成定義見[系統設計文件第 13 節](design/system-design.md)。

## 相關紀錄

- [文件檢查與實作驗證](requirements/validation/doc-implementation-check.md)：Iter1 文件與實作的核對結果、測試與效能數據。
- [Trello 與 Miro 同步紀錄](requirements/validation/trello-miro-sync.md)：Iter1 看板與故事地圖的需求基準同步過程。

## 線上資源

- [使用者需求](https://hackmd.io/@ntou-software-engineering/rJpwiiQnMg)
- [系統需求](https://hackmd.io/@ntou-software-engineering/r1ax8s9jfe)
- [使用者故事看板](https://canva.link/9p0uk6ka0rs5tfo)
- [Miro 使用者故事地圖](https://miro.com/app/board/uXjVEazHH8w=/)
- [Trello 專案看板](https://trello.com/b/pfsqtqY6/ntouer-academic-planner)
- [實作成果影片](https://youtu.be/1w52mSRzarQ)
- [GitHub](https://github.com/tky-kevin/ntouer-academic-planner)

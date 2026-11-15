# 設計文件（Iteration 2）

本資料夾是需求（[`docs/requirements/`](../requirements/)）與程式碼（[程式碼 repo](../../)）之間的設計層。需求回答「要做什麼」，這裡回答「怎麼做、資料長什麼樣、怎麼驗證」。

| 文件 | 內容 | 讀者 |
| --- | --- | --- |
| [system-design.md](system-design.md) | 容器到元件、引擎演算法、發布流程、權限、資料表、API、介面、風險與 I2 交付 | 全體、評閱者 |
| [rule-model.md](rule-model.md) | 規則怎麼被記錄：三層結構、六型節點、採計配置、多系所驗證矩陣、撰寫規範 | 規則維護者、實作 |
| [rule-bundle.schema.json](rule-bundle.schema.json) | 規則包的機器可讀格式（JSON Schema） | 實作、驗證器 |
| [examples/](examples/) | 資工 113 與商船 115 兩份可驗證樣本 | 實作、測試 |
| [spike/](spike/) | 可執行的引擎可行性驗證（不是產品程式碼） | 實作、驗收 |

## 與其他文件的關係

```
docs/requirements/urd.md ── 使用者與目標
docs/requirements/srs.md ── 系統行為與驗收（v0.9）
        │
        ├─▶ docs/design/system-design.md ── 怎麼做
        │        ├─▶ docs/design/rule-model.md ── 規則格式
        │        └─▶ docs/design/rule-bundle.schema.json ── 格式的機器版
        │
        └─▶ data/rules/ ── 113 資工的真實條文與覆蓋清單（設計的輸入，不是設計本身）

docs/design/diagrams/ ── C4 容器圖與 drawio（本設計向上對齊）
```

- 需求與設計衝突時，以需求為準，並回頭修設計。
- [`data/rules/113-cse-coverage-list.md`](../../data/rules/113-cse-coverage-list.md) 是「查到哪些條文、怎麼處理」的登錄；本資料夾的 `examples/` 是「同一批條文換成規則包格式」的樣本。兩者刻意分開：前者求完整與可追溯，後者求可執行。

## 快速驗證

```bash
node docs/design/spike/run-cases.mjs
```

預期輸出 27 項全數通過（結構驗證、採計上限、重複採計、抵免／免修、例外衝突、未知狀態、多系所、情境切換）。

## 版本

| 版本 | 日期 | 內容 |
| --- | --- | --- |
| 1.0 | 2026/11/16 | 建立 SDD、規則描述模型、schema、2 份系所樣本與 spike；對齊 SRS v0.8 |
| 1.1 | 2026/11/16 | AI 草稿提升為 MVP；管理端四張線稿（UI-08～11）補齊；來源衝突列暫時擱置；對齊 SRS v0.9、URD v1.3 |

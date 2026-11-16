# 設計文件（Iteration 2）

本資料夾是需求（[`docs/requirements/`](../requirements/)）與程式碼（[程式碼 repo](../../)）之間的設計層。需求回答「要做什麼」，這裡回答「怎麼做、資料長什麼樣、怎麼驗證」。

| 文件 | 內容 | 讀者 |
| --- | --- | --- |
| [system-design.md](system-design.md) | 容器到元件、引擎演算法、發布流程、權限、資料表、API、介面、風險與 I2 交付 | 全體、評閱者 |
| [rule-model.md](rule-model.md) | 規則怎麼被記錄：三層結構、六型節點、採計配置、多系所驗證矩陣、撰寫規範 | 規則維護者、實作 |
| [rule-bundle.schema.json](rule-bundle.schema.json) | 規則包的機器可讀格式（JSON Schema） | 實作、驗證器 |
| [examples/](examples/) | 資工 113 與商船 115 兩份可驗證樣本 | 實作、測試 |
| [spike/](spike/) | 可執行的引擎可行性驗證（不是產品程式碼） | 實作、驗收 |
| [database-design.md](database-design.md) | 欄位級資料庫設計：ER、型別與約束、索引理由、遷移順序、seed、快取、保留政策 | 實作（後端、DB）、評閱者 |
| [api-spec.md](api-spec.md) | HTTP 介面契約：回應 envelope、錯誤碼、版本策略、認證標頭、端點規格 | 實作（前後端）、評閱者 |
| [openapi.yaml](openapi.yaml) | 上面那份契約的機器可讀版（OpenAPI 3.1，先收 3 個 path） | 實作、驗證器 |
| [adr/](adr/) | 已定案的技術決策與理由（0001～0006） | 全體、實作 |

## 決策紀錄（ADR）

決策的「為什麼」寫在 ADR，設計文件只寫「現在長什麼樣」。每份 ADR 開頭都標 `Extends:`，指回它補的是 `system-design.md` 哪一節。

| 編號 | 決策 | 狀態 |
| --- | --- | --- |
| [0001 規則即資料，版本不可變](adr/0001-rules-as-data-immutable-versions.md) | 規則包 JSON ＋ 發布即凍結，`bundleId@versionNo` 唯讀 | Accepted |
| [0002 PostgreSQL + jsonb](adr/0002-postgresql-jsonb.md) | 唯一持久層；關聯表管約束，規則包存 `payload` jsonb | Accepted |
| [0003 Google OIDC](adr/0003-google-oidc-identity.md) | 唯一身分來源；後端工作階段，不用 localStorage 存 token | Accepted |
| [0004 migration 工具](adr/0004-migration-tooling.md) | `node-pg-migrate` ＋ 純 SQL，不引入 ORM；遷移檔在 `db/migrations/` | Accepted |
| [0005 測試框架與 E2E](adr/0005-test-framework-and-e2e.md) | Vitest 為單元／整合；E2E 用 Playwright，I2 不進 CI | Accepted |
| [0006 部署平台與 CI](adr/0006-deployment-platform-and-ci.md) | CI 已實作（無 secrets）；I2 只交付可部署產出，不建環境 | Accepted |

## 與其他文件的關係

```
docs/requirements/urd.md ── 使用者與目標
docs/requirements/srs.md ── 系統行為與驗收（v0.9）
        │
        ├─▶ docs/design/system-design.md ── 怎麼做
        │        ├─▶ docs/design/rule-model.md ── 規則格式
        │        ├─▶ docs/design/rule-bundle.schema.json ── 格式的機器版
        │        ├─▶ docs/design/database-design.md ── 資料落地（欄位、索引、遷移）
        │        └─▶ docs/design/api-spec.md ＋ openapi.yaml ── 介面契約
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

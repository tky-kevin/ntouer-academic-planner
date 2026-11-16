# ADR-0002：PostgreSQL 為唯一持久層，規則包內容存 jsonb

Extends: system-design.md §9（資料模型）、§12.1（技術可行性）

- **狀態**：Accepted（已定案，2026/11/16）
- **日期**：2026/11/16
- **決策者**：第七組（tky-kevin 彙整）
- **對應需求**：FR-01、FR-02、FR-12、FR-18、NFR-01、NFR-05、NFR-08
- **對應驗收**：TC-12（同步失敗與變更）、TC-13（身分與儲存）、TC-34（稽核追溯）
- **上游依據**：SRS §2.5「持久資料｜PostgreSQL」為暫定方向，本 ADR 把它定案並補上理由

## 背景

系統要同時容納兩種形狀差異極大的資料：

1. **高度結構化、需要唯一約束與關聯**：使用者與角色、系所管理員指派、稽核紀錄、個人修正、修課計畫。這些資料的錯誤代價高（越權、覆蓋錯位），需要資料庫層級的約束。
2. **形狀會演進的半結構化資料**：規則包（六型節點＋`and`／`or` 組合＋採計配置），每加一種節點或一種上限型別，schema 就會長。而且必須**整份**以不可變快照保存（ADR-0001）。

只用關聯式建模，第二類會變成深層 join 與頻繁遷移；只用文件式資料庫，第一類會失去約束與跨表交易。

## 決策

1. **PostgreSQL 16 以上為唯一持久層**，不引入第二套資料庫或快取伺服器（快取留在行程內，見 §「後果」）。
2. **兩類資料分開處理**：
   - 身分、權限、稽核、個人資料、計畫 → **正規化關聯表**（`users`、`departments`、`department_admins`、`review_records`、`student_records`、`student_overrides`、`student_condition_overrides`、`student_plans`）。
   - 規則包 → **`rule_versions.payload` 以 `jsonb` 存整份**，並以 `content_hash` 保存內容雜湊。
3. **為 jsonb 建輔助投影表**：`rule_sources`、`rule_clauses` 由發布流程從 `payload` 展開，供查詢、索引與 diff。投影表是衍生資料，`payload` 才是真相；不一致時以 `payload` 為準並重建。
4. **約束寫在資料庫，不只在應用層**：`users.google_sub` 唯一、`department_admins` 對（dept, user）唯一且以 `revoked_at IS NULL` 表達有效指派、`review_records` 與 `rule_versions` 的已發布資料**不開放 UPDATE／DELETE**（以權限與 trigger 同時限制）。
5. **`jsonb` 內容仍由應用層 validator 把關**（[rule-bundle.schema.json](../rule-bundle.schema.json)）。資料庫只保證「是合法 jsonb」，不保證「是合法規則包」。

## 為什麼不是其他資料庫

| 替代方案 | 為何不採用 |
| --- | --- |
| MongoDB 等文件式資料庫 | 規則包很適合，但 `department_admins`、`review_records` 需要唯一約束、外鍵與跨表交易；稽核「不得刪除或改寫」（FR-18）在文件式資料庫要靠應用層自律，證據力弱。 |
| SQLite | 單檔、單寫入者；不足以支撐多實例部署與並行寫入的發布流程（NFR-08）。I1 的本地 Demo 也不需要它，維持記憶體即可。 |
| MySQL／MariaDB | 可用，但 `jsonb` 的索引（GIN）與 json 函式不如 PostgreSQL 完整，且專案沒有既有的 MySQL 依賴。 |
| **PostgreSQL + jsonb（採用）** | 同一個資料庫同時滿足「嚴格約束」與「彈性快照」，且 `jsonb` 可建 GIN 索引，必要時仍能查規則內容。 |

## 後果

**好處**

- 發布流程可以在**單一交易**內完成「寫 `rule_versions` ＋ 展開投影表 ＋ 寫 `review_records`」，滿足 NFR-08 要求的原子性。
- 稽核紀錄與權限查詢是普通的 SQL，不需要另一套資料同步機制。
- 引擎只需一次查詢就能拿到完整版本（`payload`），符合 §5.2 的效能估算。

**代價與風險**

- **多了一個必須維運的服務。** 開發環境需要資料庫；本機以容器啟動，CI 的 `web` job 目前不連資料庫（測試用 fixture 與純函式）。
- **`payload` 與投影表可能不一致。** 以「發布時同交易寫入」與「可重建」兩道機制處理；不允許應用程式直接寫投影表。
- **jsonb 沒有型別檢查。** schema 變更時舊資料不會自動驗證；每次讀取仍要跑 validator，或至少驗 `schemaVersion`。
- **稽核表的不可變性要靠兩層。** 僅靠應用層權限不夠；需同時限制 DB 角色權限，並以 trigger 拒絕 UPDATE／DELETE。
- **快取層級尚未決定。** 目前設計是「行程內 LRU ＋ 版本號為鍵」，不引入 Redis；若 I3 需要多實例共享快取再另立 ADR。

## 驗證方式

- TC-13：使用者 A 無法以修改請求識別碼讀寫 B 的資料（權限＋`user_id` 條件在 SQL 層）。
- TC-12：同步失敗不清空前次快照；成功後保留個人修正並更新 `synced_at`。
- TC-34：以 `versionId` 可還原版本時間軸與當時的內容雜湊。
- 交付前檢查：已發布的 `rule_versions` 與 `review_records` 對應用角色不可 UPDATE／DELETE（以實際 SQL 嘗試，不是看程式碼）。

## 相關

- [ADR-0001 規則即資料、版本不可變](0001-rules-as-data-immutable-versions.md)：`payload` 為什麼要整份快照。
- [ADR-0004 migration 工具](0004-migration-tooling.md)：這些表怎麼演進。
- [system-design.md](../system-design.md) §9 完整欄位清單；`database-design.md`（Step 4 產出）補欄位型別、索引與 seed。

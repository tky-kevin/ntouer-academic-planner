# ADR-0004：資料庫遷移工具與順序

Extends: system-design.md §9（資料模型）

- **狀態**：**Proposed（待團隊確認，見文末「待確認」）**
- **日期**：2026/11/16
- **決策者**：第七組（tky-kevin 彙整，需資料庫負責人覆核）
- **對應需求**：NFR-08（儲存可靠性）、NFR-09（可維護與可測試）、FR-12（版本不可變）
- **對應驗收**：TC-34（稽核追溯）
- **上游依據**：ADR-0002 已定案「PostgreSQL 為唯一持久層」；本 ADR 只決定**怎麼演進 schema**

## 背景

[_0002](0002-postgresql-jsonb.md) 定案了資料庫，但沒說 schema 怎麼改。這個決定在 I2 不能省略，因為 schema 裡有三種「不能事後補」的東西：

1. **部分索引與條件約束**：`department_admins` 的有效指派要用 `WHERE revoked_at IS NULL` 的唯一索引表達，不能只靠應用層查詢。
2. **GIN 索引**：`rule_versions.payload` 可能需要對 jsonb 建 GIN，這在 ORM 的 schema DSL 裡常常只能寫 raw SQL 逃生門。
3. **不可變表的保護**：`review_records`、已發布的 `rule_versions` 需以 trigger 或角色權限拒絕 UPDATE／DELETE（FR-18）。

另外，`rule_versions.payload` 這種「整份 jsonb 快照」的欄位，一旦上線就有歷史資料；任何 schema 變更都必須**向前相容**，不能靠「清空重建」。

## 決策（建議）

1. **採 `node-pg-migrate`**，遷移檔為純 SQL／JS，放在 `db/migrations/`，以 npm script 執行：
   - `npm run db:migrate`（套用到最新）
   - `npm run db:migrate:down`（回退一個版本）
   - `npm run db:status`
2. **連線只用 `pg`（node-postgres），不引入 ORM。** 專案已有 TypeScript 型別需求，但型別可由手寫的 row 型別＋查詢函式處理；不為了型別把 schema 擁有權交給第三方工具。
3. **每個遷移檔只做一件事**，檔名 `NNNN-動詞-對象.sql`（例：`0003-create-rule-versions.sql`），並且**必須能在既有資料上執行**（加欄位給預設值或可為 null 兩段式；不刪欄位）。
4. **順序依相依性固定**（細節與欄位定義見 Step 4 的 `database-design.md`）：
   `extensions` → `users`／`departments` → `department_admins` → `rule_bundles` → `rule_versions` → `rule_sources`／`rule_clauses` → `review_records`／`test_runs` → `student_records`／`student_overrides`／`student_condition_overrides`／`student_plans` → 索引與 trigger。
5. **回退策略：向前修復優先。** 已上線且有資料的環境不跑 `down`；壞掉就補一個新的 migration 修。`down` 只用於開發環境與 PR 檢查。
6. **CI 不連資料庫**（ADR-0006）。遷移是否可用以「在乾淨資料庫上從 0 套用到最新」驗證，由開發者本機或 I3 的整合 job 執行；本輪先不進 CI，避免把外部服務引進 CI。

## 為什麼不是其他工具

| 候選 | 純 SQL 表達（部分索引／GIN／trigger） | Node 執行 | 是否引入 ORM | 判斷 |
| --- | --- | --- | --- | --- |
| **`node-pg-migrate`（建議）** | 好（migration 內容就是 SQL 或 JS，可直接寫 `CREATE INDEX … WHERE …`） | 是 | 否 | 最符合「schema 由 SQL 掌握」的目標 |
| Prisma Migrate | 中（需 `Unsupported()` 逃生門才能寫部分索引） | 是 | **是**（Prisma Client 成為 schema 擁有者） | ORM 會把 ADR-0002 的「payload 才是真相」變成兩套真相 |
| Drizzle Kit | 中（schema 用 TS DSL 描述，raw SQL 需手寫 migration） | 是 | 半（有 query builder） | 可接受，但會綁定其 DSL 版本；遷移生成與手寫混用易分歧 |
| Flyway | 好 | **否**（需 JVM） | 否 | 與 Node 單一工具鏈不符，多一個執行環境 |
| 自製 runner | 好 | 是 | 否 | 要自己處理版本表、advisory lock、並發與交易，重造輪子 |

## 後果

**好處**

- schema 的真相在 SQL 檔，與 ADR-0002 的「`payload` 是規則真相」一致，不會出現 ORM 與手寫查詢兩套模型。
- 部分索引、GIN、trigger 都能直接寫，不需要繞過工具。
- 遷移檔進 git，review 時看得到實際 DDL。

**代價與風險**

- **沒有型別自動生成。** 需手寫 row 型別或查詢回傳型別；欄位改名時編譯器不會提醒你。（I2 資料表 12 張，規模可控。）
- **沒有 ORM 的關聯載入。** 需自己寫 join；換來的是查詢可預測、沒有 N+1 魔術。
- **`down` 容易腐化。** 少人維護的回退腳本常與 up 不同步，因此政策上以「向前修復」為主。
- **並發執行需 advisory lock。** 多個部署同時跑遷移時，需在 runner 外層加鎖；`node-pg-migrate` 有內建鎖，但要確認版本行為。

## 驗證方式

- 在空資料庫上 `npm run db:migrate` 可從 0 套用到最新，且 `db:status` 顯示全部套用。
- 在已套用的資料庫上重複執行不報錯（idempotent 的檢查）。
- 以 `\d+` 檢查部分索引（`department_admins` 的有效指派唯一）與 GIN 索引確實存在。
- 以應用角色嘗試 UPDATE／DELETE 已發布的 `review_records`，必須被拒絕（TC-34 的前置條件）。

## 待確認

1. **是否接受「不引入 ORM，`pg` + 手寫 SQL」？** 這會影響後續所有 API 實作風格（Fritzcoding 的 AP-I2-03／04）。若團隊選 Drizzle，本 ADR 與 ADR-0002 的「schema 擁有權」段落要一起改。
2. **遷移檔要放 `db/migrations/` 還是 `server/db/migrations/`？** 建議前者（與 `data/`、`docs/` 同層，不屬於應用程式碼）。
3. **誰負責跑正式環境的遷移？** 若無部署環境（ADR-0006 未定），I2 只在開發環境套用。

## 相關

- [ADR-0002 PostgreSQL + jsonb](0002-postgresql-jsonb.md)：資料表與約束的來源。
- [ADR-0006 部署平台與 CI](0006-deployment-platform-and-ci.md)：為何遷移不進 CI。
- [system-design.md](../system-design.md) §9；`database-design.md`（Step 4）補上實際 DDL 順序、索引理由與 seed。

## 對應 Issue

<!-- 必填。例：Closes #12（子 Issue）、Refs AP-I2-03（父 Issue／SRS 史詩） -->

Closes #

## 變更摘要

<!-- 改了什麼、為什麼。一個 PR 一件事；範圍外的修正請另開 PR。 -->

-

## 驗證方式

<!-- 必填。貼上實際跑過的指令與結果；CI 會跑 `web`、`docs` 兩個 job，本機請先跑過對應的。 -->

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run check:docs`（相對連結 0 壞）
- [ ] `node docs/design/spike/run-cases.mjs`（27 項全數通過）
- [ ] 手動／畫面驗證：<!-- 操作步驟與觀察結果 -->

## 是否更新設計文件

<!-- 行為、資料格式、API 或介面規則有變動就必須同步更新，並寫出檔案與章節。 -->

- [ ] 已更新：`docs/design/` <!-- 檔案與章節，例：system-design.md §5.4 -->
- [ ] 不需要更新，理由：

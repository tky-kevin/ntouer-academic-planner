# ADR-0003：以 Google OpenID Connect 為唯一身分來源

Extends: system-design.md §8（權限設計）、§11.1（登入畫面）

- **狀態**：Accepted（已定案，2026/11/16）
- **日期**：2026/11/16
- **決策者**：第七組（tky-kevin 彙整）
- **對應需求**：FR-01、FR-13、NFR-04、NFR-06
- **對應驗收**：TC-13（身分與儲存）、TC-27（權限生命週期）
- **上游依據**：SRS §4 元件圖的「Google 身分驗證」、AP-FR-01「以 Google 身分登入」、AP-US-03

## 背景

系統有三種角色：學生、系所管理員、系統管理員。其中「系所管理員」由系統管理員指派一個 **Google 身分**（FR-13），而且發布規則時後端要用**當下有效**的指派重新驗證權限（FR-12）。

要自己維護密碼，就得連帶處理註冊、重設、寄信、外洩通報與個資責任；這對一個期末專案是純粹的負債，而且與 FR-01 明訂的「以 Google 身分登入」不一致。

## 決策

1. **不建立自有密碼。** Google OpenID Connect（OIDC）是唯一登入方式；沒有註冊流程，沒有密碼欄位，沒有「忘記密碼」。
2. **採授權碼流程（authorization code）＋ PKCE**，由後端交換 token。不使用隱含流程，不讓 token 出現在網址。
3. **後端驗證 ID token 後才建立工作階段**，驗證項目至少包含：簽章（Google JWKS）、`iss`、`aud`（自己的 client_id）、`exp`、`nonce`，以及 `sub` 存在。
4. **`users.google_sub` 為使用者主鍵的依據**，不用 email 當識別（email 可變、可被改）。email 僅作顯示與聯絡。
5. **自有工作階段，不用 localStorage 存 token。** 登入成功後由後端簽發 `HttpOnly` ＋ `Secure` ＋ `SameSite=Lax` 的 cookie；登出＝後端撤銷該工作階段。前端拿不到可轉移的憑證。
6. **角色一律由後端決定**（`users.role` ＋ `department_admins`），前端送來的角色或系所一律不採信；這是 FR-01「使用者 A 無法藉修改請求識別碼讀寫 B 的紀錄」的機制，也是 system-design.md §8 的要求。
7. **AIS 帳密與 Google 身分脫鉤。** AIS 只在學生主動按同步時使用，不持久儲存、不進日誌（NFR-04）；Google 登入成功不代表已取得教務資料。

## 為什麼不是其他作法

| 替代方案 | 為何不採用 |
| --- | --- |
| 自建帳號密碼 | 要自己承擔密碼儲存、重設、洩漏通報；與 FR-01 明訂的 Google 登入衝突；對三人年的專案是純負債。 |
| 前端 SPA 拿 access token 存起來 | token 可被 XSS 取走且無法即時撤銷；NFR-04 要求「驗證個人資料歸屬」且登出後不得再存取，前端持有憑證難以做到。 |
| SAML／校內 SSO | 需與校方身分系統協商，SRS 未列為資源；且 FR-13 的指派單位是 Google 身分。 |
| **Google OIDC + 後端工作階段（採用）** | 身分來源單一、撤銷可控、後端是唯一信任邊界；不需要維護密碼。 |

## 後果

**好處**

- 沒有密碼就沒有密碼外洩；NFR-04 的「AIS 密碼不持久儲存、不進日誌」可以只針對同步流程處理。
- 角色與系所範圍的檢查集中在 API 中介層，與 UI 完全分離（UI 隱藏只是體驗）。
- 「代理發布」可以用同一個身分模型表達：系統管理員在無管理員的系所發布，並在版本上標 `proxy: true`（FR-12）。

**代價與風險**

- **Google 不可用時無人能登入。** 可接受（學生與管理者本來就都用 Google 身分），但要在錯誤頁說清楚是外部身分服務問題，不是資料錯誤。
- **無法用網域限制身分。** 使用者可能是個人 Gmail，`hd` claim 不可靠；因此**「誰是管理員」只能由系統管理員指派**（FR-13）來控制，不能靠信箱網域推論。
- **`sub` 與校內學號的對應仍待解決。** I2 以 Google 身分為主；若要對應學號與系所，需人工或匯入對照表，本 ADR 不假設已有此資料。
- **OIDC client 需要一組 secret。** 依 ADR-0006，secret 只存在部署環境，**不進 CI、不進 repo**。
- **「NTOUer 既有驗證模組」的介面尚未確認。** FR-01 提到可沿用；若該模組只提供自家 session 而非 OIDC client，本決策不變，只是自行接 Google OIDC，不依賴該模組。

## 驗證方式

- TC-13：使用者 A 登入後儲存設定與修正，重新登入仍可取得；使用者 B 以 A 的識別碼發請求被拒；登入失敗與登出後都無法存取需要登入的 API。
- TC-27：系所管理員的指派與撤銷即時影響發布權；撤銷最後一位後恢復由系統管理員發布，舊版本標示不改寫。
- 資安檢查：回應標頭、cookie 屬性（`HttpOnly`／`Secure`／`SameSite`）、登出後舊 cookie 失效。

## 相關

- [ADR-0006 部署平台與 CI](0006-deployment-platform-and-ci.md)：secret 與 HTTPS 的邊界。
- [system-design.md](../system-design.md) §8 權限矩陣；AuthN 循序圖由 Step 4 補在 `system-design.md` 新增章節。
- [ADR-0002 PostgreSQL + jsonb](0002-postgresql-jsonb.md)：`users.google_sub` 唯一約束。

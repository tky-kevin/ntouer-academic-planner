// 管理端發布流程的 API 層（UI-08、UI-09）：docs/design/api-spec.md §7.8。
// 與學生端共用 `apiFetch` 的 envelope 解析與 `ProgressApiError`；
// 這裡只組合路徑與 body，不重複實作錯誤處理。
import { apiFetch } from './client'

export type AdminVersionStatus =
  | 'draft'
  | 'validating'
  | 'testing'
  | 'in-review'
  | 'approved'
  | 'published'
  | 'superseded'

/** 後端依狀態與權限算出的可執行動作；前端只拿來決定按鈕是否可用。 */
export type AdminAction = 'validate' | 'test' | 'submit' | 'approve' | 'reject' | 'publish'

/**
 * 規則包 payload 的寬鬆形狀：管理端只需要摘要數量與原樣回傳，
 * 完整結構由 `src/engine/ruleEngine.ts` 在伺服器端驗證，前端不重造一份型別。
 */
export interface AdminRulePayload {
  schemaVersion?: string
  bundleId?: string
  title?: string
  sources?: unknown[]
  clauses?: unknown[]
  requirements?: unknown[]
  [key: string]: unknown
}

export interface AdminVersion {
  versionId: string
  bundleId: string
  versionNo: number
  status: AdminVersionStatus
  schemaVersion: string
  contentHash: string
  publishedAt: string | null
  proxy: boolean
  payload: AdminRulePayload
  allowedActions: AdminAction[]
}

export interface AdminDraftUpdate {
  versionId: string
  status: AdminVersionStatus
  contentHash: string
  updatedAt: string
}

export interface AdminTestRecord {
  courseCode: string
  credits: number
  status: string
  category?: string
  owner?: string
  tags?: string[]
  dept?: string
}

export interface AdminValidationResult {
  versionId: string
  valid: boolean
  errors: string[]
  checkedAt: string
}

export interface AdminTestCaseResult {
  name: string
  status: 'passed' | 'failed'
  detail?: string
}

export interface AdminTestResult {
  versionId: string
  suite: string
  scenario: string
  passed: number
  failed: number
  overall: 'complete' | 'unconfirmed' | 'incomplete' | null
  totalCredits: number | null
  results: AdminTestCaseResult[]
}

export interface AdminTransitionResult {
  versionId: string
  status: AdminVersionStatus
  submittedAt?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  notes?: string | null
}

export interface AdminPublishResult {
  versionId: string
  status: AdminVersionStatus
  publishedAt: string | null
  publishedBy: string
  proxy: boolean
  superseded: string[]
}

export interface AdminAuditItem {
  recordId: string
  versionId: string
  action: string
  actorId: string | null
  actorRole: string
  actorDeptScope: string | null
  at: string
  detail: unknown
  contentHash: string
  diffFrom: unknown
}

export interface AdminAuditPage {
  items: AdminAuditItem[]
  nextCursor: string | null
  limit: number
}

export interface AdminDiffFieldChange {
  field: string
  before: unknown
  after: unknown
}

export interface AdminDiffItem {
  kind: 'added' | 'removed' | 'changed'
  id: string
  label?: string
  clauseId?: string
  before?: string
  after?: string
  changes?: AdminDiffFieldChange[]
}

export interface AdminDiff {
  versionId: string
  bundleId: string
  versionNo: number
  status: AdminVersionStatus
  previousVersionId: string | null
  summary: { added: number; removed: number; changed: number }
  requirements: AdminDiffItem[]
  clauses: AdminDiffItem[]
  sources: AdminDiffItem[]
}

export interface AdminAuditQuery {
  limit?: number
  cursor?: string | null
  versionId?: string | null
}

function versionPath(versionId: string, suffix = ''): string {
  // versionId 是 `bundleId@versionNo`；encode 後 `@` 仍保留，但不自己拼字串。
  return `/api/admin/rules/${encodeURIComponent(versionId)}${suffix}`
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export function getAdminVersion(versionId: string): Promise<AdminVersion> {
  return apiFetch<AdminVersion>(versionPath(versionId))
}

/** 整份 payload 取代（PUT 語意），不是部分合併；只有 draft 可以改。 */
export function updateDraft(versionId: string, payload: AdminRulePayload): Promise<AdminDraftUpdate> {
  return apiFetch<AdminDraftUpdate>(versionPath(versionId), {
    method: 'PUT',
    body: JSON.stringify({ payload }),
  })
}

export function validateVersion(versionId: string): Promise<AdminValidationResult> {
  return post<AdminValidationResult>(versionPath(versionId, '/validate'))
}

/** `records` 省略或空陣列時，後端跑空資料檢核（suite=empty-data），缺額不算失敗。 */
export function testVersion(versionId: string, records: AdminTestRecord[] = []): Promise<AdminTestResult> {
  return post<AdminTestResult>(versionPath(versionId, '/test'), { records })
}

export function submitVersion(versionId: string): Promise<AdminTransitionResult> {
  return post<AdminTransitionResult>(versionPath(versionId, '/submit'))
}

export function approveVersion(versionId: string): Promise<AdminTransitionResult> {
  return post<AdminTransitionResult>(versionPath(versionId, '/approve'))
}

export function rejectVersion(versionId: string, reason: string): Promise<AdminTransitionResult> {
  return post<AdminTransitionResult>(versionPath(versionId, '/reject'), { reason })
}

export function publishVersion(versionId: string): Promise<AdminPublishResult> {
  return post<AdminPublishResult>(versionPath(versionId, '/publish'))
}

export function getDiff(versionId: string): Promise<AdminDiff> {
  return apiFetch<AdminDiff>(versionPath(versionId, '/diff'))
}

export function getAudit(query: AdminAuditQuery = {}): Promise<AdminAuditPage> {
  const params = new URLSearchParams()
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.versionId) params.set('versionId', query.versionId)
  const search = params.toString()
  return apiFetch<AdminAuditPage>(`/api/admin/audit${search ? `?${search}` : ''}`)
}

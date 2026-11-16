// 管理端的所有 SQL（Issue #14）。這一層不判斷權限、不決定 HTTP 狀態，只做資料存取。
//
// 交易策略：`QueryFn` 由 server/index.ts 以 pg `pool.query` 實作，每次呼叫可能是不同連線，
// 所以跨 statement 的 `begin/commit/rollback` 在這裡**不安全**（BEGIN 與 COMMIT 會落在不同 client）。
// 因此會一起成功的寫入都合併成「單一 statement 的 data-modifying CTE」：
//   - 建立草稿＋created 稽核
//   - submit／approve／reject＋對應稽核
//   - publish＋supersede 舊版＋published／superseded 稽核
//   - test_runs＋tested 稽核
// 發布前後的其他寫入（rule_sources／rule_clauses 投影）刻意設計成可重複執行（先刪再插），
// 中途失敗時重跑 publish 會自我修復，不會把半套投影留在 published 版本上。
import type { QueryFn } from '../app.js'
import type { RuleBundle } from '../../src/engine/ruleEngine.js'

export type VersionStatus =
  | 'draft'
  | 'validating'
  | 'testing'
  | 'in-review'
  | 'approved'
  | 'published'
  | 'superseded'

export type ReviewAction =
  | 'created'
  | 'validated'
  | 'tested'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'superseded'

export interface BundleRow {
  bundle_id: string
  dept_id: string
  entry_year: number
  program: string
  title: string
}

export interface VersionRow {
  version_id: string
  bundle_id: string
  version_no: number
  status: VersionStatus
  payload: RuleBundle
  schema_version: string
  content_hash: string
  created_by: string | null
  created_at: Date
  submitted_at: Date | null
  reviewed_by: string | null
  reviewed_at: Date | null
  published_by: string | null
  published_at: Date | null
  proxy: boolean
  superseded_at: Date | null
  notes: string | null
  dept_id: string
}

export interface VersionSummary {
  version_id: string
  version_no: number
  payload: RuleBundle
}

export interface PublishedVersionRow {
  version_id: string
  version_no: number
  content_hash: string
  payload: RuleBundle
}

export interface ActorSnapshot {
  actorId: string
  actorRole: string
  actorDeptScope: string | null
}

export interface ReviewRow {
  record_id: string | number
  version_id: string
  action: ReviewAction
  actor_id: string | null
  actor_role: string
  actor_dept_scope: string | null
  at: Date
  detail: unknown
  content_hash: string
  diff_from: unknown
}

const VERSION_COLUMNS = `v.version_id, v.bundle_id, v.version_no, v.status, v.payload, v.schema_version,
            v.content_hash, v.created_by, v.created_at, v.submitted_at, v.reviewed_by, v.reviewed_at,
            v.published_by, v.published_at, v.proxy, v.superseded_at, v.notes, b.dept_id`

export async function getBundle(query: QueryFn, bundleId: string): Promise<BundleRow | null> {
  const result = await query(
    `select bundle_id, dept_id, entry_year, program, title from rule_bundles where bundle_id = $1`,
    [bundleId],
  )
  return (result.rows[0] as BundleRow | undefined) ?? null
}

export async function getVersion(query: QueryFn, versionId: string): Promise<VersionRow | null> {
  const result = await query(
    `select ${VERSION_COLUMNS}
       from rule_versions v
       join rule_bundles b on b.bundle_id = v.bundle_id
      where v.version_id = $1`,
    [versionId],
  )
  return (result.rows[0] as VersionRow | undefined) ?? null
}

export async function getLatestVersion(query: QueryFn, bundleId: string): Promise<VersionSummary | null> {
  const result = await query(
    `select v.version_id, v.version_no, v.payload
       from rule_versions v
      where v.bundle_id = $1
      order by v.version_no desc
      limit 1`,
    [bundleId],
  )
  return (result.rows[0] as VersionSummary | undefined) ?? null
}

export async function getPreviousVersion(
  query: QueryFn,
  bundleId: string,
  versionNo: number,
): Promise<VersionSummary | null> {
  const result = await query(
    `select v.version_id, v.version_no, v.payload
       from rule_versions v
      where v.bundle_id = $1 and v.version_no < $2
      order by v.version_no desc
      limit 1`,
    [bundleId, versionNo],
  )
  return (result.rows[0] as VersionSummary | undefined) ?? null
}

export async function listPublishedVersions(query: QueryFn, bundleId: string): Promise<PublishedVersionRow[]> {
  const result = await query(
    `select version_id, version_no, content_hash, payload
       from rule_versions
      where bundle_id = $1 and status = 'published'
      order by version_no`,
    [bundleId],
  )
  return result.rows as PublishedVersionRow[]
}

export async function updateDraftPayload(
  query: QueryFn,
  versionId: string,
  payload: RuleBundle,
  contentHash: string,
  schemaVersion: string,
): Promise<{ version_id: string; status: VersionStatus; content_hash: string } | null> {
  const result = await query(
    `update rule_versions
        set payload = $2::jsonb, content_hash = $3, schema_version = $4
      where version_id = $1 and status = 'draft'
      returning version_id, status, content_hash`,
    [versionId, payload, contentHash, schemaVersion],
  )
  return (result.rows[0] as { version_id: string; status: VersionStatus; content_hash: string } | undefined) ?? null
}

export interface CreateDraftInput {
  bundleId: string
  payload: RuleBundle
  schemaVersion: string
  contentHash: string
  actor: ActorSnapshot
  notes: string | null
  detail: unknown
  diffFrom: unknown
}

/** version_no 由 SQL 的 max+1 決定；`unique (bundle_id, version_no)` 是最後防線。 */
export async function createDraftVersion(query: QueryFn, input: CreateDraftInput): Promise<VersionRow | null> {
  const result = await query(
    `with next as (
       select coalesce(max(version_no), 0) + 1 as version_no
         from rule_versions
        where bundle_id = $1
     ),
     created as (
       insert into rule_versions
         (version_id, bundle_id, version_no, status, payload, schema_version, content_hash, created_by, notes)
       select $1::text || '@' || next.version_no, $1, next.version_no, 'draft', $2::jsonb, $3, $4, $5::uuid, $6
         from next
       returning version_id, bundle_id, version_no, status, payload, schema_version, content_hash,
                 created_by, created_at, submitted_at, reviewed_by, reviewed_at, published_by, published_at,
                 proxy, superseded_at, notes
     ),
     audit as (
       insert into review_records
         (version_id, action, actor_id, actor_role, actor_dept_scope, detail, content_hash, diff_from)
       select version_id, 'created', $5::uuid, $7, $8, $9::jsonb, content_hash, $10::jsonb
         from created
       returning record_id
     )
     select c.*, (select record_id from audit) as record_id
       from created c`,
    [
      input.bundleId,
      input.payload,
      input.schemaVersion,
      input.contentHash,
      input.actor.actorId,
      input.notes,
      input.actor.actorRole,
      input.actor.actorDeptScope,
      input.detail,
      input.diffFrom,
    ],
  )
  return (result.rows[0] as VersionRow | undefined) ?? null
}

const TRANSITION_RETURNING = `version_id, bundle_id, version_no, status, payload, schema_version, content_hash,
  created_by, created_at, submitted_at, reviewed_by, reviewed_at, published_by, published_at,
  proxy, superseded_at, notes`

export interface TransitionAudit {
  actor: ActorSnapshot
  detail: unknown
  diffFrom: unknown
}

export async function submitVersion(
  query: QueryFn,
  versionId: string,
  expectedStatus: VersionStatus,
  audit: TransitionAudit,
): Promise<VersionRow | null> {
  const result = await query(
    `with updated as (
       update rule_versions
          set status = 'in-review', submitted_at = now()
        where version_id = $1 and status = $2
        returning ${TRANSITION_RETURNING}
     ),
     audit as (
       insert into review_records
         (version_id, action, actor_id, actor_role, actor_dept_scope, detail, content_hash, diff_from)
       select version_id, 'submitted', $3::uuid, $4, $5, $6::jsonb, content_hash, $7::jsonb
         from updated
       returning record_id
     )
     select u.* from updated u`,
    [versionId, expectedStatus, audit.actor.actorId, audit.actor.actorRole, audit.actor.actorDeptScope, audit.detail, audit.diffFrom],
  )
  return (result.rows[0] as VersionRow | undefined) ?? null
}

export async function approveVersion(
  query: QueryFn,
  versionId: string,
  expectedStatus: VersionStatus,
  audit: TransitionAudit,
): Promise<VersionRow | null> {
  const result = await query(
    `with updated as (
       update rule_versions
          set status = 'approved', reviewed_by = $3::uuid, reviewed_at = now()
        where version_id = $1 and status = $2
        returning ${TRANSITION_RETURNING}
     ),
     audit as (
       insert into review_records
         (version_id, action, actor_id, actor_role, actor_dept_scope, detail, content_hash, diff_from)
       select version_id, 'approved', $3::uuid, $4, $5, $6::jsonb, content_hash, $7::jsonb
         from updated
       returning record_id
     )
     select u.* from updated u`,
    [versionId, expectedStatus, audit.actor.actorId, audit.actor.actorRole, audit.actor.actorDeptScope, audit.detail, audit.diffFrom],
  )
  return (result.rows[0] as VersionRow | undefined) ?? null
}

export async function rejectVersion(
  query: QueryFn,
  versionId: string,
  expectedStatus: VersionStatus,
  reason: string,
  audit: TransitionAudit,
): Promise<VersionRow | null> {
  const result = await query(
    `with updated as (
       update rule_versions
          set status = 'draft', reviewed_by = $3::uuid, reviewed_at = now(), notes = $4
        where version_id = $1 and status = $2
        returning ${TRANSITION_RETURNING}
     ),
     audit as (
       insert into review_records
         (version_id, action, actor_id, actor_role, actor_dept_scope, detail, content_hash, diff_from)
       select version_id, 'rejected', $3::uuid, $5, $6, $7::jsonb, content_hash, $8::jsonb
         from updated
       returning record_id
     )
     select u.* from updated u`,
    [
      versionId,
      expectedStatus,
      audit.actor.actorId,
      reason,
      audit.actor.actorRole,
      audit.actor.actorDeptScope,
      audit.detail,
      audit.diffFrom,
    ],
  )
  return (result.rows[0] as VersionRow | undefined) ?? null
}

export interface PublishResult {
  version: VersionRow
  supersededVersionIds: string[]
}

/**
 * approved → published，並把同 bundle 先前 published 的版本改成 superseded。
 * 三個寫入（supersede、publish、兩筆稽核）在同一個 statement 內。
 */
export async function publishVersion(
  query: QueryFn,
  versionId: string,
  publishedBy: string,
  proxy: boolean,
  audit: TransitionAudit,
  supersededDiffFrom: Record<string, unknown> = {},
): Promise<PublishResult | null> {
  const result = await query(
    `with target as (
       select version_id, bundle_id
         from rule_versions
        where version_id = $1 and status = 'approved'
     ),
     superseded as (
       update rule_versions
          set status = 'superseded', superseded_at = now()
        where status = 'published'
          and version_id <> $1
          and bundle_id = (select bundle_id from target)
        returning version_id, content_hash
     ),
     published as (
       update rule_versions
          set status = 'published', published_by = $2::uuid, published_at = now(), proxy = $3
        where version_id = $1 and status = 'approved'
        returning ${TRANSITION_RETURNING}
     ),
     audit_published as (
       insert into review_records
         (version_id, action, actor_id, actor_role, actor_dept_scope, detail, content_hash, diff_from)
       select version_id, 'published', $2::uuid, $4, $5, $6::jsonb, content_hash, $7::jsonb
         from published
       returning record_id
     ),
     audit_superseded as (
       insert into review_records
         (version_id, action, actor_id, actor_role, actor_dept_scope, detail, content_hash, diff_from)
       select version_id, 'superseded', $2::uuid, $4, $5,
              jsonb_build_object('supersededBy', $1::text), content_hash,
              $8::jsonb -> superseded.version_id
         from superseded
       returning record_id
     )
     select p.*,
            (select coalesce(jsonb_agg(s.version_id), '[]'::jsonb) from superseded s) as superseded_version_ids
       from published p`,
    [
      versionId,
      publishedBy,
      proxy,
      audit.actor.actorRole,
      audit.actor.actorDeptScope,
      audit.detail,
      audit.diffFrom,
      supersededDiffFrom,
    ],
  )
  const row = result.rows[0] as (VersionRow & { superseded_version_ids?: string[] }) | undefined
  if (!row) return null
  const { superseded_version_ids: supersededVersionIds, ...version } = row
  return { version, supersededVersionIds: supersededVersionIds ?? [] }
}

export async function recordValidation(
  query: QueryFn,
  versionId: string,
  contentHash: string,
  audit: ActorSnapshot & { detail: unknown; diffFrom: unknown },
): Promise<void> {
  await query(
    `insert into review_records
       (version_id, action, actor_id, actor_role, actor_dept_scope, detail, content_hash, diff_from)
     values ($1, 'validated', $2::uuid, $3, $4, $5::jsonb, $6, $7::jsonb)`,
    [versionId, audit.actorId, audit.actorRole, audit.actorDeptScope, audit.detail, contentHash, audit.diffFrom],
  )
}

export interface TestRunInput {
  versionId: string
  suite: string
  passed: number
  failed: number
  detail: unknown
  contentHash: string
  actor: ActorSnapshot
  diffFrom: unknown
}

export async function recordTestRun(query: QueryFn, input: TestRunInput): Promise<void> {
  await query(
    `with recorded as (
       insert into test_runs (version_id, suite, passed, failed, detail, run_by)
       values ($1, $2, $3, $4, $5::jsonb, $6::uuid)
       returning run_id
     ),
     audit as (
       insert into review_records
         (version_id, action, actor_id, actor_role, actor_dept_scope, detail, content_hash, diff_from)
       values ($1, 'tested', $6::uuid, $7, $8, $9::jsonb, $10, $11::jsonb)
       returning record_id
     )
     select (select run_id from recorded) as run_id, (select record_id from audit) as record_id`,
    [
      input.versionId,
      input.suite,
      input.passed,
      input.failed,
      input.detail,
      input.actor.actorId,
      input.actor.actorRole,
      input.actor.actorDeptScope,
      { suite: input.suite, passed: input.passed, failed: input.failed },
      input.contentHash,
      input.diffFrom,
    ],
  )
}

// ─── payload → rule_sources／rule_clauses 投影 ───────────────────────────────

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function dateOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

/**
 * 把 payload 的 sources／clauses 投影到正規化表格，供 GET /api/rules/{versionId} 查詢。
 * 必須在版本還是 approved（非 published）時呼叫：0017 的 trigger 禁止改 published 版本的小孩。
 * 先刪再插，可重複執行。
 */
export async function replaceProjection(query: QueryFn, versionId: string, payload: RuleBundle): Promise<void> {
  await query(`delete from rule_clauses where version_id = $1`, [versionId])
  await query(`delete from rule_sources where version_id = $1`, [versionId])

  for (const raw of payload.sources ?? []) {
    const source = recordOf(raw)
    const sourceId = stringOf(source.sourceId)
    if (!sourceId) continue
    const status = ['active', 'retired', 'unresolved'].includes(String(source.status))
      ? String(source.status)
      : 'active'
    await query(
      `insert into rule_sources
         (version_id, source_id, title, url, locator, sha256, retrieved_at, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (version_id, source_id) do update
         set title = excluded.title, url = excluded.url, locator = excluded.locator,
             sha256 = excluded.sha256, retrieved_at = excluded.retrieved_at, status = excluded.status`,
      [
        versionId,
        sourceId,
        stringOf(source.title) ?? sourceId,
        stringOf(source.url),
        stringOf(source.locator) ?? '',
        stringOf(source.sha256),
        dateOrNull(source.retrievedAt),
        status,
      ],
    )
  }

  for (const raw of payload.clauses ?? []) {
    const clause = recordOf(raw)
    const clauseId = stringOf(clause.clauseId)
    const sourceId = stringOf(clause.sourceId)
    if (!clauseId || !sourceId) continue
    const status = ['verified', 'pending', 'conflict'].includes(String(clause.status))
      ? String(clause.status)
      : 'verified'
    await query(
      `insert into rule_clauses
         (version_id, clause_id, source_id, locator, text, reading, status)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (version_id, clause_id) do update
         set source_id = excluded.source_id, locator = excluded.locator, text = excluded.text,
             reading = excluded.reading, status = excluded.status`,
      [
        versionId,
        clauseId,
        sourceId,
        stringOf(clause.locator) ?? '',
        stringOf(clause.text) ?? '',
        stringOf(clause.reading),
        status,
      ],
    )
  }
}

// ─── 稽核查詢 ────────────────────────────────────────────────────────────────

export interface AuditFilter {
  limit: number
  cursor: string | null
  versionId: string | null
  /** null＝不限制（系統管理員）；否則只回這些系所的版本紀錄。 */
  deptScopes: readonly string[] | null
}

export async function listReviewRecords(query: QueryFn, filter: AuditFilter): Promise<ReviewRow[]> {
  const where: string[] = []
  const params: unknown[] = []

  if (filter.versionId) {
    params.push(filter.versionId)
    where.push(`r.version_id = $${params.length}`)
  }
  if (filter.cursor) {
    params.push(filter.cursor)
    where.push(`r.record_id > $${params.length}::bigint`)
  }
  if (filter.deptScopes) {
    params.push(filter.deptScopes)
    where.push(`b.dept_id = any($${params.length}::text[])`)
  }
  params.push(filter.limit + 1)

  const result = await query(
    `select r.record_id, r.version_id, r.action, r.actor_id, r.actor_role, r.actor_dept_scope,
            r.at, r.detail, r.content_hash, r.diff_from
       from review_records r
       join rule_versions v on v.version_id = r.version_id
       join rule_bundles b on b.bundle_id = v.bundle_id
      ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
      order by r.record_id asc
      limit $${params.length}`,
    params,
  )
  return result.rows as ReviewRow[]
}

// 管理端請求的「形狀驗證」與 payload 正規化（Issue #14）。
// 這一層只負責 HTTP 契約（欄位名稱、型別、列舉、必填）與雜湊；
// 「規則內容對不對」由 src/engine/ruleEngine.ts 的 validateBundle() 負責，兩者刻意分開：
//   - 形狀錯誤（body 多欄位、credits 不是數字）→ 400 REQUEST_INVALID
//   - 規則內容錯誤（selector 指到不存在的 clause）→ 422 RULE_VALIDATION_FAILED
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { combineAnd, combineOr, evaluate } from '../../src/engine/ruleEngine.js'
import type {
  CourseRecordInput,
  EvaluationResult,
  OverallState,
  RecordStatus,
  RequirementResult,
  RequirementState,
  RuleBundle,
  Scenario,
} from '../../src/engine/ruleEngine.js'
import { parseVersionId } from '../routes/rules.js'

export interface Problem {
  field: string
  reason: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problems: Problem[] }

/** 請求 body 上限；規則包實測 40–100 KB，1 MiB 留給測試案例。 */
export const MAX_BODY_BYTES = 1_048_576

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failure(field: string, reason: string): ParseResult<never> {
  return { ok: false, problems: [{ field, reason }] }
}

/** 讀 JSON body；空 body 視為 `{}`（無 body 的端點才不會被迫帶 `{}`）。 */
export async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<ParseResult<unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      total += buffer.length
      if (total > maxBytes) {
        return { ok: false, problems: [{ field: 'body', reason: `超過 ${maxBytes} 位元組上限` }] }
      }
      chunks.push(buffer)
    }
  } catch {
    return { ok: false, problems: [{ field: 'body', reason: '讀取請求內容失敗' }] }
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, problems: [{ field: 'body', reason: '必須是合法 JSON' }] }
  }
}

/** 只允許列出的欄位；未知欄位一律拒絕（api-spec §1「未知欄位：請求拒絕」）。 */
export function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): Problem[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ field: key, reason: '未知欄位' }))
}

/** 查詢參數只允許列出的名稱；重複出現也視為不合法（避免 `?limit=1&limit=2` 的歧義）。 */
export function rejectUnknownQuery(url: URL, allowed: readonly string[]): Problem[] {
  const problems: Problem[] = []
  for (const key of new Set(url.searchParams.keys())) {
    if (!allowed.includes(key)) {
      problems.push({ field: key, reason: '未知查詢參數' })
      continue
    }
    if (url.searchParams.getAll(key).length > 1) {
      problems.push({ field: key, reason: '查詢參數重複' })
    }
  }
  return problems
}

// ─── payload 形狀 ────────────────────────────────────────────────────────────

// docs/design/rule-bundle.schema.json 的頂層欄位（additionalProperties: false）。
const PAYLOAD_KEYS = [
  'schemaVersion',
  'bundleId',
  'title',
  'department',
  'scope',
  'status',
  'version',
  'sources',
  'clauses',
  'allocation',
  'requirements',
  'conflicts',
] as const

const ARRAY_KEYS = ['sources', 'clauses', 'requirements', 'conflicts'] as const
const OBJECT_KEYS = ['department', 'scope', 'version', 'allocation'] as const

/**
 * payload 的形狀檢查（不是規則語意檢查）。
 * `expectedBundleId` 有值時，payload.bundleId 若存在必須相同，避免一個版本指向另一個規則包。
 */
export function parsePayloadObject(value: unknown, expectedBundleId?: string): ParseResult<Record<string, unknown>> {
  if (!isPlainObject(value)) return failure('payload', '必須是物件')
  const problems = rejectUnknownKeys(value, PAYLOAD_KEYS).map((problem) => ({ ...problem, field: `payload.${problem.field}` }))

  for (const key of ['schemaVersion', 'bundleId', 'title', 'status'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      problems.push({ field: `payload.${key}`, reason: '必須是字串' })
    }
  }
  if (value.bundleId !== undefined && expectedBundleId !== undefined && value.bundleId !== expectedBundleId) {
    problems.push({ field: 'payload.bundleId', reason: `必須等於路徑上的 ${expectedBundleId}` })
  }
  for (const key of ARRAY_KEYS) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      problems.push({ field: `payload.${key}`, reason: '必須是陣列' })
    }
  }
  for (const key of ARRAY_KEYS) {
    const items = value[key]
    if (Array.isArray(items)) {
      items.forEach((item, index) => {
        if (!isPlainObject(item)) problems.push({ field: `payload.${key}[${index}]`, reason: '必須是物件' })
      })
    }
  }
  for (const key of OBJECT_KEYS) {
    if (value[key] !== undefined && !isPlainObject(value[key])) {
      problems.push({ field: `payload.${key}`, reason: '必須是物件' })
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value }
}

// ─── 各端點的 body ───────────────────────────────────────────────────────────

export interface CreateDraftBody {
  /** 省略時由 store 複製最新版本，或由 rule_bundles 建骨架。 */
  payload?: Record<string, unknown>
}

export function parseCreateDraftBody(value: unknown, bundleId: string): ParseResult<CreateDraftBody> {
  if (!isPlainObject(value)) return failure('body', '必須是物件')
  const problems = rejectUnknownKeys(value, ['payload'])
  if (value.payload === undefined) return problems.length > 0 ? { ok: false, problems } : { ok: true, value: {} }
  const payload = parsePayloadObject(value.payload, bundleId)
  if (!payload.ok) return { ok: false, problems: [...problems, ...payload.problems] }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: { payload: payload.value } }
}

export function parseUpdateBody(value: unknown, bundleId: string): ParseResult<Record<string, unknown>> {
  if (!isPlainObject(value)) return failure('body', '必須是物件')
  const problems = rejectUnknownKeys(value, ['payload'])
  if (value.payload === undefined) problems.push({ field: 'payload', reason: '必填' })
  const payload = value.payload === undefined ? null : parsePayloadObject(value.payload, bundleId)
  if (payload && !payload.ok) problems.push(...payload.problems)
  if (problems.length > 0 || !payload) return { ok: false, problems }
  return payload
}

export const RECORD_STATUSES: readonly RecordStatus[] = [
  'pass',
  'transfer',
  'waived',
  'inProgress',
  'planned',
  'fail',
  'excluded',
  'unknown',
]
export const SCENARIOS: readonly Scenario[] = ['completed', 'inProgress', 'planned']
export const REQUIREMENT_STATES: readonly RequirementState[] = ['met', 'notMet', 'unknown']

const RECORD_KEYS = ['courseCode', 'credits', 'status', 'category', 'owner', 'tags', 'dept'] as const
const MAX_TEST_RECORDS = 1_000

export interface TestBody {
  records: CourseRecordInput[]
  scenario: Scenario
  statuses: Partial<Record<string, RequirementState>>
}

function parseRecord(value: unknown, path: string): { record?: CourseRecordInput; problems: Problem[] } {
  if (!isPlainObject(value)) return { problems: [{ field: path, reason: '必須是物件' }] }
  const problems = rejectUnknownKeys(value, RECORD_KEYS).map((problem) => ({ ...problem, field: `${path}.${problem.field}` }))
  if (typeof value.courseCode !== 'string' || value.courseCode.trim().length === 0) {
    problems.push({ field: `${path}.courseCode`, reason: '必填且必須是非空字串' })
  } else if (value.courseCode.length > 200) {
    problems.push({ field: `${path}.courseCode`, reason: '長度不可超過 200' })
  }
  if (typeof value.credits !== 'number' || !Number.isFinite(value.credits) || value.credits < 0 || value.credits > 1_000) {
    problems.push({ field: `${path}.credits`, reason: '必須是 0–1000 的數字' })
  }
  if (typeof value.status !== 'string' || !RECORD_STATUSES.includes(value.status as RecordStatus)) {
    problems.push({ field: `${path}.status`, reason: `只接受 ${RECORD_STATUSES.join('／')}` })
  }
  for (const key of ['category', 'owner', 'dept'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      problems.push({ field: `${path}.${key}`, reason: '必須是字串' })
    }
  }
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string')) {
      problems.push({ field: `${path}.tags`, reason: '必須是字串陣列' })
    }
  }
  if (problems.length > 0) return { problems }
  return {
    problems,
    record: {
      courseCode: value.courseCode as string,
      credits: value.credits as number,
      status: value.status as RecordStatus,
      ...(value.category === undefined ? {} : { category: value.category as string }),
      ...(value.owner === undefined ? {} : { owner: value.owner as string }),
      ...(value.tags === undefined ? {} : { tags: value.tags as string[] }),
      ...(value.dept === undefined ? {} : { dept: value.dept as string }),
    },
  }
}

export function parseTestBody(value: unknown): ParseResult<TestBody> {
  if (!isPlainObject(value)) return failure('body', '必須是物件')
  const problems = rejectUnknownKeys(value, ['records', 'scenario', 'statuses'])

  const scenario = value.scenario ?? 'completed'
  if (typeof scenario !== 'string' || !SCENARIOS.includes(scenario as Scenario)) {
    problems.push({ field: 'scenario', reason: `只接受 ${SCENARIOS.join('／')}` })
  }

  const records: CourseRecordInput[] = []
  if (value.records !== undefined) {
    if (!Array.isArray(value.records)) {
      problems.push({ field: 'records', reason: '必須是陣列' })
    } else if (value.records.length > MAX_TEST_RECORDS) {
      problems.push({ field: 'records', reason: `最多 ${MAX_TEST_RECORDS} 筆` })
    } else {
      value.records.forEach((record, index) => {
        const parsed = parseRecord(record, `records[${index}]`)
        problems.push(...parsed.problems)
        if (parsed.record) records.push(parsed.record)
      })
    }
  }

  const statuses: Partial<Record<string, RequirementState>> = {}
  if (value.statuses !== undefined) {
    if (!isPlainObject(value.statuses)) {
      problems.push({ field: 'statuses', reason: '必須是物件' })
    } else {
      for (const [key, state] of Object.entries(value.statuses)) {
        if (key.trim().length === 0) {
          problems.push({ field: 'statuses', reason: '狀態鍵不可為空' })
        } else if (typeof state !== 'string' || !REQUIREMENT_STATES.includes(state as RequirementState)) {
          problems.push({ field: `statuses.${key}`, reason: `只接受 ${REQUIREMENT_STATES.join('／')}` })
        } else {
          statuses[key] = state as RequirementState
        }
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { records, scenario: scenario as Scenario, statuses } }
}

export function parseRejectBody(value: unknown): ParseResult<{ reason: string }> {
  if (!isPlainObject(value)) return failure('body', '必須是物件')
  const problems = rejectUnknownKeys(value, ['reason'])
  if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
    problems.push({ field: 'reason', reason: '必填且不可為空白' })
  } else if (value.reason.length > 2_000) {
    problems.push({ field: 'reason', reason: '長度不可超過 2000' })
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { reason: (value.reason as string).trim() } }
}

/** submit／approve／publish／validate 沒有 body 欄位。 */
export function parseEmptyBody(value: unknown): ParseResult<Record<string, never>> {
  if (!isPlainObject(value)) return failure('body', '必須是物件')
  const problems = rejectUnknownKeys(value, [])
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: {} }
}

// ─── 查詢參數 ────────────────────────────────────────────────────────────────

export const AUDIT_DEFAULT_LIMIT = 50
export const AUDIT_MAX_LIMIT = 200

export interface AuditQuery {
  limit: number
  cursor: string | null
  versionId: string | null
}

export function parseAuditQuery(url: URL): ParseResult<AuditQuery> {
  const problems = rejectUnknownQuery(url, ['limit', 'cursor', 'versionId'])

  const limitRaw = url.searchParams.get('limit')
  let limit = AUDIT_DEFAULT_LIMIT
  if (limitRaw !== null) {
    if (!/^[0-9]+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > AUDIT_MAX_LIMIT) {
      problems.push({ field: 'limit', reason: `必須是 1–${AUDIT_MAX_LIMIT} 的整數` })
    } else {
      limit = Number(limitRaw)
    }
  }

  const cursorRaw = url.searchParams.get('cursor')
  let cursor: string | null = null
  if (cursorRaw !== null) {
    // cursor 是 review_records.record_id（bigint）。用字串傳遞，避免超過 Number 安全整數。
    if (!/^[1-9][0-9]{0,18}$/.test(cursorRaw)) {
      problems.push({ field: 'cursor', reason: '必須是正整數的 record_id' })
    } else {
      cursor = cursorRaw
    }
  }

  const versionIdRaw = url.searchParams.get('versionId')
  let versionId: string | null = null
  if (versionIdRaw !== null) {
    if (!parseVersionId(versionIdRaw)) {
      problems.push({ field: 'versionId', reason: '格式必須是 bundleId@versionNo，例如 cse-113-day@1' })
    } else {
      versionId = versionIdRaw
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { limit, cursor, versionId } }
}

// ─── 正規化與雜湊 ────────────────────────────────────────────────────────────

/**
 * 穩定 JSON：物件鍵遞迴排序、陣列保持原序。
 * content_hash 必須與鍵的插入順序無關，否則同一份規則內容會得到不同雜湊。
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('無法正規化非有限數字')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  throw new Error(`無法正規化型別 ${typeof value}`)
}

/** `sha256:<hex>`；資料庫 seed 也用同樣前綴（scripts/db/seed.mjs）。 */
export function hashContent(payload: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex')}`
}

// ─── /test 的純函式部分 ──────────────────────────────────────────────────────

export interface TestCaseResult {
  name: string
  status: 'passed' | 'failed'
  detail?: string
}

export interface SuiteResult {
  suite: string
  passed: number
  failed: number
  results: TestCaseResult[]
  overall?: OverallState
  totalCredits?: number
}

function checkRequirement(result: RequirementResult, path: string): TestCaseResult[] {
  const name = `${path} ${result.name ?? result.id}`.trim()
  const problems: string[] = []
  if (!REQUIREMENT_STATES.includes(result.state)) problems.push(`狀態 ${String(result.state)} 不在三態內`)

  if (result.kind === 'total' || result.kind === 'pool' || result.kind === 'credits') {
    const credits = result.credits
    const min = result.min
    if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) {
      problems.push('credits 必須是有限非負數')
    }
    if (typeof min !== 'number' || !Number.isFinite(min)) problems.push('min 必須是有限數字')
    if (typeof credits === 'number' && typeof min === 'number') {
      if (result.gap !== Math.max(0, min - credits)) problems.push(`gap 應為 ${Math.max(0, min - credits)}`)
      if (result.state === 'met' && credits < min) problems.push('state=met 但 credits < min')
      if (result.state === 'notMet' && credits >= min) problems.push('state=notMet 但 credits >= min')
    }
  }

  if (result.kind === 'and' || result.kind === 'or') {
    const children = result.children ?? []
    if (children.length === 0) problems.push('and／or 節點沒有子節點')
    const combined =
      result.kind === 'and'
        ? combineAnd(children.map((child) => child.state))
        : combineOr(children.map((child) => child.state))
    if (result.state !== combined) problems.push(`父節點狀態應為 ${combined}`)
  }

  const own: TestCaseResult =
    problems.length === 0
      ? { name, status: 'passed' }
      : { name, status: 'failed', detail: problems.join('；') }

  const childCases = (result.children ?? []).flatMap((child) => checkRequirement(child, `${path}.${child.id}`))
  return [own, ...childCases]
}

function expectedOverall(evaluation: EvaluationResult): OverallState {
  const required = evaluation.requirements.filter((requirement) => requirement.required)
  if (required.some((requirement) => requirement.state === 'notMet')) return 'incomplete'
  if (
    required.some((requirement) => requirement.state === 'unknown') ||
    evaluation.openConflicts.length > 0
  ) {
    return 'unconfirmed'
  }
  return 'complete'
}

/**
 * 跑一次引擎並檢查結果的內部一致性。
 *
 * 「測試案例」的語意（任務允許自行決定，這裡選擇）：
 * - 有帶 records／scenario：以該情境跑引擎，逐節點檢查狀態與數字不變式。
 * - 沒帶（空資料檢核，包含 R04 courseSet 等所有節點）：以 `records = []` 跑，
 *   確認每個節點都能算出三態、gap 與 min／credits 一致、overall 與子節點一致。
 *   空資料本來就該是 incomplete／unconfirmed，**不是**失敗；失敗只代表引擎或 payload 壞掉。
 * - 任何一個案例 failed → 呼叫端回 422 RULE_TEST_FAILED。
 */
export function runBundleTestSuite(
  bundle: RuleBundle,
  records: readonly CourseRecordInput[],
  scenario: Scenario,
  statuses: Partial<Record<string, RequirementState>> = {},
): SuiteResult {
  const suite = records.length === 0 ? 'empty-data' : 'provided-records'

  let evaluation: EvaluationResult
  try {
    evaluation = evaluate(bundle, records, { scenario, statuses })
  } catch (error) {
    return {
      suite,
      passed: 0,
      failed: 1,
      results: [
        {
          name: 'engine.evaluate',
          status: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }

  const results: TestCaseResult[] = evaluation.requirements.flatMap((requirement) =>
    checkRequirement(requirement, requirement.id),
  )
  const expected = expectedOverall(evaluation)
  results.push(
    evaluation.overall === expected
      ? { name: 'overall 三態一致性', status: 'passed' }
      : {
          name: 'overall 三態一致性',
          status: 'failed',
          detail: `overall=${evaluation.overall}，依節點應為 ${expected}`,
        },
  )

  const failed = results.filter((result) => result.status === 'failed').length
  return {
    suite,
    passed: results.length - failed,
    failed,
    results,
    overall: evaluation.overall,
    totalCredits: evaluation.totalCredits,
  }
}

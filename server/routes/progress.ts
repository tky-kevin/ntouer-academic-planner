// `GET /api/me/progress`：docs/design/api-spec.md §7.3。
// 資料來源：學生修課快照（student_records）＋ 個人修正（student_overrides）
// ＋ 個人條件覆蓋（student_condition_overrides）＋ 指定／最新已發布規則版本。
// 身分：`#22` 之前沒有 session，用 DEV_USER_SUB 指定一筆 users（Issue #13）。
import type { QueryFn, Reply, Route, RouteContext } from '../app.js'
import { fail, isoNow, makeMeta, ok } from '../http/envelope.js'
import { resolveIdentity } from '../auth/identity.js'
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

export interface StudentRow {
  user_id: string
  dept_id: string | null
  entry_year: number | null
  program: string | null
}

export interface VersionRow {
  version_id: string
  bundle_id: string
  status: string
  payload: RuleBundle
  dept_id: string
  entry_year: number
  program: string
}

export interface RecordRow {
  record_key: string
  course_code: string
  course_name: string | null
  credits: string | number
  category: string
  status: string
  tags: string[]
  owner: string
  term: string | null
}

export interface OverrideRow {
  record_key: string
  field: string
  value: string
}

export interface ConditionOverrideRow {
  requirement_id: string
  state: RequirementState
}

const SCENARIOS: readonly Scenario[] = ['completed', 'inProgress', 'planned']
const STATUS: Record<string, RecordStatus> = {
  passed: 'pass',
  failed: 'fail',
  inProgress: 'inProgress',
  transfer: 'transfer',
  waived: 'waived',
  unknown: 'unknown',
}

export function mapDbStatus(status: string): RecordStatus {
  return STATUS[status] ?? 'unknown'
}

function overridesByRecord(overrides: readonly OverrideRow[]): Map<string, Map<string, string>> {
  const byRecord = new Map<string, Map<string, string>>()
  for (const override of overrides) {
    const fields = byRecord.get(override.record_key) ?? new Map<string, string>()
    fields.set(override.field, override.value)
    byRecord.set(override.record_key, fields)
  }
  return byRecord
}

export function toEngineRecords(
  rows: readonly RecordRow[],
  overrides: readonly OverrideRow[],
): CourseRecordInput[] {
  const byRecord = overridesByRecord(overrides)
  return rows.map((row) => {
    const fields = byRecord.get(row.record_key)
    return {
      courseCode: row.course_code,
      credits: Number(fields?.get('credits') ?? row.credits),
      status: mapDbStatus(fields?.get('status') ?? row.status),
      category: fields?.get('category') ?? row.category,
      tags: row.tags ?? [],
      owner: row.owner ?? 'own',
    }
  })
}

// 個人條件覆蓋作用在「節點結果」這一層；有覆蓋的節點以覆蓋值為準，
// 沒被覆蓋的 and／or 由子節點重算（system-design.md §5.3）。
export function applyConditionOverrides(
  results: readonly RequirementResult[],
  overrides: ReadonlyMap<string, RequirementState>,
): RequirementResult[] {
  return results.map((result) => {
    const children = result.children ? applyConditionOverrides(result.children, overrides) : undefined
    const overridden = overrides.get(result.id)
    let state = overridden ?? result.state
    if (!overridden && children && (result.kind === 'and' || result.kind === 'or')) {
      state = result.kind === 'and' ? combineAnd(children.map((child) => child.state)) : combineOr(children.map((child) => child.state))
    }
    return children ? { ...result, state, children } : { ...result, state }
  })
}

export function overallFrom(results: readonly RequirementResult[], openConflictCount: number): OverallState {
  const required = results.filter((result) => result.required)
  if (required.some((result) => result.state === 'notMet')) return 'incomplete'
  if (required.some((result) => result.state === 'unknown') || openConflictCount > 0) return 'unconfirmed'
  return 'complete'
}

export interface ProgressInput {
  bundleId: string
  versionId: string
  scenario: Scenario
  evaluation: EvaluationResult
  records: readonly RecordRow[]
  conditionOverrides: readonly ConditionOverrideRow[]
  includeTrace: boolean
  dataSyncedAt: string | null
}

export interface ProgressData {
  bundleId: string
  versionId: string
  scenario: Scenario
  overall: OverallState
  totalCredits: number
  requirements: RequirementResult[]
  openConflicts: string[]
  trace?: Array<{
    courseCode: string
    courseName: string | null
    pool: string
    credits: number
    cappedBy: string | null
    excludedReason: string | null
  }>
  dataSyncedAt: string | null
}

export function computeProgress(input: ProgressInput): ProgressData {
  const overrides = new Map<string, RequirementState>(
    input.conditionOverrides.map((override) => [override.requirement_id, override.state]),
  )
  const requirements = applyConditionOverrides(input.evaluation.requirements, overrides)
  const openConflicts = input.evaluation.openConflicts.map((conflict) => conflict.conflictId)
  const courseNames = new Map(
    input.records.map((record) => [record.course_code, record.course_name] as const),
  )

  const data: ProgressData = {
    bundleId: input.bundleId,
    versionId: input.versionId,
    scenario: input.scenario,
    overall: overallFrom(requirements, openConflicts.length),
    totalCredits: input.evaluation.totalCredits,
    requirements,
    openConflicts,
    dataSyncedAt: input.dataSyncedAt,
  }

  if (input.includeTrace) {
    data.trace = input.evaluation.trace.map((entry) => ({
      courseCode: entry.courseCode,
      courseName: courseNames.get(entry.courseCode) ?? null,
      pool: entry.pool,
      credits: entry.credits,
      cappedBy: entry.cappedBy,
      excludedReason: entry.reason ?? null,
    }))
  }

  return data
}

function invalid(requestId: string, field: string, reason: string): Reply {
  return {
    status: 400,
    body: fail(
      {
        code: 'REQUEST_INVALID',
        message: `${field} 不合法：${reason}`,
        details: [{ field, reason }],
        retryable: false,
      },
      makeMeta(requestId),
    ),
  }
}

function unauthorized(requestId: string): Reply {
  return {
    status: 401,
    body: fail(
      { code: 'AUTH_REQUIRED', message: '請先登入。', retryable: false },
      makeMeta(requestId),
    ),
  }
}

export interface ProgressRouteOptions {
  query: QueryFn
  /** 開發身分：沒有 planner_session 且非 production 時，用這筆 users.google_sub 當登入者。 */
  devUserSub?: string
  nodeEnv?: string
}

export function createProgressRoutes({ query, devUserSub, nodeEnv }: ProgressRouteOptions): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/me/progress',
      handler: async (ctx: RouteContext) => {
        const { requestId, url } = ctx
        const scenarioParam = url.searchParams.get('scenario') ?? 'completed'
        if (!SCENARIOS.includes(scenarioParam as Scenario)) {
          return invalid(requestId, 'scenario', '只接受 completed／inProgress／planned')
        }
        const scenario = scenarioParam as Scenario

        const traceParam = url.searchParams.get('includeTrace')
        if (traceParam !== null && traceParam !== 'true' && traceParam !== 'false') {
          return invalid(requestId, 'includeTrace', '只接受 true／false')
        }
        const includeTrace = traceParam !== 'false'

        const identity = await resolveIdentity(ctx.req, query, { devUserSub, nodeEnv })
        if (!identity) return unauthorized(requestId)

        const students = await query(`select user_id, dept_id, entry_year, program from users where user_id = $1::uuid`, [
          identity.userId,
        ])
        const student = students.rows[0] as StudentRow | undefined
        if (!student) return unauthorized(requestId)

        const requestedBundleId = url.searchParams.get('bundleId')
        let versions: VersionRow[]

        if (requestedBundleId) {
          const result = await query(
            `select v.version_id, v.bundle_id, v.status, v.payload, b.dept_id, b.entry_year, b.program
               from rule_versions v
               join rule_bundles b on b.bundle_id = v.bundle_id
              where b.bundle_id = $1 and v.status = 'published'
              order by v.version_no desc
              limit 1`,
            [requestedBundleId],
          )
          versions = result.rows as VersionRow[]
          if (versions.length === 0) {
            return {
              status: 404,
              body: fail(
                {
                  code: 'RULE_BUNDLE_NOT_FOUND',
                  message: `規則包 ${requestedBundleId} 沒有已發布版本。`,
                  retryable: false,
                },
                makeMeta(requestId),
              ),
            }
          }
          if (student.dept_id && versions[0].dept_id !== student.dept_id) {
            return {
              status: 403,
              body: fail(
                {
                  code: 'AUTH_DEPT_OUT_OF_SCOPE',
                  message: '這個規則包不屬於你的系所。',
                  retryable: false,
                },
                makeMeta(requestId),
              ),
            }
          }
        } else {
          if (!student.dept_id || !student.entry_year) {
            const missing = [
              ...(student.dept_id ? [] : ['deptId']),
              ...(student.entry_year ? [] : ['entryYear']),
            ]
            return {
              status: 404,
              body: fail(
                {
                  code: 'RULE_BUNDLE_NOT_FOUND',
                  message: '你的帳號還沒有系所與入學年度，無法決定要套用哪一份規則。',
                  details: missing.map((field) => ({ field, reason: 'missing-profile' })),
                  retryable: false,
                },
                makeMeta(requestId),
              ),
            }
          }
          const result = await query(
            `select v.version_id, v.bundle_id, v.status, v.payload, b.dept_id, b.entry_year, b.program
               from rule_bundles b
               join lateral (
                 select version_id, bundle_id, status, payload
                   from rule_versions
                  where bundle_id = b.bundle_id and status = 'published'
                  order by version_no desc
                  limit 1
               ) v on true
              where b.dept_id = $1 and b.entry_year = $2 and b.program = $3
              limit 1`,
            [student.dept_id, student.entry_year, student.program ?? 'day'],
          )
          versions = result.rows as VersionRow[]
          if (versions.length === 0) {
            return {
              status: 404,
              body: fail(
                {
                  code: 'RULE_BUNDLE_NOT_FOUND',
                  message: '你的系所與入學年度目前沒有已發布的規則版本。',
                  retryable: false,
                },
                makeMeta(requestId),
              ),
            }
          }
        }

        const version = versions[0]
        const recordRows = (await query(
          `select record_key, course_code, course_name, credits, category, status, tags, owner, term
             from student_records
            where user_id = $1
            order by course_code`,
          [student.user_id],
        )).rows as RecordRow[]
        const recordOverrides = (await query(
          `select record_key, field, value from student_overrides where user_id = $1`,
          [student.user_id],
        )).rows as OverrideRow[]
        const conditionOverrides = (await query(
          `select requirement_id, state from student_condition_overrides where user_id = $1 and bundle_id = $2`,
          [student.user_id, version.bundle_id],
        )).rows as ConditionOverrideRow[]
        const syncRows = (await query(
          `select last_success_at from student_sync_state where user_id = $1`,
          [student.user_id],
        )).rows as Array<{ last_success_at: Date | null }>

        const evaluation = evaluate(version.payload, toEngineRecords(recordRows, recordOverrides), { scenario })
        const data = computeProgress({
          bundleId: version.bundle_id,
          versionId: version.version_id,
          scenario,
          evaluation,
          records: recordRows,
          conditionOverrides,
          includeTrace,
          dataSyncedAt: syncRows[0]?.last_success_at ? isoNow(syncRows[0].last_success_at) : null,
        })

        return { status: 200, body: ok(data, makeMeta(requestId, version.version_id)) }
      },
    },
  ]
}

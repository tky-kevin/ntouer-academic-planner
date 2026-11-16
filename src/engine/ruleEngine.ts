// 畢業規則引擎（I2 產品程式碼）。
// 來源：docs/design/spike/rule-engine.mjs（已驗證的演算法，邏輯不改，只補型別）。
// 限制與 spike 相同：不碰資料庫、權限、API；selector 只支援類別／擁有者／標籤／課號／系所。
// 設計依據：docs/design/system-design.md §5、docs/design/rule-model.md。

export type Scenario = 'completed' | 'inProgress' | 'planned'
export type RecordStatus =
  | 'pass'
  | 'transfer'
  | 'waived'
  | 'inProgress'
  | 'planned'
  | 'fail'
  | 'excluded'
  | 'unknown'
export type RequirementState = 'met' | 'notMet' | 'unknown'
export type OverallState = 'complete' | 'unconfirmed' | 'incomplete'
export type RequirementKind = 'total' | 'pool' | 'credits' | 'courseSet' | 'status' | 'and' | 'or'
export type SelectorKind = 'category' | 'owner' | 'tag' | 'code' | 'dept'

export interface CourseRecordInput {
  courseCode: string
  credits: number
  status: RecordStatus
  category?: string
  owner?: string
  tags?: readonly string[]
  dept?: string
}

export interface PoolDef {
  poolId: string
  name?: string
  min?: number
  max?: number
  perCourseCreditsMax?: number
  selectors: readonly string[]
}

export interface CapDef {
  capId: string
  name?: string
  scope?: 'pool' | 'global'
  poolId?: string
  selectors: readonly string[]
  max: number
  clauseId?: string
}

export interface AllocationDef {
  totalMin?: number
  precedence?: readonly string[]
  pools?: readonly PoolDef[]
  caps?: readonly CapDef[]
}

export interface SourceDef {
  sourceId: string
  title?: string
  url?: string
  locator?: string
}

export interface ClauseDef {
  clauseId: string
  sourceId: string
  locator?: string
  text?: string
  reading?: string
}

export interface RequirementNode {
  id: string
  kind: RequirementKind
  name?: string
  clauseId?: string
  required?: boolean
  min?: number
  poolId?: string
  selectors?: readonly string[]
  courses?: readonly string[]
  mode?: 'all' | 'any' | 'minCount' | 'credits'
  minCount?: number
  minCredits?: number
  statusKey?: string
  children?: readonly RequirementNode[]
}

export interface Conflict {
  conflictId: string
  summary?: string
  clauseIds?: readonly string[]
  resolution?: string
}

export interface RuleBundle {
  schemaVersion: string
  bundleId: string
  title?: string
  department?: { departmentId?: string; name?: string }
  scope?: { entryYear?: number; program?: string }
  status?: string
  version?: number | string
  sources?: readonly SourceDef[]
  clauses?: readonly ClauseDef[]
  allocation: AllocationDef
  requirements: readonly RequirementNode[]
  conflicts?: readonly Conflict[]
}

export interface CountedEntry {
  courseCode: string
  credits: number
  cappedBy?: string | null
  note?: string
}

export interface TraceEntry {
  courseCode: string
  pool: string
  credits: number
  cappedBy: string | null
  reason?: string
}

export interface RequirementResult {
  id: string
  kind: RequirementKind
  name?: string
  clauseId?: string
  required: boolean
  state: RequirementState
  credits?: number
  min?: number
  gap?: number
  counted?: CountedEntry[]
  skipped?: CountedEntry[]
  missing?: string[]
  missingCount?: number
  statusKey?: string
  children?: RequirementResult[]
}

export interface EvaluationOptions {
  scenario?: Scenario
  statuses?: Partial<Record<string, RequirementState>>
}

export interface EvaluationResult {
  bundleId: string
  scenario: Scenario
  overall: OverallState
  totalCredits: number
  poolTotals: Record<string, number>
  requirements: RequirementResult[]
  openConflicts: Conflict[]
  trace: TraceEntry[]
  claimed: Record<string, { pool: string; credits: number }>
}

export interface BundleValidation {
  ok: boolean
  errors: string[]
}

const SEL = /^(category|owner|tag|code|dept):([A-Za-z0-9_\-\u4e00-\u9fff]+)$/

export function parseSelector(selector: string): { kind: SelectorKind; value: string } {
  const match = SEL.exec(selector)
  if (!match) throw new Error(`selector 格式錯誤：${selector}`)
  return { kind: match[1] as SelectorKind, value: match[2] }
}

function matchesSelector(selector: string, record: CourseRecordInput): boolean {
  const { kind, value } = parseSelector(selector)
  switch (kind) {
    case 'category':
      return record.category === value
    case 'owner':
      return (record.owner ?? 'own') === value
    case 'tag':
      return Array.isArray(record.tags) && record.tags.includes(value)
    case 'code':
      return record.courseCode === value
    case 'dept':
      return record.dept === value
  }
}

function matchesAny(selectors: readonly string[], record: CourseRecordInput): boolean {
  return selectors.some((selector) => matchesSelector(selector, record))
}

// 修課狀態 → 是否參與本次情境
export function isEligible(record: CourseRecordInput, scenario: Scenario): boolean {
  const order: Record<Scenario, number> = { completed: 1, inProgress: 2, planned: 3 }
  const need = order[scenario] ?? 1
  switch (record.status) {
    case 'pass':
    case 'transfer': // 抵免：有學分
    case 'waived': // 免修：滿足條件但 0 學分
      return true
    case 'inProgress':
      return need >= 2
    case 'planned':
      return need >= 3
    default:
      return false // fail / excluded / unknown
  }
}

function creditsOf(record: CourseRecordInput): number {
  return record.status === 'waived' ? 0 : Number(record.credits) || 0
}

const RANK: Record<RecordStatus, number> = {
  pass: 4,
  transfer: 4,
  waived: 3,
  inProgress: 2,
  planned: 1,
  fail: 0,
  excluded: 0,
  unknown: 0,
}

function dedupe(records: readonly CourseRecordInput[]): CourseRecordInput[] {
  const seen = new Map<string, CourseRecordInput>()
  for (const record of records) {
    const previous = seen.get(record.courseCode)
    // 同課取最佳一次：及格優先於修課中／計畫，其次取學分高者
    if (!previous || (RANK[record.status] ?? 0) > (RANK[previous.status] ?? 0)) {
      seen.set(record.courseCode, record)
    }
  }
  return [...seen.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode))
}

// 依上限逐筆累加；cap 只在本計算內計數（每次評估重新起算）
function sumWithCaps(
  records: readonly CourseRecordInput[],
  selectors: readonly string[],
  caps: readonly CapDef[],
  poolId: string | undefined,
): { total: number; counted: CountedEntry[]; skipped: CountedEntry[] } {
  const used = new Map<string, number>()
  let total = 0
  const counted: CountedEntry[] = []
  const skipped: CountedEntry[] = []

  for (const record of records) {
    if (!matchesAny(selectors, record)) continue
    let allowed = creditsOf(record)
    if (allowed <= 0) {
      counted.push({ courseCode: record.courseCode, credits: 0, note: record.status })
      continue
    }
    let cappedBy: string | null = null
    for (const cap of caps) {
      if (cap.scope === 'pool' && cap.poolId && cap.poolId !== poolId) continue
      if (!matchesAny(cap.selectors, record)) continue
      const remain = Math.max(0, cap.max - (used.get(cap.capId) ?? 0))
      if (remain < allowed) {
        allowed = remain
        cappedBy = cap.capId
      }
    }
    if (allowed <= 0) {
      skipped.push({ courseCode: record.courseCode, credits: 0, note: `達上限 ${cappedBy}` })
      continue
    }
    for (const cap of caps) {
      if (cap.scope === 'pool' && cap.poolId && cap.poolId !== poolId) continue
      if (matchesAny(cap.selectors, record)) {
        used.set(cap.capId, (used.get(cap.capId) ?? 0) + allowed)
      }
    }
    total += allowed
    counted.push({ courseCode: record.courseCode, credits: allowed, cappedBy })
  }

  return { total, counted, skipped }
}

function allocate(
  bundle: RuleBundle,
  records: readonly CourseRecordInput[],
): {
  poolTotals: Record<string, number>
  claimed: Map<string, { pool: string; credits: number }>
  trace: TraceEntry[]
} {
  const pools = bundle.allocation.pools ?? []
  const precedence = bundle.allocation.precedence ?? []
  const caps = bundle.allocation.caps ?? []
  const byId = new Map(pools.map((pool) => [pool.poolId, pool]))
  const order = precedence.length > 0 ? precedence : pools.map((pool) => pool.poolId)
  const claimed = new Map<string, { pool: string; credits: number }>()
  const poolTotals = Object.fromEntries(order.map((id) => [id, 0])) as Record<string, number>
  const capUsed = new Map<string, number>()
  const trace: TraceEntry[] = []

  for (const poolId of order) {
    const pool = byId.get(poolId)
    if (!pool) throw new Error(`precedence 指向不存在的 pool：${poolId}`)
    for (const record of records) {
      if (claimed.has(record.courseCode)) continue
      if (!matchesAny(pool.selectors, record)) continue
      let credit = creditsOf(record)
      if (pool.perCourseCreditsMax != null) credit = Math.min(credit, pool.perCourseCreditsMax)
      let cappedBy: string | null = null
      for (const cap of caps) {
        if (cap.scope === 'pool' && cap.poolId && cap.poolId !== poolId) continue
        if (!matchesAny(cap.selectors, record)) continue
        const remain = Math.max(0, cap.max - (capUsed.get(cap.capId) ?? 0))
        if (remain < credit) {
          credit = remain
          cappedBy = cap.capId
        }
      }
      const room = pool.max == null ? Infinity : Math.max(0, pool.max - poolTotals[poolId])
      credit = Math.min(credit, room)
      if (credit <= 0) {
        trace.push({
          courseCode: record.courseCode,
          pool: poolId,
          credits: 0,
          cappedBy,
          reason: cappedBy ? `上限 ${cappedBy}` : '池已滿',
        })
        continue
      }
      for (const cap of caps) {
        if (cap.scope === 'pool' && cap.poolId && cap.poolId !== poolId) continue
        if (matchesAny(cap.selectors, record)) {
          capUsed.set(cap.capId, (capUsed.get(cap.capId) ?? 0) + credit)
        }
      }
      claimed.set(record.courseCode, { pool: poolId, credits: credit })
      poolTotals[poolId] += credit
      trace.push({ courseCode: record.courseCode, pool: poolId, credits: credit, cappedBy })
    }
  }

  return { poolTotals, claimed, trace }
}

const MET: RequirementState = 'met'
const NOT_MET: RequirementState = 'notMet'
const UNKNOWN: RequirementState = 'unknown'

function stateFromCredits(credits: number, min: number): RequirementState {
  return credits >= min ? MET : NOT_MET
}

function combineAnd(states: readonly RequirementState[]): RequirementState {
  if (states.includes(NOT_MET)) return NOT_MET
  if (states.includes(UNKNOWN)) return UNKNOWN
  return MET
}

function combineOr(states: readonly RequirementState[]): RequirementState {
  if (states.includes(MET)) return MET
  if (states.includes(UNKNOWN)) return UNKNOWN
  return NOT_MET
}

interface EvalContext {
  records: readonly CourseRecordInput[]
  poolTotals: Record<string, number>
  pools: Record<string, PoolDef>
  caps: readonly CapDef[]
  statuses: Partial<Record<string, RequirementState>>
  totalCredits: number
}

function evaluateRequirement(node: RequirementNode, ctx: EvalContext): RequirementResult {
  const base = { id: node.id, name: node.name, clauseId: node.clauseId, required: node.required !== false }

  switch (node.kind) {
    case 'total': {
      const credits = ctx.totalCredits
      const min = node.min ?? 0
      return { ...base, kind: 'total', state: stateFromCredits(credits, min), credits, min, gap: Math.max(0, min - credits) }
    }
    case 'pool': {
      const credits = ctx.poolTotals[node.poolId ?? ''] ?? 0
      const min = node.min ?? ctx.pools[node.poolId ?? '']?.min ?? 0
      return { ...base, kind: 'pool', state: stateFromCredits(credits, min), credits, min, gap: Math.max(0, min - credits) }
    }
    case 'credits': {
      const { total, counted, skipped } = sumWithCaps(ctx.records, node.selectors ?? [], ctx.caps, node.poolId)
      const min = node.min ?? 0
      return {
        ...base,
        kind: 'credits',
        state: stateFromCredits(total, min),
        credits: total,
        min,
        gap: Math.max(0, min - total),
        counted,
        skipped,
      }
    }
    case 'courseSet': {
      const wanted = node.courses ?? []
      const done = wanted.filter((course) => ctx.records.some((record) => record.courseCode === course))
      const missed = wanted.filter((course) => !ctx.records.some((record) => record.courseCode === course))
      let state: RequirementState
      if (node.mode === 'all') state = missed.length === 0 ? MET : NOT_MET
      else if (node.mode === 'any') state = done.length > 0 ? MET : NOT_MET
      else if (node.mode === 'minCount') state = done.length >= (node.minCount ?? 1) ? MET : NOT_MET
      else {
        const credits = ctx.records
          .filter((record) => wanted.includes(record.courseCode))
          .reduce((sum, record) => sum + creditsOf(record), 0)
        state = stateFromCredits(credits, node.minCredits ?? 0)
      }
      return { ...base, kind: 'courseSet', state, missing: missed.slice(0, 5), missingCount: missed.length }
    }
    case 'status': {
      const raw = node.statusKey ? ctx.statuses[node.statusKey] : undefined
      const state: RequirementState = raw === 'met' ? MET : raw === 'notMet' ? NOT_MET : UNKNOWN
      return { ...base, kind: 'status', state, statusKey: node.statusKey }
    }
    case 'and':
    case 'or': {
      const children = (node.children ?? []).map((child) => evaluateRequirement(child, ctx))
      const states = children.map((child) => child.state)
      return {
        ...base,
        kind: node.kind,
        state: node.kind === 'and' ? combineAnd(states) : combineOr(states),
        children,
      }
    }
    default:
      throw new Error(`未知的 requirement 種類：${(node as RequirementNode).kind}`)
  }
}

export function evaluate(
  bundle: RuleBundle,
  records: readonly CourseRecordInput[],
  options: EvaluationOptions = {},
): EvaluationResult {
  const scenario = options.scenario ?? 'completed'
  const statuses = options.statuses ?? {}
  const caps = bundle.allocation.caps ?? []
  const pools = Object.fromEntries((bundle.allocation.pools ?? []).map((pool) => [pool.poolId, pool])) as Record<
    string,
    PoolDef
  >

  const eligible = dedupe(records.filter((record) => isEligible(record, scenario)))
  const { poolTotals, claimed, trace } = allocate(bundle, eligible)
  const totalCredits = Object.values(poolTotals).reduce((sum, value) => sum + value, 0)

  const ctx: EvalContext = { records: eligible, poolTotals, pools, caps, statuses, totalCredits }
  const requirements = bundle.requirements.map((requirement) => evaluateRequirement(requirement, ctx))
  const required = requirements.filter((requirement) => requirement.required)

  const openConflicts = (bundle.conflicts ?? []).filter((conflict) => (conflict.resolution ?? 'open') === 'open')

  let overall: OverallState
  if (required.some((requirement) => requirement.state === NOT_MET)) overall = 'incomplete'
  else if (required.some((requirement) => requirement.state === UNKNOWN) || openConflicts.length > 0) {
    overall = 'unconfirmed'
  } else overall = 'complete'

  return {
    bundleId: bundle.bundleId,
    scenario,
    overall,
    totalCredits,
    poolTotals,
    requirements,
    openConflicts,
    trace,
    claimed: Object.fromEntries(claimed),
  }
}

// 結構驗證：發布前的第一道關卡（不依賴外部套件）
export function validateBundle(bundle: RuleBundle): BundleValidation {
  const errors: string[] = []
  const fields = ['schemaVersion', 'bundleId', 'department', 'scope', 'status', 'sources', 'clauses', 'allocation', 'requirements']
  const record = bundle as unknown as Record<string, unknown>
  for (const field of fields) if (!(field in record)) errors.push(`缺少必要欄位：${field}`)
  if (!bundle.department?.departmentId) errors.push('department.departmentId 必填')
  if (!Number.isInteger(bundle.scope?.entryYear)) errors.push('scope.entryYear 必須是整數')

  const sourceIds = new Set((bundle.sources ?? []).map((source) => source.sourceId))
  const clauseIds = new Set((bundle.clauses ?? []).map((clause) => clause.clauseId))
  const poolIds = new Set((bundle.allocation?.pools ?? []).map((pool) => pool.poolId))

  const duplicates = (values: readonly string[]): string[] => values.filter((value, index) => values.indexOf(value) !== index)
  if (duplicates([...sourceIds]).length > 0) errors.push('sourceId 重複')
  if (duplicates((bundle.clauses ?? []).map((clause) => clause.clauseId)).length > 0) errors.push('clauseId 重複')
  if (duplicates((bundle.requirements ?? []).map((requirement) => requirement.id)).length > 0) errors.push('requirement id 重複')

  for (const clause of bundle.clauses ?? []) {
    if (!sourceIds.has(clause.sourceId)) errors.push(`clause ${clause.clauseId} 指向不存在的 source ${clause.sourceId}`)
  }
  for (const pool of bundle.allocation?.pools ?? []) {
    for (const selector of pool.selectors ?? []) {
      if (!SEL.test(selector)) errors.push(`pool ${pool.poolId} selector 格式錯誤：${selector}`)
    }
  }
  for (const cap of bundle.allocation?.caps ?? []) {
    for (const selector of cap.selectors ?? []) {
      if (!SEL.test(selector)) errors.push(`cap ${cap.capId} selector 格式錯誤：${selector}`)
    }
    if (cap.clauseId && !clauseIds.has(cap.clauseId)) errors.push(`cap ${cap.capId} 指向不存在的 clause ${cap.clauseId}`)
  }
  for (const id of bundle.allocation?.precedence ?? []) {
    if (!poolIds.has(id)) errors.push(`precedence 指向不存在的 pool ${id}`)
  }

  const walk = (node: RequirementNode, path: string): void => {
    if (!node.id) errors.push(`${path} 缺少 id`)
    if (node.clauseId && !clauseIds.has(node.clauseId)) errors.push(`${path} 指向不存在的 clause ${node.clauseId}`)
    if (node.kind === 'pool' && node.poolId && !poolIds.has(node.poolId)) {
      errors.push(`${path} 指向不存在的 pool ${node.poolId}`)
    }
    if (node.kind === 'credits') {
      for (const selector of node.selectors ?? []) {
        if (!SEL.test(selector)) errors.push(`${path} selector 格式錯誤：${selector}`)
      }
    }
    if (node.kind === 'courseSet' && (!node.courses || node.courses.length === 0)) {
      errors.push(`${path} courseSet 缺 courses`)
    }
    for (const child of node.children ?? []) walk(child, `${path}.${child.id ?? '?'}`)
  }
  for (const requirement of bundle.requirements ?? []) walk(requirement, `requirement ${requirement.id}`)

  return { ok: errors.length === 0, errors }
}

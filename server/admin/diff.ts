// 純函式 diff：比較「前一版」與「這一版」的 payload（Issue #14、system-design §7.2）。
// 比較粒度（刻意不依賴 AI 語意）：
//   - requirements：依節點路徑（`R06`、`R06/R06-1`）逐節點比對；children 只用來展開，不當成值。
//   - clauses：依 clauseId 比對 sourceId／locator／text／reading／status／note。
//   - sources：依 sourceId 比對 title／url／file／locator／retrievedAt／sha256／status。
// 輸出只有 added／removed／changed；「不變」不列入（前端要顯示的話自己補）。
import { stableStringify } from './validate.js'

export type DiffKind = 'added' | 'removed' | 'changed'

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

export interface DiffItem {
  kind: DiffKind
  id: string
  label?: string
  clauseId?: string
  before?: string
  after?: string
  changes?: FieldChange[]
}

export interface DiffSummary {
  added: number
  removed: number
  changed: number
}

export interface PayloadDiff {
  requirements: DiffItem[]
  clauses: DiffItem[]
  sources: DiffItem[]
  summary: DiffSummary
}

type Loose = Record<string, unknown>

function asObject(value: unknown): Loose | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function display(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return '（無）'
  return stableStringify(value)
}

function clip(value: string, length = 80): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`
}

function compareFields(
  before: Loose,
  after: Loose,
  fields: readonly string[],
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of fields) {
    const left = before[field]
    const right = after[field]
    // undefined 與「鍵不存在」視為同一件事；JSON 不會有 undefined。
    if (left === undefined && right === undefined) continue
    let same = false
    try {
      same = stableStringify(left) === stableStringify(right)
    } catch {
      same = false
    }
    if (!same) changes.push({ field, before: left, after: right })
  }
  return changes
}

function describeChanges(changes: readonly FieldChange[], side: 'before' | 'after'): string {
  return changes.map((change) => `${change.field}: ${display(change[side])}`).join('；')
}

// ─── requirements ────────────────────────────────────────────────────────────

const REQUIREMENT_FIELDS = [
  'kind',
  'name',
  'clauseId',
  'required',
  'min',
  'poolId',
  'selectors',
  'courses',
  'mode',
  'minCount',
  'minCredits',
  'statusKey',
  'note',
  'source',
] as const

interface FlatRequirement {
  key: string
  node: Loose
}

function flattenRequirements(nodes: readonly unknown[], parent = ''): FlatRequirement[] {
  const out: FlatRequirement[] = []
  nodes.forEach((raw, index) => {
    const node = asObject(raw)
    if (!node) return
    const id = text(node.id) ?? `#${index}`
    const key = parent.length > 0 ? `${parent}/${id}` : id
    out.push({ key, node })
    out.push(...flattenRequirements(asArray(node.children), key))
  })
  return out
}

function requirementItem(key: string, node: Loose, kind: DiffKind, changes: FieldChange[] = []): DiffItem {
  const item: DiffItem = { kind, id: key }
  const name = text(node.name)
  if (name) item.label = clip(name)
  const clauseId = text(node.clauseId)
  if (clauseId) item.clauseId = clauseId
  if (kind === 'changed') {
    item.before = describeChanges(changes, 'before')
    item.after = describeChanges(changes, 'after')
    item.changes = changes
  }
  return item
}

function diffRequirements(previous: Loose | null, next: Loose | null): DiffItem[] {
  const before = new Map(flattenRequirements(asArray(previous?.requirements)).map((entry) => [entry.key, entry.node]))
  const after = new Map(flattenRequirements(asArray(next?.requirements)).map((entry) => [entry.key, entry.node]))
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b))
  const items: DiffItem[] = []

  for (const key of keys) {
    const left = before.get(key)
    const right = after.get(key)
    if (!left) {
      items.push(requirementItem(key, right as Loose, 'added'))
      continue
    }
    if (!right) {
      items.push(requirementItem(key, left, 'removed'))
      continue
    }
    const changes = compareFields(left, right, REQUIREMENT_FIELDS)
    if (changes.length > 0) items.push(requirementItem(key, right, 'changed', changes))
  }
  return items
}

// ─── clauses ─────────────────────────────────────────────────────────────────

const CLAUSE_FIELDS = ['sourceId', 'locator', 'text', 'reading', 'status', 'note'] as const

function keyedBy(items: readonly unknown[], key: string): Map<string, Loose> {
  const map = new Map<string, Loose>()
  for (const raw of items) {
    const item = asObject(raw)
    if (!item) continue
    const id = text(item[key])
    if (id) map.set(id, item)
  }
  return map
}

function diffClauses(previous: Loose | null, next: Loose | null): DiffItem[] {
  const before = keyedBy(asArray(previous?.clauses), 'clauseId')
  const after = keyedBy(asArray(next?.clauses), 'clauseId')
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b))
  const items: DiffItem[] = []

  for (const key of keys) {
    const left = before.get(key)
    const right = after.get(key)
    if (!left) {
      const item: DiffItem = { kind: 'added', id: key, clauseId: key }
      const label = text(right?.text)
      if (label) item.label = clip(label)
      items.push(item)
      continue
    }
    if (!right) {
      const item: DiffItem = { kind: 'removed', id: key, clauseId: key }
      const label = text(left.text)
      if (label) item.label = clip(label)
      items.push(item)
      continue
    }
    const changes = compareFields(left, right, CLAUSE_FIELDS)
    if (changes.length > 0) {
      const item: DiffItem = {
        kind: 'changed',
        id: key,
        clauseId: key,
        before: describeChanges(changes, 'before'),
        after: describeChanges(changes, 'after'),
        changes,
      }
      const label = text(right.text)
      if (label) item.label = clip(label)
      items.push(item)
    }
  }
  return items
}

// ─── sources ─────────────────────────────────────────────────────────────────

const SOURCE_FIELDS = ['title', 'url', 'file', 'locator', 'retrievedAt', 'sha256', 'status'] as const

function diffSources(previous: Loose | null, next: Loose | null): DiffItem[] {
  const before = keyedBy(asArray(previous?.sources), 'sourceId')
  const after = keyedBy(asArray(next?.sources), 'sourceId')
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b))
  const items: DiffItem[] = []

  for (const key of keys) {
    const left = before.get(key)
    const right = after.get(key)
    const label = text(right?.title) ?? text(left?.title)
    if (!left) {
      const item: DiffItem = { kind: 'added', id: key }
      if (label) item.label = clip(label)
      items.push(item)
      continue
    }
    if (!right) {
      const item: DiffItem = { kind: 'removed', id: key }
      if (label) item.label = clip(label)
      items.push(item)
      continue
    }
    const changes = compareFields(left, right, SOURCE_FIELDS)
    if (changes.length > 0) {
      const item: DiffItem = {
        kind: 'changed',
        id: key,
        before: describeChanges(changes, 'before'),
        after: describeChanges(changes, 'after'),
        changes,
      }
      if (label) item.label = clip(label)
      items.push(item)
    }
  }
  return items
}

/** `previous = null` 代表第一版：全部視為 added。 */
export function diffPayloads(previous: unknown, next: unknown): PayloadDiff {
  const before = asObject(previous)
  const after = asObject(next)
  const requirements = diffRequirements(before, after)
  const clauses = diffClauses(before, after)
  const sources = diffSources(before, after)

  const count = (kind: DiffKind): number =>
    [...requirements, ...clauses, ...sources].filter((item) => item.kind === kind).length

  return {
    requirements,
    clauses,
    sources,
    summary: { added: count('added'), removed: count('removed'), changed: count('changed') },
  }
}

/** 稽核紀錄 review_records.diff_from 只放摘要，避免稽核表被整份 diff 撐大。 */
export function summarizeDiff(diff: PayloadDiff): DiffSummary {
  return diff.summary
}

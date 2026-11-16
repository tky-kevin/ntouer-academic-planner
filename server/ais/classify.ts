// 課程分類：把 AIS 修課紀錄對到規則包需要的 category（CE／REQ／ELE）與 tag。
// 資料來源是 data/rules/113-cse-classification.json（官方檢核表與修業規定，逐條附 locator）。
// 原則：對不上就回 unknown 並附理由；不得用課名相似度猜分類（Issue #18 的同一條規矩）。
import { readFileSync } from 'node:fs'
import path from 'node:path'

export type CourseCategory = 'CE' | 'REQ' | 'ELE' | 'unknown'

export interface ClassificationPattern {
  kind: 'exact' | 'prefix' | 'contains' | 'regex'
  value: string
}

export interface ClassificationRule {
  id: string
  match: ClassificationPattern
  canonical?: string
  category: Exclude<CourseCategory, 'unknown'>
  tags?: readonly string[]
  sourceId: string
  locator: string
}

export interface ExcludedRule {
  id: string
  match: ClassificationPattern
  reason: string
  sourceId: string
  locator: string
}

export interface ClassificationTable {
  schemaVersion: string
  appliesTo: { bundleId: string; departmentId: string; entryYear: number }
  sources: readonly { sourceId: string; title: string; url?: string; locator?: string }[]
  excluded: readonly ExcludedRule[]
  rules: readonly ClassificationRule[]
}

export interface CourseClassification {
  /** `excluded` 代表這門課明文不列入畢業學分（例如軍訓）。 */
  decision: 'classified' | 'excluded' | 'unknown'
  category: CourseCategory
  tags: string[]
  /** 寫進 student_records.course_code 的鍵；有 canonical 用 canonical，否則用 AIS 課號。 */
  courseCode: string
  ruleId: string | null
  sourceId: string | null
  locator: string | null
  /** decision 不是 classified 時的理由（給 UI 顯示與 trace 用）。 */
  reason: string | null
}

/**
 * 課名正規化：全形英數／標點轉半形、移除所有空白、括號統一。
 * AIS 與檢核表的「微積分（上）」與「微積分(上)」必須視為同一門課。
 */
export function normalizeCourseName(raw: string): string {
  const halfWidth = raw.replace(/[\uFF01-\uFF5E]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  )
  return halfWidth.replace(/[\s\u3000]/g, '').trim()
}

function matches(pattern: ClassificationPattern, normalizedName: string): boolean {
  const value = normalizeCourseName(pattern.value)
  switch (pattern.kind) {
    case 'exact':
      return normalizedName === value
    case 'prefix':
      return normalizedName.startsWith(value)
    case 'contains':
      return normalizedName.includes(value)
    case 'regex':
      return new RegExp(pattern.value, 'u').test(normalizedName)
    default:
      return false
  }
}

export function parseClassificationTable(raw: unknown): ClassificationTable {
  const table = raw as ClassificationTable
  if (!table || typeof table !== 'object') throw new Error('classification 資料不是物件')
  if (!Array.isArray(table.rules) || table.rules.length === 0) throw new Error('classification.rules 必須是非空陣列')
  if (!Array.isArray(table.excluded)) throw new Error('classification.excluded 必須是陣列')
  const ids = new Set<string>()
  for (const rule of [...table.rules, ...table.excluded]) {
    if (!rule.id) throw new Error('classification 規則缺少 id')
    if (ids.has(rule.id)) throw new Error(`classification 規則 id 重複：${rule.id}`)
    ids.add(rule.id)
    if (!rule.sourceId) throw new Error(`classification 規則 ${rule.id} 缺少 sourceId`)
  }
  return table
}

export function loadClassificationTable(root: string = process.cwd()): ClassificationTable {
  const file = path.join(root, 'data', 'rules', '113-cse-classification.json')
  return parseClassificationTable(JSON.parse(readFileSync(file, 'utf8')))
}

/**
 * AIS 選別（`AisCourseRequirementKind`）只能當後備證據：
 * AIS 的「通識」明確對應共同教育；「必修／選修」不足以判斷是不是本系，故不推論。
 */
export type AisRequirementKind =
  | 'required'
  | 'elective'
  | 'generalEducation'
  | 'summer'
  | 'education'
  | 'service'
  | 'interUniversity'
  | 'extension'
  | 'unknown'

export interface ClassifyInput {
  courseName: string
  courseCode: string
  aisRequirementKind?: AisRequirementKind
}

export function classifyCourse(table: ClassificationTable, input: ClassifyInput): CourseClassification {
  const normalized = normalizeCourseName(input.courseName)
  const fallbackCode = input.courseCode.trim() || input.courseName

  for (const rule of table.excluded) {
    if (matches(rule.match, normalized)) {
      return {
        decision: 'excluded',
        category: 'unknown',
        tags: [],
        courseCode: fallbackCode,
        ruleId: rule.id,
        sourceId: rule.sourceId,
        locator: rule.locator,
        reason: rule.reason,
      }
    }
  }

  for (const rule of table.rules) {
    if (!matches(rule.match, normalized)) continue
    return {
      decision: 'classified',
      category: rule.category,
      tags: [...(rule.tags ?? [])],
      courseCode: rule.canonical ? normalizeCourseName(rule.canonical) : fallbackCode,
      ruleId: rule.id,
      sourceId: rule.sourceId,
      locator: rule.locator,
      reason: null,
    }
  }

  // AIS 明確標成通識的課，依規格書屬於共同教育；其餘一律 unknown。
  if (input.aisRequirementKind === 'generalEducation') {
    return {
      decision: 'classified',
      category: 'CE',
      tags: ['general'],
      courseCode: fallbackCode,
      ruleId: null,
      sourceId: null,
      locator: null,
      reason: null,
    }
  }

  return {
    decision: 'unknown',
    category: 'unknown',
    tags: [],
    courseCode: fallbackCode,
    ruleId: null,
    sourceId: null,
    locator: null,
    reason:
      input.aisRequirementKind === 'elective'
        ? 'AIS 只標示「選修」，沒有開課系所，無法判定系內或外系選修'
        : '課名不在官方檢核表或修業規定的分類清單內',
  }
}

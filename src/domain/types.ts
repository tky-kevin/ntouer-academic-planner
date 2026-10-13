export type CourseCategory = 'required' | 'elective'
export type CourseStatus = 'passed' | 'failed' | 'unknown'

export interface CourseRecord {
  readonly recordId: string
  readonly courseCode: string
  readonly name: string
  readonly credits: number
  readonly category: CourseCategory
  readonly status: CourseStatus
}

export type ConditionId = 'total-credits' | 'required-credits' | 'elective-credits'

export interface CreditCondition {
  readonly id: ConditionId
  readonly label: string
  readonly category: 'all' | CourseCategory
  readonly minimumCredits: number
}

export interface CreditRuleSet {
  readonly version: string
  readonly source: string
  readonly scope: 'partial'
  readonly scopeLabel: string
  readonly conditions: readonly CreditCondition[]
}

export interface CreditSummary {
  readonly totalCredits: number
  readonly requiredCredits: number
  readonly electiveCredits: number
}

export interface ConditionResult {
  readonly conditionId: ConditionId
  readonly label: string
  readonly threshold: number
  readonly earnedCredits: number
  readonly deficit: number
  readonly passed: boolean
  readonly countedRecords: readonly CourseRecord[]
}

export type ExclusionReason = 'duplicate-record' | 'failed' | 'unknown' | 'duplicate-course'

export interface ExcludedRecord {
  readonly record: CourseRecord
  readonly inputIndex: number
  readonly reason: ExclusionReason
}

export interface CreditAuditResult {
  readonly ruleVersion: string
  readonly scope: 'partial'
  readonly summary: CreditSummary
  readonly conditions: readonly ConditionResult[]
  readonly allConditionsMet: boolean
  readonly countedRecords: readonly CourseRecord[]
  readonly excludedRecords: readonly ExcludedRecord[]
}

// 學生端進度頁的資料形狀：docs/design/api-spec.md §7.3。
// API 還沒接上前用這份 mock；`loadMockProgress` 是唯一的替換點（#13 完成後改成 fetch）。
export type Scenario = 'completed' | 'inProgress' | 'planned'
export type RequirementState = 'met' | 'notMet' | 'unknown'
export type OverallState = 'complete' | 'unconfirmed' | 'incomplete'

export interface ProgressRequirement {
  id: string
  name: string
  state: RequirementState
  credits?: number
  min?: number
  gap?: number
  statusKey?: string
}

export interface ProgressTraceEntry {
  courseCode: string
  courseName: string | null
  pool: string
  credits: number
  cappedBy: string | null
  excludedReason: string | null
}

export interface ProgressData {
  bundleId: string
  versionId: string
  scenario: Scenario
  overall: OverallState
  totalCredits: number
  requirements: ProgressRequirement[]
  openConflicts: string[]
  trace?: ProgressTraceEntry[]
  dataSyncedAt: string | null
}

export class ProgressApiError extends Error {
  readonly code: string
  readonly requestId: string | null

  constructor(code: string, message: string, requestId: string | null = null) {
    super(message)
    this.name = 'ProgressApiError'
    this.code = code
    this.requestId = requestId
  }
}

export const SCENARIO_LABELS: Record<Scenario, string> = {
  completed: '已完成',
  inProgress: '修課中',
  planned: '規劃中',
}

const completed: ProgressData = {
  bundleId: 'cse-113-day',
  versionId: 'cse-113-day@1',
  scenario: 'completed',
  overall: 'unconfirmed',
  totalCredits: 135,
  requirements: [
    { id: 'R01', name: '總學分', state: 'met', credits: 135, min: 135, gap: 0 },
    { id: 'R04', name: '專業必修 18 門', state: 'met' },
    { id: 'R06', name: '系內選修', state: 'met', credits: 46, min: 46, gap: 0 },
    { id: 'R09', name: '大一英文', state: 'met' },
    { id: 'R13', name: '博雅四領域', state: 'met', credits: 14, min: 14, gap: 0 },
    { id: 'R15', name: '英文畢業門檻', state: 'unknown', statusKey: 'englishThreshold' },
    { id: 'R16', name: '操行', state: 'met' },
    { id: 'R17', name: '體育四學期', state: 'met' },
  ],
  openConflicts: ['X01'],
  trace: [
    { courseCode: 'CS101', courseName: '程式設計', pool: 'req', credits: 3, cappedBy: null, excludedReason: null },
    { courseCode: 'CS204', courseName: '資料結構', pool: 'req', credits: 3, cappedBy: null, excludedReason: null },
  ],
  dataSyncedAt: '2026-11-17T02:38:31.076+08:00',
}

const inProgress: ProgressData = {
  ...completed,
  scenario: 'inProgress',
  overall: 'incomplete',
  totalCredits: 129,
  requirements: completed.requirements.map((requirement) =>
    requirement.id === 'R01'
      ? { ...requirement, state: 'notMet', credits: 129, gap: 6 }
      : requirement.id === 'R17'
        ? { ...requirement, state: 'notMet' }
        : requirement,
  ),
}

const planned: ProgressData = {
  ...completed,
  scenario: 'planned',
  overall: 'incomplete',
  totalCredits: 120,
  requirements: completed.requirements.map((requirement) =>
    ['R01', 'R06', 'R17'].includes(requirement.id)
      ? { ...requirement, state: 'notMet', credits: requirement.credits ? requirement.credits - 15 : undefined, gap: 15 }
      : requirement,
  ),
}

const SCENARIOS: Record<Scenario, ProgressData> = { completed, inProgress, planned }

/** mock 階段：依情境回傳固定資料（非同步，讓畫面真的走過 Loading）。 */
export function loadMockProgress(scenario: Scenario): Promise<ProgressData> {
  return Promise.resolve(SCENARIOS[scenario])
}

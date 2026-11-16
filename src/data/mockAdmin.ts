// 管理端兩頁的 mock（#21）：真端點屬 #14，先固定資料讓畫面與測試可跑。
export type TestStatus = 'passed' | 'failed' | 'pending'

export interface ValidationError {
  clauseId: string
  nodeId: string
  selector?: string
  reason: string
}

export interface AdminTestResult {
  name: string
  status: TestStatus
}

export interface AdminValidationData {
  versionId: string
  bundleId: string
  proxy: boolean
  errors: ValidationError[]
  tests: AdminTestResult[]
}

export type DiffKind = 'added' | 'changed' | 'removed' | 'unchanged'

export interface DiffItem {
  id: string
  kind: DiffKind
  label: string
  clauseId?: string
  before?: string
  after?: string
}

export interface AdminSource {
  clauseId: string
  locator: string
  text: string
}

export interface AdminReviewData {
  versionId: string
  proxy: boolean
  diff: DiffItem[]
  sources: AdminSource[]
}

export const mockValidation: AdminValidationData = {
  versionId: 'cse-113-day@2',
  bundleId: 'cse-113-day',
  proxy: false,
  errors: [
    { clauseId: 'C03', nodeId: 'R06', selector: 'tag:inner', reason: 'selector 指向不存在的標籤 innerElective' },
    { clauseId: 'C05', nodeId: 'R13', reason: '博雅領域上限 4 與條文「至多 4 學分」不一致' },
  ],
  tests: [
    { name: '總學分 135', status: 'passed' },
    { name: '系內選修 46', status: 'failed' },
    { name: '衝突停在待確認', status: 'pending' },
  ],
}

export const mockReview: AdminReviewData = {
  versionId: 'cse-113-day@2',
  proxy: true,
  diff: [
    { id: 'R01', kind: 'unchanged', label: '總學分 135', clauseId: 'C01' },
    {
      id: 'R06',
      kind: 'changed',
      label: '系內選修 46',
      clauseId: 'C03',
      before: 'min: 46',
      after: 'min: 48',
    },
    { id: 'R20', kind: 'added', label: '新增：永續領域下限 2', clauseId: 'C06' },
    { id: 'R18', kind: 'removed', label: '移除：舊版游泳規定', clauseId: 'C04' },
  ],
  sources: [
    { clauseId: 'C03', locator: '手冊 p11 第 3 條', text: '系內選修至少 46 學分，其中核心課程至少 12 學分。' },
    { clauseId: 'C06', locator: '檢核表（Ⅱ）', text: '博雅永續領域至少 2 學分。' },
  ],
}

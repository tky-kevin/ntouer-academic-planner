// 分類未確認時的三態行為：SRS §8.4「未知不得當成未通過」、NFR-06「不得把未知當成失敗」。
// 真實 AIS 資料只給「必修／選修／通識」，系內／外系選修無法自動判定；
// 這種紀錄必須讓 tag 型學分條件回 unknown，而不是把缺額當成真的缺。
import { describe, expect, it } from 'vitest'
import { evaluate } from './ruleEngine'
import type { CourseRecordInput, RuleBundle } from './ruleEngine'

const bundle: RuleBundle = {
  schemaVersion: '1.0',
  bundleId: 'unclassified-113-day',
  department: { departmentId: 'cse' },
  scope: { entryYear: 113, program: 'day' },
  status: 'published',
  sources: [],
  clauses: [],
  allocation: {
    pools: [
      { poolId: 'ce', selectors: ['category:CE'], min: 0 },
      { poolId: 'rest', selectors: ['owner:own'], min: 0 },
    ],
    precedence: ['ce', 'rest'],
    caps: [],
  },
  requirements: [
    { id: 'R01', kind: 'total', name: '總學分', min: 20 },
    { id: 'R06', kind: 'credits', name: '系內選修 46', min: 46, selectors: ['tag:inner'] },
    { id: 'R04', kind: 'courseSet', name: '指定必修', mode: 'all', courses: ['程式設計'] },
  ],
}

const record = (courseCode: string, credits: number, category: string, tags: string[]): CourseRecordInput => ({
  courseCode,
  credits,
  status: 'pass',
  category,
  tags,
  owner: 'own',
})

describe('分類未確認（category=unknown）時的判定', () => {
  it('有未分類學分且 tag 條件不足 → unknown，不是 notMet', () => {
    const result = evaluate(bundle, [
      record('X1', 10, 'unknown', []),
      record('X2', 10, 'unknown', []),
      record('程式設計', 3, 'unknown', []),
    ])
    const r06 = result.requirements.find((requirement) => requirement.id === 'R06')
    expect(r06?.state).toBe('unknown')
    expect(result.overall).toBe('unconfirmed')
  })

  it('全部有分類且真的不足 → notMet（不能因為有分類就放寬）', () => {
    const result = evaluate(bundle, [record('A1', 3, 'CE', ['english']), record('B1', 3, 'ELE', [])])
    const r06 = result.requirements.find((requirement) => requirement.id === 'R06')
    expect(r06?.state).toBe('notMet')
    expect(result.overall).toBe('incomplete')
  })

  it('未分類學分仍計入總學分（池已涵蓋 owner:own）', () => {
    const result = evaluate(bundle, [record('X1', 20, 'unknown', [])])
    expect(result.totalCredits).toBe(20)
    expect(result.requirements.find((requirement) => requirement.id === 'R01')?.state).toBe('met')
  })

  it('courseSet 不受未分類影響（指定必修看的是課號，不是分類）', () => {
    const recordWithCode: CourseRecordInput = { ...record('程式設計', 3, 'unknown', []) }
    const result = evaluate(bundle, [recordWithCode])
    expect(result.requirements.find((requirement) => requirement.id === 'R04')?.state).toBe('met')
  })

  it('已達門檻時就是 met，不會被未分類拖成 unknown', () => {
    const result = evaluate(bundle, [record('X1', 46, 'unknown', ['inner'])])
    const r06 = result.requirements.find((requirement) => requirement.id === 'R06')
    expect(r06?.state).toBe('met')
  })
})

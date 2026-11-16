// 邊界案例（TC-01／02／03／05／07）：用最小 bundle 驗「不足／剛好／超過／不及格排除／重修」。
// 舊的 checkCredits 引擎已刪除；這些案例改由正式引擎承接。
import { describe, expect, it } from 'vitest'
import { evaluate } from './ruleEngine'
import type { CourseRecordInput, RecordStatus, RuleBundle } from './ruleEngine'

const bundle: RuleBundle = {
  schemaVersion: '1.0',
  bundleId: 'edge-113-day',
  department: { departmentId: 'cse' },
  scope: { entryYear: 113, program: 'day' },
  status: 'published',
  sources: [],
  clauses: [],
  allocation: {
    pools: [{ poolId: 'all', selectors: ['owner:own'] }],
    caps: [],
  },
  requirements: [{ id: 'R1', name: '總學分', kind: 'total', min: 4 }],
}

const rec = (courseCode: string, credits: number, status: RecordStatus = 'pass'): CourseRecordInput => ({
  courseCode,
  credits,
  status,
  category: 'ELE',
  tags: [],
  owner: 'own',
})

describe('引擎邊界案例', () => {
  it('空資料：總學分 0、缺額等於門檻、未完成', () => {
    const result = evaluate(bundle, [])
    expect(result.totalCredits).toBe(0)
    expect(result.requirements[0].gap).toBe(4)
    expect(result.overall).toBe('incomplete')
  })

  it('不及格的學分不採計', () => {
    expect(evaluate(bundle, [rec('A', 4, 'fail')]).totalCredits).toBe(0)
  })

  it('同一門課重修只計一次（取及格那次）', () => {
    const result = evaluate(bundle, [rec('A', 4, 'fail'), rec('A', 4, 'pass')])
    expect(result.totalCredits).toBe(4)
    expect(result.overall).toBe('complete')
  })

  it('剛好等於門檻是已達成', () => {
    const result = evaluate(bundle, [rec('A', 4)])
    expect(result.totalCredits).toBe(4)
    expect(result.requirements[0].state).toBe('met')
    expect(result.requirements[0].gap).toBe(0)
  })

  it('超過門檻：缺額不會是負數', () => {
    const result = evaluate(bundle, [rec('A', 6)])
    expect(result.totalCredits).toBe(6)
    expect(result.requirements[0].state).toBe('met')
    expect(result.requirements[0].gap).toBe(0)
  })

  it('學分足夠但指定必修缺漏 → 未完成（TC-25）', () => {
    const withCourseSet: RuleBundle = {
      ...bundle,
      requirements: [
        { id: 'R1', name: '總學分', kind: 'total', min: 4 },
        { id: 'R4', name: '指定必修', kind: 'courseSet', mode: 'all', courses: ['程式設計', '資料結構'] },
      ],
    }
    const result = evaluate(withCourseSet, [rec('程式設計', 6), rec('通識A', 6)])
    expect(result.requirements[0].state).toBe('met')
    expect(result.requirements[1].state).toBe('notMet')
    expect(result.requirements[1].missing).toContain('資料結構')
    expect(result.overall).toBe('incomplete')
  })

  it('指定必修全部到齊才算達成（TC-25 的另一半）', () => {
    const withCourseSet: RuleBundle = {
      ...bundle,
      requirements: [{ id: 'R4', name: '指定必修', kind: 'courseSet', mode: 'all', courses: ['程式設計', '資料結構'] }],
    }
    const result = evaluate(withCourseSet, [rec('程式設計', 3), rec('資料結構', 3)])
    expect(result.requirements[0].state).toBe('met')
    expect(result.overall).toBe('complete')
  })
})

import { describe, expect, it } from 'vitest'
import { recordSamples } from '../data/sampleRecords'
import { sampleExpectations } from '../data/sampleExpectations'
import { testRules } from '../data/testRules'
import type { CourseRecord, CreditRuleSet } from '../domain/types'
import { checkCredits } from './checkCredits'

describe('AP-I1-03 學分檢核引擎', () => {
  for (const sample of recordSamples) {
    it(`七組樣本：${sample.name} 的學分、缺額與達標狀態`, () => {
      const result = checkCredits(sample.records, testRules)
      const expected = sampleExpectations[sample.id]
      expect(result.summary).toEqual(expected.summary)
      expect(result.allConditionsMet).toBe(expected.allConditionsMet)
      expect(result.ruleVersion).toBe('test-v0.1')
      expect(result.scope).toBe('partial')
      expect(result.conditions).toHaveLength(3)
      for (const condition of result.conditions) {
        expect(condition).toMatchObject(expected.conditions[condition.conditionId])
      }
      expect(result.conditions.map(condition => condition.threshold)).toEqual([12, 6, 6])
    })
  }

  it('未知狀態不採計總學分或分類學分，亦不阻止其後的及格重修', () => {
    const records: CourseRecord[] = [
      { recordId: 'unknown-A', courseCode: 'A', name: '課程 A', credits: 3, category: 'required', status: 'unknown' },
      { recordId: 'unknown-C', courseCode: 'C', name: '課程 C', credits: 3, category: 'elective', status: 'unknown' },
      { recordId: 'passed-A', courseCode: 'A', name: '課程 A', credits: 3, category: 'required', status: 'passed' },
    ]
    const result = checkCredits(records, testRules)
    expect(result.summary).toEqual({ totalCredits: 3, requiredCredits: 3, electiveCredits: 0 })
    expect(result.conditions).toMatchObject([
      { earnedCredits: 3, deficit: 9, passed: false },
      { earnedCredits: 3, deficit: 3, passed: false },
      { earnedCredits: 0, deficit: 6, passed: false },
    ])
    expect(result.countedRecords.map(record => record.recordId)).toEqual(['passed-A'])
    expect(result.excludedRecords.map(record => record.reason)).toEqual(['unknown', 'unknown'])
  })

  it('更換規則門檻後，缺額與狀態同步改變', () => {
    const changedRules: CreditRuleSet = {
      ...testRules,
      version: 'test-v0.2',
      conditions: [
        { id: 'total-credits', label: '總學分', category: 'all', minimumCredits: 15 },
        { id: 'required-credits', label: '必修類學分', category: 'required', minimumCredits: 9 },
        { id: 'elective-credits', label: '選修類學分', category: 'elective', minimumCredits: 3 },
      ],
    }
    const result = checkCredits(recordSamples[1].records, changedRules)
    expect(result.ruleVersion).toBe('test-v0.2')
    expect(result.conditions).toMatchObject([
      { conditionId: 'total-credits', threshold: 15, earnedCredits: 12, deficit: 3, passed: false },
      { conditionId: 'required-credits', threshold: 9, earnedCredits: 6, deficit: 3, passed: false },
      { conditionId: 'elective-credits', threshold: 3, earnedCredits: 6, deficit: 0, passed: true },
    ])
    expect(result.allConditionsMet).toBe(false)
  })

  it('每個條件附上實際採計紀錄；同一課程可列在總學分與其所屬分類', () => {
    const result = checkCredits(recordSamples[5].records, testRules)
    expect(result.countedRecords.map(record => record.recordId)).toEqual(['rec-A-01', 'rec-B-01', 'rec-C-01', 'rec-D-01'])
    expect(result.conditions.map(condition => condition.countedRecords.map(record => record.courseCode))).toEqual([
      ['A', 'B', 'C', 'D'], ['A', 'B'], ['C', 'D'],
    ])
    expect(result.excludedRecords).toMatchObject([{ inputIndex: 4, reason: 'duplicate-record' }])
  })

  it('不同 recordId、同 courseCode 的兩筆及格紀錄也只採計一次', () => {
    const original = recordSamples[1].records
    const result = checkCredits([...original, { ...original[0], recordId: 'another-passed-A' }], testRules)
    expect(result.summary).toEqual({ totalCredits: 12, requiredCredits: 6, electiveCredits: 6 })
    expect(result.countedRecords).toHaveLength(4)
    expect(result.excludedRecords).toMatchObject([{ inputIndex: 4, reason: 'duplicate-course' }])
  })

  it('不及格紀錄在及格紀錄之前，仍能取得一次及格學分', () => {
    const original = recordSamples[1].records
    const result = checkCredits([{ ...original[0], recordId: 'earlier-A', status: 'failed' }, ...original], testRules)
    expect(result.summary).toEqual({ totalCredits: 12, requiredCredits: 6, electiveCredits: 6 })
    expect(result.conditions.map(condition => condition.deficit)).toEqual([0, 0, 0])
    expect(result.allConditionsMet).toBe(true)
  })

  it('空資料的採計明細為空，輸入資料與規則不被修改', () => {
    const records = Object.freeze(recordSamples[1].records.map(record => Object.freeze({ ...record })))
    const before = JSON.stringify({ records, testRules })
    checkCredits(records, testRules)
    expect(JSON.stringify({ records, testRules })).toBe(before)
    expect(checkCredits([], testRules).conditions.map(condition => condition.countedRecords)).toEqual([[], [], []])
  })
})

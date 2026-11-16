import { describe, expect, it } from 'vitest'
import {
  applyConditionOverrides,
  computeProgress,
  mapDbStatus,
  overallFrom,
  toEngineRecords,
} from './progress.js'
import type { ConditionOverrideRow, OverrideRow, RecordRow } from './progress.js'
import type { EvaluationResult, RequirementResult } from '../../src/engine/ruleEngine.js'

const row = (overrides: Partial<RecordRow> = {}): RecordRow => ({
  record_key: 'r1',
  course_code: '程式設計',
  course_name: '程式設計',
  credits: '3.0',
  category: 'REQ',
  status: 'passed',
  tags: ['core'],
  owner: 'own',
  term: '113-1',
  ...overrides,
})

const evaluation = (requirements: RequirementResult[], openConflicts: string[] = []): EvaluationResult => ({
  bundleId: 'cse-113-day',
  scenario: 'completed',
  overall: 'unconfirmed',
  totalCredits: 135,
  poolTotals: { ce: 28, req: 50, inner: 46 },
  requirements,
  openConflicts: openConflicts.map((conflictId) => ({ conflictId })),
  trace: [
    { courseCode: '程式設計', pool: 'req', credits: 3, cappedBy: null },
    { courseCode: '外系A', pool: 'outside', credits: 0, cappedBy: null, reason: '池已滿' },
  ],
  claimed: {},
})

describe('progress：DB 紀錄 → 引擎輸入', () => {
  it('passed 對應 pass，numeric 學分轉成數字，未知狀態保守視為 unknown', () => {
    expect(mapDbStatus('passed')).toBe('pass')
    expect(mapDbStatus('failed')).toBe('fail')
    expect(mapDbStatus('weird')).toBe('unknown')

    const [record] = toEngineRecords([row()], [])
    expect(record).toEqual({
      courseCode: '程式設計',
      credits: 3,
      status: 'pass',
      category: 'REQ',
      tags: ['core'],
      owner: 'own',
    })
  })

  it('個人修正覆蓋 credits／status／category', () => {
    const overrides: OverrideRow[] = [
      { record_key: 'r1', field: 'credits', value: '2' },
      { record_key: 'r1', field: 'status', value: 'transfer' },
      { record_key: 'r1', field: 'category', value: 'CE' },
    ]
    const [record] = toEngineRecords([row()], overrides)
    expect(record.credits).toBe(2)
    expect(record.status).toBe('transfer')
    expect(record.category).toBe('CE')
  })
})

describe('progress：條件覆蓋', () => {
  const base: RequirementResult[] = [
    { id: 'R15', kind: 'status', required: true, state: 'unknown', statusKey: 'englishThreshold' },
    {
      id: 'R99',
      kind: 'and',
      required: true,
      state: 'notMet',
      children: [
        { id: 'R06', kind: 'credits', required: true, state: 'met', credits: 46, min: 46 },
        { id: 'R05', kind: 'credits', required: true, state: 'notMet', credits: 0, min: 8 },
      ],
    },
  ]

  it('覆蓋節點直接採用覆蓋值', () => {
    const overrides = new Map([['R15', 'met' as const]])
    const results = applyConditionOverrides(base, overrides)
    expect(results[0].state).toBe('met')
  })

  it('子節點被覆蓋後，上層 and 會重算', () => {
    const overrides = new Map([['R05', 'met' as const]])
    const results = applyConditionOverrides(base, overrides)
    expect(results[1].state).toBe('met')
  })
})

describe('progress：整體結果', () => {
  const met: RequirementResult = { id: 'R01', kind: 'total', required: true, state: 'met' }
  const notMet: RequirementResult = { id: 'R02', kind: 'pool', required: true, state: 'notMet' }
  const unknown: RequirementResult = { id: 'R03', kind: 'status', required: true, state: 'unknown' }
  const optionalUnknown: RequirementResult = { id: 'R04', kind: 'status', required: false, state: 'unknown' }

  it('有 notMet → incomplete', () => {
    expect(overallFrom([met, notMet, unknown], 0)).toBe('incomplete')
  })

  it('沒有 notMet 但有 unknown → unconfirmed', () => {
    expect(overallFrom([met, unknown], 0)).toBe('unconfirmed')
  })

  it('openConflicts 非空時不得是 complete', () => {
    expect(overallFrom([met], 1)).toBe('unconfirmed')
  })

  it('required:false 的 unknown 不影響結果', () => {
    expect(overallFrom([met, optionalUnknown], 0)).toBe('complete')
  })
})

describe('progress：回應組裝', () => {
  const conditionOverrides: ConditionOverrideRow[] = [{ requirement_id: 'R15', state: 'met' }]

  it('衝突清單輸出 id、trace 帶 courseName 與 excludedReason', () => {
    const data = computeProgress({
      bundleId: 'cse-113-day',
      versionId: 'cse-113-day@1',
      scenario: 'completed',
      evaluation: evaluation(
        [
          { id: 'R15', kind: 'status', required: true, state: 'met', statusKey: 'englishThreshold' },
          { id: 'R06', kind: 'credits', required: true, state: 'met', credits: 46, min: 46 },
        ],
        ['X01'],
      ),
      records: [row()],
      conditionOverrides,
      includeTrace: true,
      dataSyncedAt: '2026-11-17T02:00:00.000+08:00',
    })

    expect(data.overall).toBe('unconfirmed') // 仍有未解衝突
    expect(data.openConflicts).toEqual(['X01'])
    expect(data.totalCredits).toBe(135)
    expect(data.trace).toHaveLength(2)
    expect(data.trace?.[0].courseName).toBe('程式設計')
    expect(data.trace?.[1].excludedReason).toBe('池已滿')
    expect(data.dataSyncedAt).toBe('2026-11-17T02:00:00.000+08:00')
  })

  it('includeTrace=false 時不輸出 trace', () => {
    const data = computeProgress({
      bundleId: 'cse-113-day',
      versionId: 'cse-113-day@1',
      scenario: 'completed',
      evaluation: evaluation([{ id: 'R01', kind: 'total', required: true, state: 'met' }]),
      records: [],
      conditionOverrides: [],
      includeTrace: false,
      dataSyncedAt: null,
    })
    expect(data.trace).toBeUndefined()
  })
})

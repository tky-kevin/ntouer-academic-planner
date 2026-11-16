// 27 項引擎回歸測試：逐項照抄 docs/design/spike/run-cases.mjs 的預期值，不重算。
// 分組（1～9）對應 spike 的 9 個段落。
import { describe, expect, it } from 'vitest'
import cseRaw from '../../docs/design/examples/113-cse.json?raw'
import mmdRaw from '../../docs/design/examples/115-mmd.json?raw'
import { evaluate, validateBundle } from './ruleEngine'
import type { CourseRecordInput, EvaluationResult, RecordStatus, RuleBundle } from './ruleEngine'

const cse = JSON.parse(cseRaw) as RuleBundle
const mmd = JSON.parse(mmdRaw) as RuleBundle

const rec = (courseCode: string, credits: number, options: Partial<CourseRecordInput> = {}): CourseRecordInput => ({
  courseCode,
  credits,
  status: (options.status ?? 'pass') as RecordStatus,
  category: options.category ?? 'ELE',
  owner: options.owner ?? 'own',
  tags: options.tags ?? [],
})

function cseComplete(): CourseRecordInput[] {
  const rows: CourseRecordInput[] = []
  const ce: [string, number, string[]][] = [
    ['國文(上)', 2, ['chinese']],
    ['國文(下)', 2, ['chinese']],
    ['大一英文(上)', 2, ['english']],
    ['大一英文(下)', 2, ['english']],
    ['進階英文', 2, ['advancedEnglish']],
    ['海洋科學概論', 2, ['ocean']],
    ['人工智慧概論', 2, ['ai']],
    ['博雅-人文A', 2, ['general', 'domainHuman']],
    ['博雅-人文B', 2, ['general', 'domainHuman']],
    ['博雅-社會A', 2, ['general', 'domainSociety']],
    ['博雅-社會B', 2, ['general', 'domainSociety']],
    ['博雅-科技A', 2, ['general', 'domainTech']],
    ['博雅-科技B', 2, ['general', 'domainTech']],
    ['博雅-永續A', 2, ['general', 'domainSustain']],
  ]
  for (const [name, credits, tags] of ce) rows.push(rec(name, credits, { category: 'CE', tags }))

  const required: [string, number][] = [
    ['程式設計', 3],
    ['離散數學', 3],
    ['計算機概論', 3],
    ['微積分(上)', 3],
    ['微積分(下)', 3],
    ['程式設計(二)', 3],
    ['線性代數', 3],
    ['數位邏輯', 3],
    ['數位邏輯實驗', 1],
    ['資料結構', 3],
    ['機率論', 3],
    ['計算機組織學', 3],
    ['演算法', 3],
    ['電腦網路', 3],
    ['作業系統', 3],
    ['資工系專題(一)', 3],
    ['資工系專題(二)', 3],
    ['資訊專題討論', 1],
  ]
  for (const [name, credits] of required) rows.push(rec(name, credits, { category: 'REQ' }))

  for (let index = 1; index <= 4; index += 1) rows.push(rec(`核心選修${index}`, 3, { tags: ['inner', 'core'] }))
  for (let index = 1; index <= 11; index += 1) rows.push(rec(`系內選修${index}`, 3, { tags: ['inner'] }))
  rows.push(rec('系內選修12', 1, { tags: ['inner'] }))

  rows.push(rec('外系A', 3, { owner: 'other' }))
  rows.push(rec('外系B', 3, { owner: 'other' }))
  rows.push(rec('外系C', 3, { owner: 'other' }))
  rows.push(rec('外系D', 2, { owner: 'other' }))
  return rows
}

const allMet = {
  englishThreshold: 'met',
  conduct: 'met',
  peFourSemesters: 'met',
  swimming: 'met',
  advancedEnglishEligibility: 'met',
} as const

const requirement = (result: EvaluationResult, id: string) => {
  const found = result.requirements.find((item) => item.id === id)
  if (!found) throw new Error(`找不到 requirement ${id}`)
  return found
}

describe('1. 規則包結構驗證', () => {
  it('資工樣本通過結構驗證', () => {
    const validation = validateBundle(cse)
    expect(validation.errors).toEqual([])
    expect(validation.ok).toBe(true)
  })

  it('商船樣本通過結構驗證', () => {
    const validation = validateBundle(mmd)
    expect(validation.errors).toEqual([])
    expect(validation.ok).toBe(true)
  })

  it('錯誤條文參照被擋下', () => {
    const broken = JSON.parse(JSON.stringify(cse)) as RuleBundle
    broken.requirements[1].clauseId = 'C99'
    const validation = validateBundle(broken)
    expect(validation.ok).toBe(false)
    expect(validation.errors[0]).toContain('C99')
  })
})

describe('2. 完整達標與衝突', () => {
  const result = evaluate(cse, cseComplete(), { statuses: allMet })

  it('總學分 135', () => {
    expect(result.totalCredits).toBe(135)
  })

  it('三池 28／50／46', () => {
    expect(result.poolTotals.ce).toBe(28)
    expect(result.poolTotals.req).toBe(50)
    expect(result.poolTotals.inner).toBe(46)
  })

  it('必修 18 門全滿足', () => {
    expect(requirement(result, 'R04').state).toBe('met')
  })

  it('核心 12 為系內子集合、不另計總學分', () => {
    expect(requirement(result, 'R07').state).toBe('met')
    expect(result.totalCredits).toBe(135)
  })

  it('未解衝突使結果停在未確認', () => {
    expect(result.overall).toBe('unconfirmed')
  })
})

describe('3. 缺額計算', () => {
  const short = cseComplete().filter(
    (record) => record.courseCode !== '系內選修11' && record.courseCode !== '系內選修12' && record.courseCode !== '外系D',
  )
  const result = evaluate(cse, short, { statuses: allMet })

  it('缺額 6 學分', () => {
    expect(requirement(result, 'R01').gap).toBe(6)
  })

  it('系內選修同時不足', () => {
    expect(requirement(result, 'R06').state).toBe('notMet')
  })

  it('總學分不足 → 未完成', () => {
    expect(result.overall).toBe('incomplete')
  })
})

describe('4. 採計上限', () => {
  const withCollege = [
    ...cseComplete(),
    rec('電資共通1', 3, { tags: ['collegeNonProgram'] }),
    rec('電資共通2', 3, { tags: ['collegeNonProgram'] }),
    rec('電資共通3', 3, { tags: ['collegeNonProgram'] }),
  ]

  it('超出上限只計 6，總學分 +6', () => {
    expect(evaluate(cse, withCollege, { statuses: allMet }).totalCredits).toBe(141)
  })

  it('trace 標記被上限截斷', () => {
    const cappedRows = evaluate(cse, withCollege, { statuses: allMet }).trace.filter(
      (entry) => entry.cappedBy === 'CAP-COLLEGE',
    )
    expect(cappedRows.length).toBeGreaterThanOrEqual(1)
    expect(cappedRows[0].credits).toBeLessThanOrEqual(3)
  })

  it('博雅人文超修不增加 R13 認列', () => {
    const overDomain = [...cseComplete(), rec('博雅-人文C', 2, { category: 'CE', tags: ['general', 'domainHuman'] })]
    expect(requirement(evaluate(cse, overDomain, { statuses: allMet }), 'R13').credits).toBe(14)
  })
})

describe('5. 重複採計', () => {
  const duplicateRows = [
    ...cseComplete(),
    rec('系內選修1', 3, { tags: ['inner'] }),
    rec('系內選修1', 3, { tags: ['inner'], owner: 'other' }),
  ]
  const result = evaluate(cse, duplicateRows, { statuses: allMet })

  it('同課多筆只計一次', () => {
    expect(result.totalCredits).toBe(135)
  })

  it('歸屬只落在一個池', () => {
    expect(result.claimed['系內選修1'].pool).toBe('inner')
  })
})

describe('6. 抵免與免修', () => {
  it('抵免計入學分且滿足大一英文', () => {
    const transferRows = cseComplete()
      .filter((record) => !record.courseCode.startsWith('大一英文'))
      .concat([rec('大一英文(抵免)', 4, { status: 'transfer', category: 'CE', tags: ['english'] })])
    const result = evaluate(cse, transferRows, { statuses: allMet })
    expect(requirement(result, 'R09').state).toBe('met')
    expect(result.totalCredits).toBe(135)
  })

  it('免修滿足指定必修', () => {
    const waivedRows = cseComplete().map((record) =>
      record.courseCode === '數位邏輯實驗' ? { ...record, status: 'waived' as RecordStatus } : record,
    )
    expect(requirement(evaluate(cse, waivedRows, { statuses: allMet }), 'R04').state).toBe('met')
  })

  it('免修不給學分，必修學分不足 1', () => {
    const waivedRows = cseComplete().map((record) =>
      record.courseCode === '數位邏輯實驗' ? { ...record, status: 'waived' as RecordStatus } : record,
    )
    const result = evaluate(cse, waivedRows, { statuses: allMet })
    expect(requirement(result, 'R03').gap).toBe(1)
  })

  it('免修後總學分降為 134', () => {
    const waivedRows = cseComplete().map((record) =>
      record.courseCode === '數位邏輯實驗' ? { ...record, status: 'waived' as RecordStatus } : record,
    )
    expect(evaluate(cse, waivedRows, { statuses: allMet }).totalCredits).toBe(134)
  })
})

describe('7. 未知狀態與衝突解除', () => {
  it('英文門檻未知 → 尚未確認', () => {
    const statuses = { ...allMet, englishThreshold: undefined }
    const result = evaluate(cse, cseComplete(), { statuses })
    expect(result.overall).toBe('unconfirmed')
    expect(requirement(result, 'R15').state).toBe('unknown')
  })

  it('衝突解除後可達完整', () => {
    const resolved = JSON.parse(JSON.stringify(cse)) as RuleBundle
    resolved.conflicts![0].resolution = 'resolved-by-owner'
    const result = evaluate(resolved, cseComplete(), { statuses: allMet })
    expect(result.overall).toBe('complete')
  })
})

describe('8. 多系所格式', () => {
  const mmdRows: CourseRecordInput[] = []
  for (let index = 1; index <= 14; index += 1) mmdRows.push(rec(`共同教育${index}`, 2, { category: 'CE' }))
  for (let index = 1; index <= 14; index += 1) mmdRows.push(rec(`專業必修${index}`, 5, { category: 'REQ' }))
  for (let index = 1; index <= 10; index += 1) mmdRows.push(rec(`主領域${index}`, 2, { tags: ['mainField'] }))
  for (let index = 1; index <= 6; index += 1) mmdRows.push(rec(`管理級${index}`, 3, { tags: ['mainField', 'managerial'] }))
  const result = evaluate(mmd, mmdRows, { statuses: { conduct: 'met' } })

  it('商船總學分 136', () => {
    expect(result.totalCredits).toBe(136)
  })

  it('主領域 38 與管理級 18 同時滿足', () => {
    expect(requirement(result, 'R05').state).toBe('met')
    expect(requirement(result, 'R06').state).toBe('met')
  })

  it('管理級為子集合、不重複計入總學分', () => {
    expect(result.totalCredits).toBe(136)
  })

  it('未確認的海上實習不阻擋畢業判定', () => {
    expect(requirement(result, 'R08').required).toBe(false)
  })
})

describe('9. 情境切換', () => {
  it('修課中課程不計入已完成', () => {
    const partial = cseComplete().map((record, index) =>
      index < 3 ? { ...record, status: 'inProgress' as RecordStatus } : record,
    )
    const completed = evaluate(cse, partial, { statuses: allMet, scenario: 'completed' })
    const inProgress = evaluate(cse, partial, { statuses: allMet, scenario: 'inProgress' })
    expect(completed.totalCredits).toBeLessThan(inProgress.totalCredits)
  })
})

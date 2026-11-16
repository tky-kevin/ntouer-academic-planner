// 結構驗證器的回歸測試：重複的 sourceId／clauseId 必須被擋下。
// 這裡修過一個真實 bug：原本拿 Set 再比對，Set 已去重所以永遠抓不到重複。
import { describe, expect, it } from 'vitest'
import { validateBundle } from './ruleEngine'
import type { RuleBundle } from './ruleEngine'

const base: RuleBundle = {
  schemaVersion: '1.0',
  bundleId: 'validate-test',
  department: { departmentId: 'cse' },
  scope: { entryYear: 113, program: 'day' },
  status: 'draft',
  sources: [{ sourceId: 'S1' }],
  clauses: [{ clauseId: 'C1', sourceId: 'S1' }],
  allocation: { pools: [] },
  requirements: [{ id: 'R1', kind: 'total', min: 0 }],
}

describe('validateBundle：重複識別碼', () => {
  it('合法的 bundle 通過', () => {
    expect(validateBundle(base)).toEqual({ ok: true, errors: [] })
  })

  it('重複 sourceId 被擋下', () => {
    const result = validateBundle({ ...base, sources: [{ sourceId: 'S1' }, { sourceId: 'S1' }] })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('sourceId 重複')
  })

  it('重複 clauseId 被擋下', () => {
    const result = validateBundle({
      ...base,
      clauses: [
        { clauseId: 'C1', sourceId: 'S1' },
        { clauseId: 'C1', sourceId: 'S1' },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('clauseId 重複')
  })

  it('重複 requirement id 被擋下', () => {
    const result = validateBundle({
      ...base,
      requirements: [
        { id: 'R1', kind: 'total', min: 0 },
        { id: 'R1', kind: 'total', min: 1 },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('requirement id 重複')
  })

  it('clause 指向不存在的 source 仍會被擋（原本就有的檢查）', () => {
    const result = validateBundle({ ...base, clauses: [{ clauseId: 'C9', sourceId: 'S9' }] })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('不存在的 source'))).toBe(true)
  })
})

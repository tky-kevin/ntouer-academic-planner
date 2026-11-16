import { describe, expect, it } from 'vitest'
import { diffPayloads, summarizeDiff } from './diff.js'

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    bundleId: 'cse-113-day',
    title: '測試規則包',
    department: { departmentId: 'cse', name: '資訊工程學系' },
    scope: { entryYear: 113, program: 'day' },
    status: 'draft',
    sources: [{ sourceId: 'S113-01', title: '113 新生手冊', url: 'https://example.edu/a.pdf', locator: 'p1' }],
    clauses: [
      { clauseId: 'C01', sourceId: 'S113-01', locator: 'p1', text: '總學分至少 12。' },
      { clauseId: 'C02', sourceId: 'S113-01', locator: 'p2', text: '核心至少 6。', reading: '核心' },
    ],
    allocation: {
      totalMin: 12,
      precedence: ['core'],
      pools: [{ poolId: 'core', name: '核心', selectors: ['tag:core'] }],
    },
    requirements: [
      { id: 'R01', kind: 'total', name: '總學分', clauseId: 'C01', min: 12 },
      {
        id: 'R02',
        kind: 'and',
        name: '核心群組',
        clauseId: 'C02',
        children: [
          { id: 'R02-1', kind: 'credits', name: '核心 6', clauseId: 'C02', min: 6, selectors: ['tag:core'] },
        ],
      },
    ],
    ...overrides,
  }
}

describe('diffPayloads', () => {
  it('內容完全相同時三區都是空陣列、summary 全 0', () => {
    const diff = diffPayloads(payload(), payload())
    expect(diff.requirements).toEqual([])
    expect(diff.clauses).toEqual([])
    expect(diff.sources).toEqual([])
    expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('沒有前一版時全部視為 added（含巢狀節點）', () => {
    const diff = diffPayloads(null, payload())
    // R01、R02、R02/R02-1 三個節點；C01、C02 兩條；S113-01 一個來源。
    expect(diff.summary).toEqual({ added: 6, removed: 0, changed: 0 })
    expect(diff.requirements.map((item) => item.id)).toEqual(['R01', 'R02', 'R02/R02-1'])
    expect(diff.requirements.every((item) => item.kind === 'added')).toBe(true)
    expect(diff.clauses.map((item) => item.id)).toEqual(['C01', 'C02'])
    expect(diff.sources.map((item) => item.id)).toEqual(['S113-01'])
  })

  it('requirement 的 min 變更為 changed，before／after 與 changes 逐欄位', () => {
    const next = payload({
      requirements: [
        { id: 'R01', kind: 'total', name: '總學分', clauseId: 'C01', min: 14 },
        {
          id: 'R02',
          kind: 'and',
          name: '核心群組',
          clauseId: 'C02',
          children: [
            { id: 'R02-1', kind: 'credits', name: '核心 6', clauseId: 'C02', min: 6, selectors: ['tag:core'] },
          ],
        },
      ],
    })
    const diff = diffPayloads(payload(), next)
    expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 1 })
    expect(diff.requirements).toHaveLength(1)
    const item = diff.requirements[0]
    expect(item).toMatchObject({ kind: 'changed', id: 'R01', clauseId: 'C01' })
    expect(item.before).toContain('min: 12')
    expect(item.after).toContain('min: 14')
    expect(item.changes).toEqual([{ field: 'min', before: 12, after: 14 }])
  })

  it('刪除整個 and 子樹時，父與子各一筆 removed', () => {
    const next = payload({
      requirements: [{ id: 'R01', kind: 'total', name: '總學分', clauseId: 'C01', min: 12 }],
    })
    const diff = diffPayloads(payload(), next)
    expect(diff.requirements.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'removed:R02',
      'removed:R02/R02-1',
    ])
    expect(diff.summary).toEqual({ added: 0, removed: 2, changed: 0 })
  })

  it('新增巢狀子節點時是 added，路徑帶父節點', () => {
    const next = payload({
      requirements: [
        { id: 'R01', kind: 'total', name: '總學分', clauseId: 'C01', min: 12 },
        {
          id: 'R02',
          kind: 'and',
          name: '核心群組',
          clauseId: 'C02',
          children: [
            { id: 'R02-1', kind: 'credits', name: '核心 6', clauseId: 'C02', min: 6, selectors: ['tag:core'] },
            { id: 'R02-2', kind: 'status', name: '英文門檻', clauseId: 'C02', statusKey: 'english' },
          ],
        },
      ],
    })
    const diff = diffPayloads(payload(), next)
    expect(diff.requirements).toHaveLength(1)
    expect(diff.requirements[0]).toMatchObject({ kind: 'added', id: 'R02/R02-2', clauseId: 'C02' })
  })

  it('clause 的文字與 reading 變更都算 changed，並帶 clauseId', () => {
    const next = payload({
      clauses: [
        { clauseId: 'C01', sourceId: 'S113-01', locator: 'p1', text: '總學分至少 14。' },
        { clauseId: 'C02', sourceId: 'S113-01', locator: 'p2', text: '核心至少 6。', reading: '核心（修正）' },
      ],
    })
    const diff = diffPayloads(payload(), next)
    expect(diff.clauses.map((item) => `${item.kind}:${item.id}`)).toEqual(['changed:C01', 'changed:C02'])
    for (const item of diff.clauses) expect(item.clauseId).toBe(item.id)
    expect(diff.clauses[0].changes?.map((change) => change.field)).toEqual(['text'])
    expect(diff.clauses[1].changes?.map((change) => change.field)).toEqual(['reading'])
  })

  it('source 的 url 與 locator 變更算 changed，label 用標題', () => {
    const next = payload({
      sources: [
        { sourceId: 'S113-01', title: '113 新生手冊', url: 'https://example.edu/b.pdf', locator: 'p9' },
      ],
    })
    const diff = diffPayloads(payload(), next)
    expect(diff.sources).toHaveLength(1)
    expect(diff.sources[0]).toMatchObject({ kind: 'changed', id: 'S113-01', label: '113 新生手冊' })
    expect(diff.sources[0].changes?.map((change) => change.field).sort()).toEqual(['locator', 'url'])
  })

  it('summary 是三個區塊的總和，且 summarizeDiff 回同樣的形狀', () => {
    const next = payload({
      sources: [
        { sourceId: 'S113-01', title: '113 新生手冊', url: 'https://example.edu/a.pdf', locator: 'p1' },
        { sourceId: 'S113-02', title: '新增來源', locator: 'p3' },
      ],
      clauses: [
        { clauseId: 'C01', sourceId: 'S113-01', locator: 'p1', text: '總學分至少 12。' },
        { clauseId: 'C02', sourceId: 'S113-01', locator: 'p2', text: '核心至少 6。', reading: '核心' },
        { clauseId: 'C03', sourceId: 'S113-02', locator: 'p3', text: '新增條文。' },
      ],
    })
    const diff = diffPayloads(payload(), next)
    expect(diff.summary).toEqual({ added: 2, removed: 0, changed: 0 })
    expect(summarizeDiff(diff)).toEqual(diff.summary)
  })

  it('未知欄位或格式壞掉的 payload 不會拋錯（視為沒有該區塊）', () => {
    const diff = diffPayloads({ requirements: 'not-an-array' }, { clauses: [{ sourceId: 1 }] })
    expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0 })
  })
})

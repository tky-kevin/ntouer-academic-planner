import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { RuleBundle } from '../../src/engine/ruleEngine.js'
import {
  hashContent,
  parseAuditQuery,
  parseCreateDraftBody,
  parseEmptyBody,
  parsePayloadObject,
  parseRejectBody,
  parseTestBody,
  parseUpdateBody,
  readJsonBody,
  rejectUnknownKeys,
  runBundleTestSuite,
  stableStringify,
} from './validate.js'

function requestWith(chunks: Array<string | Buffer>, maxBytes?: number) {
  const stream = Readable.from(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))))
  return readJsonBody(stream as unknown as IncomingMessage, maxBytes)
}

describe('body 讀取與未知欄位', () => {
  it('合法 JSON、空 body 視為 {}、壞 JSON 回 field=body', async () => {
    await expect(requestWith(['{"a":1}'])).resolves.toEqual({ ok: true, value: { a: 1 } })
    await expect(requestWith([])).resolves.toEqual({ ok: true, value: {} })
    await expect(requestWith(['   '])).resolves.toEqual({ ok: true, value: {} })
    const bad = await requestWith(['{oops'])
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.problems[0].field).toBe('body')
  })

  it('超過上限時拒絕，且不解析', async () => {
    const result = await requestWith(['1234567890'], 5)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0].reason).toContain('位元組上限')
  })

  it('rejectUnknownKeys 逐欄位列出未知欄位', () => {
    expect(rejectUnknownKeys({ a: 1, b: 2 }, ['a'])).toEqual([{ field: 'b', reason: '未知欄位' }])
    expect(rejectUnknownKeys({ a: 1 }, ['a', 'b'])).toEqual([])
  })
})

describe('payload 形狀（parsePayloadObject）', () => {
  it('接受規則包頂層欄位，拒絕未知欄位與錯誤型別', () => {
    const ok = parsePayloadObject({ schemaVersion: '1.0', bundleId: 'cse-113-day', requirements: [] })
    expect(ok.ok).toBe(true)

    const unknown = parsePayloadObject({ schemaVersion: '1.0', extra: true })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.problems[0]).toMatchObject({ field: 'payload.extra' })

    const wrongType = parsePayloadObject({ requirements: 'nope', department: [] })
    expect(wrongType.ok).toBe(false)
    if (!wrongType.ok) {
      expect(wrongType.problems.map((problem) => problem.field)).toEqual(['payload.requirements', 'payload.department'])
    }
  })

  it('payload.bundleId 必須與路徑一致', () => {
    const result = parsePayloadObject({ bundleId: 'mmd-115-day' }, 'cse-113-day')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0].field).toBe('payload.bundleId')
  })

  it('不是物件時拒絕', () => {
    expect(parsePayloadObject(null).ok).toBe(false)
    expect(parsePayloadObject([]).ok).toBe(false)
    expect(parsePayloadObject('x').ok).toBe(false)
  })
})

describe('各端點 body', () => {
  it('建立草稿：payload 可省略，未知欄位拒絕', () => {
    expect(parseCreateDraftBody({}, 'cse-113-day')).toEqual({ ok: true, value: {} })
    const withPayload = parseCreateDraftBody({ payload: { bundleId: 'cse-113-day' } }, 'cse-113-day')
    expect(withPayload.ok).toBe(true)

    const unknown = parseCreateDraftBody({ copyFrom: 'x' }, 'cse-113-day')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.problems).toEqual([{ field: 'copyFrom', reason: '未知欄位' }])
  })

  it('更新草稿：payload 必填且必須是物件', () => {
    expect(parseUpdateBody({}, 'cse-113-day').ok).toBe(false)
    expect(parseUpdateBody({ payload: 'x' }, 'cse-113-day').ok).toBe(false)
    const ok = parseUpdateBody({ payload: { schemaVersion: '1.0' } }, 'cse-113-day')
    expect(ok.ok).toBe(true)
  })

  it('測試：預設空資料與 completed，逐筆檢查 records 型別與列舉', () => {
    expect(parseTestBody({})).toEqual({
      ok: true,
      value: { records: [], scenario: 'completed', statuses: {} },
    })

    const valid = parseTestBody({
      scenario: 'inProgress',
      records: [{ courseCode: 'CS1', credits: 3, status: 'pass', category: 'core', tags: ['core'], owner: 'own' }],
      statuses: { englishThreshold: 'met' },
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) {
      expect(valid.value.records[0]).toMatchObject({ courseCode: 'CS1', credits: 3, status: 'pass', category: 'core' })
      expect(valid.value.statuses).toEqual({ englishThreshold: 'met' })
      expect(valid.value.scenario).toBe('inProgress')
    }

    const bad = parseTestBody({
      scenario: 'done',
      records: [{ courseCode: '', credits: '3', status: 'passed', extra: true }],
      statuses: { englishThreshold: 'yes' },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      const fields = bad.problems.map((problem) => problem.field)
      expect(fields).toContain('scenario')
      expect(fields).toContain('records[0].courseCode')
      expect(fields).toContain('records[0].credits')
      expect(fields).toContain('records[0].status')
      expect(fields).toContain('records[0].extra')
      expect(fields).toContain('statuses.englishThreshold')
    }
  })

  it('退回：reason 必填、去空白、不可超過 2000 字', () => {
    expect(parseRejectBody({ reason: '  條文定位錯誤  ' })).toEqual({ ok: true, value: { reason: '條文定位錯誤' } })
    expect(parseRejectBody({ reason: '   ' }).ok).toBe(false)
    expect(parseRejectBody({ reason: 'x'.repeat(2001) }).ok).toBe(false)
    expect(parseRejectBody({ reason: 'ok', extra: 1 }).ok).toBe(false)
  })

  it('submit／approve／publish／validate 不接受任何欄位', () => {
    expect(parseEmptyBody({})).toEqual({ ok: true, value: {} })
    expect(parseEmptyBody({ status: 'published' }).ok).toBe(false)
    expect(parseEmptyBody(null).ok).toBe(false)
  })
})

describe('稽核查詢參數', () => {
  it('預設 limit=50、cursor 與 versionId 為 null', () => {
    expect(parseAuditQuery(new URL('http://x/api/admin/audit'))).toEqual({
      ok: true,
      value: { limit: 50, cursor: null, versionId: null },
    })
  })

  it('合法 limit／cursor（record_id）／versionId', () => {
    const parsed = parseAuditQuery(new URL('http://x/api/admin/audit?limit=10&cursor=42&versionId=cse-113-day@3'))
    expect(parsed).toEqual({
      ok: true,
      value: { limit: 10, cursor: '42', versionId: 'cse-113-day@3' },
    })
  })

  it('拒絕 offset、超界 limit、非正整數 cursor、壞 versionId 與重複參數', () => {
    for (const search of [
      'offset=10',
      'limit=0',
      'limit=201',
      'limit=abc',
      'cursor=0',
      'cursor=-1',
      'cursor=abc',
      'versionId=cse-113-day',
      'versionId=cse-113-day@0',
      'limit=1&limit=2',
    ]) {
      const parsed = parseAuditQuery(new URL(`http://x/api/admin/audit?${search}`))
      expect(parsed.ok, search).toBe(false)
    }
  })
})

describe('正規化與 content_hash', () => {
  it('物件鍵排序、陣列保序', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}')
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]')
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify('中')).toBe('"中"')
  })

  it('hashContent 是 sha256:<hex>，且與鍵順序無關', () => {
    const canonical = '{"a":[2,{"c":4,"d":3}],"b":1}'
    const expected = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
    expect(hashContent({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(expected)
    expect(hashContent({ a: [2, { c: 4, d: 3 }], b: 1 })).toBe(expected)
    expect(hashContent({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('runBundleTestSuite（/test 的純函式部分）', () => {
  const bundle: RuleBundle = {
    schemaVersion: '1.0',
    bundleId: 'cse-113-day',
    department: { departmentId: 'cse', name: '資訊工程學系' },
    scope: { entryYear: 113 },
    status: 'draft',
    sources: [],
    clauses: [],
    allocation: {
      totalMin: 12,
      precedence: ['core'],
      pools: [{ poolId: 'core', selectors: ['tag:core'] }],
    },
    requirements: [
      { id: 'R01', kind: 'total', name: '總學分', min: 12 },
      { id: 'R02', kind: 'credits', name: '核心 6', min: 6, selectors: ['tag:core'] },
    ],
  }

  it('有帶 records 時用 provided-records 跑，結果一致即全數通過', () => {
    const suite = runBundleTestSuite(
      bundle,
      [{ courseCode: 'CS1', credits: 12, status: 'pass', category: 'core', tags: ['core'] }],
      'completed',
    )
    expect(suite.suite).toBe('provided-records')
    expect(suite.failed).toBe(0)
    expect(suite.overall).toBe('complete')
    expect(suite.totalCredits).toBe(12)
    expect(suite.results.map((result) => result.name)).toContain('overall 三態一致性')
  })

  it('沒帶 records 時是空資料檢核（empty-data）：缺額不算失敗，只檢查一致性', () => {
    const suite = runBundleTestSuite(bundle, [], 'completed')
    expect(suite.suite).toBe('empty-data')
    expect(suite.failed).toBe(0)
    expect(suite.overall).toBe('incomplete')
    expect(suite.totalCredits).toBe(0)
    // R01 與 R02 都應被檢查到，不是只挑 R04。
    expect(suite.results.map((result) => result.name)).toEqual([
      'R01 總學分',
      'R02 核心 6',
      'overall 三態一致性',
    ])
  })

  it('引擎丟錯（未知 requirement kind）時回 failed，而不是讓 route 變 500', () => {
    const broken = {
      ...bundle,
      requirements: [{ id: 'R99', kind: 'nonsense' }],
    } as unknown as RuleBundle
    const suite = runBundleTestSuite(broken, [], 'completed')
    expect(suite.failed).toBe(1)
    expect(suite.results[0]).toMatchObject({ name: 'engine.evaluate', status: 'failed' })
    expect(suite.results[0].detail).toContain('未知的 requirement 種類')
  })

  it('status 節點沒有提供狀態時是 unknown，空資料整體為 unconfirmed', () => {
    const withStatus = {
      ...bundle,
      requirements: [{ id: 'R15', kind: 'status', name: '英文門檻', statusKey: 'englishThreshold' }],
    } as RuleBundle
    const suite = runBundleTestSuite(withStatus, [], 'completed')
    expect(suite.failed).toBe(0)
    expect(suite.overall).toBe('unconfirmed')
  })
})

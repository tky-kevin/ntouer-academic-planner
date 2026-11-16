import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAdminVersion,
  getAudit,
  getDiff,
  publishVersion,
  rejectVersion,
  submitVersion,
  testVersion,
  updateDraft,
  validateVersion,
} from './admin'

const META = { requestId: 'req-1', generatedAt: '2026-11-17T04:00:00+08:00' }

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ data, meta: META }),
  } as unknown as Response
}

function stubFetch(data: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(data))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const calls = fetchMock.mock.calls
  return calls[calls.length - 1] as [string, RequestInit]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('管理端 API 層', () => {
  it('讀版本走 GET，versionId 以 percent-encode 放進路徑', async () => {
    const fetchMock = stubFetch({ versionId: 'cse-113-day@2' })

    await getAdminVersion('cse-113-day@2')

    const [path, init] = lastCall(fetchMock)
    expect(path).toBe('/api/admin/rules/cse-113-day%402')
    expect(init.method).toBeUndefined()
    expect(init.credentials).toBe('same-origin')
  })

  it('validate／submit／publish 是空 body 的 POST；test 預設帶空 records', async () => {
    const fetchMock = stubFetch({})
    await validateVersion('cse-113-day@2')
    expect(lastCall(fetchMock)[0]).toBe('/api/admin/rules/cse-113-day%402/validate')
    expect(lastCall(fetchMock)[1].method).toBe('POST')
    expect(lastCall(fetchMock)[1].body).toBeUndefined()

    await submitVersion('cse-113-day@2')
    expect(lastCall(fetchMock)[0]).toBe('/api/admin/rules/cse-113-day%402/submit')

    await publishVersion('cse-113-day@2')
    expect(lastCall(fetchMock)[0]).toBe('/api/admin/rules/cse-113-day%402/publish')

    fetchMock.mockClear()
    await testVersion('cse-113-day@2')
    expect(lastCall(fetchMock)[1].body).toBe(JSON.stringify({ records: [] }))
  })

  it('reject 帶 reason；updateDraft 帶整份 payload；diff 走 GET', async () => {
    const fetchMock = stubFetch({})
    await rejectVersion('cse-113-day@2', '條文定位錯誤')
    expect(lastCall(fetchMock)[1].body).toBe(JSON.stringify({ reason: '條文定位錯誤' }))

    await updateDraft('cse-113-day@2', { bundleId: 'cse-113-day' })
    expect(lastCall(fetchMock)[0]).toBe('/api/admin/rules/cse-113-day%402')
    expect(lastCall(fetchMock)[1].method).toBe('PUT')
    expect(lastCall(fetchMock)[1].body).toBe(JSON.stringify({ payload: { bundleId: 'cse-113-day' } }))

    await getDiff('cse-113-day@2')
    expect(lastCall(fetchMock)[0]).toBe('/api/admin/rules/cse-113-day%402/diff')
  })

  it('稽核只帶有值的查詢參數，cursor 與 versionId 都 encode', async () => {
    const fetchMock = stubFetch({ items: [], nextCursor: null, limit: 20 })

    await getAudit({ limit: 20, cursor: '15', versionId: 'cse-113-day@2' })
    expect(lastCall(fetchMock)[0]).toBe(
      '/api/admin/audit?limit=20&cursor=15&versionId=cse-113-day%402',
    )

    await getAudit({ versionId: 'cse-113-day@2' })
    expect(lastCall(fetchMock)[0]).toBe('/api/admin/audit?versionId=cse-113-day%402')

    await getAudit()
    expect(lastCall(fetchMock)[0]).toBe('/api/admin/audit')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgressApiError } from '../data/mockProgress'
import { apiFetch } from './client'

const META = { requestId: 'req-1', generatedAt: '2026-11-17T04:00:00+08:00' }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function emptyResponse(status = 204): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => '' } as unknown as Response
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('解析成功 envelope，回傳 data 並帶上 same-origin 與 JSON header', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { totalCredits: 135 }, meta: META }))

    await expect(apiFetch<{ totalCredits: number }>('/api/me/progress?scenario=completed')).resolves.toEqual({
      totalCredits: 135,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/me/progress?scenario=completed')
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('把錯誤 envelope 轉成 ProgressApiError（code／message／requestId／status／retryable）', async () => {
    stubFetch(
      jsonResponse(
        {
          error: { code: 'RULE_BUNDLE_NOT_FOUND', message: '你的系所與入學年度目前沒有已發布的規則版本。', retryable: false },
          meta: { ...META, requestId: 'req-404' },
        },
        404,
      ),
    )

    const error = await apiFetch('/api/me/progress').then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ProgressApiError)
    const apiError = error as ProgressApiError
    expect(apiError.code).toBe('RULE_BUNDLE_NOT_FOUND')
    expect(apiError.message).toBe('你的系所與入學年度目前沒有已發布的規則版本。')
    expect(apiError.requestId).toBe('req-404')
    expect(apiError.status).toBe(404)
    expect(apiError.retryable).toBe(false)
  })

  it('401 讓呼叫端能用 code === AUTH_REQUIRED 辨識', async () => {
    stubFetch(jsonResponse({ error: { code: 'AUTH_REQUIRED', message: '請先登入。', retryable: false }, meta: META }, 401))

    const error = await apiFetch('/api/me/progress').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProgressApiError)
    expect((error as ProgressApiError).code).toBe('AUTH_REQUIRED')
    expect((error as ProgressApiError).status).toBe(401)
  })

  it('非 JSON 回應丟出 INVALID_RESPONSE，不把 HTML 當資料', async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: async () => '<!doctype html><html><body>login</body></html>',
    } as unknown as Response)

    const error = await apiFetch('/api/me/progress').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProgressApiError)
    expect((error as ProgressApiError).code).toBe('INVALID_RESPONSE')
    expect((error as ProgressApiError).status).toBe(200)
  })

  it('非 JSON 的錯誤狀態沿用狀態碼給代碼', async () => {
    stubFetch({ ok: false, status: 502, text: async () => 'Bad Gateway' } as unknown as Response)

    const error = await apiFetch('/api/me/sync/ais').catch((caught: unknown) => caught)

    expect((error as ProgressApiError).code).toBe('INTERNAL')
    expect((error as ProgressApiError).status).toBe(502)
    expect((error as ProgressApiError).retryable).toBe(true)
  })

  it('204 無 body 回傳 undefined（DELETE 取消同步）', async () => {
    const fetchMock = stubFetch(emptyResponse(204))

    await expect(apiFetch<void>('/api/me/sync/ais/sync-1', { method: 'DELETE' })).resolves.toBeUndefined()
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE')
  })

  it('連不上伺服器時是 NETWORK_ERROR，不是未預期例外', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )

    const error = await apiFetch('/api/me/progress').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProgressApiError)
    expect((error as ProgressApiError).code).toBe('NETWORK_ERROR')
  })
})

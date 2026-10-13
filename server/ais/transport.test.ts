import { it, expect, vi } from 'vitest'
import { FetchAisTransport } from './transport.js'
import type { AisRequest } from './upstream/application/ports/ais-transport.js'

const request = (overrides: Partial<AisRequest> = {}): AisRequest => ({ operation: 'fixture-read', method: 'GET', url: new URL('https://ais.ntou.edu.tw/test'), headers: {}, timeoutMs: 1000, maximumResponseBytes: 1024, ...overrides })

it('Cookie 留在 server transport，redirect 後沿用；每個 transport session 隔離', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next', 'set-cookie': 'AISSESSION=synthetic-cookie; Path=/; Secure; HttpOnly' } }))
    .mockImplementation(async () => new Response('OK', { headers: { 'content-type': 'text/html' } }))
  const transport = new FetchAisTransport(fetcher)
  const response = await transport.execute(request({ method: 'POST', body: 'synthetic-login' }))
  expect(fetcher.mock.calls[0]![1]!.redirect).toBe('manual')
  expect(fetcher.mock.calls[1]![1]!.method).toBe('GET')
  expect(fetcher.mock.calls[1]![1]!.body).toBeUndefined()
  expect(new Headers(fetcher.mock.calls[1]![1]!.headers).get('cookie')).toBe('AISSESSION=synthetic-cookie')
  expect(response.headers.get('set-cookie')).toBeNull()
  await new FetchAisTransport(fetcher).execute(request())
  expect(new Headers(fetcher.mock.calls[2]![1]!.headers).get('cookie')).toBeNull()
})

it('跨來源 redirect 不會轉送 Cookie 或 POST 內容', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 307, headers: { location: 'https://example.com/leak', 'set-cookie': 'AISSESSION=private; Path=/; Secure' } }))
  await expect(new FetchAisTransport(fetcher).execute(request({ method: 'POST', body: 'private-login' }))).rejects.toMatchObject({ kind: 'contractChanged', code: 'AIS_REDIRECT_ORIGIN_CHANGED' })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('任意來源與錯誤 limits 在網路前拒絕', async () => {
  const fetcher = vi.fn<typeof fetch>()
  const transport = new FetchAisTransport(fetcher)
  await expect(transport.execute(request({ url: new URL('http://ais.ntou.edu.tw/') }))).rejects.toMatchObject({ code: 'INVALID_AIS_ORIGIN' })
  await expect(transport.execute(request({ maximumResponseBytes: 0 }))).rejects.toMatchObject({ code: 'INVALID_TRANSPORT_LIMITS' })
  expect(fetcher).not.toHaveBeenCalled()
})

it('來自 consumer 的 Cookie/Authorization 不直接轉送', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('OK'))
  await new FetchAisTransport(fetcher).execute(request({ headers: { cookie: 'untrusted=secret', authorization: 'Bearer secret' } }))
  const headers = new Headers(fetcher.mock.calls[0]![1]!.headers)
  expect(headers.get('cookie')).toBeNull()
  expect(headers.get('authorization')).toBeNull()
  expect(fetcher.mock.calls[0]![1]!.cache).toBe('no-store')
})

it('無 content-length 的過大串流也會中止', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('a'.repeat(2000)))
  await expect(new FetchAisTransport(fetcher).execute(request())).rejects.toMatchObject({ code: 'AIS_RESPONSE_TOO_LARGE' })
})

it('redirect 次數有上限', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/again' } }))
  await expect(new FetchAisTransport(fetcher).execute(request())).rejects.toMatchObject({ code: 'AIS_REDIRECT_LIMIT' })
  expect(fetcher).toHaveBeenCalledTimes(6)
})

it('timeout 會 abort 請求，錯誤不包含上游 URL 或私人資料', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new Error('PRIVATE upstream diagnostic')), { once: true })
  }))
  await expect(new FetchAisTransport(fetcher).execute(request({ timeoutMs: 10 }))).rejects.toMatchObject({ kind: 'externalUnavailable', code: 'AIS_TIMEOUT', message: 'AIS_TIMEOUT' })
})

it('HTTP 失敗的 status 保留交由 service 分類，set-cookie 不輸出', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream unavailable', { status: 503, headers: { 'set-cookie': 'state=synthetic; Path=/' } }))
  const response = await new FetchAisTransport(fetcher).execute(request())
  expect(response.status).toBe(503)
  expect(response.headers.get('set-cookie')).toBeNull()
})

import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from './app.js'
import type { QueryFn, Route } from './app.js'

const silent = { info: () => undefined, error: () => undefined }
const open: Server[] = []

async function start(query: QueryFn, routes: Route[] = []): Promise<string> {
  const server = createServer(createApp({ query, routes, logger: silent }))
  open.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  await Promise.all(
    open.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  )
})

const queryOk: QueryFn = async () => ({ rows: [] })
const queryDown: QueryFn = async () => {
  throw new Error('ECONNREFUSED 127.0.0.1:5433')
}

describe('統一 envelope 與 /healthz', () => {
  it('資料庫可用時回 200 與 data.db = ok', async () => {
    const base = await start(queryOk)
    const response = await fetch(`${base}/healthz`)
    const body = (await response.json()) as { data: { db: string }; meta: { requestId: string; generatedAt: string } }

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ db: 'ok' })
    expect(body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.meta.generatedAt).toMatch(/[+-]\d{2}:\d{2}$/)
    expect(response.headers.get('x-request-id')).toBe(body.meta.requestId)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
  })

  it('資料庫斷線時回 503 INTERNAL 且可重試', async () => {
    const base = await start(queryDown)
    const response = await fetch(`${base}/healthz`)
    const body = (await response.json()) as {
      error: { code: string; message: string; retryable: boolean }
      meta: { requestId: string }
    }

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('INTERNAL')
    expect(body.error.retryable).toBe(true)
    expect(body.error.message).toContain('資料庫')
    expect(body.meta.requestId).toBeTruthy()
    expect(response.headers.get('x-request-id')).toBe(body.meta.requestId)
  })

  it('未知路徑回 404 RESOURCE_NOT_FOUND，形狀與成功回應一致', async () => {
    const base = await start(queryOk)
    const response = await fetch(`${base}/nope`)
    const body = (await response.json()) as { error: { code: string; retryable: boolean }; meta: object }

    expect(response.status).toBe(404)
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND')
    expect(body.error.retryable).toBe(false)
    expect(body.meta).toBeTruthy()
  })

  it('可掛載額外路由（#22 的擴充點）', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/ping',
        handler: ({ requestId }) => ({ status: 200, body: { data: { pong: true }, meta: { requestId, generatedAt: 'x' } } }),
      },
    ]
    const base = await start(queryOk, routes)
    const response = await fetch(`${base}/api/ping`)
    const body = (await response.json()) as { data: { pong: boolean } }

    expect(response.status).toBe(200)
    expect(body.data.pong).toBe(true)
  })

  it('路由拋錯時回 500 INTERNAL，不洩漏錯誤內容', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/boom',
        handler: () => {
          throw new Error('secret sql detail')
        },
      },
    ]
    const base = await start(queryOk, routes)
    const response = await fetch(`${base}/api/boom`)
    const text = await response.text()

    expect(response.status).toBe(500)
    expect(text).toContain('INTERNAL')
    expect(text).not.toContain('secret sql detail')
  })
})

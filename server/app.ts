// HTTP 應用本體：node:http、無框架。路由表是資料，不是 if/else 串；
// 之後的 `/auth/*`（#22）與管理端端點只要 push 進 `routes`，不必動這裡的 envelope。
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fail, makeMeta, ok } from './http/envelope.js'

export type QueryResult = { rows: unknown[] }
export type QueryFn = (text: string, params?: readonly unknown[]) => Promise<QueryResult>

export interface Reply {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface RouteContext {
  req: IncomingMessage
  url: URL
  requestId: string
  query: QueryFn
  /** 路徑參數（`/api/rules/:versionId` → `{ versionId }`），已 decode。 */
  params: Record<string, string>
}

export interface Route {
  method: string
  /** 完全相符；結尾 `*` 代表前綴相符（例如 `/api/admin/*`）。 */
  path: string
  handler: (ctx: RouteContext) => Promise<Reply> | Reply
}

export interface Logger {
  info: (line: string) => void
  error: (line: string) => void
}

export interface AppOptions {
  query: QueryFn
  routes?: Route[]
  logger?: Logger
}

export type App = (req: IncomingMessage, res: ServerResponse) => Promise<void>

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern.endsWith('*')) {
    return pathname.startsWith(pattern.slice(0, -1)) ? {} : null
  }
  const patternParts = pattern.split('/')
  const pathParts = pathname.split('/')
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]
    const actual = pathParts[index]
    if (expected.startsWith(':')) {
      if (!actual) return null
      try {
        params[expected.slice(1)] = decodeURIComponent(actual)
      } catch {
        return null
      }
    } else if (expected !== actual) {
      return null
    }
  }
  return params
}

function send(res: ServerResponse, requestId: string, reply: Reply): void {
  const payload = JSON.stringify(reply.body)
  res.writeHead(reply.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload)),
    'X-Request-Id': requestId,
    ...reply.headers,
  })
  res.end(payload)
}

export function createApp({ query, routes = [], logger = console }: AppOptions): App {
  const health: Route = {
    method: 'GET',
    path: '/healthz',
    handler: async ({ requestId }) => {
      const headers = { 'Cache-Control': 'no-store' }
      try {
        await query('select 1')
        return { status: 200, body: ok({ db: 'ok' }, makeMeta(requestId)), headers }
      } catch {
        return {
          status: 503,
          body: fail(
            { code: 'INTERNAL', message: '資料庫目前無法連線，請稍後再試。', retryable: true },
            makeMeta(requestId),
          ),
          headers,
        }
      }
    },
  }

  const table = [health, ...routes]

  return async function handle(req, res) {
    const requestId = randomUUID()
    const startedAt = Date.now()
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    let reply: Reply

    try {
      let params: Record<string, string> | null = null
      const route = table.find((candidate) => {
        if (candidate.method !== req.method) return false
        params = matchPath(candidate.path, url.pathname)
        return params !== null
      })
      reply = route
        ? await route.handler({ req, url, requestId, query, params: params ?? {} })
        : {
            status: 404,
            body: fail(
              { code: 'RESOURCE_NOT_FOUND', message: `找不到路徑 ${url.pathname}。`, retryable: false },
              makeMeta(requestId),
            ),
          }
    } catch (error) {
      reply = {
        status: 500,
        body: fail(
          { code: 'INTERNAL', message: '伺服器發生未預期的錯誤，請帶著 requestId 回報。', retryable: true },
          makeMeta(requestId),
        ),
      }
      logger.error(
        JSON.stringify({
          level: 'error',
          requestId,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    }

    send(res, requestId, reply)
    logger.info(
      JSON.stringify({
        level: 'info',
        requestId,
        method: req.method,
        path: url.pathname,
        status: reply.status,
        durationMs: Date.now() - startedAt,
      }),
    )
  }
}

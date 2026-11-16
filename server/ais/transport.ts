import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CookieJar } from 'tough-cookie'
import type { AisRequest, AisResponse, AisTransport, AisTransportFactory } from './upstream/application/ports/ais-transport.js'
import { PlannerAisError } from './errors.js'

const origin = 'https://ais.ntou.edu.tw'

/**
 * 除錯用：`AIS_DEBUG_DUMP=<目錄>` 時把每個 AIS 回應的 body 存檔（不含 cookie／header）。
 * 只在「頁面改版導致 contractChanged」時用；內容含個人成績，目錄必須在 gitignore 內（預設 tmp/）。
 * 平常不設，這個函式直接 no-op。
 */
function dumpResponse(request: AisRequest, status: number, bytes: Uint8Array): void {
  const dir = process.env.AIS_DEBUG_DUMP?.trim()
  if (!dir) return
  try {
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeOperation = request.operation.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
    const file = path.join(dir, `${stamp}-${String(status)}-${safeOperation}.txt`)
    const header = `# operation=${request.operation}\n# url=${request.url.href}\n# status=${status}\n\n`
    writeFileSync(file, header + Buffer.from(bytes).toString('utf8'), 'utf8')
  } catch {
    // 除錯輸出失敗不影響同步。
  }
}

/** 請求失敗（timeout／連線錯誤）沒有 response 可以 dump，改記一行錯誤中繼資料。 */
function dumpFailure(request: AisRequest, code: string): void {
  const dir = process.env.AIS_DEBUG_DUMP?.trim()
  if (!dir) return
  try {
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeOperation = request.operation.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
    writeFileSync(
      path.join(dir, `${stamp}-error-${safeOperation}.txt`),
      `# operation=${request.operation}\n# method=${request.method}\n# url=${request.url.href}\n# timeoutMs=${request.timeoutMs}\n# error=${code}\n`,
      'utf8',
    )
  } catch {
    // 除錯輸出失敗不影響流程。
  }
}

/** Server-only, one CookieJar per session. Cookies/HTML are never part of Planner snapshots. */
export class FetchAisTransport implements AisTransport {
  private readonly jar = new CookieJar()
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async execute(request: AisRequest): Promise<AisResponse> {
    if (request.url.origin !== origin) throw new PlannerAisError('invalidRequest', 'INVALID_AIS_ORIGIN')
    if (!(request.timeoutMs > 0) || !(request.maximumResponseBytes > 0)) throw new PlannerAisError('invalidRequest', 'INVALID_TRANSPORT_LIMITS')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), request.timeoutMs)
    let url = request.url
    let method = request.method
    let body = request.body
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (url.origin !== origin || url.username || url.password) throw new PlannerAisError('contractChanged', 'AIS_REDIRECT_ORIGIN_CHANGED')
        const headers = new Headers(request.headers)
        headers.delete('cookie')
        headers.delete('authorization')
        headers.set('user-agent', 'NTOUER-Academic-Planner/0.1')
        const cookies = await this.jar.getCookieString(url.href)
        if (cookies) headers.set('cookie', cookies)
        const response = await this.fetcher(url, { method, headers, ...(method === 'POST' && body !== undefined ? { body } : {}), redirect: 'manual', signal: controller.signal, cache: 'no-store' })
        for (const cookie of response.headers.getSetCookie()) await this.jar.setCookie(cookie, url.href)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel()
          const location = response.headers.get('location')
          if (!location || redirects === 5) throw new PlannerAisError('contractChanged', 'AIS_REDIRECT_LIMIT')
          const next = new URL(location, url)
          if (next.origin !== origin) throw new PlannerAisError('contractChanged', 'AIS_REDIRECT_ORIGIN_CHANGED')
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
            method = 'GET'
            body = undefined
          }
          url = next
          continue
        }
        const contentLength = Number(response.headers.get('content-length'))
        if (contentLength > request.maximumResponseBytes) {
          await response.body?.cancel()
          throw new PlannerAisError('contractChanged', 'AIS_RESPONSE_TOO_LARGE')
        }
        const reader = response.body?.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.length
            if (length > request.maximumResponseBytes) {
              await reader.cancel()
              throw new PlannerAisError('contractChanged', 'AIS_RESPONSE_TOO_LARGE')
            }
            chunks.push(value)
          }
        }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        // Cookies are internal even at the transport boundary.
        dumpResponse(request, response.status, bytes)
        const safeHeaders = new Headers(response.headers)
        safeHeaders.delete('set-cookie')
        return { status: response.status, headers: safeHeaders, body: bytes }
      }
      throw new PlannerAisError('contractChanged', 'AIS_REDIRECT_LIMIT')
    } catch (error) {
      if (error instanceof PlannerAisError) {
        dumpFailure(request, error.code)
        throw error
      }
      const code = controller.signal.aborted ? 'AIS_TIMEOUT' : 'AIS_FETCH_FAILED'
      dumpFailure(request, code)
      throw new PlannerAisError('externalUnavailable', code, true)
    } finally { clearTimeout(timer) }
  }
}

export class FetchAisTransportFactory implements AisTransportFactory {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  create(): AisTransport { return new FetchAisTransport(this.fetcher) }
}

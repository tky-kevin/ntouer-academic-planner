import { CookieJar } from 'tough-cookie'
import type { AisRequest, AisResponse, AisTransport, AisTransportFactory } from './upstream/application/ports/ais-transport.js'
import { PlannerAisError } from './errors.js'

const origin = 'https://ais.ntou.edu.tw'

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
        const safeHeaders = new Headers(response.headers)
        safeHeaders.delete('set-cookie')
        return { status: response.status, headers: safeHeaders, body: bytes }
      }
      throw new PlannerAisError('contractChanged', 'AIS_REDIRECT_LIMIT')
    } catch (error) {
      if (error instanceof PlannerAisError) throw error
      throw new PlannerAisError('externalUnavailable', controller.signal.aborted ? 'AIS_TIMEOUT' : 'AIS_FETCH_FAILED', true)
    } finally { clearTimeout(timer) }
  }
}

export class FetchAisTransportFactory implements AisTransportFactory {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  create(): AisTransport { return new FetchAisTransport(this.fetcher) }
}

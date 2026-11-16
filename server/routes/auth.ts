// Google OIDC 的三個路由：start／callback／session（GET＋DELETE）。
// 規格：docs/design/api-spec.md §6.1、§7.1、§7.2；流程：system-design.md §14。
import type { IncomingMessage } from 'node:http'
import type { QueryFn, Reply, Route, RouteContext } from '../app.js'
import { fail, isoNow, makeMeta, ok } from '../http/envelope.js'
import { clearCookie, parseCookies, serializeCookie } from '../http/cookies.js'
import {
  assertStateMatches,
  buildAuthorizationUrl,
  createNonce,
  createPkcePair,
  readStateCookie,
  signStateCookie,
  verifyIdToken,
} from '../auth/oidc.js'
import type { IdTokenClaims } from '../auth/oidc.js'
import { createSession, readSession, revokeSession } from '../auth/session.js'
import { loadDeptScopes } from '../authz/can.js'

export interface AuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  sessionSecret: string
  /** 只有 HTTPS（或 production）才加 Secure；本機 http 加了瀏覽器會收不到。 */
  secureCookies: boolean
}

export interface AuthRouteOptions {
  query: QueryFn
  config: AuthConfig
  fetchImpl?: typeof fetch
}

const SESSION_COOKIE = 'planner_session'
const STATE_COOKIE = 'planner_oauth'
const SESSION_MAX_AGE = 7 * 24 * 60 * 60
const STATE_MAX_AGE = 5 * 60
const STATE_COOKIE_PATH = '/auth'

function unauthorized(requestId: string): Reply {
  return {
    status: 401,
    body: fail({ code: 'AUTH_REQUIRED', message: '請先登入。', retryable: false }, makeMeta(requestId)),
    headers: { 'Cache-Control': 'no-store' },
  }
}

function redirect(location: string, headers: Record<string, string | string[]> = {}): Reply {
  return { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } }
}

function cookieOptions(config: AuthConfig, maxAgeSeconds: number, path = '/') {
  return {
    maxAgeSeconds,
    path,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax' as const,
  }
}

// 變更類請求的 Origin 檢查（api-spec §2）。瀏覽器一定會帶 Origin；curl 沒有時放行，
// 但 Authorization 不靠這個，cookie 仍是 HttpOnly＋SameSite=Lax。
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function createAuthRoutes({ query, config, fetchImpl = fetch }: AuthRouteOptions): Route[] {
  return [
    {
      method: 'GET',
      path: '/auth/google/start',
      handler: async ({ requestId }) => {
        if (!config.clientId || !config.clientSecret) {
          return {
            status: 500,
            body: fail({ code: 'INTERNAL', message: 'OIDC 尚未設定。', retryable: false }, makeMeta(requestId)),
          }
        }
        const { verifier, challenge } = createPkcePair()
        const state = createNonce()
        const nonce = createNonce()
        const location = buildAuthorizationUrl({ config, state, codeChallenge: challenge, nonce })
        const stateCookie = signStateCookie(
          { state, verifier, nonce, expiresAt: Date.now() + STATE_MAX_AGE * 1000 },
          config.sessionSecret,
        )
        return redirect(location, {
          'Set-Cookie': serializeCookie(STATE_COOKIE, stateCookie, cookieOptions(config, STATE_MAX_AGE, STATE_COOKIE_PATH)),
        })
      },
    },
    {
      method: 'GET',
      path: '/auth/callback',
      handler: async (ctx: RouteContext) => {
        const { url, requestId, req } = ctx
        const cookies = parseCookies(req.headers.cookie)
        const stateCookie = readStateCookie(cookies[STATE_COOKIE], config.sessionSecret)
        if (!stateCookie) return redirect('/login-failed')

        const error = url.searchParams.get('error')
        if (error) return redirect('/login-failed')

        try {
          assertStateMatches(stateCookie.state, url.searchParams.get('state'))
        } catch {
          return redirect('/login-failed')
        }

        const code = url.searchParams.get('code')
        if (!code) return redirect('/login-failed')

        let idToken: string | undefined
        try {
          const response = await fetchImpl('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: config.clientId,
              client_secret: config.clientSecret,
              redirect_uri: config.redirectUri,
              grant_type: 'authorization_code',
              code_verifier: stateCookie.verifier,
            }),
          })
          if (!response.ok) return redirect('/login-failed')
          const body = (await response.json()) as { id_token?: string }
          idToken = body.id_token
        } catch {
          return redirect('/login-failed')
        }
        if (!idToken) return redirect('/login-failed')

        let claims: IdTokenClaims
        try {
          claims = await verifyIdToken(idToken, { clientId: config.clientId, nonce: stateCookie.nonce })
        } catch (caught) {
          console.error(
            JSON.stringify({
              level: 'error',
              requestId,
              message: `id token 驗證失敗：${caught instanceof Error ? caught.message : 'unknown'}`,
            }),
          )
          return redirect('/login-failed')
        }

        const users = await query(
          `insert into users (google_sub, email, last_login_at)
           values ($1, $2, now())
           on conflict (google_sub) do update set email = excluded.email, last_login_at = now()
           returning user_id`,
          [claims.sub, claims.email ?? `${claims.sub}@unknown`],
        )
        const userId = (users.rows[0] as { user_id: string }).user_id
        const session = await createSession(query, userId, req.headers['user-agent'] ?? null)

        return redirect('/', {
          'Set-Cookie': [
            serializeCookie(SESSION_COOKIE, session.token, cookieOptions(config, SESSION_MAX_AGE)),
            clearCookie(STATE_COOKIE, cookieOptions(config, 0, STATE_COOKIE_PATH)),
          ],
        })
      },
    },
    {
      method: 'GET',
      path: '/auth/session',
      handler: async ({ req, requestId }) => {
        const cookies = parseCookies(req.headers.cookie)
        const token = cookies[SESSION_COOKIE]
        if (!token) return unauthorized(requestId)
        const session = await readSession(query, token)
        if (!session) return unauthorized(requestId)
        const deptScopes = session.role === 'sysadmin' ? [] : await loadDeptScopes(query, session.userId)

        return {
          status: 200,
          body: ok(
            {
              user: { userId: session.userId, email: session.email, displayName: null },
              role: session.role,
              deptScopes,
              expiresAt: isoNow(session.expiresAt),
            },
            makeMeta(requestId),
          ),
          headers: { 'Cache-Control': 'no-store' },
        }
      },
    },
    {
      method: 'DELETE',
      path: '/auth/session',
      handler: async ({ req, requestId }) => {
        if (!sameOrigin(req)) {
          return {
            status: 403,
            body: fail(
              { code: 'AUTH_ORIGIN_MISMATCH', message: '請求來源與站台不同源。', retryable: false },
              makeMeta(requestId),
            ),
            headers: { 'Cache-Control': 'no-store' },
          }
        }
        const cookies = parseCookies(req.headers.cookie)
        const token = cookies[SESSION_COOKIE]
        if (!token || !(await readSession(query, token))) return unauthorized(requestId)
        await revokeSession(query, token)
        return {
          status: 204,
          headers: {
            'Set-Cookie': clearCookie(SESSION_COOKIE, cookieOptions(config, 0)),
            'Cache-Control': 'no-store',
          },
        }
      },
    },
  ]
}

// 需要真實 PostgreSQL：`npm run test:db`。Google 的 token 端點不連（start 只產生網址）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Pool } from 'pg'
import { createApp } from '../app.js'
import type { QueryFn } from '../app.js'
import { createAuthRoutes } from './auth.js'
import { createSession } from '../auth/session.js'
import { loadDotEnv, readConfig } from '../env.js'

const silent = { info: () => undefined, error: () => undefined }
const config = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:3000/auth/callback',
  sessionSecret: 'test-session-secret',
  secureCookies: false,
}

let pool: Pool
let query: QueryFn
let server: Server | undefined
let base = ''
let userId: string

beforeAll(async () => {
  loadDotEnv()
  pool = new Pool({ connectionString: readConfig().databaseUrl, connectionTimeoutMillis: 2_000 })
  query = async (text, params) => {
    const result = await pool.query(text, params ? [...params] : undefined)
    return { rows: result.rows }
  }
  const rows = await pool.query("select user_id from users where google_sub = 'dev-student'")
  if (rows.rowCount === 0) throw new Error('需要先跑 `npm run db:migrate` 與 `npm run db:seed`')
  userId = rows.rows[0].user_id

  server = createServer(createApp({ query, routes: createAuthRoutes({ query, config }), logger: silent }))
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  if (userId) await pool.query('delete from sessions where user_id = $1', [userId])
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await pool?.end()
})

async function cookieFor(): Promise<string> {
  const { token } = await createSession(query, userId)
  return `planner_session=${token}`
}

describe('OIDC／工作階段路由', () => {
  it('未登入 GET /auth/session → 401 AUTH_REQUIRED', async () => {
    const response = await fetch(`${base}/auth/session`)
    expect(response.status).toBe(401)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('AUTH_REQUIRED')
  })

  it('/auth/google/start → 302 到 accounts.google.com，並帶簽章 state cookie', async () => {
    const response = await fetch(`${base}/auth/google/start`, { redirect: 'manual' })
    const location = response.headers.get('location') ?? ''
    const setCookie = response.headers.get('set-cookie') ?? ''

    expect(response.status).toBe(302)
    expect(location.startsWith('https://accounts.google.com/')).toBe(true)
    expect(location).toContain('code_challenge=')
    expect(location).toContain('state=')
    expect(setCookie).toContain('planner_oauth=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
  })

  it('有效 cookie → GET 200（role、deptScopes、no-store），DELETE → 204 後同一 cookie 401', async () => {
    const cookie = await cookieFor()
    const session = await fetch(`${base}/auth/session`, { headers: { Cookie: cookie } })
    const body = (await session.json()) as { data: { role: string; deptScopes: string[]; user: { email: string } } }

    expect(session.status).toBe(200)
    expect(body.data.role).toBe('student')
    expect(body.data.deptScopes).toEqual([])
    expect(body.data.user.email).toBe('dev-student@example.edu')
    expect(session.headers.get('cache-control')).toBe('no-store')

    const logout = await fetch(`${base}/auth/session`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: base },
    })
    expect(logout.status).toBe(204)

    const after = await fetch(`${base}/auth/session`, { headers: { Cookie: cookie } })
    expect(after.status).toBe(401)
  })

  it('不同源的 DELETE → 403 AUTH_ORIGIN_MISMATCH，且 session 不被撤銷', async () => {
    const cookie = await cookieFor()
    const response = await fetch(`${base}/auth/session`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: 'http://evil.example' },
    })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('AUTH_ORIGIN_MISMATCH')

    const still = await fetch(`${base}/auth/session`, { headers: { Cookie: cookie } })
    expect(still.status).toBe(200)
  })
})

// 請求身分解析：真實 session 優先，其次（僅非 production）才用 DEV_USER_SUB 替身。
// api-spec §2：cookie 工作階段是唯一認證方式；DEV_USER_SUB 只是本機開發的臨時身分。
import type { IncomingMessage } from 'node:http'
import type { QueryFn } from '../app.js'
import { parseCookies } from '../http/cookies.js'
import { readSession } from './session.js'

export const SESSION_COOKIE = 'planner_session'

export interface Identity {
  userId: string
  email: string
  role: 'student' | 'sysadmin'
  googleSub: string
  /** `session`＝真的登入；`dev`＝本機替身，畫面上必須標示。 */
  source: 'session' | 'dev'
}

export interface IdentityOptions {
  devUserSub?: string
  nodeEnv?: string
}

interface UserRow {
  user_id: string
  email: string
  role: 'student' | 'sysadmin'
  google_sub: string
}

/**
 * 顯示名稱與系所不在此查；需要時再由各自的 route 撈，避免每次請求多打一次 join。
 *
 * 規則：
 * 1. 有 cookie → 只認真實 session；session 無效就回 null（**不**退回開發身分，
 *    否則被撤銷的 session 會默默變成 dev 使用者）。
 * 2. 沒 cookie 且 NODE_ENV !== 'production' 且設了 DEV_USER_SUB → 用該 users 列。
 * 3. 其餘一律 null（呼叫端回 401 AUTH_REQUIRED）。
 */
export async function resolveIdentity(
  req: IncomingMessage,
  query: QueryFn,
  options: IdentityOptions = {},
): Promise<Identity | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  if (token) {
    const session = await readSession(query, token)
    if (!session) return null
    return {
      userId: session.userId,
      email: session.email,
      role: session.role,
      googleSub: session.googleSub,
      source: 'session',
    }
  }

  const devUserSub = options.devUserSub?.trim()
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development'
  if (!devUserSub || nodeEnv === 'production') return null

  const result = await query(`select user_id, email, role, google_sub from users where google_sub = $1`, [devUserSub])
  const row = result.rows[0] as UserRow | undefined
  if (!row) return null
  return { userId: row.user_id, email: row.email, role: row.role, googleSub: row.google_sub, source: 'dev' }
}

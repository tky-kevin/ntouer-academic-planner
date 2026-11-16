// 工作階段：只把 token 的 SHA-256 寫進 sessions（ADR-0003、api-spec §2）。
import { createHash, randomBytes } from 'node:crypto'
import type { QueryFn } from '../app.js'

export interface SessionRecord {
  userId: string
  email: string
  role: 'student' | 'sysadmin'
  googleSub: string
  expiresAt: Date
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const SESSION_TTL_DAYS = 7

export async function createSession(
  query: QueryFn,
  userId: string,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const result = await query(
    `insert into sessions (token_hash, user_id, expires_at, user_agent)
     values ($1, $2, now() + ($3 || ' days')::interval, $4)
     returning expires_at`,
    [hashToken(token), userId, String(SESSION_TTL_DAYS), userAgent ?? null],
  )
  const expiresAt = (result.rows[0] as { expires_at: Date }).expires_at
  return { token, expiresAt }
}

export async function readSession(query: QueryFn, token: string): Promise<SessionRecord | null> {
  const result = await query(
    `select s.user_id, s.expires_at, u.email, u.role, u.google_sub
       from sessions s
       join users u on u.user_id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()`,
    [hashToken(token)],
  )
  const row = result.rows[0] as
    | { user_id: string; expires_at: Date; email: string; role: 'student' | 'sysadmin'; google_sub: string }
    | undefined
  if (!row) return null
  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    googleSub: row.google_sub,
    expiresAt: row.expires_at,
  }
}

export async function revokeSession(query: QueryFn, token: string): Promise<boolean> {
  const result = await query(
    `update sessions set revoked_at = now()
      where token_hash = $1 and revoked_at is null
      returning token_hash`,
    [hashToken(token)],
  )
  return result.rows.length > 0
}

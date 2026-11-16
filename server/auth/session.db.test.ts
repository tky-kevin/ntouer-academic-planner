// 需要真實 PostgreSQL：`npm run test:db`。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createSession, hashToken, readSession, revokeSession } from './session.js'
import type { QueryFn } from '../app.js'
import { loadDotEnv, readConfig } from '../env.js'

let pool: Pool
let query: QueryFn
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
})

afterAll(async () => {
  if (userId) await pool.query('delete from sessions where user_id = $1', [userId])
  await pool?.end()
})

describe('工作階段', () => {
  it('資料庫只保存 token 的 SHA-256', async () => {
    const { token } = await createSession(query, userId)
    const stored = await pool.query('select token_hash from sessions where token_hash = $1', [hashToken(token)])
    expect(stored.rowCount).toBe(1)
    expect(hashToken(token)).not.toBe(token)
    const raw = await pool.query('select 1 from sessions where token_hash = $1', [token])
    expect(raw.rowCount).toBe(0)
  })

  it('revoked_at 之後查不到工作階段', async () => {
    const { token } = await createSession(query, userId)
    expect(await readSession(query, token)).not.toBeNull()
    expect(await revokeSession(query, token)).toBe(true)
    expect(await readSession(query, token)).toBeNull()
    const stored = await pool.query('select revoked_at from sessions where token_hash = $1', [hashToken(token)])
    expect(stored.rows[0].revoked_at).not.toBeNull()
  })

  it('過期的 session 查不到', async () => {
    const { token } = await createSession(query, userId)
    await pool.query("update sessions set expires_at = now() - interval '1 hour' where token_hash = $1", [
      hashToken(token),
    ])
    expect(await readSession(query, token)).toBeNull()
  })
})

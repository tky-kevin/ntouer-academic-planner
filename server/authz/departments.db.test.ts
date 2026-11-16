// 需要真實 PostgreSQL：`npm run test:db`。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { countActiveDeptAdmins, loadDeptScopes } from './can.js'
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

  await pool.query(
    `insert into department_admins (dept_id, user_id, granted_by)
     values ('cse', $1, $1)
     on conflict (dept_id, user_id) do update set revoked_at = null, revoked_by = null`,
    [userId],
  )
})

afterAll(async () => {
  if (userId) await pool.query('delete from department_admins where user_id = $1', [userId])
  await pool?.end()
})

describe('系所範圍（department_admins）', () => {
  it('有效指派會被算進 deptScopes 與 countActiveDeptAdmins', async () => {
    expect(await loadDeptScopes(query, userId)).toContain('cse')
    expect(await countActiveDeptAdmins(query, 'cse')).toBeGreaterThanOrEqual(1)
  })

  it('撤銷後（revoked_at 非 null）立即不算有效，也不快取', async () => {
    await pool.query('update department_admins set revoked_at = now() where user_id = $1', [userId])
    expect(await loadDeptScopes(query, userId)).toEqual([])
    expect(await countActiveDeptAdmins(query, 'cse')).toBe(0)
  })
})

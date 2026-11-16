// 需要真實 PostgreSQL：`npm run test:db`。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { countActiveDeptAdmins, loadDeptScopes } from './can.js'
import type { QueryFn } from '../app.js'
import { loadDotEnv, readConfig } from '../env.js'

let pool: Pool
let query: QueryFn
let userId: string
// db/seed 另外種了 cse 的 dev-admin；這個測試驗的是「撤銷後 count 歸零」，
// 先把它暫時移開，afterAll 原樣放回，避免改動 seed 的狀態。
let otherCseAdmins: Array<{
  dept_id: string
  user_id: string
  granted_by: string
  granted_at: Date
  revoked_at: Date | null
  revoked_by: string | null
}> = []

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

  otherCseAdmins = (
    await pool.query(
      `select dept_id, user_id, granted_by, granted_at, revoked_at, revoked_by
         from department_admins
        where dept_id = 'cse' and user_id <> $1`,
      [userId],
    )
  ).rows
  await pool.query('delete from department_admins where dept_id = $1 and user_id <> $2', ['cse', userId])

  await pool.query(
    `insert into department_admins (dept_id, user_id, granted_by)
     values ('cse', $1, $1)
     on conflict (dept_id, user_id) do update set revoked_at = null, revoked_by = null`,
    [userId],
  )
})

afterAll(async () => {
  if (userId) await pool.query('delete from department_admins where user_id = $1', [userId])
  for (const admin of otherCseAdmins) {
    await pool.query(
      `insert into department_admins (dept_id, user_id, granted_by, granted_at, revoked_at, revoked_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (dept_id, user_id) do update
         set granted_by = excluded.granted_by, granted_at = excluded.granted_at,
             revoked_at = excluded.revoked_at, revoked_by = excluded.revoked_by`,
      [admin.dept_id, admin.user_id, admin.granted_by, admin.granted_at, admin.revoked_at, admin.revoked_by],
    )
  }
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

// 真實 PostgreSQL：AIS 同步的寫入路徑（upsert、previous_raw、清掉已不存在的紀錄、同步狀態）。
// 跑法：`npm run test:db`（需要 docker compose 的 db 與已套用的遷移）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import type { QueryFn } from '../app.js'
import { loadDotEnv, readConfig } from '../env.js'
import { persistSync, recordSyncFailure } from '../ais/persist.js'
import type { SyncRecord } from '../ais/sync.js'

let pool: Pool
let query: QueryFn
const userId = '11111111-1111-4111-8111-111111111111'

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    recordKey: 'ais:grade:1141-B5701-A',
    courseCode: '微積分(上)',
    courseName: '微積分（上）',
    credits: 3,
    category: 'REQ',
    status: 'passed',
    term: '1141',
    tags: [],
    owner: 'own',
    raw: { source: 'grades', score: '88' },
    ...overrides,
  }
}

beforeAll(async () => {
  loadDotEnv()
  pool = new Pool({ connectionString: readConfig().databaseUrl, connectionTimeoutMillis: 2_000 })
  query = async (text, params) => {
    const result = await pool.query(text, params ? [...params] : undefined)
    return { rows: result.rows }
  }
  await pool.query('delete from users where user_id = $1::uuid', [userId])
  await pool.query(
    `insert into users (user_id, google_sub, email, role) values ($1::uuid, 'persist-db-test', 'persist@test.local', 'student')`,
    [userId],
  )
})

afterAll(async () => {
  await pool?.query('delete from users where user_id = $1::uuid', [userId])
  await pool?.end()
})

describe('persistSync（真實資料庫）', () => {
  it('第一次同步寫入紀錄與 last_success_at', async () => {
    const result = await persistSync({
      query,
      userId,
      records: [record(), record({ recordKey: 'ais:grade:1141-B9999-A', courseCode: 'B9999', courseName: '機器學習', credits: 3, category: 'unknown' })],
      departmentName: null,
      syncedAt: new Date().toISOString(),
    })
    expect(result.insertedOrUpdated).toBe(2)

    const rows = await pool.query(
      `select record_key, course_code, credits, category, status from student_records where user_id = $1::uuid order by record_key`,
      [userId],
    )
    expect(rows.rowCount).toBe(2)
    const byKey = new Map(rows.rows.map((row) => [row.record_key as string, row]))
    expect(byKey.get('ais:grade:1141-B9999-A')?.course_code).toBe('B9999')
    expect(Number(byKey.get('ais:grade:1141-B5701-A')?.credits)).toBe(3)

    const state = await pool.query(`select last_result, last_success_at from student_sync_state where user_id = $1::uuid`, [userId])
    expect(state.rows[0].last_result).toBe('ok')
    expect(state.rows[0].last_success_at).not.toBeNull()
  })

  it('第二次同步把舊值放進 previous_raw，並移除 AIS 已沒有的紀錄', async () => {
    const result = await persistSync({
      query,
      userId,
      records: [record({ credits: 4, raw: { source: 'grades', score: '90' } })],
      departmentName: null,
      syncedAt: new Date().toISOString(),
    })
    expect(result.insertedOrUpdated).toBe(1)
    expect(result.removed).toBe(1)

    const rows = await pool.query(
      `select credits, previous_raw, previous_synced_at from student_records where user_id = $1::uuid`,
      [userId],
    )
    expect(rows.rowCount).toBe(1)
    expect(Number(rows.rows[0].credits)).toBe(4)
    expect(rows.rows[0].previous_raw).toEqual({ source: 'grades', score: '88' })
    expect(rows.rows[0].previous_synced_at).not.toBeNull()
  })

  it('同步失敗只記 last_result=failed，不動 last_success_at 與紀錄', async () => {
    const before = await pool.query(`select last_success_at from student_sync_state where user_id = $1::uuid`, [userId])
    await recordSyncFailure(query, userId, { code: 'AIS_LOGIN_REJECTED' })

    const after = await pool.query(`select last_success_at, last_result, last_error_code from student_sync_state where user_id = $1::uuid`, [userId])
    expect(after.rows[0].last_success_at).toEqual(before.rows[0].last_success_at)
    expect(after.rows[0].last_result).toBe('failed')
    expect(after.rows[0].last_error_code).toBe('AIS_LOGIN_REJECTED')

    const records = await pool.query(`select count(*)::int as count from student_records where user_id = $1::uuid`, [userId])
    expect(records.rows[0].count).toBe(1)
  })

  it('AIS 帶來的系所名稱會在使用者尚未設定時自動對應 departments', async () => {
    await persistSync({ query, userId, records: [record()], departmentName: '資訊工程學系', syncedAt: new Date().toISOString() })
    const user = await pool.query(`select dept_id from users where user_id = $1::uuid`, [userId])
    expect(user.rows[0].dept_id).toBe('cse')
  })

  it('個人修正不會被 AIS 清理掉（只清 ais: 開頭）', async () => {
    await pool.query(
      `insert into student_overrides (user_id, record_key, field, value) values ($1::uuid, 'manual-1', 'category', 'CE')`,
      [userId],
    )
    await persistSync({ query, userId, records: [record()], departmentName: null, syncedAt: new Date().toISOString() })
    const overrides = await pool.query(`select count(*)::int as count from student_overrides where user_id = $1::uuid`, [userId])
    expect(overrides.rows[0].count).toBe(1)
  })
})

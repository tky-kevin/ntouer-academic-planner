// 把一次成功同步寫進資料庫。全部用單一 statement（每個 statement 各自原子），
// 不開跨 statement 交易：QueryFn 走 pool，BEGIN/COMMIT 不保證同一條連線。
// 失敗時保留前次快照：只有在 AIS 讀取全部成功後才會呼叫這裡。
import type { QueryFn } from '../app.js'
import type { SyncRecord } from './sync.js'

export interface PersistSyncInput {
  query: QueryFn
  userId: string
  records: readonly SyncRecord[]
  /** AIS 成績頁的系所名稱；只用來在使用者尚未設定系所時自動對應 departments.name。 */
  departmentName: string | null
  syncedAt: string
}

export interface PersistResult {
  insertedOrUpdated: number
  removed: number
}

function toRow(record: SyncRecord): Record<string, unknown> {
  return {
    record_key: record.recordKey,
    course_code: record.courseCode,
    course_name: record.courseName,
    credits: record.credits,
    category: record.category,
    status: record.status,
    term: record.term,
    tags: record.tags,
    owner: record.owner,
    raw: record.raw ?? null,
  }
}

export async function persistSync({ query, userId, records, departmentName, syncedAt }: PersistSyncInput): Promise<PersistResult> {
  const rows = records.map(toRow)
  const keys = rows.map((row) => row.record_key as string)

  let insertedOrUpdated = 0
  if (rows.length > 0) {
    const result = await query(
      `insert into student_records
         (user_id, record_key, course_code, course_name, credits, category, status, term, tags, owner, raw, synced_at)
       select $1::uuid, x.record_key, x.course_code, x.course_name, x.credits, x.category, x.status, x.term,
              coalesce(x.tags, '{}'::text[]), coalesce(x.owner, 'own'), x.raw, $3::timestamptz
         from jsonb_to_recordset($2::jsonb) as x(
           record_key text, course_code text, course_name text, credits numeric,
           category text, status text, term text, tags text[], owner text, raw jsonb)
       on conflict (user_id, record_key) do update set
         course_code   = excluded.course_code,
         course_name   = excluded.course_name,
         credits       = excluded.credits,
         category      = excluded.category,
         status        = excluded.status,
         term          = excluded.term,
         tags          = excluded.tags,
         owner         = excluded.owner,
         previous_raw  = student_records.raw,
         previous_synced_at = student_records.synced_at,
         raw           = excluded.raw,
         synced_at     = excluded.synced_at
       returning record_key`,
      [userId, JSON.stringify(rows), syncedAt],
    )
    insertedOrUpdated = result.rows.length
  }

  // AIS 已經沒有的紀錄要移除，否則會留下幽靈學分。只清 `ais:` 開頭，
  // 個人修正（student_overrides）與非 AIS 來源的紀錄不動。
  const stale = await query(
    `delete from student_records
      where user_id = $1::uuid
        and record_key like 'ais:%'
        and not (record_key = any($2::text[]))
      returning record_key`,
    [userId, keys],
  )

  if (departmentName) {
    await query(
      `update users u
          set dept_id = d.dept_id
         from departments d
        where u.user_id = $1::uuid
          and u.dept_id is null
          and d.name = $2
        returning u.user_id`,
      [userId, departmentName],
    )
  }

  await query(
    `insert into student_sync_state (user_id, last_success_at, last_attempt_at, last_result, last_error_code)
     values ($1::uuid, $2::timestamptz, now(), 'ok', null)
     on conflict (user_id) do update set
       last_success_at = excluded.last_success_at,
       last_attempt_at = now(),
       last_result     = 'ok',
       last_error_code = null`,
    [userId, syncedAt],
  )

  return { insertedOrUpdated, removed: stale.rows.length }
}

/**
 * 記錄一次失敗的同步嘗試。只寫入穩定的錯誤代碼，不寫訊息、不寫帳密。
 * 失敗不覆蓋 `last_success_at`：前次成功的資料仍在，畫面要能顯示「資料時間」。
 */
export async function recordSyncFailure(query: QueryFn, userId: string, error: unknown): Promise<void> {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'INTERNAL'
  const safeCode = code.slice(0, 64)
  await query(
    `insert into student_sync_state (user_id, last_attempt_at, last_result, last_error_code)
     values ($1::uuid, now(), 'failed', $2)
     on conflict (user_id) do update set
       last_attempt_at = now(),
       last_result     = 'failed',
       last_error_code = $2`,
    [userId, safeCode],
  )
}

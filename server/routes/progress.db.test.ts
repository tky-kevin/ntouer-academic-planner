// 需要真實 PostgreSQL：`npm run test:db`（CI 的 api job 會先 migrate + seed）。
// 驗證整條路徑：users → 最新已發布版本 → student_records／覆蓋 → 引擎 → 回應。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Pool } from 'pg'
import { createApp } from '../app.js'
import type { QueryFn } from '../app.js'
import { createProgressRoutes } from './progress.js'
import { loadDotEnv, readConfig } from '../env.js'

const silent = { info: () => undefined, error: () => undefined }
let pool: Pool
let server: Server | undefined
let base = ''

beforeAll(async () => {
  loadDotEnv()
  pool = new Pool({ connectionString: readConfig().databaseUrl, connectionTimeoutMillis: 2_000 })

  const seeded = await pool.query("select 1 from users where google_sub = 'dev-student'")
  if (seeded.rowCount === 0) throw new Error('需要先跑 `npm run db:migrate` 與 `npm run db:seed`（會建立 dev-student）')

  // seed 預設把樣本種成 draft；學生端只能讀 published。
  // 先讓這個 bundle 只剩一個 published：測試不該假設「資料庫沒有其他已發布版本」，
  // 例如跑過管理端發布流程後會有 cse-113-day@2。
  await pool.query(
    "update rule_versions set status = 'superseded' where bundle_id = 'cse-113-day' and version_id <> 'cse-113-day@1' and status = 'published'",
  )
  await pool.query(
    "update rule_versions set status = 'published', published_at = now() where version_id = 'cse-113-day@1'",
  )

  const query: QueryFn = async (text, params) => {
    const result = await pool.query(text, params ? [...params] : undefined)
    return { rows: result.rows }
  }
  server = createServer(
    createApp({ query, routes: createProgressRoutes({ query, devUserSub: 'dev-student' }), logger: silent }),
  )
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await pool?.end()
})

describe('GET /api/me/progress（真實資料庫：dev-student）', () => {
  it('回 200：135 學分、unconfirmed（X01 未解）、requirements 與 trace 齊備', async () => {
    const response = await fetch(`${base}/api/me/progress`)
    const body = (await response.json()) as {
      data: {
        bundleId: string
        versionId: string
        scenario: string
        overall: string
        totalCredits: number
        requirements: Array<{ id: string; state: string }>
        openConflicts: string[]
        trace: unknown[]
        dataSyncedAt: string | null
      }
      meta: { ruleVersionId: string }
    }

    expect(response.status).toBe(200)
    expect(body.data.bundleId).toBe('cse-113-day')
    expect(body.data.versionId).toBe('cse-113-day@1')
    expect(body.data.scenario).toBe('completed')
    expect(body.data.totalCredits).toBe(135)
    expect(body.data.overall).toBe('unconfirmed')
    expect(body.data.openConflicts).toEqual(['X01'])
    expect(body.data.requirements.find((item) => item.id === 'R06')?.state).toBe('met')
    expect(body.data.requirements.find((item) => item.id === 'R15')?.state).toBe('met')
    expect(body.data.trace.length).toBeGreaterThan(0)
    expect(body.data.dataSyncedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(body.meta.ruleVersionId).toBe('cse-113-day@1')
  })

  it('includeTrace=false 時不帶 trace；scenario 不合法回 400', async () => {
    const noTrace = await fetch(`${base}/api/me/progress?includeTrace=false`)
    const noTraceBody = (await noTrace.json()) as { data: { trace?: unknown } }
    expect(noTrace.status).toBe(200)
    expect(noTraceBody.data.trace).toBeUndefined()

    const invalid = await fetch(`${base}/api/me/progress?scenario=whenever`)
    const invalidBody = (await invalid.json()) as { error: { code: string; details: { field: string }[] } }
    expect(invalid.status).toBe(400)
    expect(invalidBody.error.code).toBe('REQUEST_INVALID')
    expect(invalidBody.error.details[0].field).toBe('scenario')
  })

  it('指定別的系所規則包 → 403；不存在的規則包 → 404', async () => {
    const otherDept = await fetch(`${base}/api/me/progress?bundleId=mmd-115-day`)
    expect([403, 404]).toContain(otherDept.status) // mmd 尚無已發布版本 → 404；有版本時 → 403

    const missing = await fetch(`${base}/api/me/progress?bundleId=nope-113-day`)
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('RULE_BUNDLE_NOT_FOUND')
  })

  it('沒有對應的使用者 → 401 AUTH_REQUIRED', async () => {
    const query: QueryFn = async (text, params) => {
      const result = await pool.query(text, params ? [...params] : undefined)
      return { rows: result.rows }
    }
    const nobody = createServer(
      createApp({ query, routes: createProgressRoutes({ query, devUserSub: 'nobody' }), logger: silent }),
    )
    await new Promise<void>((resolve) => nobody.listen(0, '127.0.0.1', resolve))
    const nobodyBase = `http://127.0.0.1:${(nobody.address() as AddressInfo).port}`
    try {
      const response = await fetch(`${nobodyBase}/api/me/progress`)
      expect(response.status).toBe(401)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('AUTH_REQUIRED')
    } finally {
      await new Promise<void>((resolve) => nobody.close(() => resolve()))
    }
  })
})

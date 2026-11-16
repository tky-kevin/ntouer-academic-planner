// 需要真實 PostgreSQL：`npm run test:db`（CI 的 api job 會先 migrate + seed）。
// 驗證 route 對真實 schema 的查詢與 jsonb payload，而不是只驗 fake row。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Pool } from 'pg'
import { createApp } from '../app.js'
import type { QueryFn } from '../app.js'
import { createRulesRoutes } from './rules.js'
import { loadDotEnv, readConfig } from '../env.js'

const silent = { info: () => undefined, error: () => undefined }
let pool: Pool
let server: Server | undefined
let base = ''

beforeAll(async () => {
  loadDotEnv()
  pool = new Pool({ connectionString: readConfig().databaseUrl, connectionTimeoutMillis: 2_000 })

  const { rows } = await pool.query(
    "select version_id from rule_versions where version_id in ('cse-113-day@1', 'mmd-115-day@1')",
  )
  if (rows.length < 2) throw new Error('需要先跑 `npm run db:migrate` 與 `npm run db:seed` 才有測試資料')

  // seed 預設把兩個樣本都種成 draft；這裡固定成「一個 published、一個 draft」。
  await pool.query(
    "update rule_versions set status = 'published', published_at = now() where version_id = 'cse-113-day@1'",
  )
  await pool.query(
    "update rule_versions set status = 'draft', published_at = null, published_by = null where version_id = 'mmd-115-day@1'",
  )

  const query: QueryFn = async (text, params) => {
    const result = await pool.query(text, params ? [...params] : undefined)
    return { rows: result.rows }
  }
  server = createServer(createApp({ query, routes: createRulesRoutes({ query }), logger: silent }))
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await pool?.end()
})

describe('GET /api/rules/{versionId}（真實資料庫）', () => {
  it('cse-113-day@1 回 200、published、10 條 clause、4 個來源', async () => {
    const response = await fetch(`${base}/api/rules/cse-113-day@1`)
    const body = (await response.json()) as {
      data: { status: string; clauses: unknown[]; sources: unknown[]; contentHash: string }
      meta: { ruleVersionId: string }
    }

    expect(response.status).toBe(200)
    expect(body.data.status).toBe('published')
    expect(body.data.clauses).toHaveLength(10)
    expect(body.data.sources).toHaveLength(4)
    expect(body.data.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(body.meta.ruleVersionId).toBe('cse-113-day@1')
  })

  it('include=payload 回 jsonb 的完整 payload', async () => {
    const response = await fetch(`${base}/api/rules/cse-113-day@1?include=payload`)
    const body = (await response.json()) as { data: { payload: { schemaVersion?: string; requirements?: unknown[] } } }

    expect(response.status).toBe(200)
    expect(body.data.payload.schemaVersion).toBeTruthy()
    expect(Array.isArray(body.data.payload.requirements)).toBe(true)
  })

  it('draft 版本對學生回 409、不存在的版本回 404', async () => {
    const draft = await fetch(`${base}/api/rules/mmd-115-day@1`)
    expect(draft.status).toBe(409)
    expect(((await draft.json()) as { error: { code: string } }).error.code).toBe('RULE_VERSION_NOT_PUBLISHED')

    const missing = await fetch(`${base}/api/rules/nope@1`)
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('RULE_VERSION_NOT_FOUND')
  })
})

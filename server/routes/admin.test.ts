// Issue #14 管理端端點的 HTTP 測試：假 QueryFn ＋ createApp({ routes })。
// 假 QueryFn 只實作 server/admin/store.ts 會發出的 SQL（用 SQL 片段辨識），
// 目的是測路由、權限、狀態機與稽核，不是測 PostgreSQL 語法本身（那需要真 DB）。
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app.js'
import type { QueryFn } from '../app.js'
import { createAdminRoutes } from './admin.js'
import type { AdminRouteOptions } from './admin.js'

const silent = { info: () => undefined, error: () => undefined }
const open: Server[] = []

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

type Json = Record<string, any>

interface FakeUser {
  user_id: string
  email: string
  role: 'student' | 'sysadmin'
  google_sub: string
}

interface FakeBundle {
  bundle_id: string
  dept_id: string
  entry_year: number
  program: string
  title: string
}

interface FakeVersion {
  version_id: string
  bundle_id: string
  version_no: number
  status: string
  payload: Json
  schema_version: string
  content_hash: string
  created_by: string | null
  created_at: Date
  submitted_at: Date | null
  reviewed_by: string | null
  reviewed_at: Date | null
  published_by: string | null
  published_at: Date | null
  proxy: boolean
  superseded_at: Date | null
  notes: string | null
}

interface FakeReview {
  record_id: number
  version_id: string
  action: string
  actor_id: string | null
  actor_role: string
  actor_dept_scope: string | null
  at: Date
  detail: unknown
  content_hash: string
  diff_from: unknown
}

const ID = {
  admin: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  student: '33333333-3333-4333-8333-333333333333',
  sysadmin: '44444444-4444-4444-8444-444444444444',
}

function payloadFor(bundleId: string, deptId: string, min: number, clauseText: string, requirementKind = 'total'): Json {
  return {
    schemaVersion: '1.0',
    bundleId,
    title: '測試規則包',
    department: { departmentId: deptId, name: '測試系' },
    scope: { entryYear: 113, program: 'day' },
    status: 'draft',
    sources: [{ sourceId: 'S113-01', title: '113 新生手冊', locator: 'p1' }],
    clauses: [{ clauseId: 'C01', sourceId: 'S113-01', locator: 'p1', text: clauseText }],
    allocation: {
      totalMin: min,
      precedence: ['core'],
      pools: [{ poolId: 'core', name: '核心', selectors: ['tag:core'] }],
    },
    requirements: [{ id: 'R01', kind: requirementKind, name: '總學分', clauseId: 'C01', min }],
  }
}

class FakeDb {
  users: FakeUser[] = [
    { user_id: ID.admin, email: 'admin@example.edu', role: 'student', google_sub: 'dev-admin' },
    { user_id: ID.other, email: 'other@example.edu', role: 'student', google_sub: 'dev-other' },
    { user_id: ID.student, email: 'student@example.edu', role: 'student', google_sub: 'dev-student' },
    { user_id: ID.sysadmin, email: 'root@example.edu', role: 'sysadmin', google_sub: 'dev-sysadmin' },
  ]
  admins = [
    { dept_id: 'cse', user_id: ID.admin, revoked_at: null as Date | null },
    { dept_id: 'mmd', user_id: ID.other, revoked_at: null as Date | null },
  ]
  bundles: FakeBundle[] = [
    { bundle_id: 'cse-113-day', dept_id: 'cse', entry_year: 113, program: 'day', title: '資工 113' },
    { bundle_id: 'mmd-115-day', dept_id: 'mmd', entry_year: 115, program: 'day', title: '商船 115' },
    { bundle_id: 'tst-113-day', dept_id: 'tst', entry_year: 113, program: 'day', title: '測試系 113' },
  ]
  versions: FakeVersion[] = []
  sources: Array<Record<string, unknown> & { version_id: string; source_id: string }> = []
  clauses: Array<Record<string, unknown> & { version_id: string; clause_id: string }> = []
  reviewRecords: FakeReview[] = []
  testRuns: Array<Record<string, unknown>> = []
  recordSeq = 0
  query: QueryFn

  constructor() {
    this.versions.push(this.version('cse-113-day', 1, 'published', payloadFor('cse-113-day', 'cse', 12, '總學分至少 12。')))
    this.versions.push(this.version('mmd-115-day', 1, 'draft', payloadFor('mmd-115-day', 'mmd', 10, '總學分至少 10。')))
    this.versions.push(this.version('tst-113-day', 1, 'approved', payloadFor('tst-113-day', 'tst', 8, '總學分至少 8。')))
    this.versions.push(this.version('cse-113-day', 2, 'approved', payloadFor('cse-113-day', 'cse', 12, '總學分至少 12。')))
    this.query = async (text, params) => this.run(text, params ? [...params] : [])
  }

  version(bundleId: string, versionNo: number, status: string, payload: Json): FakeVersion {
    return {
      version_id: `${bundleId}@${versionNo}`,
      bundle_id: bundleId,
      version_no: versionNo,
      status,
      payload,
      schema_version: '1.0',
      content_hash: `sha256:${String(versionNo).padStart(64, '0')}`,
      created_by: ID.admin,
      created_at: new Date('2026-11-16T00:00:00Z'),
      submitted_at: null,
      reviewed_by: null,
      reviewed_at: null,
      published_by: null,
      published_at: null,
      proxy: false,
      superseded_at: null,
      notes: null,
    }
  }

  findVersion(versionId: string): FakeVersion | undefined {
    return this.versions.find((version) => version.version_id === versionId)
  }

  deptOf(versionId: string): string {
    const version = this.findVersion(versionId)
    const bundle = this.bundles.find((candidate) => candidate.bundle_id === version?.bundle_id)
    return bundle?.dept_id ?? ''
  }

  row(version: FakeVersion): Json {
    return { ...version, dept_id: this.deptOf(version.version_id) }
  }

  audit(input: {
    versionId: string
    action: string
    actorId: string | null
    actorRole: string
    actorDeptScope: string | null
    detail: unknown
    contentHash: string
    diffFrom: unknown
  }): FakeReview {
    this.recordSeq += 1
    const record: FakeReview = {
      record_id: this.recordSeq,
      version_id: input.versionId,
      action: input.action,
      actor_id: input.actorId,
      actor_role: input.actorRole,
      actor_dept_scope: input.actorDeptScope,
      at: new Date(Date.parse('2026-11-17T00:00:00Z') + this.recordSeq * 1000),
      detail: input.detail,
      content_hash: input.contentHash,
      diff_from: input.diffFrom,
    }
    this.reviewRecords.push(record)
    return record
  }

  async run(raw: string, params: readonly unknown[]): Promise<{ rows: unknown[] }> {
    const sql = raw.replace(/\s+/g, ' ').trim()
    const p = (index: number): any => params[index]

    // 身分與權限
    if (sql.includes('from users where google_sub')) {
      return { rows: this.users.filter((user) => user.google_sub === p(0)) }
    }
    if (sql.includes('count(*)')) {
      const deptId = p(0) as string
      return {
        rows: [{ count: this.admins.filter((admin) => admin.dept_id === deptId && admin.revoked_at === null).length }],
      }
    }
    if (sql.includes('from department_admins')) {
      const userId = p(0) as string
      return {
        rows: this.admins
          .filter((admin) => admin.user_id === userId && admin.revoked_at === null)
          .sort((a, b) => a.dept_id.localeCompare(b.dept_id))
          .map((admin) => ({ dept_id: admin.dept_id })),
      }
    }
    if (sql.includes('from rule_bundles where bundle_id')) {
      return { rows: this.bundles.filter((bundle) => bundle.bundle_id === p(0)) }
    }

    // 建立草稿＋created 稽核（單一 CTE）
    if (sql.includes('insert into rule_versions')) {
      const bundleId = p(0) as string
      const currentMax = Math.max(0, ...this.versions.filter((v) => v.bundle_id === bundleId).map((v) => v.version_no))
      const version = this.version(bundleId, currentMax + 1, 'draft', p(1) as Json)
      version.schema_version = p(2) as string
      version.content_hash = p(3) as string
      version.created_by = p(4) as string
      version.notes = (p(5) as string | null) ?? null
      this.versions.push(version)
      const record = this.audit({
        versionId: version.version_id,
        action: 'created',
        actorId: p(4) as string,
        actorRole: p(6) as string,
        actorDeptScope: (p(7) as string | null) ?? null,
        detail: p(8),
        contentHash: version.content_hash,
        diffFrom: p(9),
      })
      return { rows: [{ ...this.row(version), record_id: record.record_id }] }
    }

    // 狀態轉移（每種都在同一個 statement 內寫稽核）
    if (sql.includes("set status = 'in-review'")) {
      return this.transition(p(0), p(1), 'in-review', (version) => {
        version.submitted_at = new Date()
      }, 'submitted', [p(2), p(3), p(4)], p(5), p(6))
    }
    if (sql.includes("set status = 'approved'")) {
      return this.transition(p(0), p(1), 'approved', (version) => {
        version.reviewed_by = p(2) as string
        version.reviewed_at = new Date()
      }, 'approved', [p(2), p(3), p(4)], p(5), p(6))
    }
    if (sql.includes("set status = 'draft'")) {
      return this.transition(p(0), p(1), 'draft', (version) => {
        version.reviewed_by = p(2) as string
        version.reviewed_at = new Date()
        version.notes = p(3) as string
      }, 'rejected', [p(2), p(4), p(5)], p(6), p(7))
    }
    if (sql.includes("set status = 'published'") && sql.includes("set status = 'superseded'")) {
      return this.publish(p(0), p(1), Boolean(p(2)), p(3), p(4), p(5), p(6))
    }

    // 更新草稿 payload（CAS：status 必須還是 draft）
    if (sql.includes('set payload =')) {
      const version = this.findVersion(p(0) as string)
      if (!version || version.status !== 'draft') return { rows: [] }
      version.payload = p(1) as Json
      version.content_hash = p(2) as string
      version.schema_version = p(3) as string
      return { rows: [{ version_id: version.version_id, status: version.status, content_hash: version.content_hash }] }
    }

    // 測試證據＋tested 稽核
    if (sql.includes('insert into test_runs')) {
      this.testRuns.push({
        version_id: p(0),
        suite: p(1),
        passed: p(2),
        failed: p(3),
        detail: p(4),
        run_by: p(5),
      })
      this.audit({
        versionId: p(0) as string,
        action: 'tested',
        actorId: p(5) as string,
        actorRole: p(6) as string,
        actorDeptScope: (p(7) as string | null) ?? null,
        detail: p(8),
        contentHash: p(9) as string,
        diffFrom: p(10),
      })
      return { rows: [{ run_id: this.testRuns.length, record_id: this.recordSeq }] }
    }

    // validated 稽核
    if (sql.includes('insert into review_records')) {
      if (sql.includes("'validated'")) {
        this.audit({
          versionId: p(0) as string,
          action: 'validated',
          actorId: p(1) as string,
          actorRole: p(2) as string,
          actorDeptScope: (p(3) as string | null) ?? null,
          detail: p(4),
          contentHash: p(5) as string,
          diffFrom: p(6),
        })
        return { rows: [{ record_id: this.recordSeq }] }
      }
      throw new Error(`fake query 未實作的 review_records insert：${sql.slice(0, 120)}`)
    }

    // 稽核查詢
    if (sql.includes('from review_records r')) {
      const versionMatch = /r\.version_id = \$(\d+)/.exec(sql)
      const cursorMatch = /r\.record_id > \$(\d+)/.exec(sql)
      const deptMatch = /b\.dept_id = any\(\$(\d+)/.exec(sql)
      const limitMatch = /limit \$(\d+)/.exec(sql)
      let rows = [...this.reviewRecords]
      if (versionMatch) rows = rows.filter((record) => record.version_id === params[Number(versionMatch[1]) - 1])
      if (cursorMatch) rows = rows.filter((record) => record.record_id > Number(params[Number(cursorMatch[1]) - 1]))
      if (deptMatch) {
        const scopes = params[Number(deptMatch[1]) - 1] as string[]
        rows = rows.filter((record) => scopes.includes(this.deptOf(record.version_id)))
      }
      const limit = limitMatch ? Number(params[Number(limitMatch[1]) - 1]) : 50
      rows.sort((a, b) => a.record_id - b.record_id)
      return { rows: rows.slice(0, limit) }
    }

    // 版本查詢
    if (sql.includes('where v.version_id = $1')) {
      const version = this.findVersion(p(0) as string)
      return { rows: version ? [this.row(version)] : [] }
    }
    if (sql.includes('v.version_no < $2')) {
      const bundleId = p(0) as string
      const versionNo = Number(p(1))
      const previous = this.versions
        .filter((version) => version.bundle_id === bundleId && version.version_no < versionNo)
        .sort((a, b) => b.version_no - a.version_no)[0]
      return { rows: previous ? [{ version_id: previous.version_id, version_no: previous.version_no, payload: previous.payload }] : [] }
    }
    if (sql.includes('v.bundle_id = $1') && sql.includes('order by v.version_no desc')) {
      const latest = this.versions
        .filter((version) => version.bundle_id === p(0))
        .sort((a, b) => b.version_no - a.version_no)[0]
      return { rows: latest ? [{ version_id: latest.version_id, version_no: latest.version_no, payload: latest.payload }] : [] }
    }
    if (sql.includes('from rule_versions') && sql.includes("status = 'published'") && sql.includes('content_hash')) {
      return {
        rows: this.versions
          .filter((version) => version.bundle_id === p(0) && version.status === 'published')
          .sort((a, b) => a.version_no - b.version_no)
          .map((version) => ({
            version_id: version.version_id,
            version_no: version.version_no,
            content_hash: version.content_hash,
          })),
      }
    }

    // 來源／條文投影
    if (sql.includes('delete from rule_clauses')) {
      this.clauses = this.clauses.filter((clause) => clause.version_id !== p(0))
      return { rows: [] }
    }
    if (sql.includes('delete from rule_sources')) {
      this.sources = this.sources.filter((source) => source.version_id !== p(0))
      return { rows: [] }
    }
    if (sql.includes('insert into rule_sources')) {
      const source = {
        version_id: p(0) as string,
        source_id: p(1) as string,
        title: p(2),
        url: p(3),
        locator: p(4),
        sha256: p(5),
        retrieved_at: p(6),
        status: p(7),
      }
      this.sources = this.sources.filter(
        (existing) => !(existing.version_id === source.version_id && existing.source_id === source.source_id),
      )
      this.sources.push(source as any)
      return { rows: [] }
    }
    if (sql.includes('insert into rule_clauses')) {
      const clause = {
        version_id: p(0) as string,
        clause_id: p(1) as string,
        source_id: p(2),
        locator: p(3),
        text: p(4),
        reading: p(5),
        status: p(6),
      }
      this.clauses = this.clauses.filter(
        (existing) => !(existing.version_id === clause.version_id && existing.clause_id === clause.clause_id),
      )
      this.clauses.push(clause as any)
      return { rows: [] }
    }

    throw new Error(`fake query 未實作：${sql.slice(0, 160)}`)
  }

  transition(
    versionId: unknown,
    expected: unknown,
    status: string,
    mutate: (version: FakeVersion) => void,
    action: string,
    actor: readonly unknown[],
    detail: unknown,
    diffFrom: unknown,
  ): { rows: unknown[] } {
    const version = this.findVersion(versionId as string)
    if (!version || version.status !== expected) return { rows: [] }
    version.status = status
    mutate(version)
    this.audit({
      versionId: version.version_id,
      action,
      actorId: actor[0] as string,
      actorRole: actor[1] as string,
      actorDeptScope: (actor[2] as string | null) ?? null,
      detail,
      contentHash: version.content_hash,
      diffFrom,
    })
    return { rows: [this.row(version)] }
  }

  publish(
    versionId: unknown,
    publishedBy: unknown,
    proxy: boolean,
    actorRole: unknown,
    actorDeptScope: unknown,
    detail: unknown,
    diffFrom: unknown,
  ): { rows: unknown[] } {
    const version = this.findVersion(versionId as string)
    if (!version || version.status !== 'approved') return { rows: [] }
    const superseded = this.versions.filter(
      (candidate) =>
        candidate.bundle_id === version.bundle_id &&
        candidate.status === 'published' &&
        candidate.version_id !== version.version_id,
    )
    for (const old of superseded) {
      old.status = 'superseded'
      old.superseded_at = new Date()
      this.audit({
        versionId: old.version_id,
        action: 'superseded',
        actorId: publishedBy as string,
        actorRole: actorRole as string,
        actorDeptScope: (actorDeptScope as string | null) ?? null,
        detail: { supersededBy: version.version_id },
        contentHash: old.content_hash,
        diffFrom: null,
      })
    }
    version.status = 'published'
    version.published_by = publishedBy as string
    version.published_at = new Date()
    version.proxy = proxy
    this.audit({
      versionId: version.version_id,
      action: 'published',
      actorId: publishedBy as string,
      actorRole: actorRole as string,
      actorDeptScope: (actorDeptScope as string | null) ?? null,
      detail,
      contentHash: version.content_hash,
      diffFrom,
    })
    return {
      rows: [{ ...this.row(version), superseded_version_ids: superseded.map((old) => old.version_id) }],
    }
  }
}

async function start(db: FakeDb, options: Partial<AdminRouteOptions> = {}): Promise<string> {
  const routeOptions: AdminRouteOptions = {
    query: db.query,
    nodeEnv: 'test',
    ...options,
  }
  const server = createServer(createApp({ query: db.query, routes: createAdminRoutes(routeOptions), logger: silent }))
  open.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function call(
  base: string,
  path: string,
  options: { method?: string; body?: unknown; origin?: string | null } = {},
): Promise<{ status: number; body: Json; headers: Headers }> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers.Origin = options.origin === undefined ? base : options.origin ?? ''
  if (headers.Origin === '') delete headers.Origin
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as Json) : {}, headers: response.headers }
}

describe('管理端認證與 CSRF', () => {
  it('沒有身分時所有端點都 401 AUTH_REQUIRED，並帶 no-store', async () => {
    const base = await start(new FakeDb())
    const calls = [
      { path: '/api/admin/rules/cse-113-day/draft', method: 'POST', body: {} },
      { path: '/api/admin/rules/cse-113-day@1', method: 'PUT', body: { payload: {} } },
      { path: '/api/admin/rules/cse-113-day@1/validate', method: 'POST', body: {} },
      { path: '/api/admin/rules/cse-113-day@1/test', method: 'POST', body: {} },
      { path: '/api/admin/rules/cse-113-day@1/submit', method: 'POST', body: {} },
      { path: '/api/admin/rules/cse-113-day@1/approve', method: 'POST', body: {} },
      { path: '/api/admin/rules/cse-113-day@1/reject', method: 'POST', body: { reason: 'x' } },
      { path: '/api/admin/rules/cse-113-day@1/publish', method: 'POST', body: {} },
      { path: '/api/admin/rules/cse-113-day@1/diff', method: 'GET' },
      { path: '/api/admin/audit', method: 'GET' },
    ]

    for (const entry of calls) {
      const result = await call(base, entry.path, entry)
      expect(result.status, entry.path).toBe(401)
      expect(result.body.error.code, entry.path).toBe('AUTH_REQUIRED')
      expect(result.headers.get('cache-control'), entry.path).toBe('no-store')
    }
  })

  it('不同源的變更請求 403 AUTH_ORIGIN_MISMATCH，且不寫入任何版本', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })
    const before = db.versions.length

    for (const entry of [
      { path: '/api/admin/rules/cse-113-day/draft', method: 'POST', body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') } },
      { path: '/api/admin/rules/cse-113-day@1', method: 'PUT', body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') } },
    ]) {
      const result = await call(base, entry.path, { ...entry, origin: 'http://evil.example' })
      expect(result.status, entry.path).toBe(403)
      expect(result.body.error.code, entry.path).toBe('AUTH_ORIGIN_MISMATCH')
    }
    expect(db.versions).toHaveLength(before)
  })

  it('沒有 Origin 的請求（curl／伺服器端）不因 CSRF 被擋', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })
    const result = await call(base, '/api/admin/rules/cse-113-day/draft', {
      method: 'POST',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') },
      origin: null,
    })
    expect(result.status).toBe(201)
  })
})

describe('管理端權限', () => {
  it('系所管理員動別的系所 → 403 AUTH_DEPT_OUT_OF_SCOPE（含 diff、建立草稿、發布）', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })

    for (const entry of [
      { path: '/api/admin/rules/mmd-115-day@1', method: 'PUT', body: { payload: payloadFor('mmd-115-day', 'mmd', 10, 'x') } },
      { path: '/api/admin/rules/mmd-115-day@1/diff', method: 'GET' },
      { path: '/api/admin/rules/mmd-115-day/draft', method: 'POST', body: {} },
      { path: '/api/admin/rules/mmd-115-day@1/publish', method: 'POST', body: {} },
    ]) {
      const result = await call(base, entry.path, entry)
      expect(result.status, entry.path).toBe(403)
      expect(result.body.error.code, entry.path).toBe('AUTH_DEPT_OUT_OF_SCOPE')
    }

    // 自己的系所可以讀 diff。
    const own = await call(base, '/api/admin/rules/cse-113-day@1/diff')
    expect(own.status).toBe(200)
  })

  it('沒有被指派系所的一般學生 → 403 AUTH_FORBIDDEN（不是 out of scope）', async () => {
    const base = await start(new FakeDb(), { devUserSub: 'dev-student' })
    const result = await call(base, '/api/admin/rules/cse-113-day@1', {
      method: 'PUT',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') },
    })
    expect(result.status).toBe(403)
    expect(result.body.error.code).toBe('AUTH_FORBIDDEN')
  })

  it('系統管理員可在沒有管理員的系所代理發布（proxy=true），有管理員時被拒', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-sysadmin' })

    // tst 系沒有有效管理員 → proxy 發布。
    const allowed = await call(base, '/api/admin/rules/tst-113-day@1/publish', { method: 'POST', body: {} })
    expect(allowed.status).toBe(200)
    expect(allowed.body.data.status).toBe('published')
    expect(allowed.body.data.proxy).toBe(true)

    // cse 仍有 dev-admin → 系統管理員不得代理發布。
    const denied = await call(base, '/api/admin/rules/cse-113-day@2/publish', { method: 'POST', body: {} })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('AUTH_FORBIDDEN')
  })
})

describe('GET /api/admin/rules/{versionId}（讀取版本）', () => {
  it('沒有身分 401 AUTH_REQUIRED；格式錯誤 400；不存在 404 RULE_VERSION_NOT_FOUND', async () => {
    const noIdentity = await start(new FakeDb())
    const unauthorized = await call(noIdentity, '/api/admin/rules/cse-113-day@1')
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.body.error.code).toBe('AUTH_REQUIRED')

    const base = await start(new FakeDb(), { devUserSub: 'dev-admin' })
    const malformed = await call(base, '/api/admin/rules/not-a-version')
    expect(malformed.status).toBe(400)
    expect(malformed.body.error.details[0].field).toBe('versionId')

    const missing = await call(base, '/api/admin/rules/nope@1')
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('RULE_VERSION_NOT_FOUND')
  })

  it('別系的版本 403 AUTH_DEPT_OUT_OF_SCOPE；沒有管理權 403 AUTH_FORBIDDEN', async () => {
    const base = await start(new FakeDb(), { devUserSub: 'dev-admin' })

    const otherDept = await call(base, '/api/admin/rules/mmd-115-day@1')
    expect(otherDept.status).toBe(403)
    expect(otherDept.body.error.code).toBe('AUTH_DEPT_OUT_OF_SCOPE')

    const noScope = await start(new FakeDb(), { devUserSub: 'dev-student' })
    const forbidden = await call(noScope, '/api/admin/rules/cse-113-day@1')
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.error.code).toBe('AUTH_FORBIDDEN')
  })

  it('200 回中繼資料、整份 payload 與依狀態／權限算出的 allowedActions', async () => {
    const db = new FakeDb()
    db.findVersion('cse-113-day@1')!.published_at = new Date('2026-11-10T10:00:00Z')
    const base = await start(db, { devUserSub: 'dev-admin' })

    // published → 不可原地操作。
    const published = await call(base, '/api/admin/rules/cse-113-day@1')
    expect(published.status).toBe(200)
    expect(published.body.data).toMatchObject({
      versionId: 'cse-113-day@1',
      bundleId: 'cse-113-day',
      versionNo: 1,
      status: 'published',
      schemaVersion: '1.0',
      proxy: false,
      allowedActions: [],
    })
    expect(published.body.data.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(published.body.data.publishedAt).toMatch(/^2026-/)
    expect(published.body.data.payload.requirements).toHaveLength(1)
    expect(published.body.meta.ruleVersionId).toBe('cse-113-day@1')
    expect(published.headers.get('cache-control')).toBe('no-store')

    // approved → publish。
    const approved = await call(base, '/api/admin/rules/cse-113-day@2')
    expect(approved.status).toBe(200)
    expect(approved.body.data.status).toBe('approved')
    expect(approved.body.data.allowedActions).toEqual(['publish'])
    expect(approved.body.data.publishedAt).toBeNull()

    // in-review → approve／reject。
    const created = await call(base, '/api/admin/rules/cse-113-day/draft', {
      method: 'POST',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, '總學分至少 12。') },
    })
    const versionId: string = created.body.data.versionId
    await call(base, `/api/admin/rules/${versionId}/submit`, { method: 'POST', body: {} })
    const inReview = await call(base, `/api/admin/rules/${versionId}`)
    expect(inReview.body.data.status).toBe('in-review')
    expect(inReview.body.data.allowedActions).toEqual(['approve', 'reject'])

    // draft → validate／test／submit（換另一個系所的管理員）。
    const other = await start(db, { devUserSub: 'dev-other' })
    const draft = await call(other, '/api/admin/rules/mmd-115-day@1')
    expect(draft.status).toBe(200)
    expect(draft.body.data.status).toBe('draft')
    expect(draft.body.data.allowedActions).toEqual(['validate', 'test', 'submit'])
  })
})

describe('狀態機與稽核', () => {
  it('draft → validate → test → submit → approve → publish 全程，並留下對應稽核', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })

    // 建立草稿（複製最新版 @2？cse 已有 @2 approved；建立會是 @3）。
    const created = await call(base, '/api/admin/rules/cse-113-day/draft', {
      method: 'POST',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, '總學分至少 12。') },
    })
    expect(created.status).toBe(201)
    expect(created.body.data.versionNo).toBe(3)
    expect(created.body.data.status).toBe('draft')
    const versionId: string = created.body.data.versionId
    expect(versionId).toBe('cse-113-day@3')
    expect(created.headers.get('cache-control')).toBe('no-store')

    // 更新草稿：min 12 → 14、條文文字也改，讓 diff 有 changed。
    const updatedPayload = payloadFor('cse-113-day', 'cse', 14, '總學分至少 14。')
    const updated = await call(base, `/api/admin/rules/${versionId}`, { method: 'PUT', body: { payload: updatedPayload } })
    expect(updated.status).toBe(200)
    expect(updated.body.data.status).toBe('draft')
    expect(updated.body.data.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)

    // 結構驗證。
    const validated = await call(base, `/api/admin/rules/${versionId}/validate`, { method: 'POST', body: {} })
    expect(validated.status).toBe(200)
    expect(validated.body.data.valid).toBe(true)

    // 測試（帶案例）。
    const tested = await call(base, `/api/admin/rules/${versionId}/test`, {
      method: 'POST',
      body: {
        scenario: 'completed',
        records: [{ courseCode: 'CS1', credits: 14, status: 'pass', category: 'core', tags: ['core'] }],
      },
    })
    expect(tested.status).toBe(200)
    expect(tested.body.data.suite).toBe('provided-records')
    expect(tested.body.data.failed).toBe(0)
    expect(tested.body.data.overall).toBe('complete')

    // 與前一版（@2 approved，min 12）比較。
    const diff = await call(base, `/api/admin/rules/${versionId}/diff`)
    expect(diff.status).toBe(200)
    expect(diff.body.data.previousVersionId).toBe('cse-113-day@2')
    expect(diff.body.data.summary).toEqual({ added: 0, removed: 0, changed: 2 })
    expect(diff.body.data.requirements).toEqual([
      expect.objectContaining({
        kind: 'changed',
        id: 'R01',
        clauseId: 'C01',
        changes: [{ field: 'min', before: 12, after: 14 }],
      }),
    ])
    expect(diff.body.data.clauses.map((item: Json) => item.kind)).toEqual(['changed'])
    expect(diff.body.data.sources).toEqual([])

    // 送審 → 核准 → 發布。
    const submitted = await call(base, `/api/admin/rules/${versionId}/submit`, { method: 'POST', body: {} })
    expect(submitted.status).toBe(200)
    expect(submitted.body.data.status).toBe('in-review')

    const approved = await call(base, `/api/admin/rules/${versionId}/approve`, { method: 'POST', body: {} })
    expect(approved.status).toBe(200)
    expect(approved.body.data.status).toBe('approved')
    expect(approved.body.data.reviewedBy).toBe(ID.admin)

    const published = await call(base, `/api/admin/rules/${versionId}/publish`, { method: 'POST', body: {} })
    expect(published.status).toBe(200)
    expect(published.body.data.status).toBe('published')
    expect(published.body.data.proxy).toBe(false)
    expect(published.body.data.superseded).toEqual(['cse-113-day@1'])

    // 資料庫狀態：published_at／published_by 有寫、舊版 superseded、投影有內容。
    const stored = db.findVersion(versionId)!
    expect(stored.published_at).toBeInstanceOf(Date)
    expect(stored.published_by).toBe(ID.admin)
    expect(db.findVersion('cse-113-day@1')!.status).toBe('superseded')
    expect(db.sources.filter((source) => source.version_id === versionId)).toHaveLength(1)
    expect(db.clauses.filter((clause) => clause.version_id === versionId)).toHaveLength(1)

    // 稽核：created → validated → tested → submitted → approved → published／superseded。
    const audit = await call(base, `/api/admin/audit?versionId=${encodeURIComponent(versionId)}`)
    expect(audit.status).toBe(200)
    const actions = audit.body.data.items.map((item: Json) => item.action)
    expect(actions.slice(0, 5)).toEqual(['created', 'validated', 'tested', 'submitted', 'approved'])
    expect(actions).toContain('published')
    for (const item of audit.body.data.items) {
      expect(item.versionId).toBe(versionId)
      expect(item.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(item.actorRole).toBe('student')
      expect(item.actorDeptScope).toBe('cse')
    }

    // published 後不可原地改；所有狀態操作都被 409 擋下。
    const republish = await call(base, `/api/admin/rules/${versionId}/publish`, { method: 'POST', body: {} })
    expect(republish.status).toBe(409)
    expect(republish.body.error.code).toBe('RULE_VERSION_IMMUTABLE')

    const putAfterPublish = await call(base, `/api/admin/rules/${versionId}`, {
      method: 'PUT',
      body: { payload: updatedPayload },
    })
    expect(putAfterPublish.status).toBe(409)
    expect(putAfterPublish.body.error.code).toBe('RULE_VERSION_IMMUTABLE')
    expect(putAfterPublish.body.error.details[0]).toMatchObject({ field: 'status', reason: 'status=published' })
  })

  it('非法轉移一律 409 RULE_VERSION_IMMUTABLE（含 published、draft 直接核准／退回）', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })

    // cse-113-day@1 是 published。
    for (const path of ['validate', 'test', 'submit', 'approve', 'publish']) {
      const result = await call(base, `/api/admin/rules/cse-113-day@1/${path}`, {
        method: 'POST',
        body: path === 'test' ? { records: [] } : {},
      })
      expect(result.status, path).toBe(409)
      expect(result.body.error.code, path).toBe('RULE_VERSION_IMMUTABLE')
    }
    const put = await call(base, '/api/admin/rules/cse-113-day@1', {
      method: 'PUT',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') },
    })
    expect(put.status).toBe(409)

    // 建立一份 cse 草稿，檢查 draft 不能直接核准／退回／發布。
    const created = await call(base, '/api/admin/rules/cse-113-day/draft', {
      method: 'POST',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') },
    })
    const versionId: string = created.body.data.versionId
    for (const path of ['approve', 'reject', 'publish']) {
      const result = await call(base, `/api/admin/rules/${versionId}/${path}`, {
        method: 'POST',
        body: path === 'reject' ? { reason: '文件不足' } : {},
      })
      expect(result.status, path).toBe(409)
      expect(result.body.error.code, path).toBe('RULE_VERSION_IMMUTABLE')
    }

    // 退回後回到 draft，可以再次編輯；退回原因寫進 notes 與稽核。
    const submitted = await call(base, `/api/admin/rules/${versionId}/submit`, { method: 'POST', body: {} })
    expect(submitted.status).toBe(200)
    const rejected = await call(base, `/api/admin/rules/${versionId}/reject`, {
      method: 'POST',
      body: { reason: '條文定位錯誤' },
    })
    expect(rejected.status).toBe(200)
    expect(rejected.body.data.status).toBe('draft')
    expect(rejected.body.data.notes).toBe('條文定位錯誤')
    expect(db.findVersion(versionId)!.reviewed_by).toBe(ID.admin)

    const audit = await call(base, `/api/admin/audit?versionId=${encodeURIComponent(versionId)}`)
    expect(audit.body.data.items.map((item: Json) => item.action)).toContain('rejected')
  })
})

describe('驗證、測試與參數錯誤', () => {
  it('結構驗證失敗 422 RULE_VALIDATION_FAILED，details 逐條，狀態留在 draft 並寫 validated 稽核', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })

    // 故意只給 schemaVersion／bundleId：validateBundle 會列出缺少的必要欄位。
    const created = await call(base, '/api/admin/rules/cse-113-day/draft', {
      method: 'POST',
      body: { payload: { schemaVersion: '1.0', bundleId: 'cse-113-day' } },
    })
    expect(created.status).toBe(201)
    const versionId: string = created.body.data.versionId

    const validated = await call(base, `/api/admin/rules/${versionId}/validate`, { method: 'POST', body: {} })
    expect(validated.status).toBe(422)
    expect(validated.body.error.code).toBe('RULE_VALIDATION_FAILED')
    expect(validated.body.error.details.length).toBeGreaterThan(0)
    expect(validated.body.error.details[0]).toHaveProperty('reason')
    expect(db.findVersion(versionId)!.status).toBe('draft')
    expect(db.reviewRecords.some((record) => record.version_id === versionId && record.action === 'validated')).toBe(true)
  })

  it('測試失敗 422 RULE_TEST_FAILED（引擎丟錯），並留下 test_runs 證據', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })

    const broken = payloadFor('cse-113-day', 'cse', 12, 'x', 'nonsense')
    const created = await call(base, '/api/admin/rules/cse-113-day/draft', { method: 'POST', body: { payload: broken } })
    const versionId: string = created.body.data.versionId

    const tested = await call(base, `/api/admin/rules/${versionId}/test`, { method: 'POST', body: {} })
    expect(tested.status).toBe(422)
    expect(tested.body.error.code).toBe('RULE_TEST_FAILED')
    expect(tested.body.error.details[0].field).toBe('engine.evaluate')
    expect(db.findVersion(versionId)!.status).toBe('draft')
    expect(db.testRuns).toHaveLength(1)
    expect(db.testRuns[0]).toMatchObject({ version_id: versionId, failed: 1 })
    expect(db.reviewRecords.some((record) => record.version_id === versionId && record.action === 'tested')).toBe(true)
  })

  it('未知欄位、型別錯誤、未知查詢參數、offset 一律 400 REQUEST_INVALID＋details', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })

    // 先建一份 cse 草稿，才不會在 body 驗證前被權限／狀態擋掉。
    const created = await call(base, '/api/admin/rules/cse-113-day/draft', {
      method: 'POST',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') },
    })
    const versionId: string = created.body.data.versionId

    const unknownBody = await call(base, `/api/admin/rules/${versionId}`, {
      method: 'PUT',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x'), status: 'published' },
    })
    expect(unknownBody.status).toBe(400)
    expect(unknownBody.body.error.code).toBe('REQUEST_INVALID')
    expect(unknownBody.body.error.details).toContainEqual({ field: 'status', reason: '未知欄位' })

    const badTest = await call(base, `/api/admin/rules/${versionId}/test`, {
      method: 'POST',
      body: { records: [{ courseCode: 'X', credits: '3', status: 'passed' }], scenario: 'done' },
    })
    expect(badTest.status).toBe(400)
    expect(badTest.body.error.details.map((problem: Json) => problem.field)).toContain('records[0].credits')

    const offset = await call(base, '/api/admin/audit?offset=10')
    expect(offset.status).toBe(400)
    expect(offset.body.error.details).toContainEqual({ field: 'offset', reason: '未知查詢參數' })

    const badVersionId = await call(base, '/api/admin/rules/not-a-version', {
      method: 'PUT',
      body: { payload: {} },
    })
    expect(badVersionId.status).toBe(400)
    expect(badVersionId.body.error.details[0].field).toBe('versionId')

    const unknownQuery = await call(base, '/api/admin/rules/cse-113-day@1/diff?include=payload')
    expect(unknownQuery.status).toBe(400)
  })

  it('退回缺少 reason、body 型別錯誤 → 400；不存在的版本／規則包 → 404', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })

    const created = await call(base, '/api/admin/rules/cse-113-day/draft', {
      method: 'POST',
      body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') },
    })
    const versionId: string = created.body.data.versionId
    await call(base, `/api/admin/rules/${versionId}/submit`, { method: 'POST', body: {} })

    const noReason = await call(base, `/api/admin/rules/${versionId}/reject`, { method: 'POST', body: {} })
    expect(noReason.status).toBe(400)
    expect(noReason.body.error.details).toContainEqual({ field: 'reason', reason: '必填且不可為空白' })

    expect((await call(base, '/api/admin/rules/nope@1/diff')).body.error.code).toBe('RULE_VERSION_NOT_FOUND')
    expect((await call(base, '/api/admin/rules/nope-113-day/draft', { method: 'POST', body: {} })).body.error.code).toBe(
      'RULE_BUNDLE_NOT_FOUND',
    )
    expect((await call(base, '/api/admin/audit?versionId=nope@1')).body.error.code).toBe('RULE_VERSION_NOT_FOUND')
  })
})

describe('diff 與稽核分頁', () => {
  it('第一版 diff 的 previousVersionId 是 null、全部 added', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-other' })
    const diff = await call(base, '/api/admin/rules/mmd-115-day@1/diff')
    expect(diff.status).toBe(200)
    expect(diff.body.data.previousVersionId).toBeNull()
    expect(diff.body.data.summary).toEqual({ added: 3, removed: 0, changed: 0 })
    expect(diff.body.data.requirements).toHaveLength(1)
    expect(diff.body.data.clauses).toHaveLength(1)
    expect(diff.body.data.sources).toHaveLength(1)
  })

  it('稽核用 record_id 做 cursor（禁 offset），limit 與 nextCursor 正確、可翻下一頁', async () => {
    const db = new FakeDb()
    const base = await start(db, { devUserSub: 'dev-admin' })
    // 先製造 4 筆 cse 稽核。
    for (let index = 0; index < 2; index += 1) {
      const created = await call(base, '/api/admin/rules/cse-113-day/draft', {
        method: 'POST',
        body: { payload: payloadFor('cse-113-day', 'cse', 12, 'x') },
      })
      const versionId: string = created.body.data.versionId
      await call(base, `/api/admin/rules/${versionId}/validate`, { method: 'POST', body: {} })
    }

    const first = await call(base, '/api/admin/audit?limit=2')
    expect(first.status).toBe(200)
    expect(first.body.data.items).toHaveLength(2)
    expect(first.body.data.nextCursor).toBe(first.body.data.items[1].recordId)

    const second = await call(base, `/api/admin/audit?limit=2&cursor=${first.body.data.nextCursor}`)
    expect(second.status).toBe(200)
    const firstIds = first.body.data.items.map((item: Json) => Number(item.recordId))
    const secondIds = second.body.data.items.map((item: Json) => Number(item.recordId))
    expect(Math.min(...secondIds)).toBeGreaterThan(Math.max(...firstIds))

    // 系所管理員只看自己系所；mmd 的稽核不能出現。
    db.audit({
      versionId: 'mmd-115-day@1',
      action: 'created',
      actorId: ID.other,
      actorRole: 'student',
      actorDeptScope: 'mmd',
      detail: {},
      contentHash: 'sha256:abc',
      diffFrom: null,
    })
    const scoped = await call(base, '/api/admin/audit?limit=100')
    expect(scoped.body.data.items.every((item: Json) => item.versionId.startsWith('cse-'))).toBe(true)
  })
})

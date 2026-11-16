import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app.js'
import type { QueryFn } from '../app.js'
import { createSyncRoutes } from './sync.js'
import { AisSyncService } from '../ais/sync.js'
import type { AisSessionClient } from '../ais/sync.js'
import { loadClassificationTable } from '../ais/classify.js'
import type { AisConfigValues } from '../env.js'
import type { CaptchaSolver } from '../ais/upstream/application/ports/gateway-session.js'

const silent = { info: () => undefined, error: () => undefined }
const open: Server[] = []

const DEV_USER = {
  user_id: '6f1c0000-0000-4000-8000-000000000001',
  email: 'dev@example.com',
  role: 'student',
  google_sub: 'dev-student',
}

const config: AisConfigValues = {
  account: 'B12345678',
  password: 'secret',
  gradePassingScore: 60,
  timetableYear: null,
  timetableTerm: null,
  captchaTtlSeconds: 300,
  syncTimeoutMs: 5_000,
  ocrUrl: null,
  ocrToken: null,
}

function fakeQuery(): QueryFn {
  return async (text, params) => {
    if (text.includes('from sessions')) return { rows: [] }
    if (text.includes('where google_sub')) return { rows: [DEV_USER] }
    if (text.includes('insert into student_records')) return { rows: [{ record_key: 'x' }] }
    if (text.includes('delete from student_records')) return { rows: [] }
    if (text.includes('update users u')) return { rows: [] }
    if (text.includes('student_sync_state')) return { rows: [] }
    if (text.includes('from departments')) return { rows: params?.[0] === 'cse' ? [{ dept_id: 'cse' }] : [] }
    if (text.includes('from users where user_id = $1::uuid')) {
      return { rows: [{ dept_id: 'cse', entry_year: 113, program: 'day' }] }
    }
    if (text.includes('set dept_id')) return { rows: [{ dept_id: 'cse', entry_year: 113, program: 'day' }] }
    return { rows: [] }
  }
}

function service(query: QueryFn): AisSyncService {
  const clientFactory = (solver: CaptchaSolver): AisSessionClient => ({
    login: async () => {
      await solver.solve(new Uint8Array([1, 2, 3]))
    },
    readGrades: async () =>
      ({
        schemaVersion: 'planner-ais-v0.1',
        origin: 'fixture',
        fetchedAt: '2026-11-17T00:00:00.000Z',
        identityVerification: 'profileMatched',
        query: { kind: 'history' },
        gradePolicy: { version: 'test', source: 'test' },
        records: [
          {
            recordId: 'ais:1141-B5701-A',
            sourceRecordId: '1141-B5701-A',
            termId: '1141',
            courseCode: 'B5701',
            name: '微積分（上）',
            credits: 3,
            category: 'required',
            status: 'passed',
            classSection: 'A',
            sourceRequirement: '必修',
            semesterScore: '88',
            provisionalScore: null,
            outcome: 'numeric',
            numericScore: 88,
            reviewReasons: [],
          },
        ],
        sourceSummary: {},
        conductGrades: [],
        studentContext: { academicSystem: '大學部', division: null, department: '資訊工程學系', yearLevel: 4 },
        issues: [],
      }) as never,
    readTimetable: async () => {
      throw new Error('not used')
    },
    logout: async () => undefined,
  })
  return new AisSyncService({
    config,
    query,
    classification: loadClassificationTable(process.cwd()),
    clientFactory,
  })
}

async function start(options: { devUserSub?: string | undefined } = { devUserSub: 'dev-student' }): Promise<string> {
  const query = fakeQuery()
  const server = createServer(
    createApp({
      query,
      logger: silent,
      routes: createSyncRoutes({
        query,
        service: service(query),
        devUserSub: options.devUserSub,
        nodeEnv: 'test',
      }),
    }),
  )
  open.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('POST /api/me/sync/ais', () => {
  it('未登入回 401 AUTH_REQUIRED', async () => {
    const base = await start({ devUserSub: undefined })
    const response = await post(`${base}/api/me/sync/ais`, {})
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('AUTH_REQUIRED')
  })

  it('同源檢查：Origin 不同源回 403', async () => {
    const base = await start()
    const response = await post(`${base}/api/me/sync/ais`, {}, { Origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('AUTH_ORIGIN_MISMATCH')
  })

  it('只給帳號沒給密碼時回 400（不接受半套憑證）', async () => {
    const base = await start()
    const response = await post(`${base}/api/me/sync/ais`, { account: 'B1' })
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('REQUEST_INVALID')
  })

  it('成功開始同步：202＋驗證碼圖片＋遮蔽帳號', async () => {
    const base = await start()
    const response = await post(`${base}/api/me/sync/ais`, {})
    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body.data.captchaImage.startsWith('data:image/png;base64,')).toBe(true)
    expect(body.data.accountMasked).toBe('B12****78')
    expect(body.meta.requestId).toBeTruthy()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})

describe('POST /api/me/sync/ais/{syncId}', () => {
  it('驗證碼格式錯誤回 400', async () => {
    const base = await start()
    const started = await (await post(`${base}/api/me/sync/ais`, {})).json()
    const response = await post(`${base}/api/me/sync/ais/${started.data.syncId}`, { captcha: 'x' })
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('SYNC_CAPTCHA_INVALID')
  })

  it('成功的同步回 200，含 counts、dataSyncedAt、profile.missing 與 unmatched', async () => {
    const base = await start()
    const started = await (await post(`${base}/api/me/sync/ais`, {})).json()
    const response = await post(`${base}/api/me/sync/ais/${started.data.syncId}`, { captcha: 'A1B2' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.status).toBe('succeeded')
    expect(body.data.counts.passed).toBe(1)
    expect(body.data.dataSyncedAt).toBeTruthy()
    expect(Array.isArray(body.data.unmatched)).toBe(true)
    expect(body.data.profile.deptId).toBe('cse')
    expect(body.data.profile.missing).toEqual([])
  })

  it('不存在的 syncId 回 404 SYNC_NOT_FOUND', async () => {
    const base = await start()
    const response = await post(`${base}/api/me/sync/ais/nope`, { captcha: 'A1B2' })
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('SYNC_NOT_FOUND')
  })
})

describe('DELETE /api/me/sync/ais/{syncId}', () => {
  it('取消回 204，之後完成回 404', async () => {
    const base = await start()
    const started = await (await post(`${base}/api/me/sync/ais`, {})).json()
    const cancelled = await fetch(`${base}/api/me/sync/ais/${started.data.syncId}`, { method: 'DELETE' })
    expect(cancelled.status).toBe(204)
    const again = await post(`${base}/api/me/sync/ais/${started.data.syncId}`, { captcha: 'A1B2' })
    expect(again.status).toBe(404)
  })
})

describe('PATCH /api/me/profile', () => {
  const patch = (url: string, body: unknown) =>
    fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('入學年度不合法回 400 並指出欄位', async () => {
    const base = await start()
    const response = await patch(`${base}/api/me/profile`, { entryYear: 999 })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('REQUEST_INVALID')
    expect(body.error.details[0].field).toBe('entryYear')
  })

  it('未知系所回 400', async () => {
    const base = await start()
    const response = await patch(`${base}/api/me/profile`, { deptId: 'nope' })
    expect(response.status).toBe(400)
    expect((await response.json()).error.details[0].reason).toBe('unknown-department')
  })

  it('不允許未知欄位（避免偷偷塞 role）', async () => {
    const base = await start()
    const response = await patch(`${base}/api/me/profile`, { role: 'sysadmin' })
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('REQUEST_INVALID')
  })

  it('成功更新回 200', async () => {
    const base = await start()
    const response = await patch(`${base}/api/me/profile`, { entryYear: 113, deptId: 'cse' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.deptId).toBe('cse')
    expect(body.data.entryYear).toBe(113)
  })
})

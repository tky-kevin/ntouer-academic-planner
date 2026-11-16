import { describe, expect, it } from 'vitest'
import type { QueryFn } from '../app.js'
import { AisSyncService, DeferredCaptchaSolver, SyncError, aisErrorMessage, maskAccount } from './sync.js'
import type { AisSessionClient } from './sync.js'
import { PlannerAisError } from './errors.js'
import { loadClassificationTable } from './classify.js'
import type { AisConfigValues } from '../env.js'
import type { GradeSnapshot } from './types.js'
import type { CaptchaSolver } from './upstream/application/ports/gateway-session.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

const config = (overrides: Partial<AisConfigValues> = {}): AisConfigValues => ({
  account: 'B12345678',
  password: 'secret-password',
  gradePassingScore: 60,
  timetableYear: 114,
  timetableTerm: 2,
  captchaTtlSeconds: 300,
  syncTimeoutMs: 5_000,
  ocrUrl: null,
  ocrToken: null,
  ...overrides,
})

function gradeRecord(overrides: Partial<GradeSnapshot['records'][number]> = {}): GradeSnapshot['records'][number] {
  return {
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
    ...overrides,
  } as GradeSnapshot['records'][number]
}

function snapshot(records: GradeSnapshot['records'] = [gradeRecord()]): GradeSnapshot {
  return {
    schemaVersion: 'planner-ais-v0.1',
    origin: 'fixture',
    fetchedAt: '2026-11-17T00:00:00.000Z',
    identityVerification: 'profileMatched',
    query: { kind: 'history' },
    gradePolicy: { version: 'test', source: 'test', numericPassingScore: 60 },
    records,
    sourceSummary: {} as GradeSnapshot['sourceSummary'],
    conductGrades: [],
    studentContext: { academicSystem: '大學部', division: '日間學制', department: '資訊工程學系', yearLevel: 4 },
    issues: [],
  }
}

interface Harness {
  service: AisSyncService
  calls: { sql: string; params?: readonly unknown[] }[]
  solver: () => DeferredCaptchaSolver | null
  advance: (ms: number) => void
}

function harness(options: { config?: AisConfigValues; snapshot?: GradeSnapshot; timetable?: unknown; login?: 'ok' | 'reject' } = {}): Harness {
  const calls: { sql: string; params?: readonly unknown[] }[] = []
  const query: QueryFn = async (text, params) => {
    calls.push({ sql: text, params })
    return { rows: [] }
  }
  let solver: DeferredCaptchaSolver | null = null
  let clock = Date.parse('2026-11-17T04:00:00.000Z')
  const clientFactory = (captchaSolver: CaptchaSolver): AisSessionClient => {
    solver = captchaSolver as DeferredCaptchaSolver
    return {
      login: async () => {
        const code = await captchaSolver.solve(PNG)
        if (options.login === 'reject' || code !== 'A1B2') {
          throw new PlannerAisError('authenticationRequired', 'AIS_LOGIN_REJECTED')
        }
      },
      readGrades: async () => options.snapshot ?? snapshot(),
      readTimetable: async () => options.timetable as never,
      logout: async () => undefined,
    }
  }
  const service = new AisSyncService({
    config: options.config ?? config(),
    query,
    classification: loadClassificationTable(process.cwd()),
    clientFactory,
    now: () => clock,
  })
  return {
    service,
    calls,
    solver: () => solver,
    advance: (ms) => {
      clock += ms
    },
  }
}

describe('AIS 同步：驗證碼兩段式', () => {
  it('start 回傳驗證碼圖片與遮蔽帳號，complete 成功後把紀錄寫進資料庫', async () => {
    const h = harness()
    const started = await h.service.start({ userId: 'user-1' })
    expect(started.captchaImage.startsWith('data:image/png;base64,')).toBe(true)
    expect(started.accountMasked).toBe('B12****78')
    expect(started.source).toBe('env')

    const result = await h.service.complete('user-1', started.syncId, 'a1b2')
    expect(result.outcome.counts.total).toBeGreaterThan(0)
    expect(result.outcome.records[0].courseCode).toBe('微積分(上)')
    expect(result.outcome.records[0].category).toBe('REQ')
    const sqls = h.calls.map((call) => call.sql)
    expect(sqls.some((sql) => sql.includes('insert into student_records'))).toBe(true)
    expect(sqls.some((sql) => sql.includes('student_sync_state'))).toBe(true)
  })

  it('未設定帳密時明確拒絕，不會偷偷用空帳號登入', async () => {
    const h = harness({ config: config({ account: null, password: null }) })
    await expect(h.service.start({ userId: 'user-1' })).rejects.toMatchObject({
      code: 'AIS_CREDENTIALS_NOT_CONFIGURED',
    })
  })

  it('同一使用者同時只能有一個同步', async () => {
    const h = harness()
    await h.service.start({ userId: 'user-1' })
    await expect(h.service.start({ userId: 'user-1' })).rejects.toMatchObject({ code: 'SYNC_ALREADY_RUNNING' })
  })

  it('驗證碼格式不對時拒絕，且不消耗這次同步', async () => {
    const h = harness()
    const started = await h.service.start({ userId: 'user-1' })
    await expect(h.service.complete('user-1', started.syncId, 'abc')).rejects.toMatchObject({
      code: 'SYNC_CAPTCHA_INVALID',
    })
  })

  it('驗證碼過期後回 409 SYNC_EXPIRED', async () => {
    const h = harness({ config: config({ captchaTtlSeconds: 30 }) })
    const started = await h.service.start({ userId: 'user-1' })
    h.advance(31_000)
    await expect(h.service.complete('user-1', started.syncId, 'A1B2')).rejects.toMatchObject({ code: 'SYNC_EXPIRED' })
    expect(h.service.pendingCount()).toBe(0)
  })

  it('取消後就不能再完成', async () => {
    const h = harness()
    const started = await h.service.start({ userId: 'user-1' })
    expect(h.service.cancel('user-1', started.syncId)).toBe('cancelled')
    await expect(h.service.complete('user-1', started.syncId, 'A1B2')).rejects.toMatchObject({ code: 'SYNC_NOT_FOUND' })
  })

  it('別人的同步不能取消、也不能完成', async () => {
    const h = harness()
    const started = await h.service.start({ userId: 'user-1' })
    expect(h.service.cancel('user-2', started.syncId)).toBe('not-found')
    await expect(h.service.complete('user-2', started.syncId, 'A1B2')).rejects.toMatchObject({ code: 'SYNC_NOT_FOUND' })
  })

  it('AIS 拒絕登入時把上游代碼往上傳，訊息不含帳密，且不清空既有快照', async () => {
    const h = harness({ login: 'reject' })
    const started = await h.service.start({ userId: 'user-1' })
    await expect(h.service.complete('user-1', started.syncId, 'ZZZZ')).rejects.toMatchObject({ code: 'AIS_LOGIN_REJECTED' })
    // 失敗時不得動 student_records：前次成功快照要留著（TC-12）。
    const touchedRecords = h.calls.some(
      (call) => call.sql.includes('insert into student_records') || call.sql.includes('delete from student_records'),
    )
    expect(touchedRecords).toBe(false)
    // 只記一次失敗狀態。
    const syncStateWrites = h.calls.filter((call) => call.sql.includes('student_sync_state'))
    expect(syncStateWrites.length).toBeGreaterThan(0)
    expect(syncStateWrites.every((call) => call.sql.includes("'failed'") || call.params?.includes('failed'))).toBe(true)
    expect(aisErrorMessage(new PlannerAisError('authenticationRequired', 'AIS_LOGIN_REJECTED'))).not.toContain('secret')
  })
})

describe('AIS 同步：紀錄轉換', () => {
  it('軍訓被排除、未分類選修進 unmatched、修課中由課表補上', async () => {
    const h = harness({
      snapshot: snapshot([
        gradeRecord({ recordId: 'ais:1141-M001-A', sourceRecordId: '1141-M001-A', name: '軍訓（一）', courseCode: 'M001', credits: 0, category: 'required' }),
        gradeRecord({ recordId: 'ais:1141-B9999-A', sourceRecordId: '1141-B9999-A', name: '機器學習', courseCode: 'B9999', category: 'elective', sourceRequirement: '選修' }),
        gradeRecord(),
      ]),
      timetable: {
        schemaVersion: 'planner-ais-v0.1',
        origin: 'fixture',
        fetchedAt: '2026-11-17T00:00:00.000Z',
        termId: '1142',
        courses: [{ courseCode: 'B8000', name: '資料結構' }],
        offerings: [
          { offeringId: 'o1', courseCode: 'B8000', termId: '1142', department: '資訊工程學系', section: 'A', credits: 3, sourceRequirement: '必修', instructors: [] },
        ],
        meetings: [],
        enrollments: [],
        periods: [],
      },
    })
    const started = await h.service.start({ userId: 'user-1' })
    const result = await h.service.complete('user-1', started.syncId, 'A1B2')

    const names = result.outcome.records.map((record) => record.courseName)
    expect(names).not.toContain('軍訓（一）')
    expect(result.outcome.warnings.some((warning) => warning.includes('軍訓'))).toBe(true)
    expect(result.outcome.unmatched.map((course) => course.courseName)).toContain('機器學習')
    const inProgress = result.outcome.records.find((record) => record.courseName === '資料結構')
    expect(inProgress?.status).toBe('inProgress')
    expect(result.outcome.counts.inProgress).toBe(1)
    expect(result.outcome.profile.department).toBe('資訊工程學系')
  })

  it('沒有設定課表學期時只同步成績，並在 warnings 說明', async () => {
    const h = harness({ config: config({ timetableYear: null, timetableTerm: null }) })
    const started = await h.service.start({ userId: 'user-1' })
    const result = await h.service.complete('user-1', started.syncId, 'A1B2')
    expect(result.outcome.warnings.some((warning) => warning.includes('AIS_TIMETABLE_YEAR'))).toBe(true)
  })
})

describe('小工具', () => {
  it('遮蔽帳號只留頭尾', () => {
    expect(maskAccount('B12345678')).toBe('B12****78')
    expect(maskAccount('abc')).toBe('***')
  })

  it('SyncError 帶 HTTP 狀態', () => {
    const error = new SyncError('SYNC_EXPIRED', 409, '過期')
    expect(error.httpStatus).toBe(409)
  })
})

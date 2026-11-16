// AIS 同步編排：驗證碼兩段式（start → 使用者輸入 → complete）。
// 安全邊界（NFR-04／api-spec §4）：
//   - 帳密只存在這支服務的記憶體 state，登入成功或失敗後立刻丟棄；
//   - 不寫入資料庫、不寫入日誌、不回傳給前端（只回遮蔽後的帳號）；
//   - 前端只拿到一次性的 syncId 與驗證碼圖片。
import { randomBytes } from 'node:crypto'
import type { QueryFn } from '../app.js'
import type { AisConfigValues } from '../env.js'
import type { CaptchaSolver } from './upstream/application/ports/gateway-session.js'
import { parseAisCourseRequirement } from './upstream/protocol/ais/course-requirement.js'
import { PlannerAisClient } from './client.js'
import { PlannerAisError, safeAisError } from './errors.js'
import { classifyCourse, normalizeCourseName } from './classify.js'
import type { ClassifyInput, ClassificationTable } from './classify.js'
import type { AcademicRecord, GradeSnapshot, TimetableSnapshot } from './types.js'
import { persistSync, recordSyncFailure } from './persist.js'

export interface AisSessionClient {
  login(credentials: { account: string; password: string }): Promise<void>
  readGrades(): Promise<GradeSnapshot>
  readTimetable(rocYear: number, term: number): Promise<TimetableSnapshot>
  logout(): Promise<void>
}

export type SyncRecordStatus = 'passed' | 'failed' | 'inProgress' | 'transfer' | 'waived' | 'unknown'

export interface SyncRecord {
  recordKey: string
  courseCode: string
  courseName: string
  credits: number
  /** 規則包的 category：CE／REQ／ELE；無法判定時 `unknown`（不得猜）。 */
  category: string
  status: SyncRecordStatus
  term: string | null
  tags: string[]
  owner: 'own' | 'other'
  raw: unknown
}

export interface SyncCounts {
  total: number
  passed: number
  failed: number
  inProgress: number
  unknown: number
}

export interface UnmatchedCourse {
  courseCode: string
  courseName: string
  reason: string
}

export interface SyncOutcome {
  records: SyncRecord[]
  counts: SyncCounts
  /** 未分類的課程（畫面要列給使用者看，不假裝已分類）。 */
  unmatched: UnmatchedCourse[]
  warnings: string[]
  dataSyncedAt: string
  profile: {
    academicSystem: string | null
    division: string | null
    department: string | null
    yearLevel: number | null
  }
}

export interface StartSyncInput {
  userId: string
  /** 未提供時用 `.env.local` 的 AIS_ACCOUNT／AIS_PASSWORD。 */
  account?: string
  password?: string
}

export interface StartSyncResult {
  syncId: string
  /** `data:image/png;base64,…`；前端直接當 <img src>。 */
  captchaImage: string
  expiresAt: string
  accountMasked: string
  source: 'env' | 'request'
}

export interface CompleteSyncResult {
  outcome: SyncOutcome
  persisted: { insertedOrUpdated: number; removed: number }
}

export type CancelResult = 'cancelled' | 'not-found'

interface PendingSync {
  syncId: string
  userId: string
  createdAt: number
  /** 驗證碼輸入期限。 */
  captchaDeadline: number
  /** 使用者送出驗證碼後的整體期限。 */
  syncDeadline: number
  client: AisSessionClient
  solver: DeferredCaptchaSolver
  login: Promise<void>
  settled: boolean
}

/**
 * 驗證碼解題器：把 AIS 的驗證碼圖片交給前端，等使用者輸入。
 * AIS 登入失敗會重試並換一張新圖；本流程一次同步只收一次驗證碼，
 * 因此第二次要求直接拒絕，讓使用者重新開始（比卡住或猜圖安全）。
 */
export class DeferredCaptchaSolver implements CaptchaSolver {
  private calls = 0
  private imageReady!: (png: Uint8Array) => void
  private codeReady!: (code: string | null) => void
  private readonly image: Promise<Uint8Array>
  private readonly code: Promise<string | null>

  constructor() {
    this.image = new Promise<Uint8Array>((resolve) => {
      this.imageReady = resolve
    })
    this.code = new Promise<string | null>((resolve) => {
      this.codeReady = resolve
    })
  }

  waitForImage(): Promise<Uint8Array> {
    return this.image
  }

  async solve(png: Uint8Array): Promise<string | null> {
    this.calls += 1
    if (this.calls > 1) {
      throw new PlannerAisError('authenticationRequired', 'CAPTCHA_RETRY_REQUIRED')
    }
    this.imageReady(png)
    return this.code
  }

  provide(code: string): void {
    this.codeReady(code)
  }

  cancel(): void {
    this.codeReady(null)
  }
}

function maskAccount(account: string): string {
  const trimmed = account.trim()
  if (trimmed.length <= 3) return '***'
  if (trimmed.length <= 6) return `${trimmed.slice(0, 1)}${'*'.repeat(trimmed.length - 2)}${trimmed.slice(-1)}`
  return `${trimmed.slice(0, 3)}${'*'.repeat(Math.max(2, trimmed.length - 5))}${trimmed.slice(-2)}`
}

function countsOf(records: readonly SyncRecord[]): SyncCounts {
  return {
    total: records.length,
    passed: records.filter((record) => record.status === 'passed').length,
    failed: records.filter((record) => record.status === 'failed').length,
    inProgress: records.filter((record) => record.status === 'inProgress').length,
    unknown: records.filter((record) => record.status === 'unknown').length,
  }
}

export type SyncErrorCode =
  | 'SYNC_ALREADY_RUNNING'
  | 'SYNC_NOT_FOUND'
  | 'SYNC_EXPIRED'
  | 'SYNC_CAPTCHA_INVALID'
  | 'AIS_CREDENTIALS_NOT_CONFIGURED'
  | 'SYNC_TIMED_OUT'

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

export interface SyncServiceOptions {
  config: AisConfigValues
  query: QueryFn
  classification: ClassificationTable
  /** 測試注入用；預設建立真的 PlannerAisClient。 */
  clientFactory?: (solver: CaptchaSolver) => AisSessionClient
  now?: () => number
}

export class AisSyncService {
  private readonly pendingById = new Map<string, PendingSync>()
  private readonly pendingByUser = new Map<string, string>()
  private readonly now: () => number

  constructor(private readonly options: SyncServiceOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  private newClient(solver: CaptchaSolver): AisSessionClient {
    if (this.options.clientFactory) return this.options.clientFactory(solver)
    const { gradePassingScore, ocrUrl, ocrToken } = this.options.config
    return new PlannerAisClient({
      captchaSolver: ocrUrl ? ocrThenManual(ocrUrl, ocrToken, solver) : solver,
      gradePolicy: {
        version: 'ntou-planner-env',
        source:
          gradePassingScore === null
            ? '未設定 AIS_GRADE_PASSING_SCORE：不假設及格分數'
            : '操作者設定 AIS_GRADE_PASSING_SCORE；來源見 .env.example',
        ...(gradePassingScore === null ? {} : { numericPassingScore: gradePassingScore }),
      },
    })
  }

  async start(input: StartSyncInput): Promise<StartSyncResult> {
    const existing = this.pendingByUser.get(input.userId)
    if (existing) {
      const pending = this.pendingById.get(existing)
      if (pending && !this.isExpired(pending)) {
        throw new SyncError('SYNC_ALREADY_RUNNING', 409, '這個帳號已有一個同步在進行，請先完成或取消。')
      }
      if (pending) this.discard(pending)
    }

    const account = (input.account ?? this.options.config.account ?? '').trim()
    const password = input.password ?? this.options.config.password ?? ''
    if (!account || !password) {
      throw new SyncError(
        'AIS_CREDENTIALS_NOT_CONFIGURED',
        400,
        '尚未設定 AIS 帳密：請在 .env.local 填 AIS_ACCOUNT／AIS_PASSWORD，或在同步對話框臨時輸入。',
      )
    }

    const solver = new DeferredCaptchaSolver()
    const client = this.newClient(solver)
    const syncId = randomBytes(16).toString('base64url')
    const start = this.now()
    const pending: PendingSync = {
      syncId,
      userId: input.userId,
      createdAt: start,
      captchaDeadline: start + this.options.config.captchaTtlSeconds * 1000,
      syncDeadline: start + this.options.config.captchaTtlSeconds * 1000 + this.options.config.syncTimeoutMs,
      client,
      solver,
      login: Promise.resolve(),
      settled: false,
    }
    this.pendingById.set(syncId, pending)
    this.pendingByUser.set(input.userId, syncId)

    // 先登入直到需要驗證碼為止；帳密在這個 promise 內消耗，不再被任何地方引用。
    pending.login = client.login({ account, password })
    pending.login.catch(() => {
      // 錯誤由 start()/complete() 的 await 接手；這裡只是避免 unhandled rejection。
    })

    let image: Uint8Array
    try {
      image = await Promise.race([
        solver.waitForImage(),
        pending.login.then((): never => {
          throw new PlannerAisError('externalUnavailable', 'AIS_LOGIN_WITHOUT_CAPTCHA')
        }),
      ])
    } catch (error) {
      this.discard(pending)
      await recordSyncFailure(this.options.query, input.userId, error).catch(() => undefined)
      throw toSyncError(error)
    }

    return {
      syncId,
      captchaImage: `data:image/png;base64,${Buffer.from(image).toString('base64')}`,
      expiresAt: new Date(pending.captchaDeadline).toISOString(),
      accountMasked: maskAccount(account),
      source: input.account ? 'request' : 'env',
    }
  }

  async complete(userId: string, syncId: string, captcha: string): Promise<CompleteSyncResult> {
    const pending = this.requirePending(userId, syncId)
    if (this.now() > pending.captchaDeadline) {
      this.discard(pending)
      throw new SyncError('SYNC_EXPIRED', 409, '驗證碼已過期，請重新開始同步。')
    }
    const code = captcha.trim().toUpperCase()
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      throw new SyncError('SYNC_CAPTCHA_INVALID', 400, '驗證碼必須是四碼英數字。')
    }

    pending.solver.provide(code)
    try {
      await withTimeout(pending.login, this.options.config.syncTimeoutMs, () => {
        throw new SyncError('SYNC_TIMED_OUT', 502, 'AIS 登入逾時，請稍後重試。')
      })

      const gradeSnapshot = await withTimeout(
        pending.client.readGrades(),
        this.options.config.syncTimeoutMs,
        () => {
          throw new SyncError('SYNC_TIMED_OUT', 502, '讀取成績逾時，請稍後重試。')
        },
      )

      const warnings: string[] = []
      let timetable: TimetableSnapshot | null = null
      const { timetableYear, timetableTerm } = this.options.config
      if (timetableYear !== null && timetableTerm !== null) {
        try {
          timetable = await pending.client.readTimetable(timetableYear, timetableTerm)
        } catch (error) {
          const code2 = error instanceof PlannerAisError ? error.code : 'AIS_UNAVAILABLE'
          warnings.push(`本學期課表讀取失敗（${code2}），修課中狀態未更新。`)
        }
      } else {
        warnings.push('未設定 AIS_TIMETABLE_YEAR／AIS_TIMETABLE_TERM，這次同步不含本學期修課中資料。')
      }

      const outcome = this.buildOutcome(gradeSnapshot, timetable, warnings)
      const persisted = await persistSync({
        query: this.options.query,
        userId,
        records: outcome.records,
        departmentName: gradeSnapshot.studentContext?.department ?? null,
        syncedAt: outcome.dataSyncedAt,
      })
      this.discard(pending)
      return { outcome, persisted }
    } catch (error) {
      this.discard(pending)
      await recordSyncFailure(this.options.query, userId, error).catch(() => undefined)
      throw toSyncError(error)
    } finally {
      await pending.client.logout().catch(() => undefined)
    }
  }

  cancel(userId: string, syncId: string): CancelResult {
    const pending = this.pendingById.get(syncId)
    if (!pending || pending.userId !== userId) return 'not-found'
    this.discard(pending)
    return 'cancelled'
  }

  /** 測試與關機用：清掉所有未完成的同步。 */
  disposeAll(): void {
    for (const pending of [...this.pendingById.values()]) this.discard(pending)
  }

  pendingCount(): number {
    return this.pendingById.size
  }

  private requirePending(userId: string, syncId: string): PendingSync {
    const pending = this.pendingById.get(syncId)
    if (!pending || pending.userId !== userId) {
      throw new SyncError('SYNC_NOT_FOUND', 404, '找不到這個同步，可能已完成、已取消或已過期。')
    }
    return pending
  }

  private isExpired(pending: PendingSync): boolean {
    return this.now() > pending.syncDeadline
  }

  private discard(pending: PendingSync): void {
    if (pending.settled) return
    pending.settled = true
    pending.solver.cancel()
    this.pendingById.delete(pending.syncId)
    if (this.pendingByUser.get(pending.userId) === pending.syncId) this.pendingByUser.delete(pending.userId)
  }

  /** 把 AIS 快照轉成 student_records 需要的形狀（純函式，方便測試）。 */
  buildOutcome(snapshot: GradeSnapshot, timetable: TimetableSnapshot | null, warnings: string[]): SyncOutcome {
    const records: SyncRecord[] = []
    const unmatched: UnmatchedCourse[] = []
    const seenCourses = new Set<string>()

    for (const record of snapshot.records) {
      const requirementKind = record.sourceRequirement
        ? safeRequirementKind(record.sourceRequirement)
        : 'unknown'
      const classified = classifyCourse(this.options.classification, {
        courseName: record.name,
        courseCode: record.courseCode,
        aisRequirementKind: requirementKind,
      } as ClassifyInput)

      if (classified.decision === 'excluded') {
        warnings.push(`略過不計學分的課程：${record.name}（${classified.reason ?? '排除規則'}）`)
        continue
      }
      if (record.outcome === 'withdrawn') continue
      if (classified.decision === 'unknown') {
        unmatched.push({
          courseCode: record.courseCode,
          courseName: record.name,
          reason: classified.reason ?? '課名不在官方分類清單內',
        })
      }

      records.push({
        recordKey: `ais:grade:${record.sourceRecordId}`,
        courseCode: classified.courseCode,
        courseName: record.name,
        credits: record.credits,
        category: classified.category,
        status: toSyncStatus(record),
        term: record.termId,
        tags: classified.tags,
        owner: 'own',
        raw: {
          source: 'grades',
          sourceRecordId: record.sourceRecordId,
          termId: record.termId,
          courseCode: record.courseCode,
          courseTitle: record.name,
          credits: record.credits,
          semesterScore: record.semesterScore,
          provisionalScore: record.provisionalScore,
          outcome: record.outcome,
          numericScore: record.numericScore,
          selection: record.sourceRequirement,
          reviewReasons: record.reviewReasons,
          classifiedBy: classified.ruleId,
          classificationSource: classified.sourceId,
          classificationLocator: classified.locator,
        },
      })
      seenCourses.add(classified.courseCode)
    }

    if (timetable) {
      const names = new Map(timetable.courses.map((course) => [course.courseCode, course.name]))
      for (const offering of timetable.offerings) {
        const name = names.get(offering.courseCode) ?? offering.courseCode
        const classified = classifyCourse(this.options.classification, {
          courseName: name,
          courseCode: offering.courseCode,
        })
        if (classified.decision === 'excluded') continue
        // 同一個課號在成績裡已有紀錄時，成績紀錄優先（可能已及格）；修課中只在沒有成績時補上。
        if (seenCourses.has(classified.courseCode)) continue
        if (classified.decision === 'unknown') {
          unmatched.push({ courseCode: offering.courseCode, courseName: name, reason: classified.reason ?? '未分類' })
        }
        records.push({
          recordKey: `ais:term:${timetable.termId}:${offering.courseCode}:${offering.section}`,
          courseCode: classified.courseCode,
          courseName: name,
          credits: offering.credits,
          category: classified.category,
          status: 'inProgress',
          term: timetable.termId,
          tags: classified.tags,
          owner: 'own',
          raw: {
            source: 'timetable',
            termId: timetable.termId,
            courseCode: offering.courseCode,
            courseTitle: name,
            credits: offering.credits,
            section: offering.section,
            department: offering.department,
            instructors: offering.instructors,
            classifiedBy: classified.ruleId,
          },
        })
        seenCourses.add(classified.courseCode)
      }
    }

    return {
      records,
      counts: countsOf(records),
      unmatched,
      warnings,
      dataSyncedAt: new Date(this.now()).toISOString(),
      profile: {
        academicSystem: snapshot.studentContext?.academicSystem ?? null,
        division: snapshot.studentContext?.division ?? null,
        department: snapshot.studentContext?.department ?? null,
        yearLevel: snapshot.studentContext?.yearLevel ?? null,
      },
    }
  }
}

function safeRequirementKind(label: string): ClassifyInput['aisRequirementKind'] {
  try {
    return parseAisCourseRequirement(label).kind
  } catch {
    return 'unknown'
  }
}

function toSyncStatus(record: AcademicRecord): SyncRecordStatus {
  switch (record.status) {
    case 'passed':
      return 'passed'
    case 'failed':
      return 'failed'
    case 'unknown':
      return record.outcome === 'exempt' ? 'unknown' : 'unknown'
    default:
      return 'unknown'
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => never): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout()
          } catch (error) {
            reject(error)
          }
        }, ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function toSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error
  if (error instanceof PlannerAisError) {
    return new SyncError(error.code as SyncErrorCode, 502, aisErrorMessage(error))
  }
  return new SyncError('SYNC_TIMED_OUT', 502, '同步失敗，請稍後重試。')
}

/** AIS 錯誤碼 → 給人看的中文；不透漏帳密、HTML 或內部路徑。 */
export function aisErrorMessage(error: PlannerAisError): string {
  const messages: Record<string, string> = {
    AIS_LOGIN_REJECTED: 'AIS 拒絕登入：請確認學號與密碼（驗證碼輸入錯誤也會出現這個訊息）。',
    CAPTCHA_RECOGNITION_EXHAUSTED: '驗證碼連續錯誤，請重新開始同步。',
    CAPTCHA_RETRY_REQUIRED: '驗證碼錯誤，請重新開始同步（每次同步只能輸入一次驗證碼）。',
    AIS_STUDENT_IDENTITY_MISMATCH: '登入帳號與成績頁的學號不一致，已停止同步。',
    SESSION_REQUIRED: 'AIS 工作階段遺失，請重新同步。',
    AIS_TIMEOUT: 'AIS 回應逾時，請稍後重試。',
    AIS_UNAVAILABLE: '目前連不上 AIS，請稍後重試。',
    AIS_CREDENTIALS_NOT_CONFIGURED: '尚未設定 AIS 帳密。',
    AIS_TIMETABLE_TERM_NOT_OFFERED: 'AIS 沒有這個學期的課表。',
  }
  return messages[error.code] ?? `AIS 同步失敗（${error.code}），請稍後重試。`
}

/** 有設定 OCR 就先試 OCR，失敗自動退回人工輸入。 */
function ocrThenManual(url: string, token: string | null, manual: CaptchaSolver): CaptchaSolver {
  return {
    async solve(png: Uint8Array): Promise<string | null> {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'image/png',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: png as unknown as BodyInit,
        })
        if (response.ok) {
          const text = (await response.text()).trim()
          const json = text.startsWith('{') ? (JSON.parse(text) as { code?: string; text?: string }) : null
          const code = json?.code ?? json?.text ?? text
          if (/^[A-Za-z0-9]{4}$/.test(code)) return code.toUpperCase()
        }
      } catch {
        // OCR 不可用時退回人工輸入，不讓同步因此失敗。
      }
      return manual.solve(png)
    },
  }
}

export { maskAccount, normalizeCourseName }

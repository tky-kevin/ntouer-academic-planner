import { createHmac, randomBytes } from 'node:crypto'
import { AuthService } from './upstream/application/auth-service.js'
import { GradesService } from './upstream/application/grades-service.js'
import { TimetableService } from './upstream/application/timetable-service.js'
import { MemoryGatewaySessionStore, CryptoTokenSource, SystemClock } from './upstream/infrastructure/self_hosted/memory-session-store.js'
import { AisCourseCatalogSource } from './upstream/protocol/ais/course-catalog-source.js'
import { attachCourseDetail } from './upstream/application/course-catalog-ingestion.js'
import { parseAisGradeDetailsCallback } from './upstream/protocol/ais/grade-details-parser.js'
import type { AisCatalogCourse } from './upstream/protocol/ais/course-catalog-parser.js'
import type { AisGradesQuery } from './upstream/protocol/ais/grades-query.js'
import type { CaptchaSolver, Clock, AccountScopeDeriver } from './upstream/application/ports/gateway-session.js'
import type { AisTransport, AisTransportFactory } from './upstream/application/ports/ais-transport.js'
import { FetchAisTransportFactory } from './transport.js'
import { PlannerAisError, safeAisError } from './errors.js'
import { normalizeGrades, normalizeTimetable, normalizeCatalogPage } from './normalize.js'
import type { CourseDetailSnapshot, DataOrigin, GradePolicy } from './types.js'

export interface PlannerAisOptions {
  readonly captchaSolver: CaptchaSolver
  readonly gradePolicy: GradePolicy
  readonly transportFactory?: AisTransportFactory
  readonly publicTransport?: AisTransport
  readonly clock?: Clock
  readonly origin?: DataOrigin
}

/** One client = one student's private session. Public catalog uses a separate transport. */
export class PlannerAisClient {
  private readonly sessions: MemoryGatewaySessionStore
  private readonly auth: AuthService
  private readonly grades: GradesService
  private readonly timetable: TimetableService
  private readonly clock: Clock
  private readonly publicTransport: AisTransport
  private readonly accountScopes: AccountScopeDeriver
  private accountScope: string | null = null
  private sessionId: string | null = null
  private readonly details = new Map<string, { source: AisCourseCatalogSource; course: AisCatalogCourse }>()

  constructor(private readonly options: PlannerAisOptions) {
    this.clock = options.clock ?? new SystemClock()
    const factory = options.transportFactory ?? new FetchAisTransportFactory()
    this.publicTransport = options.publicTransport ?? new FetchAisTransportFactory().create()
    this.sessions = new MemoryGatewaySessionStore(factory, new CryptoTokenSource(), this.clock)
    const secret = randomBytes(32)
    this.accountScopes = { derive: async account => createHmac('sha256', secret).update(account).digest('base64url') }
    this.auth = new AuthService(this.sessions, options.captchaSolver, this.accountScopes)
    this.grades = new GradesService(this.sessions, this.clock)
    this.timetable = new TimetableService(this.sessions, this.clock)
  }

  async login(credentials: { account: string; password: string }): Promise<void> {
    if (this.sessionId) await this.sessions.delete(this.sessionId)
    this.sessionId = null
    this.accountScope = null
    const session = await this.auth.createSession()
    try { this.accountScope = await this.auth.login(session.id, credentials); this.sessionId = session.id }
    catch (error) { await this.sessions.delete(session.id); throw safeAisError(error) }
  }

  async logout(): Promise<void> {
    const id = this.sessionId
    this.sessionId = null
    this.accountScope = null
    if (!id) return
    try { await this.auth.logout(id) } catch (error) { throw safeAisError(error) }
  }

  async readGrades(query: AisGradesQuery = { kind: 'history' }) {
    if (!['semester', 'academic_year', 'history'].includes(query.kind)) throw new PlannerAisError('invalidRequest', 'INVALID_GRADES_QUERY')
    if (query.kind === 'semester' && !/^\d{3}[1-4]$/.test(query.termId)) throw new PlannerAisError('invalidRequest', 'INVALID_GRADES_QUERY')
    if (query.kind === 'academic_year' && (!Number.isSafeInteger(query.rocYear) || query.rocYear < 1 || query.rocYear > 999)) throw new PlannerAisError('invalidRequest', 'INVALID_GRADES_QUERY')
    try {
      const result = await this.grades.readSnapshot(this.requireSession(), query)
      const studentNumber = result.data.profile?.studentNumber
      if (studentNumber && await this.accountScopes.derive(studentNumber.trim().toUpperCase()) !== this.accountScope) {
        await this.sessions.delete(this.requireSession())
        this.sessionId = null
        this.accountScope = null
        throw new PlannerAisError('authenticationRequired', 'AIS_STUDENT_IDENTITY_MISMATCH')
      }
      return { ...normalizeGrades(result.data, this.options.gradePolicy, result.fetchedAt, this.options.origin ?? 'live'), identityVerification: studentNumber ? 'profileMatched' as const : 'sessionOnly' as const }
    } catch (error) { throw safeAisError(error) }
  }

  async readTimetable(rocYear: number, term: number) {
    try {
      const result = await this.timetable.readSnapshot(this.requireSession(), rocYear, term)
      return normalizeTimetable(result.slots, result.periods, `${String(rocYear).padStart(3, '0')}${term}`, result.fetchedAt, this.options.origin ?? 'live')
    } catch (error) { throw safeAisError(error) }
  }

  async readCatalogPage(academicYear: string, pageNumber = 1) {
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new PlannerAisError('invalidRequest', 'INVALID_CATALOG_PAGE')
    try {
      const source = new AisCourseCatalogSource(this.publicTransport, { academicYears: [academicYear] })
      const partitions = await source.partitions()
      const page = await source.page(partitions[0]!, pageNumber)
      const normalized = normalizeCatalogPage(page.courses, page.pageNumber, page.totalPages, page.totalRows)
      page.courses.forEach((course, index) => this.details.set(normalized.offerings[index]!.offeringId, { source, course }))
      return { schemaVersion: 'planner-ais-v0.1' as const, origin: this.options.origin ?? 'live', fetchedAt: this.clock.now().toISOString(), ...normalized }
    } catch (error) { throw safeAisError(error) }
  }

  async readCourseDetail(id: string): Promise<CourseDetailSnapshot> {
    const entry = this.details.get(id)
    if (!entry) throw new PlannerAisError('invalidRequest', 'OFFERING_NOT_LOADED')
    try {
      const detail = await entry.source.detail(entry.course)
      const checked = attachCourseDetail({ identityKey: entry.course.identityKey, list: entry.course, detail: null, occurrences: [] }, detail)
      if ('reason' in checked || !checked.detail) throw new PlannerAisError('dataInvalid', 'COURSE_DETAIL_IDENTITY_MISMATCH')
      return { origin: this.options.origin ?? 'live', offeringId: id, detail: checked.detail }
    } catch (error) { throw safeAisError(error) }
  }

  private requireSession(): string {
    if (!this.sessionId) throw new PlannerAisError('authenticationRequired', 'SESSION_REQUIRED', true)
    return this.sessionId
  }
}

/** Grade-details parser adapter; live detail navigation is deliberately not guessed. */
export function parseGradeDetails(raw: string) {
  try { return parseAisGradeDetailsCallback(raw) } catch (error) { throw safeAisError(error) }
}

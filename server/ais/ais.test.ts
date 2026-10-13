import { describe, it, expect, vi, afterEach } from 'vitest'
import { PlannerAisClient, parseGradeDetails } from './client.js'
import { auditGradeSnapshot, normalizeGrades, normalizeTimetable, normalizeCatalogPage } from './normalize.js'
import { parseAisGradesCallback } from './upstream/protocol/ais/grades-parser.js'
import { parseAisTimetableCallbacks, parseAisTimetablePeriods } from './upstream/protocol/ais/timetable-parser.js'
import { parseAisCourseCatalogCallback } from './upstream/protocol/ais/course-catalog-parser.js'
import { parseAisCourseDetailPage } from './upstream/protocol/ais/course-detail-parser.js'
import { fixture, ScriptedTransport } from './testing/scripted-transport.js'
import { fixtureClient, fixturePolicy, fixedClock, loginSteps, gradeSteps } from './testing/scenarios.js'
import { testRules } from '../../src/data/testRules.js'

afterEach(() => vi.unstubAllGlobals())
const credentials = { account: 'FIXTURE01', password: 'fixture-pass' }

describe('Planner AIS fixture integration', () => {
  it('登入 → 歷年成績 → 同一檢核引擎 → 課表 → 公開課程與 detail，完全不使用網路', async () => {
    const network = vi.fn(() => { throw new Error('Network is forbidden in fixtures') })
    vi.stubGlobal('fetch', network)
    const { client, privateTransport, publicTransport } = fixtureClient()
    await client.login(credentials)
    const grades = await client.readGrades()
    const report = auditGradeSnapshot(grades, testRules)
    expect(grades.origin).toBe('fixture')
    expect(grades.records).toHaveLength(10)
    expect(report.audit.summary).toEqual({ totalCredits: 11, requiredCredits: 6, electiveCredits: 3 })
    expect(report.audit.conditions).toMatchObject([
      { threshold: 12, earnedCredits: 11, deficit: 1, passed: false },
      { threshold: 6, earnedCredits: 6, deficit: 0, passed: true },
      { threshold: 6, earnedCredits: 3, deficit: 3, passed: false },
    ])
    expect(report.audit.countedRecords.map(record => record.courseCode)).toEqual(['A', 'B', 'C', 'U'])
    expect(report.hasUnresolvedData).toBe(true)
    const timetable = await client.readTimetable(114, 2)
    expect(timetable.offerings).toHaveLength(2)
    expect(timetable.enrollments).toHaveLength(2)
    expect(timetable.meetings).toHaveLength(3)
    expect(timetable.enrollments.every(record => record.status === 'inProgress')).toBe(true)
    expect(timetable.periods[0]).toMatchObject({ id: '0', startsAt: { hour: 6, minute: 20 } })
    const catalog = await client.readCatalogPage('114')
    expect(catalog.offerings).toHaveLength(2)
    expect(catalog.totalPages).toBe(1)
    const detail = await client.readCourseDetail(catalog.offerings[0]!.offeringId)
    expect(detail.detail.courseCode).toBe('FAKE101')
    expect(detail.detail.outline.zh).toBeTruthy()
    expect(detail.detail.meetingSlots.length).toBeGreaterThan(0)
    const query = new URLSearchParams(privateTransport.requests[8]!.body)
    expect(query.get('QUERY_TYPE')).toBe('RB_TYPE_3')
    expect(new URLSearchParams(privateTransport.requests[2]!.body).get('M_PW2')).toBe('A1B2')
    const exported = JSON.stringify({ grades, timetable, catalog, detail })
    for (const forbidden of ['fixture-pass', 'FAKE_VIEW_STATE', '__VIEWSTATE', 'detailEventTarget', 'FIXTURE-STUDENT']) expect(exported).not.toContain(forbidden)
    expect(network).not.toHaveBeenCalled()
    privateTransport.assertComplete()
    publicTransport.assertComplete()
  })

  it('單學期與學年查詢只保留指定範圍', async () => {
    const { client } = fixtureClient([...loginSteps, ...gradeSteps('planner-grades.callback.txt', 'query_grades'), ...gradeSteps('planner-grades.callback.txt', 'query_grades')], [])
    await client.login(credentials)
    const semester = await client.readGrades({ kind: 'semester', termId: '1132' })
    expect(semester.records.map(record => record.courseCode)).toEqual(['X', 'A'])
    const year = await client.readGrades({ kind: 'academic_year', rocYear: 113 })
    expect(year.records).toHaveLength(9)
    expect(year.records.every(record => record.termId.startsWith('113'))).toBe(true)
  })

  it('原始數字與暫存成績不直接等同及格；缺少及格政策時保留待確認', () => {
    const parsed = parseAisGradesCallback(fixture('planner-grades.callback.txt'), { kind: 'history' })
    const snapshot = normalizeGrades(parsed, { version: 'unknown', source: '尚未核對' }, fixedClock.now().toISOString(), 'fixture')
    expect(snapshot.records[1]).toMatchObject({ outcome: 'numeric', status: 'unknown', reviewReasons: ['gradingPolicyMissing'] })
    const x = snapshot.records.find(record => record.courseCode === 'X')!
    expect(x).toMatchObject({ status: 'unknown', outcome: 'unpublished', provisionalScore: '90' })
    expect(auditGradeSnapshot(snapshot, testRules).audit.summary).toEqual({ totalCredits: 0, requiredCredits: 0, electiveCredits: 0 })
  })

  it('抵免、退選與未知分類保留語意；已及格未知分類只計總學分', () => {
    const parsed = parseAisGradesCallback(fixture('planner-grades.callback.txt'), { kind: 'history' })
    const snapshot = normalizeGrades(parsed, fixturePolicy, fixedClock.now().toISOString(), 'fixture')
    expect(snapshot.records.find(record => record.courseCode === 'U')).toMatchObject({ category: 'unknown', status: 'passed', reviewReasons: ['classificationUnknown'] })
    expect(snapshot.records.find(record => record.courseCode === 'W')).toMatchObject({ status: 'unknown', outcome: 'withdrawn' })
    expect(snapshot.records.find(record => record.courseCode === 'E')).toMatchObject({ status: 'unknown', outcome: 'exempt' })
    const exempt = normalizeGrades(parsed, { ...fixturePolicy, countExemptCredits: true }, fixedClock.now().toISOString(), 'fixture')
    expect(auditGradeSnapshot(exempt, testRules).audit.summary).toEqual({ totalCredits: 14, requiredCredits: 9, electiveCredits: 3 })
  })

  it('分數政策可替換，不在 adapter 中寫死及格分數', () => {
    const parsed = parseAisGradesCallback(fixture('planner-grades.callback.txt'), { kind: 'history' })
    const snapshot = normalizeGrades(parsed, { ...fixturePolicy, numericPassingScore: 80 }, fixedClock.now().toISOString(), 'fixture')
    expect(auditGradeSnapshot(snapshot, testRules).audit.summary).toEqual({ totalCredits: 6, requiredCredits: 3, electiveCredits: 3 })
    expect(() => normalizeGrades(parsed, { ...fixturePolicy, numericPassingScore: NaN }, '', 'fixture')).toThrow('INVALID_GRADE_POLICY')
  })

  it('課表重複時段不增加修課筆數，班別與學期有獨立識別', () => {
    const slots = parseAisTimetableCallbacks(fixture('timetable-list.callback.txt'), fixture('timetable-grid.callback.txt'), '1142')
    const periods = parseAisTimetablePeriods(fixture('timetable-grid.callback.txt'))
    const snapshot = normalizeTimetable([...slots, slots[0]!], periods, '1142', '', 'fixture')
    expect(snapshot.offerings).toHaveLength(2)
    expect(snapshot.meetings).toHaveLength(3)
    expect(snapshot.offerings.map(item => item.credits)).toEqual([3, 2])
    expect(() => normalizeTimetable(slots, periods, '1132', '', 'fixture')).toThrow('TIMETABLE_TERM_MISMATCH')
    expect(() => normalizeTimetable([...slots, { ...slots[0]!, credits: 9 }], periods, '1142', '', 'fixture')).toThrow('TIMETABLE_CREDITS_CONFLICT')
  })

  it('成績明細保留期中、期末、扣考與平時成績；空資料正常', () => {
    expect(parseGradeDetails(fixture('grade-details.callback.txt'))).toMatchObject({ midtermAssessment: '84', finalAssessment: '91', semesterScore: '88', finalDisqualification: '#', continuousAssessments: [{ courseCode: 'FAKE601', score: '90' }] })
    expect(parseGradeDetails(fixture('grade-details-empty.callback.txt')).continuousAssessments).toEqual([])
    expect(() => parseGradeDetails('<html>changed</html>')).toThrow()
  })

  it('空成績、必需欄位變更與重複資料分開處理', () => {
    const empty = parseAisGradesCallback('0|查無資料', { kind: 'history' })
    const snapshot = normalizeGrades(empty, fixturePolicy, '', 'fixture')
    expect(snapshot.records).toEqual([])
    expect(auditGradeSnapshot(snapshot, testRules).audit.conditions.map(item => item.deficit)).toEqual([12, 6, 6])
    const raw = fixture('planner-grades.callback.txt')
    expect(() => parseAisGradesCallback(raw.replace('<th>學分</th>', '<th>changed</th>'), { kind: 'history' })).toThrow('grades_credits_header_changed')
    const row = raw.match(/<tr><td>1121[\s\S]*?<\/tr>/)![0]
    expect(() => parseAisGradesCallback(raw.replace('</table>', row + '</table>'), { kind: 'history' })).toThrow('invalid_grade_row')
  })

  it('公開課程欄位重排可解析，未知欄位漂移會回報失敗', () => {
    expect(parseAisCourseCatalogCallback(fixture('course-catalog-reordered.callback.txt'), 'fixture', 'partition')).toHaveLength(1)
    expect(() => parseAisCourseCatalogCallback(fixture('course-catalog.callback.txt').replace('<th>學分</th>', '<th>changed</th>'), 'fixture', 'partition')).toThrow()
  })

  it('detail 身份不符拒絕綁定；非必要欄位缺漏保留 warning', async () => {
    const { catalogSteps } = await import('./testing/scenarios.js')
    const steps = catalogSteps.map(step => step.operation === 'course_catalog_detail' ? { ...step, fixture: undefined, body: fixture('planner-course-detail.html').replaceAll('FAKE101', 'WRONG-CODE') } : step)
    const { client } = fixtureClient([], steps)
    const catalog = await client.readCatalogPage('114')
    await expect(client.readCourseDetail(catalog.offerings[0]!.offeringId)).rejects.toMatchObject({ code: 'COURSE_DETAIL_IDENTITY_MISMATCH' })
    const detail = parseAisCourseDetailPage(fixture('course-detail.html').replaceAll('M_ENG_TARGET', 'missing_optional'))
    expect(detail.warnings).toContainEqual(expect.objectContaining({ field: 'M_ENG_TARGET', code: 'control_missing' }))
  })

  it('課程識別不依賴抓取快照 ID；換快照仍可對應同一開課班別', () => {
    const first = parseAisCourseCatalogCallback(fixture('course-catalog.callback.txt'), 'snapshot-one', 'partition')
    const second = parseAisCourseCatalogCallback(fixture('course-catalog.callback.txt'), 'snapshot-two', 'partition')
    expect(first[0]!.id).toBe(second[0]!.id)
    expect(normalizeCatalogPage(first, 1, 1, 2).offerings[0]!.offeringId).toBe(normalizeCatalogPage(second, 1, 1, 2).offerings[0]!.offeringId)
  })

  it('未登入、無效 query 與未載入課程不發送查詢', async () => {
    const { client, privateTransport, publicTransport } = fixtureClient([], [])
    await expect(client.readGrades()).rejects.toMatchObject({ kind: 'authenticationRequired', code: 'SESSION_REQUIRED' })
    await expect(client.readGrades({ kind: 'semester', termId: 'bogus' })).rejects.toMatchObject({ kind: 'invalidRequest' })
    await expect(client.readTimetable(114, 2)).rejects.toMatchObject({ kind: 'authenticationRequired' })
    await expect(client.readCourseDetail('unknown')).rejects.toMatchObject({ code: 'OFFERING_NOT_LOADED' })
    expect(privateTransport.requests).toEqual([])
    expect(publicTransport.requests).toEqual([])
  })

  it('登入被拒絕後不能取得私人資料，錯誤不暴露表單或密碼', async () => {
    const { client } = fixtureClient([...loginSteps.slice(0, 2), { operation: 'login', fixture: 'login-current.html' }], [])
    await expect(client.login(credentials)).rejects.toMatchObject({ kind: 'authenticationRequired', code: 'AIS_LOGIN_REJECTED' })
    await expect(client.readGrades()).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
  })

  it('失敗的驗證碼辨識最多三次，必需隱藏欄位缺漏拒絕登入', async () => {
    const steps = Array.from({ length: 3 }).flatMap(() => loginSteps.slice(0, 2))
    const transport = new ScriptedTransport(steps)
    const client = new PlannerAisClient({ captchaSolver: { solve: async () => null }, gradePolicy: fixturePolicy, transportFactory: { create: () => transport } })
    await expect(client.login(credentials)).rejects.toMatchObject({ code: 'CAPTCHA_RECOGNITION_EXHAUSTED' })
    expect(transport.requests).toHaveLength(6)
    transport.assertComplete()
    const bad = fixtureClient([{ operation: 'create_auth_challenge', fixture: 'login-missing-hidden.html' }], [])
    await expect(bad.client.login(credentials)).rejects.toMatchObject({ code: 'AIS_LOGIN_FORM_CHANGED' })
  })

  it('登入後回到登入頁視為 session 失效；伺服器錯誤與欄位漂移分開分類', async () => {
    const expired = fixtureClient([...loginSteps, { operation: 'read_grades_menu', fixture: 'login-current.html' }], [])
    await expired.client.login(credentials)
    await expect(expired.client.readGrades()).rejects.toMatchObject({ kind: 'authenticationRequired' })
    const unavailable = fixtureClient([...loginSteps, { operation: 'read_grades_menu', body: '', status: 503 }], [])
    await unavailable.client.login(credentials)
    await expect(unavailable.client.readGrades()).rejects.toMatchObject({ kind: 'externalUnavailable' })
    const changed = fixtureClient([...loginSteps, { operation: 'read_grades_menu', body: '<html>unexpected</html>' }], [])
    await changed.client.login(credentials)
    await expect(changed.client.readGrades()).rejects.toMatchObject({ kind: 'contractChanged' })
  })

  it('登出清除 session，即使遠端登出失敗也不保留存取能力', async () => {
    const { client } = fixtureClient([...loginSteps, { operation: 'logout', body: '', status: 503 }], [])
    await client.login(credentials)
    await expect(client.logout()).rejects.toMatchObject({ kind: 'externalUnavailable' })
    await expect(client.readGrades()).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
  })

  it('課程第二頁送出正確 postback，保留更新後的表單 state', async () => {
    const { catalogSteps } = await import('./testing/scenarios.js')
    const firstPage = fixture('course-catalog.callback.txt').replace('id="PC_TotalPage">1', 'id="PC_TotalPage">2').replace('id="PC_TotalRow">2', 'id="PC_TotalRow">101')
    const secondPage = firstPage.replace('name="PC$PageNo" value="1"', 'name="PC$PageNo" value="2"')
    const steps = catalogSteps.slice(0, 11).map(step => step.fixture === 'course-catalog.callback.txt' ? { ...step, fixture: undefined, body: firstPage } : step)
    steps.push({ operation: 'course_catalog_page', body: secondPage, contentType: 'text/plain' })
    const { client, publicTransport } = fixtureClient([], steps)
    const page = await client.readCatalogPage('114', 2)
    expect(page).toMatchObject({ pageNumber: 2, totalPages: 2, totalRows: 101 })
    const body = new URLSearchParams(publicTransport.requests[11]!.body)
    expect(body.get('PC$PageNo')).toBe('2')
    expect(body.get('__VIEWSTATE')).toBe('FAKE_NEXT_STATE')
    publicTransport.assertComplete()
  })

  it('新版登入驗證碼 bootstrap 導頁與表單重新載入', async () => {
    const initial = fixture('login-current.html').replace('src="/Temp/Captcha/A1B2C3D4E5F6G7H8I9J0K1L2.png?nonce=fake-query"', '').replace('<body>', "<body><script>location.href='DefaultQ.aspx';</script>")
    const { client, privateTransport } = fixtureClient([
      { operation: 'create_auth_challenge', body: initial },
      { operation: 'bootstrap_auth_captcha', body: "<script>location.href='Default.aspx';</script>" },
      { operation: 'refresh_auth_challenge', fixture: 'login-current.html' },
      ...loginSteps.slice(1),
    ], [])
    await client.login(credentials)
    privateTransport.assertComplete()
  })

  it('超過 session 閒置期限後，私人查詢在發送前拒絕', async () => {
    const transport = new ScriptedTransport(loginSteps)
    let now = fixedClock.now()
    const client = new PlannerAisClient({ gradePolicy: fixturePolicy, captchaSolver: { solve: async () => 'A1B2' }, transportFactory: { create: () => transport }, clock: { now: () => now } })
    await client.login(credentials)
    now = new Date(now.getTime() + 31 * 60_000)
    await expect(client.readGrades()).rejects.toMatchObject({ kind: 'authenticationRequired' })
    transport.assertComplete()
  })

  it('成績 profile 的學號需符合登入帳號，身份不符即清除 session', async () => {
    const raw = fixture('grades-history.callback.txt')
    const steps = [...loginSteps, ...gradeSteps('grades-history.callback.txt')]
    const wrong = fixtureClient(steps, [])
    await wrong.client.login(credentials)
    await expect(wrong.client.readGrades()).rejects.toMatchObject({ code: 'AIS_STUDENT_IDENTITY_MISMATCH' })
    await expect(wrong.client.readGrades()).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
    const correctSteps = steps.map(step => step.fixture === 'grades-history.callback.txt' ? { ...step, fixture: undefined, body: raw.replace('FIXTURE-STUDENT', 'FIXTURE01') } : step)
    const correct = fixtureClient(correctSteps, [])
    await correct.client.login(credentials)
    expect((await correct.client.readGrades()).identityVerification).toBe('profileMatched')
  })
})

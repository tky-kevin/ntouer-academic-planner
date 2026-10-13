import { fixtureClient } from '../server/ais/testing/scenarios.js'
import { fixture } from '../server/ais/testing/scripted-transport.js'
import { auditGradeSnapshot, parseGradeDetails } from '../server/ais/index.js'
import { testRules } from '../src/data/testRules.js'

const { client, privateTransport, publicTransport } = fixtureClient()
await client.login({ account: 'FIXTURE01', password: 'fixture-pass' })
const grades = await client.readGrades()
const timetable = await client.readTimetable(114, 2)
const catalog = await client.readCatalogPage('114')
const detail = await client.readCourseDetail(catalog.offerings[0]!.offeringId)
const gradeDetails = parseGradeDetails(fixture('grade-details.callback.txt'))
privateTransport.assertComplete()
publicTransport.assertComplete()
const report = auditGradeSnapshot(grades, testRules)
console.log(JSON.stringify({ notice: '全部是 fixture 模擬資料；開發測試規則，僅檢核部分條件', origin: grades.origin, gradePolicy: grades.gradePolicy, gradeRecords: grades.records.length, audit: report.audit.summary, deficits: report.audit.conditions.map(item => ({ id: item.conditionId, deficit: item.deficit, passed: item.passed })), unresolved: grades.issues, timetable: { courses: timetable.courses.length, offerings: timetable.offerings.length, enrollments: timetable.enrollments.length, meetings: timetable.meetings.length }, catalog: { offerings: catalog.offerings.length, pages: catalog.totalPages }, detail: { courseCode: detail.detail.courseCode, scheduleStatus: detail.detail.scheduleStatus, warnings: detail.detail.warnings.length }, gradeDetails: { continuousAssessments: gradeDetails.continuousAssessments.length }, networkRequests: 0 }, null, 2))

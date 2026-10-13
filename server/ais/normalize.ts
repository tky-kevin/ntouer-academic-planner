import { checkCredits } from '../../src/engine/checkCredits.js'
import type { CreditRuleSet } from '../../src/domain/types.js'
import type { AisGradesResult } from './upstream/protocol/ais/grades-parser.js'
import type { AisTimetablePeriod, AisTimetableSlot } from './upstream/protocol/ais/timetable-parser.js'
import type { AisCatalogCourse } from './upstream/protocol/ais/course-catalog-parser.js'
import { parseAisCourseRequirement } from './upstream/protocol/ais/course-requirement.js'
import { PlannerAisError } from './errors.js'
import type { AcademicRecord, DataOrigin, GradeOutcome, GradePolicy, GradeSnapshot, TimetableSnapshot, CourseOffering, CatalogPage } from './types.js'

function outcome(value: string | null): { kind: GradeOutcome; score: number | null } {
  const text = value?.trim() ?? ''
  if (text === '' || text.startsWith('+')) return { kind: 'unpublished', score: null }
  if (/^\d+(?:\.\d+)?$/.test(text) && Number(text) <= 100) return { kind: 'numeric', score: Number(text) }
  if (text === '通過') return { kind: 'passed', score: null }
  if (text === '不通過' || text.startsWith('*')) return { kind: 'failed', score: null }
  if (/^W$/i.test(text)) return { kind: 'withdrawn', score: null }
  if (text === '抵') return { kind: 'exempt', score: null }
  return { kind: 'other', score: null }
}

export function normalizeGrades(parsed: AisGradesResult, policy: GradePolicy, fetchedAt: string, origin: DataOrigin): GradeSnapshot {
  if (policy.numericPassingScore !== undefined && (!Number.isFinite(policy.numericPassingScore) || policy.numericPassingScore < 0 || policy.numericPassingScore > 100)) {
    throw new PlannerAisError('invalidRequest', 'INVALID_GRADE_POLICY')
  }
  const records: AcademicRecord[] = parsed.courses.map(course => {
    const result = outcome(course.semesterScore)
    const reasons: string[] = []
    const sourceKind = course.selection.trim() ? parseAisCourseRequirement(course.selection).kind : 'unknown'
    const category = sourceKind === 'required' || sourceKind === 'elective' ? sourceKind : 'unknown'
    if (category === 'unknown') reasons.push('classificationUnknown')
    let status: AcademicRecord['status'] = 'unknown'
    if (result.kind === 'passed') status = 'passed'
    else if (result.kind === 'failed') status = 'failed'
    else if (result.kind === 'numeric' && policy.numericPassingScore !== undefined) status = result.score! >= policy.numericPassingScore ? 'passed' : 'failed'
    else if (result.kind === 'exempt' && policy.countExemptCredits === true) status = 'passed'
    else if (result.kind !== 'withdrawn') reasons.push(result.kind === 'numeric' ? 'gradingPolicyMissing' : result.kind === 'exempt' ? 'exemptionPolicyMissing' : result.kind)
    return {
      recordId: `ais:${course.id}`, sourceRecordId: course.id, termId: course.termId,
      courseCode: course.courseCode, name: course.courseTitle, classSection: course.classSection,
      credits: course.credits, category, status, sourceRequirement: course.selection,
      semesterScore: course.semesterScore, provisionalScore: course.provisionalScore,
      outcome: result.kind, numericScore: result.score, reviewReasons: reasons,
    }
  })
  return {
    schemaVersion: 'planner-ais-v0.1', origin, fetchedAt, identityVerification: 'notChecked', query: parsed.query, gradePolicy: { ...policy }, records,
    sourceSummary: parsed.summary, conductGrades: parsed.conductGrades,
    studentContext: parsed.profile === null ? null : {
      academicSystem: parsed.profile.academicSystem, division: parsed.profile.division,
      department: parsed.profile.department, yearLevel: parsed.profile.yearLevel,
    },
    issues: records.filter(record => record.reviewReasons.length > 0).map(record => ({ recordId: record.recordId, reasons: record.reviewReasons })),
  }
}

export function auditGradeSnapshot(snapshot: GradeSnapshot, rules: CreditRuleSet) {
  return { audit: checkCredits(snapshot.records, rules), issues: snapshot.issues, hasUnresolvedData: snapshot.issues.length > 0, scopeLabel: '部分條件已檢核' as const }
}

export function offeringId(termId: string, courseCode: string, department: string, section: string): string {
  return `ais-offering:${[termId, courseCode, department, section].map(encodeURIComponent).join('/')}`
}

export function normalizeTimetable(slots: readonly AisTimetableSlot[], periods: readonly AisTimetablePeriod[], termId: string, fetchedAt: string, origin: DataOrigin): TimetableSnapshot {
  const offerings = new Map<string, CourseOffering>()
  const courses = new Map<string, { courseCode: string; name: string }>()
  const meetings = new Map<string, TimetableSnapshot['meetings'][number]>()
  for (const slot of slots) {
    if (slot.termId !== termId) throw new PlannerAisError('dataInvalid', 'TIMETABLE_TERM_MISMATCH')
    const id = offeringId(slot.termId, slot.courseCode, slot.department, slot.section)
    const prior = offerings.get(id)
    if (prior && prior.credits !== slot.credits) throw new PlannerAisError('dataInvalid', 'TIMETABLE_CREDITS_CONFLICT')
    offerings.set(id, { offeringId: id, termId: slot.termId, courseCode: slot.courseCode, department: slot.department, section: slot.section, credits: slot.credits, sourceRequirement: slot.requirement, instructors: slot.instructor ? [slot.instructor] : [] })
    courses.set(slot.courseCode, { courseCode: slot.courseCode, name: slot.courseTitle })
    const key = `${id}|${slot.weekday}|${slot.periodId}|${slot.classroom ?? ''}`
    meetings.set(key, { offeringId: id, weekday: slot.weekday, periodId: slot.periodId, classroom: slot.classroom })
  }
  return {
    schemaVersion: 'planner-ais-v0.1', origin, fetchedAt, termId, courses: [...courses.values()], offerings: [...offerings.values()], meetings: [...meetings.values()], periods,
    enrollments: [...offerings.keys()].map(id => ({ enrollmentId: `enrollment:${id}`, offeringId: id, status: 'inProgress' })),
  }
}

export function normalizeCatalogPage(courses: readonly AisCatalogCourse[], pageNumber: number, totalPages: number, totalRows: number): CatalogPage {
  return {
    pageNumber, totalPages, totalRows,
    courses: [...new Map(courses.map(course => [course.courseCode, { courseCode: course.courseCode, name: course.courseTitle }])).values()],
    offerings: courses.map(course => ({ offeringId: offeringId(course.termId, course.courseCode, course.department, course.section), termId: course.termId, courseCode: course.courseCode, department: course.department, section: course.section, credits: course.credits, sourceRequirement: course.requirementRawLabel ?? course.requirement, instructors: course.instructors })),
  }
}

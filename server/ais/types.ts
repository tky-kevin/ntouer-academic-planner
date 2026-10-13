import type { CourseRecord } from '../../src/domain/types.js'
import type { AisCourseDetail } from './upstream/protocol/ais/course-detail-parser.js'
import type { AisGradeSummary } from './upstream/protocol/ais/grades-parser.js'
import type { AisGradesQuery } from './upstream/protocol/ais/grades-query.js'
import type { AisTimetablePeriod } from './upstream/protocol/ais/timetable-parser.js'

export type DataOrigin = 'fixture' | 'live'
export type GradeOutcome = 'numeric' | 'passed' | 'failed' | 'withdrawn' | 'exempt' | 'unpublished' | 'other'
export interface GradePolicy {
  readonly version: string
  readonly source: string
  /** Omit when no verified numeric grading policy is available. No default passing score. */
  readonly numericPassingScore?: number
  readonly countExemptCredits?: boolean
}
export interface AcademicRecord extends CourseRecord {
  readonly sourceRecordId: string
  readonly termId: string
  readonly classSection: string | null
  readonly sourceRequirement: string
  readonly semesterScore: string | null
  readonly provisionalScore: string | null
  readonly outcome: GradeOutcome
  readonly numericScore: number | null
  readonly reviewReasons: readonly string[]
}
export interface GradeSnapshot {
  readonly schemaVersion: 'planner-ais-v0.1'
  readonly origin: DataOrigin
  readonly fetchedAt: string
  readonly identityVerification: 'notChecked' | 'sessionOnly' | 'profileMatched'
  readonly query: AisGradesQuery
  readonly gradePolicy: GradePolicy
  readonly records: readonly AcademicRecord[]
  readonly sourceSummary: AisGradeSummary
  readonly conductGrades: readonly { termId: string; score: string }[]
  readonly studentContext: { academicSystem: string | null; division: string | null; department: string | null; yearLevel: number | null } | null
  readonly issues: readonly { recordId: string; reasons: readonly string[] }[]
}
export interface CourseDefinition { readonly courseCode: string; readonly name: string }
export interface CourseOffering {
  readonly offeringId: string
  readonly courseCode: string
  readonly termId: string
  readonly department: string
  readonly section: string
  readonly credits: number
  readonly sourceRequirement: string
  readonly instructors: readonly string[]
}
export interface MeetingSlot {
  readonly offeringId: string
  readonly weekday: number
  readonly periodId: string
  readonly classroom: string | null
}
export interface TimetableSnapshot {
  readonly schemaVersion: 'planner-ais-v0.1'
  readonly origin: DataOrigin
  readonly fetchedAt: string
  readonly termId: string
  readonly courses: readonly CourseDefinition[]
  readonly offerings: readonly CourseOffering[]
  readonly meetings: readonly MeetingSlot[]
  readonly enrollments: readonly { enrollmentId: string; offeringId: string; status: 'inProgress' }[]
  readonly periods: readonly AisTimetablePeriod[]
}
export interface CatalogPage {
  readonly pageNumber: number
  readonly totalPages: number
  readonly totalRows: number
  readonly courses: readonly CourseDefinition[]
  readonly offerings: readonly CourseOffering[]
}
export interface CourseDetailSnapshot {
  readonly origin: DataOrigin
  readonly offeringId: string
  /** Parsed fields only; no HTML, Cookie, WebForms fields or navigation callbacks. */
  readonly detail: AisCourseDetail
}

import { PlannerAisClient } from '../client.js'
import { ScriptedTransport } from './scripted-transport.js'
import type { FixtureStep } from './scripted-transport.js'
import type { GradePolicy } from '../types.js'

export const fixturePolicy: GradePolicy = { version: 'fixture-grading-v0.1', source: '人工開發測試及格規則；不是正式學校規定', numericPassingScore: 60 }
export const fixedClock = { now: () => new Date('2026-10-14T00:00:00.000Z') }
export const loginSteps: readonly FixtureStep[] = [
  { operation: 'create_auth_challenge', fixture: 'login-current.html' },
  { operation: 'fetch_auth_captcha', contentType: 'image/png', body: new Uint8Array([137,80,78,71,13,10,26,10]) },
  { operation: 'login', fixture: 'authenticated-shell.html', method: 'POST' },
]
export function gradeSteps(rawFixture = 'planner-grades.callback.txt', queryOperation = 'query_grades_history'): FixtureStep[] {
  return [
    { operation: 'read_grades_menu', fixture: 'menu-tree-root.html' },
    { operation: 'expand_grades_menu_group', fixture: 'menu-tree-academic.callback.txt', contentType: 'text/plain' },
    { operation: 'expand_grades_menu_group', fixture: 'menu-tree-grades.callback.txt', contentType: 'text/plain' },
    { operation: 'open_grades_feature', fixture: 'grades-loader.html' },
    { operation: 'read_grades_query_page', fixture: 'grades-query-page.html' },
    { operation: queryOperation, fixture: rawFixture },
  ]
}
export const timetableSteps: readonly FixtureStep[] = [
  { operation: 'read_timetable_menu', fixture: 'menu-tree-root.html' },
  { operation: 'expand_timetable_menu_group', fixture: 'menu-tree-academic.callback.txt', contentType: 'text/plain' },
  { operation: 'expand_timetable_menu_group', fixture: 'menu-tree-selection.callback.txt', contentType: 'text/plain' },
  { operation: 'open_timetable_feature', fixture: 'timetable-loader.html' },
  { operation: 'read_timetable_query_page', fixture: 'timetable-query-page.html' },
  { operation: 'query_timetable_list', fixture: 'timetable-list.callback.txt', contentType: 'text/plain' },
  { operation: 'query_timetable_grid', fixture: 'timetable-grid.callback.txt', contentType: 'text/plain' },
]
export const catalogSteps: readonly FixtureStep[] = [
  { operation: 'course_catalog_public_shell', fixture: 'course-catalog-public-shell.html' },
  { operation: 'course_catalog_public_entry', fixture: 'course-catalog-public-entry.html' },
  { operation: 'course_catalog_query_page', fixture: 'course-catalog-query-page.html' },
  { operation: 'course_catalog_public_shell', fixture: 'course-catalog-public-shell.html' },
  { operation: 'course_catalog_public_entry', fixture: 'course-catalog-public-entry.html' },
  { operation: 'course_catalog_query_page', fixture: 'course-catalog-query-page.html' },
  ...['course_catalog_select_academic_year', 'course_catalog_select_term', 'course_catalog_select_degree', 'course_catalog_unit_query', 'course_catalog_page_size'].map(operation => ({ operation, fixture: 'course-catalog.callback.txt', contentType: 'text/plain' })),
  { operation: 'course_catalog_detail_target', fixture: 'course-detail-target.callback.txt', contentType: 'text/plain' },
  { operation: 'course_catalog_detail', fixture: 'planner-course-detail.html' },
]
export function fixtureClient(privateSteps: readonly FixtureStep[] = [...loginSteps, ...gradeSteps(), ...timetableSteps], publicSteps: readonly FixtureStep[] = catalogSteps, policy: GradePolicy = fixturePolicy) {
  const privateTransport = new ScriptedTransport(privateSteps)
  const publicTransport = new ScriptedTransport(publicSteps)
  const client = new PlannerAisClient({ captchaSolver: { solve: async () => 'A1B2' }, gradePolicy: policy, transportFactory: { create: () => privateTransport }, publicTransport, clock: fixedClock, origin: 'fixture' })
  return { client, privateTransport, publicTransport }
}

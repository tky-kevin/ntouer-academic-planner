import type { CourseRecord } from '../domain/types'

export type SampleId = 'insufficient' | 'exact' | 'excess' | 'empty' | 'failed' | 'duplicate' | 'retake'

export interface RecordSample {
  readonly id: SampleId
  readonly name: string
  readonly description: string
  readonly records: readonly CourseRecord[]
}

const courseA: CourseRecord = { recordId: 'rec-A-01', courseCode: 'A', name: '課程 A', credits: 3, category: 'required', status: 'passed' }
const courseB: CourseRecord = { recordId: 'rec-B-01', courseCode: 'B', name: '課程 B', credits: 3, category: 'required', status: 'passed' }
const courseC: CourseRecord = { recordId: 'rec-C-01', courseCode: 'C', name: '課程 C', credits: 3, category: 'elective', status: 'passed' }
const courseD: CourseRecord = { recordId: 'rec-D-01', courseCode: 'D', name: '課程 D', credits: 3, category: 'elective', status: 'passed' }
const courseX: CourseRecord = { recordId: 'rec-X-01', courseCode: 'X', name: '課程 X', credits: 3, category: 'elective', status: 'passed' }
const exactRecords = [courseA, courseB, courseC, courseD]

/** AP-I1-02：修課紀錄與預期結果分開管理。 */
export const recordSamples: readonly RecordSample[] = [
  { id: 'insufficient', name: '不足', description: 'A、B、C 及格', records: [courseA, courseB, courseC] },
  { id: 'exact', name: '剛好達標', description: 'A、B、C、D 及格', records: exactRecords },
  { id: 'excess', name: '超過門檻', description: '再加入選修課程 X', records: [...exactRecords, courseX] },
  { id: 'empty', name: '空資料', description: '沒有修課紀錄', records: [] },
  { id: 'failed', name: '不及格', description: 'A、B、C 及格；D 不及格', records: [courseA, courseB, courseC, { ...courseD, status: 'failed' }] },
  { id: 'duplicate', name: '重複紀錄', description: '達標資料加上同一筆 A', records: [...exactRecords, { ...courseA }] },
  { id: 'retake', name: '簡單重修', description: '達標資料加上 A 的不及格紀錄', records: [...exactRecords, { ...courseA, recordId: 'rec-A-previous', status: 'failed' }] },
]

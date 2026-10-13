import type { SampleId } from './sampleRecords'
import type { ConditionId, CreditSummary } from '../domain/types'

interface SampleExpectation {
  readonly summary: CreditSummary
  readonly conditions: Readonly<Record<ConditionId, { earnedCredits: number; deficit: number; passed: boolean }>>
  readonly allConditionsMet: boolean
}

/** 獨立、直接列明的測試答案；畫面及引擎不得匯入此檔。 */
export const sampleExpectations: Readonly<Record<SampleId, SampleExpectation>> = {
  insufficient: {
    summary: { totalCredits: 9, requiredCredits: 6, electiveCredits: 3 },
    conditions: {
      'total-credits': { earnedCredits: 9, deficit: 3, passed: false },
      'required-credits': { earnedCredits: 6, deficit: 0, passed: true },
      'elective-credits': { earnedCredits: 3, deficit: 3, passed: false },
    },
    allConditionsMet: false,
  },
  exact: {
    summary: { totalCredits: 12, requiredCredits: 6, electiveCredits: 6 },
    conditions: {
      'total-credits': { earnedCredits: 12, deficit: 0, passed: true },
      'required-credits': { earnedCredits: 6, deficit: 0, passed: true },
      'elective-credits': { earnedCredits: 6, deficit: 0, passed: true },
    },
    allConditionsMet: true,
  },
  excess: {
    summary: { totalCredits: 15, requiredCredits: 6, electiveCredits: 9 },
    conditions: {
      'total-credits': { earnedCredits: 15, deficit: 0, passed: true },
      'required-credits': { earnedCredits: 6, deficit: 0, passed: true },
      'elective-credits': { earnedCredits: 9, deficit: 0, passed: true },
    },
    allConditionsMet: true,
  },
  empty: {
    summary: { totalCredits: 0, requiredCredits: 0, electiveCredits: 0 },
    conditions: {
      'total-credits': { earnedCredits: 0, deficit: 12, passed: false },
      'required-credits': { earnedCredits: 0, deficit: 6, passed: false },
      'elective-credits': { earnedCredits: 0, deficit: 6, passed: false },
    },
    allConditionsMet: false,
  },
  failed: {
    summary: { totalCredits: 9, requiredCredits: 6, electiveCredits: 3 },
    conditions: {
      'total-credits': { earnedCredits: 9, deficit: 3, passed: false },
      'required-credits': { earnedCredits: 6, deficit: 0, passed: true },
      'elective-credits': { earnedCredits: 3, deficit: 3, passed: false },
    },
    allConditionsMet: false,
  },
  duplicate: {
    summary: { totalCredits: 12, requiredCredits: 6, electiveCredits: 6 },
    conditions: {
      'total-credits': { earnedCredits: 12, deficit: 0, passed: true },
      'required-credits': { earnedCredits: 6, deficit: 0, passed: true },
      'elective-credits': { earnedCredits: 6, deficit: 0, passed: true },
    },
    allConditionsMet: true,
  },
  retake: {
    summary: { totalCredits: 12, requiredCredits: 6, electiveCredits: 6 },
    conditions: {
      'total-credits': { earnedCredits: 12, deficit: 0, passed: true },
      'required-credits': { earnedCredits: 6, deficit: 0, passed: true },
      'elective-credits': { earnedCredits: 6, deficit: 0, passed: true },
    },
    allConditionsMet: true,
  },
}

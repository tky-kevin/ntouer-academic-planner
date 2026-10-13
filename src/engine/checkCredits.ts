import type { CourseRecord, CreditAuditResult, CreditRuleSet, ExcludedRecord } from '../domain/types'

/** AP-I1-03：純函式；門檻與分類選取由規則資料決定。 */
export function checkCredits(records: readonly CourseRecord[], rules: CreditRuleSet): CreditAuditResult {
  const seenRecordIds = new Set<string>()
  const countedCourseCodes = new Set<string>()
  const countedRecords: CourseRecord[] = []
  const excludedRecords: ExcludedRecord[] = []

  records.forEach((record, inputIndex) => {
    if (seenRecordIds.has(record.recordId)) {
      excludedRecords.push({ record, inputIndex, reason: 'duplicate-record' })
      return
    }
    seenRecordIds.add(record.recordId)

    if (record.status !== 'passed') {
      excludedRecords.push({ record, inputIndex, reason: record.status })
      return
    }
    if (countedCourseCodes.has(record.courseCode)) {
      excludedRecords.push({ record, inputIndex, reason: 'duplicate-course' })
      return
    }
    countedCourseCodes.add(record.courseCode)
    countedRecords.push(record)
  })

  const sumCredits = (items: readonly CourseRecord[]) => items.reduce((sum, record) => sum + record.credits, 0)
  const summary = {
    totalCredits: sumCredits(countedRecords),
    requiredCredits: sumCredits(countedRecords.filter(record => record.category === 'required')),
    electiveCredits: sumCredits(countedRecords.filter(record => record.category === 'elective')),
  }
  const conditions = rules.conditions.map(condition => {
    const applicableRecords = countedRecords.filter(record => condition.category === 'all' || record.category === condition.category)
    const earnedCredits = sumCredits(applicableRecords)
    return {
      conditionId: condition.id,
      label: condition.label,
      threshold: condition.minimumCredits,
      earnedCredits,
      deficit: Math.max(condition.minimumCredits - earnedCredits, 0),
      passed: earnedCredits >= condition.minimumCredits,
      countedRecords: applicableRecords,
    }
  })

  return {
    ruleVersion: rules.version,
    scope: rules.scope,
    summary,
    conditions,
    allConditionsMet: conditions.every(condition => condition.passed),
    countedRecords,
    excludedRecords,
  }
}

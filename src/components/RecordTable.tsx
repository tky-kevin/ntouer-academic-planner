import type { CourseRecord, CreditAuditResult, ExclusionReason } from '../domain/types'
import { Icon } from './Icon'

const statusLabels = { passed: '及格', failed: '不及格', unknown: '尚未確認' } as const
const exclusionLabels: Record<ExclusionReason, string> = {
  'duplicate-record': '重複紀錄',
  failed: '不及格排除',
  unknown: '未知排除',
  'duplicate-course': '同課已採計',
}

interface RecordTableProps {
  records: readonly CourseRecord[]
  result: CreditAuditResult | null
}

export function RecordTable({ records, result }: RecordTableProps) {
  const excludedByIndex = new Map(result?.excludedRecords.map(item => [item.inputIndex, item.reason]))
  return (
    <>
      <p className="mobile-table-hint">可左右滑動查看完整紀錄。</p>
      <div className="table-scroll" role="region" aria-label="已載入修課紀錄" tabIndex={0}>
        <table>
          <caption className="sr-only">模擬修課紀錄；採計結果於執行檢核後更新</caption>
          <thead><tr><th scope="col">課程</th><th scope="col">紀錄 ID</th><th scope="col" className="number-cell">學分</th><th scope="col">類別</th><th scope="col">修課狀態</th><th scope="col">採計</th></tr></thead>
          <tbody>
            {records.map((record, index) => {
              const reason = excludedByIndex.get(index)
              return (
                <tr key={`${record.recordId}-${index}`} className={reason ? 'excluded-row' : undefined}>
                  <th scope="row"><span className="course-name">{record.name}</span><span className="course-code">課號 {record.courseCode}</span></th>
                  <td className="record-id">{record.recordId}</td>
                  <td className="number-cell">{record.credits}</td>
                  <td>{record.category === 'required' ? '必修' : record.category === 'elective' ? '選修' : '分類待確認'}</td>
                  <td><span className={`status-badge status-${record.status}`}>{statusLabels[record.status]}</span></td>
                  <td><span className={result && !reason ? 'counted-label' : 'muted'}>{result ? reason ? exclusionLabels[reason] : '已採計' : '待檢核'}</span></td>
                </tr>
              )
            })}
            {records.length === 0 && <tr><td colSpan={6} className="empty-records"><Icon name="file" /><strong>此樣本沒有修課紀錄</strong><span>仍可執行檢核，查看零學分時的缺額。</span></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

import type { ConditionResult, CreditCondition } from '../domain/types'
import { Icon } from './Icon'

interface ResultCardProps {
  condition: CreditCondition
  result?: ConditionResult
}

export function ResultCard({ condition, result }: ResultCardProps) {
  const stateClass = result ? result.passed ? 'result-met' : 'result-unmet' : 'result-pending'
  return (
    <article className={`result-card ${stateClass}`} aria-label={`${condition.label}結果`}>
      <div className="result-card-heading"><h3>{condition.label}</h3><span className="result-status">{result ? result.passed ? <><Icon name="check" />已達標</> : '未達標' : '待檢核'}</span></div>
      <p className="credit-value"><strong>{result?.earnedCredits ?? '—'}</strong><span> / {result?.threshold ?? condition.minimumCredits} 學分</span></p>
      <div className="credit-track" aria-hidden="true"><span style={{ transform: `scaleX(${result ? result.threshold === 0 ? 1 : Math.min(result.earnedCredits / result.threshold, 1) : 0})` }} /></div>
      <p className="credit-deficit">{result ? <>尚缺 <strong>{result.deficit}</strong> 學分</> : '執行後顯示已取得學分與缺額'}</p>
      {result && <details className="counted-details"><summary>採計紀錄（{result.countedRecords.length} 筆）</summary>{result.countedRecords.length > 0 ? <ul>{result.countedRecords.map(record => <li key={record.recordId}><span>{record.name} <small>{record.recordId}</small></span><span>{record.credits} 學分</span></li>)}</ul> : <p>無符合採計條件的紀錄。</p>}</details>}
    </article>
  )
}

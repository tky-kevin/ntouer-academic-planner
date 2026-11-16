import type { AdminProblem } from '../pages/adminShared'
import { problemTitle } from '../pages/adminShared'

/** 401／403／409／422 的共用錯誤區塊：標題依狀態分支，422 逐條列出 details。 */
export function AdminProblemPanel({ problem }: { problem: AdminProblem }) {
  return (
    <section className="state-panel" role="alert" aria-labelledby="problem-heading">
      <h2 id="problem-heading">{problemTitle(problem)}</h2>
      <p>{problem.message}</p>
      {problem.details.length > 0 ? (
        <ul className="error-list">
          {problem.details.map((detail, index) => (
            <li key={`${detail.field ?? 'detail'}-${index}`}>
              <div className="error-head">
                {detail.field ? <code>{detail.field}</code> : null}
                <span>{problem.code}</span>
              </div>
              <p>{detail.reason}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="state-request-id">請求編號：{problem.requestId ?? '（未提供）'}</p>
    </section>
  )
}

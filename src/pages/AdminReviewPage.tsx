import { useState } from 'react'
import { Alert } from '../components/Alert'
import { DiffView } from '../components/DiffView'
import { Icon } from '../components/Icon'
import { SourcePanel } from '../components/SourcePanel'
import { mockReview } from '../data/mockAdmin'
import type { AdminReviewData } from '../data/mockAdmin'

export default function AdminReviewPage({ data = mockReview }: { data?: AdminReviewData }) {
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const canReject = reason.trim().length > 0

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>
      <header className="app-header">
        <div className="page-width header-content">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="file" />
            </span>
            <div>
              <h1>
                NTOUER <span>Academic Planner</span>
              </h1>
              <p>規則管理端</p>
            </div>
          </div>
          <span className="iteration-label">
            管理端 <span>{data.versionId}</span>
          </span>
        </div>
      </header>

      <main id="main-content" className="page-width admin-main">
        <div className="admin-intro">
          <h2>審核與差異</h2>
          <p>與上一個版本比較，逐節點分成四類。</p>
        </div>

        {data.proxy ? (
          <Alert tone="warning" title="未經系所管理者審核">
            這個版本由系統管理員代理發布，請確認是否要保留「代理」標示。
          </Alert>
        ) : null}

        <div className="admin-grid">
          <section className="panel" aria-labelledby="diff-heading">
            <h3 id="diff-heading">版本差異</h3>
            <DiffView items={data.diff} />
          </section>
          <SourcePanel sources={data.sources} />
        </div>

        <section className="panel review-panel" aria-labelledby="review-heading">
          <h3 id="review-heading">審核意見</h3>
          <label className="field" htmlFor="review-reason">
            退回原因（核准時可留空）
          </label>
          <textarea
            id="review-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：系內選修下限與手冊第 3 條不一致"
          />
          <div className="review-actions">
            <button className="button-secondary" type="button" disabled={!canReject} onClick={() => setMessage('已退回，請修正後重新送審。')}>
              退回
            </button>
            <button className="button-primary" type="button" onClick={() => setMessage('已核准，等待發布。')}>
              核准
            </button>
            {message ? <p role="status">{message}</p> : null}
          </div>
        </section>
      </main>

      <footer className="page-width app-footer">
        <span>NTOUER Academic Planner · I2</span>
        <p>退回必須填原因；核准與退回都會寫入 review_records。</p>
      </footer>
    </>
  )
}

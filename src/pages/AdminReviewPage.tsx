import { useEffect, useState } from 'react'
import { Alert } from '../components/Alert'
import { AdminProblemPanel } from '../components/AdminProblemPanel'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { Skeleton } from '../components/Skeleton'
import * as adminApi from '../api/admin'
import type {
  AdminAuditItem,
  AdminAuditPage,
  AdminAuditQuery,
  AdminDiff,
  AdminDiffItem,
  AdminPublishResult,
  AdminTransitionResult,
  AdminVersion,
} from '../api/admin'
import {
  actionLabel,
  formatTime,
  loadErrorTitle,
  problemFrom,
  statusLabel,
  versionIdFromQuery,
} from './adminShared'
import type { AdminProblem } from './adminShared'

export interface AdminReviewApi {
  getAdminVersion: (versionId: string) => Promise<AdminVersion>
  getDiff: (versionId: string) => Promise<AdminDiff>
  getAudit: (query?: AdminAuditQuery) => Promise<AdminAuditPage>
  approveVersion: (versionId: string) => Promise<AdminTransitionResult>
  rejectVersion: (versionId: string, reason: string) => Promise<AdminTransitionResult>
  publishVersion: (versionId: string) => Promise<AdminPublishResult>
}

export interface AdminReviewPageProps {
  /** 測試或內嵌時直接指定；省略就讀網址 `?versionId=…`。 */
  versionId?: string | null
  api?: AdminReviewApi
}

type LoadState = 'missing' | 'loading' | 'ready' | 'error'
type Outcome = AdminProblem | { kind: 'info'; title: string; message: string }
type DiffDomain = '條件' | '條文' | '來源'

const AUDIT_PAGE_SIZE = 20

const DIFF_GROUPS = [
  { kind: 'added', label: '新增' },
  { kind: 'removed', label: '刪除' },
  { kind: 'changed', label: '變更' },
] as const

type DomainDiffItem = AdminDiffItem & { domain: DiffDomain }

function mergeDiff(diff: AdminDiff | null): DomainDiffItem[] {
  if (!diff) return []
  return [
    ...diff.requirements.map((item) => ({ ...item, domain: '條件' as const })),
    ...diff.clauses.map((item) => ({ ...item, domain: '條文' as const })),
    ...diff.sources.map((item) => ({ ...item, domain: '來源' as const })),
  ]
}

function auditDetailText(detail: unknown): string | null {
  if (typeof detail !== 'object' || detail === null) return null
  const record = detail as Record<string, unknown>
  if (typeof record.reason === 'string' && record.reason.length > 0) return `原因：${record.reason}`
  return null
}

export default function AdminReviewPage({ versionId, api = adminApi }: AdminReviewPageProps) {
  const requestedVersionId = versionId === undefined ? versionIdFromQuery() : versionId
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<AdminProblem | null>(null)
  const [version, setVersion] = useState<AdminVersion | null>(null)
  const [diff, setDiff] = useState<AdminDiff | null>(null)
  const [auditItems, setAuditItems] = useState<AdminAuditItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<AdminProblem | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | 'publish' | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [published, setPublished] = useState<AdminPublishResult | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!requestedVersionId) {
      setLoadState('missing')
      setVersion(null)
      return
    }
    let active = true
    setLoadState('loading')
    setLoadError(null)
    setOutcome(null)
    setPublished(null)
    Promise.all([
      api.getAdminVersion(requestedVersionId),
      api.getDiff(requestedVersionId),
      api.getAudit({ versionId: requestedVersionId, limit: AUDIT_PAGE_SIZE }),
    ])
      .then(([nextVersion, nextDiff, audit]) => {
        if (!active) return
        setVersion(nextVersion)
        setDiff(nextDiff)
        setAuditItems(audit.items)
        setNextCursor(audit.nextCursor)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setLoadError(problemFrom(error, '無法載入規則版本。'))
        setLoadState('error')
      })
    return () => {
      active = false
    }
  }, [api, requestedVersionId, reloadKey])

  const can = (action: 'approve' | 'reject' | 'publish'): boolean =>
    version?.allowedActions.includes(action) ?? false
  const diffItems = mergeDiff(diff)

  async function runApprove() {
    if (!version || busy) return
    setBusy('approve')
    setOutcome(null)
    try {
      const data = await api.approveVersion(version.versionId)
      setVersion((current) =>
        current ? { ...current, status: data.status, allowedActions: ['publish'] } : current,
      )
      setOutcome({ kind: 'info', title: '已核准', message: '審核意見已記錄，可以發布這個版本。' })
    } catch (error) {
      setOutcome(problemFrom(error))
    } finally {
      setBusy(null)
    }
  }

  async function runReject() {
    if (!version || busy || reason.trim().length === 0) return
    setBusy('reject')
    setOutcome(null)
    try {
      const data = await api.rejectVersion(version.versionId, reason.trim())
      setVersion((current) =>
        current ? { ...current, status: data.status, allowedActions: [] } : current,
      )
      setOutcome({ kind: 'info', title: '已退回', message: '退回原因已記錄，請修正後重新送審。' })
    } catch (error) {
      setOutcome(problemFrom(error))
    } finally {
      setBusy(null)
    }
  }

  async function runPublish() {
    if (!version || busy) return
    setBusy('publish')
    setOutcome(null)
    try {
      const data = await api.publishVersion(version.versionId)
      setVersion((current) =>
        current
          ? {
              ...current,
              status: data.status,
              proxy: data.proxy,
              publishedAt: data.publishedAt,
              allowedActions: [],
            }
          : current,
      )
      setPublished(data)
      setOutcome({
        kind: 'info',
        title: '已發布',
        message: `版本 ${data.versionId} 已發布（proxy=${String(data.proxy)}）。`,
      })
    } catch (error) {
      setOutcome(problemFrom(error))
    } finally {
      setBusy(null)
    }
  }

  async function loadMoreAudit() {
    if (!version || !nextCursor || auditLoading) return
    setAuditLoading(true)
    setAuditError(null)
    try {
      const page = await api.getAudit({
        versionId: version.versionId,
        cursor: nextCursor,
        limit: AUDIT_PAGE_SIZE,
      })
      setAuditItems((items) => [...items, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (error) {
      setAuditError(problemFrom(error, '無法載入更多稽核紀錄。'))
    } finally {
      setAuditLoading(false)
    }
  }

  const headerVersionId = version?.versionId ?? requestedVersionId ?? '未指定'
  const rejectDisabled = !can('reject') || reason.trim().length === 0 || busy !== null

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
            管理端 <span>{headerVersionId}</span>
          </span>
        </div>
      </header>

      <main id="main-content" className="page-width admin-main">
        <div className="admin-intro">
          <h2>審核與差異</h2>
          <p>
            {version
              ? `${version.bundleId}｜${version.versionId}｜${statusLabel(version.status)}`
              : '與前一個版本比較，分成新增、刪除、變更三類；審核動作會寫入 review_records。'}
          </p>
        </div>

        {loadState === 'missing' ? (
          <EmptyState
            title="請指定 versionId"
            description="在網址加上 ?versionId=<bundleId>@<versionNo>，例如 /admin-review.html?versionId=cse-113-day@2。"
          />
        ) : null}

        {loadState === 'loading' ? <Skeleton /> : null}

        {loadState === 'error' && loadError ? (
          <section className="state-panel" role="alert">
            <h2>{loadErrorTitle(loadError)}</h2>
            <p>{loadError.message}</p>
            <dl className="state-details">
              <div>
                <dt>錯誤代碼</dt>
                <dd>{loadError.code}</dd>
              </div>
              <div>
                <dt>請求編號</dt>
                <dd>{loadError.requestId ?? '（未提供）'}</dd>
              </div>
            </dl>
            {loadError.status === 401 ? (
              <a className="button-primary" href="/auth/google/start">
                用 Google 登入
              </a>
            ) : (
              <button className="button-secondary" type="button" onClick={() => setReloadKey((key) => key + 1)}>
                重新載入
              </button>
            )}
          </section>
        ) : null}

        {loadState === 'ready' && version ? (
          <>
            {version.proxy ? (
              <Alert tone="warning" title="未經系所管理者審核">
                這個版本由系統管理員代理發布，請確認是否要保留「代理」標示。
              </Alert>
            ) : null}

            {published ? (
              <section className="state-panel" role="status" aria-labelledby="published-heading">
                <h2 id="published-heading">已發布</h2>
                <p>
                  版本 {published.versionId} 已發布（{formatTime(published.publishedAt)}）。
                </p>
                <p>
                  proxy：<code>{String(published.proxy)}</code>
                  {published.proxy
                    ? '（由系統管理員代理發布，未經系所管理者審核）'
                    : '（由系所管理員審核後發布）'}
                </p>
                {published.superseded.length > 0 ? (
                  <p>被取代的版本：{published.superseded.join('、')}</p>
                ) : null}
              </section>
            ) : null}

            <section className="panel" aria-labelledby="version-heading">
              <h3 id="version-heading">版本資訊</h3>
              <dl className="admin-meta">
                <div>
                  <dt>versionId</dt>
                  <dd>
                    <code>{version.versionId}</code>
                  </dd>
                </div>
                <div>
                  <dt>status</dt>
                  <dd>
                    <span className="tag">{statusLabel(version.status)}</span>
                    <code>{version.status}</code>
                  </dd>
                </div>
                <div>
                  <dt>contentHash</dt>
                  <dd>
                    <code>{version.contentHash}</code>
                  </dd>
                </div>
                <div>
                  <dt>previousVersionId</dt>
                  <dd>
                    <code>{diff?.previousVersionId ?? '（無前一版）'}</code>
                  </dd>
                </div>
              </dl>
            </section>

            <div className="admin-grid">
              <section className="panel" aria-labelledby="diff-heading">
                <h3 id="diff-heading">版本差異</h3>
                <p className="empty-note">
                  相對 {diff?.previousVersionId ?? '（無前一版）'}：新增 {diff?.summary.added ?? 0}、刪除{' '}
                  {diff?.summary.removed ?? 0}、變更 {diff?.summary.changed ?? 0}。差異由結構比較產生。
                </p>
                <div className="diff-view">
                  {DIFF_GROUPS.map(({ kind, label }) => {
                    const group = diffItems.filter((item) => item.kind === kind)
                    return (
                      <section className={`diff-group diff-${kind}`} key={kind} aria-labelledby={`diff-${kind}`}>
                        <h4 id={`diff-${kind}`}>
                          {label} <span className="quiet-count">{group.length}</span>
                        </h4>
                        {group.length === 0 ? (
                          <p className="empty-note">沒有{label}的項目。</p>
                        ) : (
                          <ul className="diff-list">
                            {group.map((item) => (
                              <li key={`${item.domain}-${kind}-${item.id}`}>
                                <div className="diff-line">
                                  <code>{item.id}</code>
                                  <span>{item.label ?? item.id}</span>
                                  <span className="tag">{item.domain}</span>
                                  {item.clauseId ? <span className="tag">{item.clauseId}</span> : null}
                                </div>
                                {item.before !== undefined || item.after !== undefined ? (
                                  <p className="diff-values">
                                    {item.before !== undefined ? <del>{item.before}</del> : null}
                                    {item.before !== undefined && item.after !== undefined ? <span>→</span> : null}
                                    {item.after !== undefined ? <ins>{item.after}</ins> : null}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    )
                  })}
                </div>
              </section>

              <section className="panel" aria-labelledby="audit-heading">
                <h3 id="audit-heading">稽核紀錄</h3>
                <p className="empty-note">依 record_id 升冪，用 cursor 分頁；不使用 offset。</p>
                {auditItems.length === 0 ? (
                  <p className="empty-note">這個版本還沒有稽核紀錄。</p>
                ) : (
                  <ol className="audit-list">
                    {auditItems.map((item) => {
                      const detail = auditDetailText(item.detail)
                      return (
                        <li key={item.recordId}>
                          <div className="audit-head">
                            <span className="tag">{actionLabel(item.action)}</span>
                            <code>{item.action}</code>
                            <span>{formatTime(item.at)}</span>
                          </div>
                          <p className="empty-note">
                            {item.actorRole}｜{item.actorId ?? '（系統）'}
                            {item.actorDeptScope ? `｜${item.actorDeptScope}` : ''}
                          </p>
                          {detail ? <p>{detail}</p> : null}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {auditError ? <AdminProblemPanel problem={auditError} /> : null}
                {nextCursor ? (
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={loadMoreAudit}
                    disabled={auditLoading}
                  >
                    {auditLoading ? '載入中…' : '載入更多'}
                  </button>
                ) : null}
              </section>
            </div>

            <section className="panel review-panel" aria-labelledby="review-heading">
              <h3 id="review-heading">審核意見</h3>
              <label className="field" htmlFor="review-reason">
                退回原因（核准或發布時可留空）
              </label>
              <textarea
                id="review-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="例如：系內選修下限與手冊第 3 條不一致"
              />
              <p className="empty-note">
                核准前後端會重驗權限與內容；發布後不可原地修改，只能從已發布版本複製新草稿。
                proxy=true 表示由系統管理員代理發布、未經系所管理者審核，發布後畫面必須保留這個標示。
              </p>
              <div className="review-actions">
                <button
                  className="button-secondary"
                  type="button"
                  onClick={runReject}
                  disabled={rejectDisabled}
                >
                  {busy === 'reject' ? '退回中…' : '退回'}
                </button>
                <button
                  className="button-primary"
                  type="button"
                  onClick={runApprove}
                  disabled={!can('approve') || busy !== null}
                >
                  {busy === 'approve' ? '核准中…' : '核准'}
                </button>
                <button
                  className="button-primary"
                  type="button"
                  onClick={runPublish}
                  disabled={!can('publish') || busy !== null}
                >
                  {busy === 'publish' ? '發布中…' : '發布'}
                </button>
              </div>
              {outcome?.kind === 'info' ? (
                <Alert tone="info" title={outcome.title}>
                  {outcome.message}
                </Alert>
              ) : null}
              {outcome?.kind === 'problem' ? <AdminProblemPanel problem={outcome} /> : null}
            </section>
          </>
        ) : null}
      </main>

      <footer className="page-width app-footer">
        <span>NTOUER Academic Planner · I2</span>
        <p>退回必須填原因；核准與退回都會寫入 review_records。</p>
      </footer>
    </>
  )
}

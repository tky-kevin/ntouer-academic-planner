import { useEffect, useState } from 'react'
import { Alert } from '../components/Alert'
import { AdminProblemPanel } from '../components/AdminProblemPanel'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { Skeleton } from '../components/Skeleton'
import * as adminApi from '../api/admin'
import type {
  AdminAction,
  AdminTestRecord,
  AdminTestResult,
  AdminValidationResult,
  AdminVersion,
  AdminVersionStatus,
} from '../api/admin'
import {
  formatTime,
  loadErrorTitle,
  problemFrom,
  statusLabel,
  versionIdFromQuery,
} from './adminShared'
import type { AdminProblem } from './adminShared'

/** 只依賴這幾個呼叫，測試可以注入替身而不碰全域 fetch。 */
export interface AdminValidateApi {
  getAdminVersion: (versionId: string) => Promise<AdminVersion>
  validateVersion: (versionId: string) => Promise<AdminValidationResult>
  testVersion: (versionId: string, records?: AdminTestRecord[]) => Promise<AdminTestResult>
  submitVersion: (versionId: string) => Promise<{ versionId: string; status: AdminVersionStatus }>
}

export interface AdminValidatePageProps {
  /** 測試或內嵌時直接指定；省略就讀網址 `?versionId=…`。 */
  versionId?: string | null
  api?: AdminValidateApi
}

type Outcome =
  | { kind: 'validated'; data: AdminValidationResult }
  | { kind: 'tested'; data: AdminTestResult }
  | { kind: 'submitted'; status: AdminVersionStatus }
  | AdminProblem

type LoadState = 'missing' | 'loading' | 'ready' | 'error'

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function parseRecords(raw: string): AdminTestRecord[] | AdminProblem {
  if (raw.trim().length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      kind: 'problem',
      status: 400,
      code: 'REQUEST_INVALID',
      message: '測試紀錄必須是合法 JSON。',
      details: [],
      requestId: null,
    }
  }
  if (!Array.isArray(parsed)) {
    return {
      kind: 'problem',
      status: 400,
      code: 'REQUEST_INVALID',
      message: '測試紀錄必須是 JSON 陣列，例如 [{"courseCode":"CS101","credits":3,"status":"pass"}]。',
      details: [],
      requestId: null,
    }
  }
  return parsed as AdminTestRecord[]
}

function TestResultPanel({ data }: { data: AdminTestResult }) {
  const emptyData = data.suite === 'empty-data'
  return (
    <section className="panel" aria-labelledby="test-result-heading">
      <h3 id="test-result-heading">測試結果</h3>
      <p className="empty-note">
        suite：<code>{data.suite}</code>
        {emptyData ? '（空資料檢核；缺額不算失敗，失敗只代表引擎或 payload 壞掉）' : '（使用提供的測試紀錄）'}
      </p>
      <dl className="admin-meta">
        <div>
          <dt>通過</dt>
          <dd>{data.passed}</dd>
        </div>
        <div>
          <dt>失敗</dt>
          <dd>{data.failed}</dd>
        </div>
        <div>
          <dt>overall</dt>
          <dd>{data.overall ?? '（無）'}</dd>
        </div>
        <div>
          <dt>totalCredits</dt>
          <dd>{data.totalCredits ?? '（無）'}</dd>
        </div>
      </dl>
      <ul className="test-list">
        {data.results.map((result, index) => (
          <li key={`${result.name}-${index}`}>
            <span>{result.name}</span>
            <span className={`state-pill state-${result.status === 'passed' ? 'met' : 'notMet'}`}>
              {result.status === 'passed' ? '通過' : '失敗'}
            </span>
            {result.detail ? <p className="empty-note">{result.detail}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function AdminValidatePage({ versionId, api = adminApi }: AdminValidatePageProps) {
  const requestedVersionId = versionId === undefined ? versionIdFromQuery() : versionId
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<AdminProblem | null>(null)
  const [version, setVersion] = useState<AdminVersion | null>(null)
  const [recordsText, setRecordsText] = useState('')
  const [busy, setBusy] = useState<AdminAction | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
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
    api
      .getAdminVersion(requestedVersionId)
      .then((data) => {
        if (!active) return
        setVersion(data)
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

  const can = (action: AdminAction): boolean => version?.allowedActions.includes(action) ?? false
  const summary = version
    ? [
        { key: 'requirements', value: countOf(version.payload.requirements) },
        { key: 'clauses', value: countOf(version.payload.clauses) },
        { key: 'sources', value: countOf(version.payload.sources) },
      ]
    : []

  async function runValidate() {
    if (!version || busy) return
    setBusy('validate')
    setOutcome(null)
    try {
      const data = await api.validateVersion(version.versionId)
      setOutcome({ kind: 'validated', data })
    } catch (error) {
      setOutcome(problemFrom(error))
    } finally {
      setBusy(null)
    }
  }

  async function runTest() {
    if (!version || busy) return
    const records = parseRecords(recordsText)
    if (!Array.isArray(records)) {
      setOutcome(records)
      return
    }
    setBusy('test')
    setOutcome(null)
    try {
      const data = await api.testVersion(version.versionId, records)
      setOutcome({ kind: 'tested', data })
    } catch (error) {
      setOutcome(problemFrom(error))
    } finally {
      setBusy(null)
    }
  }

  async function runSubmit() {
    if (!version || busy) return
    setBusy('submit')
    setOutcome(null)
    try {
      const data = await api.submitVersion(version.versionId)
      setVersion((current) =>
        current ? { ...current, status: data.status, allowedActions: [] } : current,
      )
      setOutcome({ kind: 'submitted', status: data.status })
    } catch (error) {
      setOutcome(problemFrom(error))
    } finally {
      setBusy(null)
    }
  }

  const headerVersionId = version?.versionId ?? requestedVersionId ?? '未指定'

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
          <h2>驗證與測試</h2>
          <p>
            {version
              ? `${version.bundleId}｜${version.versionId}｜${statusLabel(version.status)}`
              : '結構驗證 → 測試案例 → 送審；任一道關卡未過就不能送審。'}
          </p>
        </div>

        {loadState === 'missing' ? (
          <EmptyState
            title="請指定 versionId"
            description="在網址加上 ?versionId=<bundleId>@<versionNo>，例如 /admin-validate.html?versionId=cse-113-day@2。"
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
                這個版本由系統管理員代理發布，畫面上必須保留這個標示。
              </Alert>
            ) : null}

            <div className="admin-grid">
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
                    <dt>publishedAt</dt>
                    <dd>{formatTime(version.publishedAt)}</dd>
                  </div>
                </dl>
                <p className="empty-note">
                  {version.bundleId}｜v{version.versionNo}｜schemaVersion {version.schemaVersion}
                </p>
              </section>

              <section className="panel" aria-labelledby="payload-heading">
                <h3 id="payload-heading">payload 摘要</h3>
                <ul className="admin-summary">
                  {summary.map((entry) => (
                    <li key={entry.key}>
                      <span>{entry.key}</span>
                      <strong>{entry.value}</strong>
                    </li>
                  ))}
                </ul>
                <p className="empty-note">
                  allowedActions：{version.allowedActions.length > 0 ? version.allowedActions.join('、') : '（目前沒有可執行的動作）'}
                </p>
              </section>
            </div>

            <section className="panel admin-test-panel" aria-labelledby="test-input-heading">
              <h3 id="test-input-heading">測試資料（選填）</h3>
              <label className="field" htmlFor="test-records">
                測試紀錄 JSON（留空＝空資料檢核）
              </label>
              <textarea
                id="test-records"
                rows={4}
                value={recordsText}
                onChange={(event) => setRecordsText(event.target.value)}
                placeholder='[{"courseCode":"CS101","credits":3,"status":"pass","category":"core"}]'
              />
              <p className="empty-note">
                空資料檢核會跑完整引擎，確認三態、缺額與 overall 一致；缺額本身不算失敗。
              </p>
            </section>

            {outcome?.kind === 'problem' ? <AdminProblemPanel problem={outcome} /> : null}
            {outcome?.kind === 'validated' ? (
              <Alert tone="info" title="結構驗證通過">
                版本 {outcome.data.versionId} 沒有結構錯誤（{formatTime(outcome.data.checkedAt)}）。
              </Alert>
            ) : null}
            {outcome?.kind === 'tested' ? <TestResultPanel data={outcome.data} /> : null}
            {outcome?.kind === 'submitted' ? (
              <Alert tone="info" title="已送審">
                狀態已變成 {statusLabel(outcome.status)}（{outcome.status}），等待系所管理者審核。
              </Alert>
            ) : null}

            <div className="admin-actions">
              <button
                className="button-primary"
                type="button"
                onClick={runValidate}
                disabled={!can('validate') || busy !== null}
              >
                {busy === 'validate' ? '驗證中…' : '結構驗證'}
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={runTest}
                disabled={!can('test') || busy !== null}
              >
                {busy === 'test' ? '測試中…' : '執行測試'}
              </button>
              <button
                className="button-primary"
                type="button"
                onClick={runSubmit}
                disabled={!can('submit') || busy !== null}
              >
                {busy === 'submit' ? '送審中…' : '送審'}
              </button>
              <p>
                {can('validate') || can('test') || can('submit')
                  ? '驗證與測試通過後再送審；所有操作都會留下稽核紀錄。'
                  : '目前狀態或權限不允許驗證、測試或送審。'}
              </p>
            </div>
          </>
        ) : null}
      </main>

      <footer className="page-width app-footer">
        <span>NTOUER Academic Planner · I2</span>
        <p>所有變更都會留下稽核紀錄；送出後由系所管理者審核。</p>
      </footer>
    </>
  )
}

import { useEffect, useState } from 'react'
import { Alert } from '../components/Alert'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { Skeleton } from '../components/Skeleton'
import { ProgressApiError, SCENARIO_LABELS, loadMockProgress } from '../data/mockProgress'
import type { ProgressData, Scenario } from '../data/mockProgress'

type Loader = (scenario: Scenario) => Promise<ProgressData>

type View =
  | { status: 'loading' }
  | { status: 'ready'; data: ProgressData }
  | { status: 'empty'; data: ProgressData }
  | { status: 'error'; code: string; requestId: string | null; message: string }
  | { status: 'forbidden'; requestId: string | null }

const OVERALL_LABEL = {
  complete: '已滿足',
  unconfirmed: '尚有條件待確認',
  incomplete: '尚未完成',
} as const

const STATE_LABEL = {
  met: '已達成',
  notMet: '未達成',
  unknown: '尚未確認',
} as const

const SCENARIOS: Scenario[] = ['completed', 'inProgress', 'planned']

function formatTime(value: string | null): string {
  if (!value) return '尚未同步'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ProgressPage({ load = loadMockProgress }: { load?: Loader }) {
  const [scenario, setScenario] = useState<Scenario>('completed')
  const [view, setView] = useState<View>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setView({ status: 'loading' })
    load(scenario)
      .then((data) => {
        if (!active) return
        setView(data.requirements.length === 0 ? { status: 'empty', data } : { status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!active) return
        if (error instanceof ProgressApiError) {
          if (error.code === 'AUTH_FORBIDDEN' || error.code === 'AUTH_DEPT_OUT_OF_SCOPE') {
            setView({ status: 'forbidden', requestId: error.requestId })
          } else {
            setView({ status: 'error', code: error.code, requestId: error.requestId, message: error.message })
          }
          return
        }
        setView({ status: 'error', code: 'INTERNAL', requestId: null, message: '發生未預期的錯誤，請稍後再試。' })
      })
    return () => {
      active = false
    }
  }, [load, scenario, reloadKey])

  const data = view.status === 'ready' || view.status === 'empty' ? view.data : null

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>
      <header className="app-header">
        <div className="page-width header-content">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="book" />
            </span>
            <div>
              <h1>
                NTOUER <span>Academic Planner</span>
              </h1>
              <p>海大智慧修課與畢業規劃系統</p>
            </div>
          </div>
          <span className="iteration-label">
            Iteration 2 <span>Demo</span>
          </span>
        </div>
      </header>

      <aside className="test-notice" aria-label="檢核範圍提醒">
        <div className="page-width notice-content">
          <Icon name="info" />
          <strong>僅檢核部分畢業條件</strong>
          <span>
            {data ? `規則版本 ${data.versionId}｜資料時間 ${formatTime(data.dataSyncedAt)}` : '結果不代表正式畢業資格。'}
          </span>
        </div>
      </aside>

      <main id="main-content" className="page-width progress-main">
        <div className="progress-intro">
          <div>
            <h2>畢業進度</h2>
            <p>{data ? `${data.bundleId}｜${SCENARIO_LABELS[scenario]}情境` : '正在取得你的修課紀錄…'}</p>
          </div>
          <div className="scenario-switch" role="group" aria-label="情境切換">
            {SCENARIOS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scenario === value}
                className={`scenario-button${scenario === value ? ' is-active' : ''}`}
                onClick={() => setScenario(value)}
              >
                {SCENARIO_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        {view.status === 'loading' ? <Skeleton /> : null}

        {view.status === 'empty' ? (
          <EmptyState title="目前沒有可顯示的條件" description="這份規則版本還沒有任何條件，或你的資料尚未同步。" />
        ) : null}

        {view.status === 'error' ? (
          <ErrorState
            code={view.code}
            requestId={view.requestId}
            message={view.message}
            onRetry={() => setReloadKey((key) => key + 1)}
          />
        ) : null}

        {view.status === 'forbidden' ? (
          <section className="state-panel" role="alert">
            <h2>你沒有檢視這份進度的權限</h2>
            <p>請確認你登入的帳號與系所，或請系所管理者協助開通。</p>
            <p className="state-request-id">請求編號：{view.requestId ?? '（未提供）'}</p>
          </section>
        ) : null}

        {view.status === 'ready' ? (
          <>
            <section className="progress-summary" aria-label="整體結果">
              <div className={`overall overall-${view.data.overall}`}>
                <span className="overall-label">{OVERALL_LABEL[view.data.overall]}</span>
                <strong className="summary-number">{view.data.totalCredits}</strong>
                <span className="summary-unit">學分</span>
              </div>
              <dl className="summary-details">
                <div>
                  <dt>已達成條件</dt>
                  <dd>
                    {view.data.requirements.filter((requirement) => requirement.state === 'met').length}／
                    {view.data.requirements.length}
                  </dd>
                </div>
                <div>
                  <dt>待確認</dt>
                  <dd>{view.data.requirements.filter((requirement) => requirement.state === 'unknown').length}</dd>
                </div>
                <div>
                  <dt>未解衝突</dt>
                  <dd>{view.data.openConflicts.length}</dd>
                </div>
              </dl>
            </section>

            {view.data.openConflicts.length > 0 ? (
              <Alert tone="warning" title="尚有條件待確認">
                規則文件之間還有未解決的衝突（{view.data.openConflicts.join('、')}），在你確認之前不會顯示「已滿足」。
              </Alert>
            ) : null}

            <ul className="requirement-list" aria-label="畢業條件">
              {view.data.requirements.map((requirement) => {
                const percent =
                  requirement.credits !== undefined && requirement.min
                    ? Math.min(100, Math.round((requirement.credits / requirement.min) * 100))
                    : null
                return (
                  <li className={`requirement-card requirement-${requirement.state}`} key={requirement.id}>
                    <div className="requirement-head">
                      <h3>{requirement.name}</h3>
                      <span className={`state-pill state-${requirement.state}`}>
                        {STATE_LABEL[requirement.state]}
                      </span>
                    </div>
                    {requirement.credits !== undefined && requirement.min !== undefined ? (
                      <>
                        <p className="requirement-meta">
                          已取得 {requirement.credits}／{requirement.min} 學分
                          {requirement.gap ? `，尚缺 ${requirement.gap}` : ''}
                        </p>
                        <div className="progress-track" aria-hidden="true">
                          <span style={{ width: `${percent ?? 0}%` }} />
                        </div>
                      </>
                    ) : null}
                    {requirement.state === 'unknown' ? (
                      <p className="requirement-note">尚未確認，不會當成未通過。</p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}
      </main>

      <footer className="page-width app-footer">
        <span>NTOUER Academic Planner · I2</span>
        <p>規則由系所維護，資料來自教務系統；有疑義請洽系辦。</p>
      </footer>
    </>
  )
}

import { Alert } from '../components/Alert'
import { Icon } from '../components/Icon'
import { mockValidation } from '../data/mockAdmin'
import type { AdminValidationData } from '../data/mockAdmin'

const TEST_LABEL = { passed: '通過', failed: '失敗', pending: '待確認' } as const

export default function AdminValidatePage({ data = mockValidation }: { data?: AdminValidationData }) {
  const testsAllPassed = data.tests.every((test) => test.status === 'passed')
  const canSubmit = data.errors.length === 0 && testsAllPassed

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
          <h2>驗證與測試</h2>
          <p>
            {data.bundleId}｜{data.versionId}
          </p>
        </div>

        {data.proxy ? (
          <Alert tone="warning" title="未經系所管理者審核">
            這個版本由系統管理員代理發布，畫面上必須保留這個標示。
          </Alert>
        ) : null}

        <div className="admin-grid">
          <section className="panel" aria-labelledby="validation-heading">
            <h3 id="validation-heading">結構驗證</h3>
            {data.errors.length === 0 ? (
              <p className="empty-note">沒有結構錯誤。</p>
            ) : (
              <ul className="error-list">
                {data.errors.map((error) => (
                  <li key={`${error.clauseId}-${error.nodeId}`}>
                    <div className="error-head">
                      <code>{error.clauseId}</code>
                      <span>節點 {error.nodeId}</span>
                      {error.selector ? <span className="tag">{error.selector}</span> : null}
                    </div>
                    <p>{error.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="tests-heading">
            <h3 id="tests-heading">測試案例</h3>
            <ul className="test-list">
              {data.tests.map((test) => (
                <li key={test.name}>
                  <span>{test.name}</span>
                  <span className={`state-pill state-${test.status === 'passed' ? 'met' : test.status === 'failed' ? 'notMet' : 'unknown'}`}>
                    {TEST_LABEL[test.status]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="admin-actions">
          <button className="button-primary" type="button" disabled={!canSubmit}>
            送出審核
          </button>
          <p>
            {canSubmit
              ? '驗證與測試都通過，可以送審。'
              : '驗證有錯誤或測試未全過時不能送審；請先修正規則。'}
          </p>
        </div>
      </main>

      <footer className="page-width app-footer">
        <span>NTOUER Academic Planner · I2</span>
        <p>所有變更都會留下稽核紀錄；送出後由系所管理者審核。</p>
      </footer>
    </>
  )
}

import { useState } from 'react'
import { recordSamples } from './data/sampleRecords'
import type { SampleId } from './data/sampleRecords'
import { testRules } from './data/testRules'
import { checkCredits } from './engine/checkCredits'
import type { CreditAuditResult } from './domain/types'
import { Icon } from './components/Icon'
import { RulesPanel } from './components/RulesPanel'
import { SamplePicker } from './components/SamplePicker'
import { RecordTable } from './components/RecordTable'
import { ResultCard } from './components/ResultCard'

export default function App() {
  const [selectedId, setSelectedId] = useState<SampleId>('insufficient')
  const [result, setResult] = useState<CreditAuditResult | null>(null)
  const [sampleChanged, setSampleChanged] = useState(false)
  const selectedSample = recordSamples.find(sample => sample.id === selectedId)!

  function selectSample(id: SampleId) {
    if (id === selectedId) return
    setSelectedId(id)
    setResult(null)
    setSampleChanged(true)
  }

  return (
    <>
      <a className="skip-link" href="#main-content">跳至主要內容</a>
      <header className="app-header">
        <div className="page-width header-content">
          <div className="brand"><span className="brand-mark"><Icon name="book" /></span><div><h1>NTOUER <span>Academic Planner</span></h1><p>海大智慧修課與畢業規劃系統</p></div></div>
          <span className="iteration-label">Iteration 1 <span>Demo</span></span>
        </div>
      </header>
      <aside className="test-notice" aria-label="檢核範圍提醒"><div className="page-width notice-content"><Icon name="info" /><strong>開發測試規則，僅檢核部分條件</strong><span>結果僅供本次 Demo 驗證，不代表正式畢業要求。</span></div></aside>

      <main id="main-content" className="page-width">
        <div className="intro"><div><h2>學分檢核 Demo</h2><p>從模擬修課紀錄開始，查看已取得學分與尚缺條件。</p></div><ol className="workflow" aria-label="操作流程"><li className="step-done"><Icon name="check" /><span>選取紀錄</span></li><li className={result ? 'step-done' : 'step-current'}><span className="step-dot">2</span><span>執行檢核</span></li><li className={result ? 'step-current' : ''}><span className="step-dot">3</span><span>查看結果</span></li></ol></div>
        <div className="planner-layout">
          <aside className="setup-panel"><RulesPanel rules={testRules} /><SamplePicker selectedId={selectedId} onSelect={selectSample} /></aside>
          <div className="workspace">
            <section className="records-panel" aria-labelledby="records-heading">
              <div className="records-heading"><div><div className="section-heading"><h2 id="records-heading">已載入修課紀錄</h2><span className="quiet-count">{selectedSample.records.length} 筆</span></div><p className="loaded-sample">目前樣本：<strong>{selectedSample.name}</strong></p></div><button className="run-button" type="button" onClick={() => setResult(checkCredits(selectedSample.records, testRules))}>執行學分檢核<Icon name="arrow" /></button></div>
              <RecordTable records={selectedSample.records} result={result} />
              <div className="counting-note"><Icon name="info" /><p>僅採計及格紀錄；相同紀錄 ID 與相同課號的及格學分只計一次。</p></div>
            </section>

            <section className="results-section" aria-labelledby="results-heading">
              <div className="section-heading"><h2 id="results-heading">學分檢核結果</h2><span className="results-version">{testRules.version}</span></div>
              <div className="result-feedback" role="status" aria-live="polite" aria-atomic="true">
                {result ? <div className={`audit-summary ${result.allConditionsMet ? 'summary-met' : 'summary-unmet'}`}><Icon name={result.allConditionsMet ? 'check' : 'info'} /><div><h3>部分條件已檢核</h3><p>{result.allConditionsMet ? '本次三項測試條件全部達標。' : `本次測試條件尚未全部達標：${result.conditions.filter(condition => !condition.passed).length} 項仍有缺額。`}</p><p className="audit-trace">採計 {result.countedRecords.length} 筆及格紀錄，排除 {result.excludedRecords.length} 筆紀錄。此結果不代表完整畢業條件已滿足。</p></div></div> : <div className="pending-feedback"><Icon name="info" /><p>{sampleChanged ? '已切換樣本，請重新執行檢核。' : '尚未執行檢核，請點選「執行學分檢核」查看結果。'}</p></div>}
              </div>
              <div className="result-grid" key={selectedId}>{testRules.conditions.map(condition => <ResultCard key={condition.id} condition={condition} result={result?.conditions.find(item => item.conditionId === condition.id)} />)}</div>
            </section>
          </div>
        </div>
      </main>
      <footer className="page-width app-footer"><span>NTOUER Academic Planner · I1</span><p>模擬資料・部分條件檢核。正式規則與教務資料串接將於後續迭代處理。</p></footer>
    </>
  )
}

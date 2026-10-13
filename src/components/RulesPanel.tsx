import type { CreditRuleSet } from '../domain/types'

export function RulesPanel({ rules }: { rules: CreditRuleSet }) {
  return (
    <section className="rules-section" aria-labelledby="rules-heading">
      <div className="section-heading"><h2 id="rules-heading">本次測試規則</h2><span className="version-tag">{rules.version}</span></div>
      <dl className="rule-thresholds">
        {rules.conditions.map(condition => (
          <div key={condition.id}><dt>{condition.label}</dt><dd>至少 <strong>{condition.minimumCredits}</strong> 學分</dd></div>
        ))}
      </dl>
      <p className="rule-source">來源：{rules.source}<br />範圍：{rules.scopeLabel}</p>
    </section>
  )
}

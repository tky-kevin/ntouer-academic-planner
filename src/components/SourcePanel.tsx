import type { AdminSource } from '../data/mockAdmin'

export function SourcePanel({ sources }: { sources: AdminSource[] }) {
  return (
    <section className="panel" aria-labelledby="source-heading">
      <h3 id="source-heading">條文與來源定位</h3>
      <ul className="source-list">
        {sources.map((source) => (
          <li key={source.clauseId}>
            <div className="source-head">
              <code>{source.clauseId}</code>
              <span>{source.locator}</span>
            </div>
            <p>{source.text}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

import type { DiffItem, DiffKind } from '../data/mockAdmin'

const GROUP_LABEL: Record<DiffKind, string> = {
  added: '新增',
  changed: '變更',
  removed: '刪除',
  unchanged: '不變',
}

const GROUP_ORDER: DiffKind[] = ['added', 'changed', 'removed', 'unchanged']

export function DiffView({ items }: { items: DiffItem[] }) {
  return (
    <div className="diff-view">
      {GROUP_ORDER.map((kind) => {
        const group = items.filter((item) => item.kind === kind)
        return (
          <section className={`diff-group diff-${kind}`} key={kind} aria-labelledby={`diff-${kind}`}>
            <h4 id={`diff-${kind}`}>
              {GROUP_LABEL[kind]} <span className="quiet-count">{group.length}</span>
            </h4>
            {group.length === 0 ? (
              <p className="empty-note">沒有{GROUP_LABEL[kind]}的項目。</p>
            ) : (
              <ul className="diff-list">
                {group.map((item) => (
                  <li key={item.id}>
                    <div className="diff-line">
                      <code>{item.id}</code>
                      <span>{item.label}</span>
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
  )
}

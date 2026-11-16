export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <section className="state-panel" aria-live="polite">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </section>
  )
}

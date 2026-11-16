export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="sr-only">載入中</span>
      <div className="skeleton-summary" aria-hidden="true" />
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" aria-hidden="true" key={index} />
      ))}
    </div>
  )
}

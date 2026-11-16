export function ErrorState({
  code,
  requestId,
  message,
  onRetry,
}: {
  code: string
  requestId: string | null
  message: string
  onRetry?: () => void
}) {
  return (
    <section className="state-panel" role="alert">
      <h2>無法載入進度</h2>
      <p>{message}</p>
      <dl className="state-details">
        <div>
          <dt>錯誤代碼</dt>
          <dd>{code}</dd>
        </div>
        <div>
          <dt>請求編號</dt>
          <dd>{requestId ?? '（未提供）'}</dd>
        </div>
      </dl>
      {onRetry ? (
        <button className="button-secondary" type="button" onClick={onRetry}>
          重新載入
        </button>
      ) : null}
    </section>
  )
}

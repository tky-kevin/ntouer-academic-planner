// 統一回應 envelope：docs/design/api-spec.md §3。
// 成功一定有 data ＋ meta；失敗一定有 error ＋ meta。客戶端只看有沒有 data／error，不看 HTTP 狀態猜形狀。

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_DEPT_OUT_OF_SCOPE'
  | 'AUTH_ORIGIN_MISMATCH'
  | 'REQUEST_INVALID'
  | 'RESOURCE_NOT_FOUND'
  | 'RULE_BUNDLE_NOT_FOUND'
  | 'RULE_VERSION_NOT_FOUND'
  | 'RULE_VERSION_NOT_PUBLISHED'
  | 'RULE_VERSION_IMMUTABLE'
  | 'RULE_VALIDATION_FAILED'
  | 'RULE_TEST_FAILED'
  | 'SYNC_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL'

/**
 * 錯誤碼是開放集合：api-spec §5.3 規定新增錯誤碼不算破壞性變更，客戶端必須容忍未知 code。
 * AIS 同步會回報上游的具體代碼（例如 `AIS_LOGIN_REJECTED`），那些不逐一列舉在這裡，
 * 但仍然只能透過 `fail()` 產生，形狀不會走鐘。
 */
export type ErrorCodeLike = ErrorCode | (string & {})

export interface Meta {
  requestId: string
  generatedAt: string
  ruleVersionId?: string
}

export interface ApiError {
  code: string
  message: string
  details?: unknown[]
  retryable: boolean
}

export interface OkBody<T> {
  data: T
  meta: Meta
}

export interface ErrorBody {
  error: ApiError
  meta: Meta
}

/** ISO 8601 帶時區偏移（用伺服器所在時區，例如 +08:00）；資料庫存 UTC，輸出帶偏移。 */
export function isoNow(now: Date = new Date()): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  )
}

export function makeMeta(requestId: string, ruleVersionId?: string): Meta {
  return ruleVersionId ? { requestId, generatedAt: isoNow(), ruleVersionId } : { requestId, generatedAt: isoNow() }
}

export function ok<T>(data: T, meta: Meta): OkBody<T> {
  return { data, meta }
}

export function fail(
  error: { code: ErrorCodeLike; message: string; details?: unknown[]; retryable: boolean },
  meta: Meta,
): ErrorBody {
  const body: ApiError = { code: error.code, message: error.message, retryable: error.retryable }
  if (error.details && error.details.length > 0) body.details = error.details
  return { error: body, meta }
}

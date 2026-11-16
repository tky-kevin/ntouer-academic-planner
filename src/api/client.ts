// 前端唯一的 HTTP 入口：docs/design/api-spec.md §3。
// 所有回應都是 envelope：成功 `{ data, meta }`、失敗 `{ error: { code, message, details?, retryable }, meta }`。
// 這一層只負責解析形狀與轉錯誤，**不**決定導頁；401 由呼叫端看 `code === 'AUTH_REQUIRED'` 自行處理。
import { ProgressApiError } from '../data/mockProgress'
import type { ProgressApiErrorOptions } from '../data/mockProgress'

export interface ApiMeta {
  requestId: string
  generatedAt: string
  ruleVersionId?: string
}

interface ErrorEnvelope {
  error: {
    code: string
    message: string
    details?: unknown[]
    retryable?: boolean
  }
  meta?: Partial<ApiMeta>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 沒有 envelope（例如反向代理擋掉、HTML 錯誤頁）時，至少用狀態碼給一個可分支的代碼。 */
function codeFromStatus(status: number): string {
  if (status === 401) return 'AUTH_REQUIRED'
  if (status === 403) return 'AUTH_FORBIDDEN'
  if (status === 404) return 'RESOURCE_NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'INTERNAL'
  return 'REQUEST_INVALID'
}

function malformed(status: number, detail: string, options: ProgressApiErrorOptions): ProgressApiError {
  return new ProgressApiError('INVALID_RESPONSE', `伺服器回應格式不正確（HTTP ${status}）：${detail}`, null, {
    ...options,
    status,
  })
}

/**
 * 呼叫 API 並回傳 `data`。`init` 與 fetch 相同；`credentials` 固定 `same-origin`（session cookie），
 * `Content-Type` 預設 `application/json`，呼叫端要覆寫可以自己帶 header。
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', headers })
  } catch {
    throw new ProgressApiError('NETWORK_ERROR', '無法連線到伺服器，請確認網路後再試一次。', null, { retryable: true })
  }

  let raw: string
  try {
    raw = await response.text()
  } catch {
    throw malformed(response.status, '無法讀取回應內容', { retryable: true })
  }

  if (raw.trim() === '') {
    if (response.ok) return undefined as T
    throw new ProgressApiError(
      codeFromStatus(response.status),
      `伺服器沒有回傳內容（HTTP ${response.status}）。`,
      null,
      { status: response.status, retryable: response.status >= 500 },
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 錯誤狀態下的 HTML 錯誤頁（例如反向代理的 502）：用狀態碼給可分支的代碼，不要一律算格式錯誤。
    if (!response.ok) {
      throw new ProgressApiError(
        codeFromStatus(response.status),
        `伺服器回應格式不正確（HTTP ${response.status}）。`,
        null,
        { status: response.status, retryable: response.status >= 500 },
      )
    }
    throw malformed(response.status, '不是 JSON', { retryable: false })
  }

  if (!isRecord(parsed)) throw malformed(response.status, '不是物件', { retryable: response.status >= 500 })

  if (isRecord(parsed.error)) {
    const envelope = parsed as unknown as ErrorEnvelope
    const error = envelope.error
    throw new ProgressApiError(
      typeof error.code === 'string' ? error.code : codeFromStatus(response.status),
      typeof error.message === 'string' ? error.message : '發生未預期的錯誤，請稍後再試。',
      typeof envelope.meta?.requestId === 'string' ? envelope.meta.requestId : null,
      {
        status: response.status,
        retryable: error.retryable ?? response.status >= 500,
        details: Array.isArray(error.details) ? error.details : undefined,
      },
    )
  }

  if ('data' in parsed) return parsed.data as T

  throw malformed(response.status, '缺少 data 或 error', { retryable: true })
}

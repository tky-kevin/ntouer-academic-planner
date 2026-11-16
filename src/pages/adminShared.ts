// 管理端兩頁共用的顯示輔助：狀態標籤、時間格式、錯誤分類。
// 錯誤一律沿用 `ProgressApiError`（與學生端同一個 envelope client），不另立錯誤型別。
import { ProgressApiError } from '../data/mockProgress'

export const ADMIN_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  validating: '驗證中',
  testing: '測試中',
  'in-review': '審核中',
  approved: '已核准',
  published: '已發布',
  superseded: '已被取代',
}

export const ADMIN_ACTION_LABEL: Record<string, string> = {
  created: '建立',
  validated: '結構驗證',
  tested: '執行測試',
  submitted: '送審',
  approved: '核准',
  rejected: '退回',
  published: '發布',
  superseded: '被取代',
}

export interface AdminProblemDetail {
  field?: string
  reason: string
}

export interface AdminProblem {
  kind: 'problem'
  status: number
  code: string
  message: string
  details: AdminProblemDetail[]
  requestId: string | null
}

export function statusLabel(status: string): string {
  return ADMIN_STATUS_LABEL[status] ?? status
}

export function actionLabel(action: string): string {
  return ADMIN_ACTION_LABEL[action] ?? action
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '（無）'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })
}

/** 網址 `?versionId=…`；兩頁都不引入 router，直接讀 query。 */
export function versionIdFromQuery(): string | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('versionId')
  return value && value.trim().length > 0 ? value : null
}

function normalizeDetail(value: unknown): AdminProblemDetail {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const field = typeof record.field === 'string' ? record.field : undefined
    const reason =
      typeof record.reason === 'string'
        ? record.reason
        : JSON.stringify(value)
    return field ? { field, reason } : { reason }
  }
  return { reason: String(value) }
}

/** 把 `ProgressApiError` 轉成畫面可分支的結構；未知錯誤不假裝成功。 */
export function problemFrom(error: unknown, fallback = '發生未預期的錯誤，請稍後再試。'): AdminProblem {
  if (error instanceof ProgressApiError) {
    return {
      kind: 'problem',
      status: error.status ?? 0,
      code: error.code,
      message: error.message,
      details: (error.details ?? []).map(normalizeDetail),
      requestId: error.requestId,
    }
  }
  return {
    kind: 'problem',
    status: 0,
    code: 'INTERNAL',
    message: error instanceof Error && error.message ? error.message : fallback,
    details: [],
    requestId: null,
  }
}

/** 401／403／409／422 各有不同標題，不把「沒有權限」講成「發生錯誤」。 */
export function problemTitle(problem: AdminProblem): string {
  switch (problem.status) {
    case 401:
      return '請先登入'
    case 403:
      return '你沒有執行這個動作的權限'
    case 409:
      return '目前狀態不允許這個操作'
    case 422:
      return problem.code === 'RULE_TEST_FAILED' ? '測試案例未通過' : '規則內容未通過驗證'
    default:
      return '操作失敗'
  }
}

export function loadErrorTitle(problem: AdminProblem): string {
  switch (problem.status) {
    case 401:
      return '請先登入'
    case 403:
      return '你沒有讀取這個版本的權限'
    case 404:
      return '找不到規則版本'
    default:
      return '無法載入規則版本'
  }
}

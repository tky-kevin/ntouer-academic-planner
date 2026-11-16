// AIS 教務資料同步：`POST /api/me/sync/ais`、`POST /api/me/sync/ais/{syncId}`、`DELETE`（取消）。
// AIS 帳密只由後端從 `.env.local` 讀取（或由呼叫端在 request body 帶），前端不保存、不落地。
import { apiFetch } from './client'

export interface SyncStartData {
  syncId: string
  /** `data:image/png;base64,...`，直接放進 `<img src>`。 */
  captchaImage: string
  /** ISO 8601；到這個時間之後驗證碼就不能用了。 */
  expiresAt: string
  /** 例如 `B12****34`。 */
  accountMasked: string
  source: 'env' | 'request'
}

export interface SyncCounts {
  total: number
  passed: number
  failed: number
  inProgress: number
  unknown: number
}

export interface UnmatchedCourse {
  courseCode: string
  courseName: string
}

export interface SyncProfile {
  deptId: string | null
  entryYear: number | null
  /** 後端目前也會帶 `program`；不是契約必要欄位，忽略也不影響。 */
  program?: string
  /** 後端判定缺哪些欄位，例如 `['deptId', 'entryYear']`。 */
  missing: string[]
}

export interface SyncResultData {
  status: 'succeeded'
  counts: SyncCounts
  /** ISO 8601。 */
  dataSyncedAt: string
  unmatched: UnmatchedCourse[]
  profile: SyncProfile
  warnings: string[]
}

/** 開始同步：後端登入 AIS、回傳驗證碼圖片與到期時間（202）。 */
export function startAisSync(): Promise<SyncStartData> {
  return apiFetch<SyncStartData>('/api/me/sync/ais', { method: 'POST', body: JSON.stringify({}) })
}

/** 送出驗證碼，成功回 200 與同步結果；502 代表 AIS 端失敗（錯誤碼在 `apiFetch` 轉成的 ProgressApiError）。 */
export function submitAisCaptcha(syncId: string, captcha: string): Promise<SyncResultData> {
  return apiFetch<SyncResultData>(`/api/me/sync/ais/${encodeURIComponent(syncId)}`, {
    method: 'POST',
    body: JSON.stringify({ captcha }),
  })
}

/** 取消一次同步（204，無 body）；對話框在 captcha 階段關閉時呼叫。 */
export function cancelAisSync(syncId: string): Promise<void> {
  return apiFetch<void>(`/api/me/sync/ais/${encodeURIComponent(syncId)}`, { method: 'DELETE' })
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ProgressApiError } from '../data/mockProgress'
import { cancelAisSync, startAisSync, submitAisCaptcha } from '../api/sync'
import type { SyncResultData } from '../api/sync'

// AIS 驗證碼是四碼英數字；格式不對就在前端擋掉，不要浪費一次後端往返。
const CAPTCHA_PATTERN = /^[0-9A-Za-z]{4}$/

type Stage =
  | { name: 'idle' }
  | { name: 'captcha'; syncId: string; captchaImage: string; accountMasked: string }
  | { name: 'done'; result: SyncResultData }
  | { name: 'error'; code: string; message: string; retryable: boolean }

const PROFILE_FIELD_LABELS: Record<string, string> = {
  deptId: '系所',
  entryYear: '入學年度',
  program: '學制',
}

function toErrorStage(error: unknown): Stage {
  if (error instanceof ProgressApiError) {
    return { name: 'error', code: error.code, message: error.message, retryable: error.retryable }
  }
  return { name: 'error', code: 'INTERNAL', message: '發生未預期的錯誤，請稍後再試。', retryable: true }
}

function secondsLeft(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })
}

export interface SyncDialogProps {
  /** 關閉（X／Esc／取消／完成）；captcha 階段會先呼叫 DELETE 取消這次同步。 */
  onClose: () => void
  /** 同步成功時呼叫，讓父層重新載入進度。 */
  onSynced?: (result: SyncResultData) => void
}

/**
 * 「同步教務資料」三步驟對話框：idle → captcha → done／error。
 * AIS 帳密不在前端：後端用 `.env.local` 登入，前端只送驗證碼。
 */
export function SyncDialog({ onClose, onSynced }: SyncDialogProps) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' })
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [captcha, setCaptcha] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const captchaInputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    if (stage.name === 'captcha') {
      // 取消遠端的同步工作；失敗也不擋關閉。
      void cancelAisSync(stage.syncId).catch(() => undefined)
    }
    onClose()
  }, [stage, onClose])

  const start = useCallback(async () => {
    setPending(true)
    setFieldError(null)
    try {
      const data = await startAisSync()
      const deadline = Date.parse(data.expiresAt)
      setExpiresAt(Number.isNaN(deadline) ? null : deadline)
      setRemaining(Number.isNaN(deadline) ? 0 : secondsLeft(deadline))
      setCaptcha('')
      setStage({
        name: 'captcha',
        syncId: data.syncId,
        captchaImage: data.captchaImage,
        accountMasked: data.accountMasked,
      })
    } catch (error) {
      setExpiresAt(null)
      setStage(toErrorStage(error))
    } finally {
      setPending(false)
    }
  }, [])

  const submit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault()
      if (stage.name !== 'captcha') return
      const value = captcha.trim()
      if (!CAPTCHA_PATTERN.test(value)) {
        setFieldError('請輸入四碼英數字驗證碼（大小寫不拘）。')
        return
      }
      setFieldError(null)
      setPending(true)
      try {
        const result = await submitAisCaptcha(stage.syncId, value)
        setStage({ name: 'done', result })
        setExpiresAt(null)
        onSynced?.(result)
      } catch (error) {
        setExpiresAt(null)
        setStage(toErrorStage(error))
      } finally {
        setPending(false)
      }
    },
    [stage, captcha, onSynced],
  )

  // 倒數：到 expiresAt 就切到 error（SYNC_EXPIRED），captcha 輸入框同時消失。
  useEffect(() => {
    if (stage.name !== 'captcha' || expiresAt === null) return
    const tick = () => {
      const left = secondsLeft(expiresAt)
      setRemaining(left)
      if (left <= 0) {
        setStage({
          name: 'error',
          code: 'SYNC_EXPIRED',
          message: '驗證碼已逾時，請重新開始同步。',
          retryable: true,
        })
      }
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
    // 只在 captcha 階段與到期時間變動時重設計時器。
  }, [stage.name, expiresAt])

  // 初始焦點：對話框本身；進入 captcha 後移到驗證碼輸入框。
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    if (stage.name === 'captcha') captchaInputRef.current?.focus()
  }, [stage.name])

  // Esc 關閉（監聽 document，焦點跑到外面也關得掉）。
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  // 焦點鎖在對話框內（Tab／Shift+Tab 循環）。
  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-dialog-title"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="dialog-head">
          <h2 id="sync-dialog-title">同步教務資料</h2>
          <button type="button" className="dialog-close" aria-label="關閉同步對話框" onClick={close}>
            ×
          </button>
        </div>

        {stage.name === 'idle' ? (
          <div className="dialog-body">
            <p>
              系統會用已設定的 AIS 帳號登入教務系統，你只需要輸入畫面上的驗證碼。同步不會清空既有資料；
              失敗時前次快照仍然可用。
            </p>
            <div className="dialog-actions">
              <button type="button" className="button-primary" onClick={start} disabled={pending}>
                {pending ? '正在連線 AIS…' : '開始同步'}
              </button>
              <button type="button" className="button-secondary" onClick={close}>
                取消
              </button>
            </div>
          </div>
        ) : null}

        {stage.name === 'captcha' ? (
          <div className="dialog-body">
            <p className="dialog-account">
              登入帳號：<strong>{stage.accountMasked}</strong>
            </p>
            <img className="dialog-captcha" src={stage.captchaImage} alt="AIS 驗證碼" width={160} height={52} />
            <form className="dialog-form" onSubmit={submit} noValidate>
              <div className="form-field">
                <label htmlFor="sync-captcha">驗證碼</label>
                <input
                  id="sync-captcha"
                  ref={captchaInputRef}
                  name="captcha"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4}
                  value={captcha}
                  aria-invalid={fieldError !== null}
                  aria-describedby={fieldError ? 'sync-captcha-error' : undefined}
                  onChange={(event) => {
                    setCaptcha(event.target.value)
                    if (fieldError) setFieldError(null)
                  }}
                />
                {fieldError ? (
                  <p className="field-error" id="sync-captcha-error" role="alert">
                    {fieldError}
                  </p>
                ) : null}
              </div>
              <p className="dialog-countdown" aria-live="polite">
                剩餘 {remaining} 秒
              </p>
              <div className="dialog-actions">
                <button type="submit" className="button-primary" disabled={pending}>
                  {pending ? '同步中…' : '確認'}
                </button>
                <button type="button" className="button-secondary" onClick={close}>
                  取消
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {stage.name === 'done' ? (
          <div className="dialog-body">
            <h3>同步完成</h3>
            <p>資料時間：{formatTime(stage.result.dataSyncedAt)}</p>
            <dl className="dialog-summary">
              <div>
                <dt>總計</dt>
                <dd>{stage.result.counts.total}</dd>
              </div>
              <div>
                <dt>通過</dt>
                <dd>{stage.result.counts.passed}</dd>
              </div>
              <div>
                <dt>未通過</dt>
                <dd>{stage.result.counts.failed}</dd>
              </div>
              <div>
                <dt>修課中</dt>
                <dd>{stage.result.counts.inProgress}</dd>
              </div>
              <div>
                <dt>未確認</dt>
                <dd>{stage.result.counts.unknown}</dd>
              </div>
            </dl>

            <p>未對應課程 {stage.result.unmatched.length} 筆</p>
            {stage.result.unmatched.length > 0 ? (
              <ul className="dialog-list">
                {stage.result.unmatched.map((course) => (
                  <li key={course.courseCode}>
                    {course.courseCode} {course.courseName}
                  </li>
                ))}
              </ul>
            ) : null}

            {stage.result.profile.missing.length > 0 ? (
              <p className="dialog-note">
                還缺個人資料：
                {stage.result.profile.missing
                  .map((field) => PROFILE_FIELD_LABELS[field] ?? field)
                  .join('、')}
                ，補齊後才能套用規則。
              </p>
            ) : null}

            {stage.result.warnings.length > 0 ? (
              <ul className="dialog-list dialog-warnings">
                {stage.result.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <div className="dialog-actions">
              <button type="button" className="button-primary" onClick={close}>
                完成
              </button>
            </div>
          </div>
        ) : null}

        {stage.name === 'error' ? (
          <div className="dialog-body">
            <div className="alert alert-danger" role="alert">
              <div>
                <strong>{stage.code}</strong>
                <div className="alert-body">{stage.message}</div>
              </div>
            </div>
            <p className="dialog-note">前次快照仍可用，進度與資料時間不會被清空。</p>
            <div className="dialog-actions">
              {stage.retryable ? (
                <button type="button" className="button-primary" onClick={start} disabled={pending}>
                  {pending ? '正在連線 AIS…' : '再試一次'}
                </button>
              ) : null}
              <button type="button" className="button-secondary" onClick={close}>
                關閉
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { ProgressApiError } from '../data/mockProgress'
import { updateProfile } from '../api/profile'
import type { Program } from '../api/profile'

// 入學年度是民國年三位數（100–130，例如 113）；超出範圍或不是整數就不送出。
const ENTRY_YEAR_PATTERN = /^\d{3}$/

function validateEntryYear(value: string): string | null {
  const trimmed = value.trim()
  if (!ENTRY_YEAR_PATTERN.test(trimmed)) return '入學年度需為三位數民國年（100–130），例如 113。'
  const year = Number(trimmed)
  if (year < 100 || year > 130) return '入學年度需介於 100 到 130 之間。'
  return null
}

export interface ProfileFormProps {
  /** 預設值；`deptId` 預設 `cse`。 */
  initial?: { deptId?: string; entryYear?: number; program?: Program }
  /** 存檔成功後呼叫，父層用它重新載入進度。 */
  onSaved: () => void
}

/** 「補齊系所／入學年度」表單：`PATCH /api/me/profile`。 */
export function ProfileForm({ initial, onSaved }: ProfileFormProps) {
  const [deptId, setDeptId] = useState(initial?.deptId ?? 'cse')
  const [entryYear, setEntryYear] = useState(initial?.entryYear ? String(initial.entryYear) : '')
  const [program, setProgram] = useState<Program>(initial?.program ?? 'day')
  const [entryYearError, setEntryYearError] = useState<string | null>(null)
  const [deptError, setDeptError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const yearError = validateEntryYear(entryYear)
    const deptIdValue = deptId.trim()
    const deptValueError = deptIdValue === '' ? '請填寫系所代碼，例如 cse。' : null
    setEntryYearError(yearError)
    setDeptError(deptValueError)
    setSubmitError(null)
    if (yearError || deptValueError) return

    setPending(true)
    setSaved(false)
    try {
      await updateProfile({ deptId: deptIdValue, entryYear: Number(entryYear.trim()), program })
      setSaved(true)
      onSaved()
    } catch (error) {
      if (error instanceof ProgressApiError) {
        setSubmitError({ code: error.code, message: error.message })
      } else {
        setSubmitError({ code: 'INTERNAL', message: '發生未預期的錯誤，請稍後再試。' })
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="state-panel profile-form" aria-labelledby="profile-form-title">
      <h2 id="profile-form-title">補齊系所與入學年度</h2>
      <p>
        你的帳號還沒有完整的系所與入學年度，系統決定不出要套用哪一份畢業規則。補齊後會自動重新載入進度；
        沒有對應的規則版本時不會改套其他年度。
      </p>

      <form className="profile-form-fields" onSubmit={submit} noValidate>
        <div className="form-field">
          <label htmlFor="profile-dept">系所代碼</label>
          <input
            id="profile-dept"
            name="deptId"
            type="text"
            autoComplete="off"
            value={deptId}
            aria-invalid={deptError !== null}
            aria-describedby={deptError ? 'profile-dept-error' : undefined}
            onChange={(event) => {
              setDeptId(event.target.value)
              if (deptError) setDeptError(null)
            }}
          />
          {deptError ? (
            <p className="field-error" id="profile-dept-error" role="alert">
              {deptError}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor="profile-entry-year">入學年度（民國年）</label>
          <input
            id="profile-entry-year"
            name="entryYear"
            type="text"
            inputMode="numeric"
            placeholder="113"
            maxLength={3}
            value={entryYear}
            aria-invalid={entryYearError !== null}
            aria-describedby={entryYearError ? 'profile-entry-year-error' : 'profile-entry-year-hint'}
            onChange={(event) => {
              setEntryYear(event.target.value)
              if (entryYearError) setEntryYearError(null)
            }}
          />
          {entryYearError ? (
            <p className="field-error" id="profile-entry-year-error" role="alert">
              {entryYearError}
            </p>
          ) : (
            <p className="field-hint" id="profile-entry-year-hint">
              三位數民國年，例如 113。
            </p>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="profile-program">學制</label>
          <select
            id="profile-program"
            name="program"
            value={program}
            onChange={(event) => setProgram(event.target.value as Program)}
          >
            <option value="day">日間部</option>
            <option value="night">夜間部</option>
          </select>
        </div>

        {submitError ? (
          <div className="alert alert-danger" role="alert">
            <div>
              <strong>{submitError.code}</strong>
              <div className="alert-body">{submitError.message}</div>
            </div>
          </div>
        ) : null}

        <div className="profile-form-actions">
          <button type="submit" className="button-primary" disabled={pending}>
            {pending ? '儲存中…' : '儲存'}
          </button>
          <span className="field-hint" role="status">
            {saved ? '已儲存，正在重新載入進度…' : ''}
          </span>
        </div>
      </form>
    </section>
  )
}

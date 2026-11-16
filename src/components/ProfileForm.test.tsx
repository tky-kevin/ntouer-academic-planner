// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileForm } from './ProfileForm'

const META = { requestId: 'req-profile', generatedAt: '2026-11-17T04:00:00+08:00' }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProfileForm（補齊系所／入學年度）', () => {
  it('入學年度不是三位數時在欄位旁提示，且不送出 PATCH', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ProfileForm onSaved={vi.fn()} />)
    await user.type(screen.getByLabelText('入學年度（民國年）'), '99')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('100–130')
    expect(screen.getByLabelText('入學年度（民國年）')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('入學年度超出 100–130 也擋下來', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ProfileForm onSaved={vi.fn()} />)
    await user.type(screen.getByLabelText('入學年度（民國年）'), '250')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(await screen.findByText(/100 到 130/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('成功時 PATCH /api/me/profile 並呼叫 onSaved', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { deptId: 'cse', entryYear: 113, program: 'day' }, meta: META }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ProfileForm onSaved={onSaved} />)
    expect(screen.getByLabelText('系所代碼')).toHaveValue('cse')

    await user.type(screen.getByLabelText('入學年度（民國年）'), '113')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/me/profile')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ deptId: 'cse', entryYear: 113, program: 'day' })
  })

  it('後端拒絕時顯示錯誤碼與訊息', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { code: 'REQUEST_INVALID', message: 'entryYear 不合法：需介於 100–130。', retryable: false }, meta: META },
          400,
        ),
      ),
    )

    render(<ProfileForm onSaved={onSaved} />)
    await user.type(screen.getByLabelText('入學年度（民國年）'), '113')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(await screen.findByText('REQUEST_INVALID')).toBeVisible()
    expect(screen.getByText('entryYear 不合法：需介於 100–130。')).toBeVisible()
    expect(onSaved).not.toHaveBeenCalled()
  })
})

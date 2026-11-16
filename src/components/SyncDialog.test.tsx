// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncDialog } from './SyncDialog'

const META = { requestId: 'req-sync', generatedAt: '2026-11-17T04:00:00+08:00' }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function startBody(ttlMs = 120_000) {
  return {
    data: {
      syncId: 'sync-1',
      captchaImage: 'data:image/png;base64,AAA',
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      accountMasked: 'B12****34',
      source: 'env',
    },
    meta: META,
  }
}

const RESULT = {
  status: 'succeeded',
  counts: { total: 42, passed: 30, failed: 2, inProgress: 8, unknown: 2 },
  dataSyncedAt: '2026-11-17T04:00:05+08:00',
  unmatched: [{ courseCode: 'XX1', courseName: '未知課程' }],
  profile: { deptId: 'cse', entryYear: 113, missing: [] },
  warnings: ['1 筆課程學分數與課綱不一致'],
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('SyncDialog（AIS 同步）', () => {
  it('開始同步 → 輸入驗證碼 → 顯示同步結果，並通知父層重新載入', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSynced = vi.fn()
    const fetchMock = stubFetch(jsonResponse(startBody(), 202), jsonResponse({ data: RESULT, meta: META }))

    render(<SyncDialog onClose={onClose} onSynced={onSynced} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')

    await user.click(screen.getByRole('button', { name: '開始同步' }))

    const image = await screen.findByAltText('AIS 驗證碼')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,AAA')
    expect(screen.getByText('B12****34')).toBeVisible()
    const input = screen.getByLabelText('驗證碼')
    expect(document.activeElement).toBe(input)

    await user.type(input, 'a1b2')
    await user.click(screen.getByRole('button', { name: '確認' }))

    expect(await screen.findByText('同步完成')).toBeVisible()
    expect(screen.getByText('未對應課程 1 筆')).toBeVisible()
    expect(screen.getByText(/XX1/)).toBeVisible()
    expect(screen.getByText(/1 筆課程學分數與課綱不一致/)).toBeVisible()
    expect(onSynced).toHaveBeenCalledTimes(1)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/me/sync/ais')
    const [path, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(path).toBe('/api/me/sync/ais/sync-1')
    expect(JSON.parse(String(init.body))).toEqual({ captcha: 'a1b2' })

    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('驗證碼格式不對在欄位旁提示，不送出請求', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch(jsonResponse(startBody(), 202))

    render(<SyncDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '開始同步' }))
    await screen.findByLabelText('驗證碼')

    await user.type(screen.getByLabelText('驗證碼'), '12')
    await user.click(screen.getByRole('button', { name: '確認' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('四碼英數字')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('502 顯示 error.code、message 與「前次快照仍可用」，並可重試', async () => {
    const user = userEvent.setup()
    stubFetch(
      jsonResponse(startBody(), 202),
      jsonResponse(
        { error: { code: 'AIS_LOGIN_REJECTED', message: 'AIS 帳號或密碼不正確。', retryable: true }, meta: META },
        502,
      ),
    )

    render(<SyncDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '開始同步' }))
    await screen.findByLabelText('驗證碼')

    await user.type(screen.getByLabelText('驗證碼'), 'A1B2')
    await user.click(screen.getByRole('button', { name: '確認' }))

    expect(await screen.findByText('AIS_LOGIN_REJECTED')).toBeVisible()
    expect(screen.getByText('AIS 帳號或密碼不正確。')).toBeVisible()
    expect(screen.getByText(/前次快照仍可用/)).toBeVisible()
    expect(screen.getByRole('button', { name: '再試一次' })).toBeVisible()
  })

  it('倒數到 expiresAt 就切到 SYNC_EXPIRED 並停止輸入', async () => {
    vi.useFakeTimers()
    stubFetch(jsonResponse(startBody(2000), 202))

    render(<SyncDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '開始同步' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByAltText('AIS 驗證碼')).toBeVisible()
    expect(screen.getByText('剩餘 2 秒')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText('剩餘 1 秒')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText('SYNC_EXPIRED')).toBeVisible()
    expect(screen.queryByLabelText('驗證碼')).not.toBeInTheDocument()
    expect(screen.getByText(/驗證碼已逾時/)).toBeVisible()
  })

  it('captcha 階段按 Esc 關閉時呼叫 DELETE 取消同步', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const fetchMock = stubFetch(jsonResponse(startBody(), 202), {
      ok: true,
      status: 204,
      text: async () => '',
    } as unknown as Response)

    render(<SyncDialog onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: '開始同步' }))
    await screen.findByLabelText('驗證碼')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [path, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(path).toBe('/api/me/sync/ais/sync-1')
    expect(init.method).toBe('DELETE')
  })

  it('開始同步失敗時顯示錯誤碼與訊息', async () => {
    const user = userEvent.setup()
    stubFetch(
      jsonResponse(
        {
          error: {
            code: 'REQUEST_INVALID',
            message: '未設定 AIS 帳密。',
            details: [{ field: 'AIS_ACCOUNT', reason: 'not-configured' }],
            retryable: false,
          },
          meta: META,
        },
        400,
      ),
    )

    render(<SyncDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '開始同步' }))

    expect(await screen.findByText('REQUEST_INVALID')).toBeVisible()
    expect(screen.getByText('未設定 AIS 帳密。')).toBeVisible()
    expect(screen.queryByRole('button', { name: '再試一次' })).not.toBeInTheDocument()
  })
})

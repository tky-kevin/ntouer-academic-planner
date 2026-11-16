// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProgressPage from './ProgressPage'
import { ProgressApiError, loadMockProgress } from '../data/mockProgress'

// 預設 loader 已改成真實 API（src/api/progress）。既有案例不注入 load prop 的地方
// 仍以 mock 資料驅動，這裡只把 API 模組換成 loadMockProgress，斷言維持原樣。
vi.mock('../api/progress', () => ({
  loadProgress: async (scenario: 'completed' | 'inProgress' | 'planned') =>
    (await import('../data/mockProgress')).loadMockProgress(scenario),
}))

describe('學生端進度頁（UI-02）', () => {
  it('unknown 條件顯示「尚未確認」而不是未通過', async () => {
    render(<ProgressPage />)
    const heading = await screen.findByRole('heading', { name: '英文畢業門檻' })
    const card = heading.closest('li')
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText('尚未確認')).toBeVisible()
    expect(within(card as HTMLElement).queryByText('未達成')).not.toBeInTheDocument()
  })

  it('未解衝突時整體顯示待確認', async () => {
    render(<ProgressPage />)
    await screen.findByRole('heading', { name: '畢業進度' })
    const labels = await screen.findAllByText('尚有條件待確認')
    expect(labels.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/X01/)).toBeVisible()
  })

  it('空清單顯示空狀態', async () => {
    const empty = async () => ({ ...(await loadMockProgress('completed')), requirements: [] })
    render(<ProgressPage load={empty} />)
    expect(await screen.findByText('目前沒有可顯示的條件')).toBeVisible()
  })

  it('錯誤回應顯示 error.code 與 requestId', async () => {
    const failing = async () => {
      throw new ProgressApiError('INTERNAL', '資料庫暫時無法使用。', 'req-abc-123')
    }
    render(<ProgressPage load={failing} />)
    expect(await screen.findByText('INTERNAL')).toBeVisible()
    expect(screen.getByText('req-abc-123')).toBeVisible()
    expect(screen.getByText('資料庫暫時無法使用。')).toBeVisible()
  })

  it('切換情境會改變顯示的總學分', async () => {
    const user = userEvent.setup()
    render(<ProgressPage />)
    expect(await screen.findByText('135')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '修課中' }))
    expect(await screen.findByText('129')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '規劃中' }))
    expect(await screen.findByText('120')).toBeVisible()
  })

  it('持續顯示部分檢核提示', async () => {
    render(<ProgressPage />)
    expect(await screen.findByText('僅檢核部分畢業條件')).toBeVisible()
    expect(screen.getByLabelText('檢核範圍提醒')).toBeVisible()
  })

  it('無權限顯示 403 說明', async () => {
    const forbidden = async () => {
      throw new ProgressApiError('AUTH_FORBIDDEN', '沒有權限。', 'req-403')
    }
    render(<ProgressPage load={forbidden} />)
    expect(await screen.findByText('你沒有檢視這份進度的權限')).toBeVisible()
    expect(screen.getByText(/req-403/)).toBeVisible()
  })

  it('載入中顯示骨架', () => {
    const pending = () => new Promise<never>(() => undefined)
    render(<ProgressPage load={pending} />)
    expect(screen.getByRole('status')).toHaveTextContent('載入中')
  })

  it('401 顯示 Google 登入入口，且不顯示錯誤碼', async () => {
    const signedOut = async () => {
      throw new ProgressApiError('AUTH_REQUIRED', '請先登入。', 'req-401')
    }
    render(<ProgressPage load={signedOut} />)
    expect(await screen.findByRole('heading', { name: '請用 Google 登入' })).toBeVisible()
    expect(screen.getByRole('link', { name: '用 Google 登入' })).toHaveAttribute('href', '/auth/google/start')
    expect(screen.queryByText('AUTH_REQUIRED')).not.toBeInTheDocument()
    expect(screen.queryByText('req-401')).not.toBeInTheDocument()
  })

  it('RULE_BUNDLE_NOT_FOUND 提到系所／入學年度時顯示補齊表單', async () => {
    const missingProfile = async () => {
      throw new ProgressApiError(
        'RULE_BUNDLE_NOT_FOUND',
        '你的帳號還沒有系所與入學年度，無法決定要套用哪一份規則。',
        'req-404',
      )
    }
    render(<ProgressPage load={missingProfile} />)
    expect(await screen.findByRole('heading', { name: '補齊系所與入學年度' })).toBeVisible()
    expect(screen.getByLabelText('系所代碼')).toBeVisible()
    expect(screen.queryByText('無法載入進度')).not.toBeInTheDocument()
  })

  it('提示條的資料時間是資料驅動的', async () => {
    const unsynced = async () => ({ ...(await loadMockProgress('completed')), dataSyncedAt: null })
    render(<ProgressPage load={unsynced} />)
    expect(await screen.findByText(/尚未同步教務資料/)).toBeVisible()
  })

  it('「同步教務資料」按鈕會開啟對話框', async () => {
    const user = userEvent.setup()
    render(<ProgressPage />)
    await screen.findByRole('heading', { name: '畢業進度' })
    await user.click(screen.getByRole('button', { name: '同步教務資料' }))
    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.getByRole('heading', { name: '同步教務資料' })).toBeVisible()
  })
})

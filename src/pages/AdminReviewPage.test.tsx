// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminReviewPage from './AdminReviewPage'

describe('管理端：審核與差異（UI-09）', () => {
  it('diff 分為新增變更刪除不變四類', () => {
    render(<AdminReviewPage />)
    for (const label of ['新增', '變更', '刪除', '不變']) {
      expect(screen.getByRole('heading', { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    expect(screen.getByText('min: 46')).toBeVisible()
    expect(screen.getByText('min: 48')).toBeVisible()
  })

  it('退回時未填原因不能送出', async () => {
    const user = userEvent.setup()
    render(<AdminReviewPage />)
    const reject = screen.getByRole('button', { name: '退回' })
    expect(reject).toBeDisabled()

    await user.type(screen.getByLabelText(/退回原因/), '與手冊第 3 條不一致')
    expect(reject).toBeEnabled()
  })

  it('proxy 版本顯示未經系所審核', () => {
    render(<AdminReviewPage />)
    expect(screen.getByText('未經系所管理者審核')).toBeVisible()
  })
})

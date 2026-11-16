// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminValidatePage from './AdminValidatePage'
import { mockValidation } from '../data/mockAdmin'

describe('管理端：驗證與測試（UI-08）', () => {
  it('驗證錯誤會顯示 clauseId 與節點 id', () => {
    render(<AdminValidatePage />)
    expect(screen.getByText('C03')).toBeVisible()
    expect(screen.getByText(/節點 R06/)).toBeVisible()
    expect(screen.getByText(/selector 指向不存在的標籤/)).toBeVisible()
  })

  it('測試未全過時送審按鈕為 disabled', () => {
    render(<AdminValidatePage />)
    expect(screen.getByRole('button', { name: '送出審核' })).toBeDisabled()
  })

  it('驗證與測試都通過時送審可按', () => {
    render(
      <AdminValidatePage
        data={{
          ...mockValidation,
          errors: [],
          tests: mockValidation.tests.map((test) => ({ ...test, status: 'passed' as const })),
        }}
      />,
    )
    expect(screen.getByRole('button', { name: '送出審核' })).toBeEnabled()
  })
})

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('AP-I1-04 可操作結果頁', () => {
  it('初始畫面提供七組樣本、規則來源與持續可見的部分檢核提示', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'NTOUER Academic Planner' })).toBeVisible()
    expect(screen.getByText('開發測試規則，僅檢核部分條件')).toBeVisible()
    expect(screen.getByText(/來源：人工建立的開發測試規則/)).toBeVisible()
    expect(within(screen.getByRole('group', { name: '模擬修課紀錄樣本' })).getAllByRole('button')).toHaveLength(7)
    expect(screen.getByRole('status')).toHaveTextContent('尚未執行檢核')
    expect(screen.queryByText('部分條件已檢核')).not.toBeInTheDocument()
  })

  it('執行按鈕計算結果，切換樣本清除舊結果，再執行得到新結果', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '執行學分檢核' }))
    expect(screen.getByRole('status')).toHaveTextContent('部分條件已檢核')
    expect(screen.getByRole('status')).toHaveTextContent('2 項仍有缺額')
    const total = screen.getByRole('article', { name: '總學分結果' })
    expect(within(total).getByText('9')).toBeVisible()
    expect(within(total).getByText('3')).toBeVisible()
    expect(within(total).getByText('未達標')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /剛好達標/ }))
    expect(screen.getByRole('status')).toHaveTextContent('已切換樣本，請重新執行檢核。')
    expect(screen.queryByText('部分條件已檢核')).not.toBeInTheDocument()
    expect(screen.getAllByText('待檢核').length).toBeGreaterThanOrEqual(3)
    expect(within(total).queryByText('9')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '執行學分檢核' }))
    expect(screen.getByRole('status')).toHaveTextContent('本次三項測試條件全部達標。')
    expect(within(screen.getByRole('article', { name: '總學分結果' })).getByText('12')).toBeVisible()
    expect(screen.getByText('開發測試規則，僅檢核部分條件')).toBeVisible()
    expect(screen.queryByText('正式畢業資格已達成')).not.toBeInTheDocument()
  })

  it('空資料可以執行，顯示零學分與明確缺額', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /空資料/ }))
    expect(screen.getByText('此樣本沒有修課紀錄')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '執行學分檢核' }))
    expect(screen.getByRole('status')).toHaveTextContent('3 項仍有缺額')
    const total = screen.getByRole('article', { name: '總學分結果' })
    expect(within(total).getByText('0')).toBeVisible()
    expect(within(total).getByText('12')).toBeVisible()
  })

  it('重複紀錄保留在原始表格，採計說明與結果明細顯示去重', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /重複紀錄/ }))
    await user.click(screen.getByRole('button', { name: '執行學分檢核' }))
    expect(screen.getByRole('status')).toHaveTextContent('採計 4 筆及格紀錄，排除 1 筆紀錄。')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(within(table).getByText('重複紀錄')).toBeVisible()
    const total = screen.getByRole('article', { name: '總學分結果' })
    await user.click(within(total).getByText('採計紀錄（4 筆）'))
    expect(within(total).getByText('課程 A')).toBeVisible()
    expect(within(total).getByText('rec-A-01')).toBeVisible()
  })
})

// 透過 playwright-cli run-code 執行的瀏覽器驗證片段。
// 所有預期數值直接列明；不呼叫引擎或匯入樣本答案。
async page => {
const cases = [
  { name: '不足', credits: ['9', '6', '3'], deficits: ['3', '0', '3'], states: ['未達標', '已達標', '未達標'] },
  { name: '剛好達標', credits: ['12', '6', '6'], deficits: ['0', '0', '0'], states: ['已達標', '已達標', '已達標'] },
  { name: '超過門檻', credits: ['15', '6', '9'], deficits: ['0', '0', '0'], states: ['已達標', '已達標', '已達標'] },
  { name: '空資料', credits: ['0', '0', '0'], deficits: ['12', '6', '6'], states: ['未達標', '未達標', '未達標'] },
  { name: '不及格', credits: ['9', '6', '3'], deficits: ['3', '0', '3'], states: ['未達標', '已達標', '未達標'] },
  { name: '重複紀錄', credits: ['12', '6', '6'], deficits: ['0', '0', '0'], states: ['已達標', '已達標', '已達標'] },
  { name: '簡單重修', credits: ['12', '6', '6'], deficits: ['0', '0', '0'], states: ['已達標', '已達標', '已達標'] },
]
const check = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
}
await page.setViewportSize({ width: 1440, height: 1050 })
const demoUrl = page.url()
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(demoUrl)) throw new Error('請先開啟本機 Demo 開發或預覽網址')
await page.goto(demoUrl)
for (let index = 0; index < cases.length; index++) {
  const item = cases[index]
  await page.getByRole('button', { name: new RegExp(`^${index + 1} ${item.name} `) }).click()
  if (index > 0) {
    check(await page.locator('.credit-value strong').allTextContents(), ['—', '—', '—'], `${item.name} 清除舊結果`)
    if (!(await page.getByRole('status').textContent()).includes('已切換樣本，請重新執行檢核。')) throw new Error('切換提示遺失')
  }
  await page.getByRole('button', { name: '執行學分檢核' }).click()
  check(await page.locator('.credit-value strong').allTextContents(), item.credits, `${item.name} 學分`)
  check(await page.locator('.credit-deficit strong').allTextContents(), item.deficits, `${item.name} 缺額`)
  check(await page.locator('.result-status').allTextContents(), item.states, `${item.name} 狀態`)
  if (!(await page.getByRole('status').textContent()).includes('部分條件已檢核')) throw new Error('部分檢核文字遺失')
  if (!(await page.getByText('開發測試規則，僅檢核部分條件').isVisible())) throw new Error('規則提示遺失')
  console.log(`PASS: ${item.name} — credits, deficits, states, reset and notice`)
}
await page.getByRole('button', { name: /2 剛好達標/ }).click()
await page.getByRole('button', { name: '執行學分檢核' }).click()
await page.evaluate(() => window.scrollTo(0, 0))
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '桌面不溢出')
await page.screenshot({ path: 'output/playwright/desktop.png', fullPage: true, animations: 'disabled' })
await page.setViewportSize({ width: 375, height: 812 })
await page.getByRole('button', { name: /4 空資料/ }).click()
await page.getByRole('button', { name: '執行學分檢核' }).click()
check(await page.locator('.credit-value strong').allTextContents(), ['0', '0', '0'], '手機空資料')
await page.getByRole('button', { name: /2 剛好達標/ }).click()
await page.getByRole('button', { name: '執行學分檢核' }).click()
check(await page.locator('.credit-value strong').allTextContents(), ['12', '6', '6'], '手機達標')
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '手機不溢出')
await page.locator('.table-scroll').evaluate(element => { element.scrollLeft = element.scrollWidth })
check(await page.locator('.table-scroll').evaluate(element => element.scrollLeft > 0), true, '手機表格可滑動')
await page.locator('.table-scroll').evaluate(element => { element.scrollLeft = 0 })
await page.evaluate(() => window.scrollTo(0, 1200))
check(await page.locator('.test-notice').evaluate(element => element.getBoundingClientRect().top), 0, '提示捲動後仍置頂')
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: 'output/playwright/mobile.png', fullPage: true, animations: 'disabled' })
console.log('PASS: desktop 1440px, mobile 375px, empty data, table scroll, sticky notice')
return { passedSamples: 7, desktopWidth: 1440, mobileWidth: 375, checks: ['credits', 'deficits', 'states', 'result-reset', 'partial-notice', 'empty-data', 'horizontal-table', 'sticky-notice', 'page-overflow'] }
}

process.env.AIS_MENU_EXPAND_DELAY_MS = '0'
// 「先直接 GET 查詢頁，不行才走選單」：AIS 查詢頁只靠 session cookie，選單是舊版 TreeView，
// 只要選單改版整個流程就掛；直接存取能繞過它。
import { describe, expect, it } from 'vitest'
import { openAisFeature } from './upstream/application/ais-feature-navigation.js'
import type { GatewaySession } from './upstream/application/ports/gateway-session.js'
import { ScriptedTransport } from './testing/scripted-transport.js'
import type { FixtureStep } from './testing/scripted-transport.js'

const loaderUrl = new URL('https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_.aspx?progcd=STU2020')
const queryUrl = new URL('https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_01.aspx')

function session(steps: readonly FixtureStep[]): { session: GatewaySession; transport: ScriptedTransport } {
  const transport = new ScriptedTransport(steps)
  return { session: { transport, csrfToken: 'test', authenticated: true }, transport }
}

function options() {
  return {
    menuGroups: ['教務系統', '成績系統'],
    targetTitle: '查詢各式成績',
    expectedLoaderUrl: loaderUrl,
    expectedProgramCode: 'STU2020',
    expectedQueryUrl: queryUrl,
    operation: 'grades' as const,
    directQueryFirst: true,
    assertAuthenticated: (html: string) => {
      if (/<title>\s*登入/iu.test(html)) throw new Error('login page')
    },
  }
}

describe('直接 GET 查詢頁（繞過選單）', () => {
  it('session 有效時直接命中查詢頁，完全不用展開選單', async () => {
    const { session: gw, transport } = session([
      { operation: 'try_direct_grades_query_page', fixture: 'grades-query-page.html' },
    ])
    const result = await openAisFeature(gw, options())
    expect(result.queryUrl.pathname).toBe('/Application/GRD/GRD50/GRD5010_01.aspx')
    expect(result.html).toContain('Q_AYEARSMS')
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0].operation).toBe('try_direct_grades_query_page')
  })

  it('直接 GET 拿到登入頁時退回選單導覽', async () => {
    const { session: gw } = session([
      { operation: 'try_direct_grades_query_page', body: '<html><title>登入</title></html>' },
      { operation: 'read_grades_menu', fixture: 'menu-tree-postback.html' },
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-groups.html' },
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-grades.html' },
      { operation: 'read_grades_query_page', fixture: 'grades-query-page.html' },
    ])
    const result = await openAisFeature(gw, options())
    expect(result.html).toContain('Q_AYEARSMS')
  })

  it('直接 GET 拿到沒有查詢表單的頁面（例如錯誤頁）也退回選單', async () => {
    const { session: gw } = session([
      { operation: 'try_direct_grades_query_page', body: '<html><body>系統維護中</body></html>' },
      { operation: 'read_grades_menu', fixture: 'menu-tree-postback.html' },
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-groups.html' },
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-grades.html' },
      { operation: 'read_grades_query_page', fixture: 'grades-query-page.html' },
    ])
    const result = await openAisFeature(gw, options())
    expect(result.html).toContain('Q_AYEARSMS')
  })
})

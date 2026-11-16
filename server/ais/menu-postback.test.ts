process.env.AIS_MENU_EXPAND_DELAY_MS = '0'
// 新版 AIS MenuTree（__doPostBack）的解析與導覽。
// 2026-11-17 實測：AIS 改成標準 ASP.NET TreeView，舊版 TreeView_PopulateNode 解析直接失敗。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyAisMenuExpandCallback,
  buildAisMenuExpandBody,
  parseAisMenuPage,
} from './upstream/protocol/ais/menu-tree-parser.js'
import { openAisFeature } from './upstream/application/ais-feature-navigation.js'
import type { GatewaySession } from './upstream/application/ports/gateway-session.js'
import { ScriptedTransport } from './testing/scripted-transport.js'
import type { FixtureStep } from './testing/scripted-transport.js'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('新版選單解析（__doPostBack）', () => {
  it('沒有 TreeView_Data.lastIndex 也能解析出群組與頁面', () => {
    const state = parseAisMenuPage(fixture('menu-tree-postback.html'))
    expect(state.mode).toBe('postback')
    const group = state.nodes.find((node) => node.kind === 'group' && node.title === '教務系統')
    expect(group?.postbackPath).toBe('NTOU\\STU')
    const page = state.nodes.find((node) => node.kind === 'page' && node.title === '修改密碼')
    expect(page?.loaderUrl?.pathname).toBe('/Application/PWD/PWD1020_.aspx')
  })

  it('展開 body 用 __EVENTTARGET/__EVENTARGUMENT，不是舊版的 callback param', () => {
    const state = parseAisMenuPage(fixture('menu-tree-postback.html'))
    const group = state.nodes.find((node) => node.title === '教務系統')
    if (!group) throw new Error('missing group')
    const params = new URLSearchParams(buildAisMenuExpandBody(state, group))
    expect(params.get('__EVENTTARGET')).toBe('Menu_TreeView')
    expect(params.get('__EVENTARGUMENT')).toBe('tNTOU\\STU')
    expect(params.get('__VIEWSTATE')).toBe('FAKE_POSTBACK_VIEWSTATE')
    expect(params.get('__EVENTVALIDATION')).toBe('FAKE_POSTBACK_VALIDATION')
  })

  it('展開後的回應是 HTML（整頁或片段），hidden fields 會更新', () => {
    const state = parseAisMenuPage(fixture('menu-tree-postback.html'))
    const group = state.nodes.find((node) => node.title === '教務系統')
    if (!group) throw new Error('missing group')
    const next = applyAisMenuExpandCallback(state, group, fixture('menu-tree-postback-groups.html'))
    expect(next.mode).toBe('postback')
    expect(next.fields.get('__VIEWSTATE')).toBe('FAKE_POSTBACK_VIEWSTATE_2')
    expect(next.nodes.some((node) => node.title === '成績系統')).toBe(true)
  })
})

describe('新版選單導覽', () => {
  const loaderUrl = new URL('https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_.aspx?progcd=STU2020')
  const queryUrl = new URL('https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_01.aspx')

  function session(steps: readonly FixtureStep[]): GatewaySession {
    return { transport: new ScriptedTransport(steps), csrfToken: 'test', authenticated: true }
  }

  it('展開兩層群組後找到查詢頁；頁面連結直接是查詢頁時不再經 loader', async () => {
    const steps: FixtureStep[] = [
      { operation: 'read_grades_menu', fixture: 'menu-tree-postback.html' },
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-groups.html' },
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-grades.html' },
      { operation: 'read_grades_query_page', fixture: 'grades-query-page.html' },
    ]
    const result = await openAisFeature(session(steps), {
      menuGroups: ['教務系統', '成績系統'],
      targetTitle: '查詢各式成績',
      expectedLoaderUrl: loaderUrl,
      expectedProgramCode: 'STU2020',
      expectedQueryUrl: queryUrl,
      operation: 'grades',
      assertAuthenticated: () => undefined,
    })
    expect(result.queryUrl.pathname).toBe('/Application/GRD/GRD50/GRD5010_01.aspx')
    expect(result.html).toContain('QUERY')
  })

  it('功能被搬到別的群組時，會用有上限的廣度搜尋找回來', async () => {
    const steps: FixtureStep[] = [
      { operation: 'read_grades_menu', fixture: 'menu-tree-postback-bfs-root.html' },
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-bfs-stu.html' },
      // 設定的路徑沒有成績系統 → 廣度搜尋先展開選課系統（沒有目標），再展開學務系統（找到）
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-bfs-stu.html' },
      { operation: 'expand_grades_menu_group', fixture: 'menu-tree-postback-bfs-sls.html' },
      { operation: 'open_grades_feature', fixture: 'grades-loader.html' },
      { operation: 'read_grades_query_page', fixture: 'grades-query-page.html' },
    ]
    const result = await openAisFeature(session(steps), {
      menuGroups: ['教務系統', '成績系統'],
      targetTitle: '查詢各式成績',
      expectedLoaderUrl: loaderUrl,
      expectedProgramCode: 'STU2020',
      expectedQueryUrl: queryUrl,
      operation: 'grades',
      assertAuthenticated: () => undefined,
    })
    expect(result.queryUrl.pathname).toBe('/Application/GRD/GRD50/GRD5010_01.aspx')
  })
})

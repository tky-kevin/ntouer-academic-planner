// 選單導覽的失敗診斷：四種失敗要回不同的代碼，否則線上出錯無法分辨原因。
// 這是 Planner 對 upstream 的唯一行為外修改（見 server/ais/README.md）。
import { describe, expect, it } from 'vitest'
import { openAisFeature } from './upstream/application/ais-feature-navigation.js'
import type { GatewaySession } from './upstream/application/ports/gateway-session.js'
import { ScriptedTransport } from './testing/scripted-transport.js'
import type { FixtureStep } from './testing/scripted-transport.js'
import { AisProtocolError } from './upstream/protocol/ais/protocol-error.js'

const menuUrl = new URL('https://ais.ntou.edu.tw/MenuTree.aspx')
const loaderUrl = new URL('https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_.aspx?progcd=STU2020')
const queryUrl = new URL('https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_01.aspx')

const groupSteps: FixtureStep[] = [
  { operation: 'read_grades_menu', fixture: 'menu-tree-root.html' },
  { operation: 'expand_grades_menu_group', fixture: 'menu-tree-academic.callback.txt', contentType: 'text/plain' },
  { operation: 'expand_grades_menu_group', fixture: 'menu-tree-grades.callback.txt', contentType: 'text/plain' },
]

function session(steps: readonly FixtureStep[]): GatewaySession {
  return { transport: new ScriptedTransport(steps), csrfToken: 'test', authenticated: true }
}

function options(overrides: Partial<Parameters<typeof openAisFeature>[1]> = {}) {
  return {
    menuGroups: ['教務系統', '成績系統'],
    targetTitle: '查詢各式成績',
    expectedLoaderUrl: loaderUrl,
    expectedProgramCode: 'STU2020',
    expectedQueryUrl: queryUrl,
    operation: 'grades' as const,
    assertAuthenticated: () => undefined,
    ...overrides,
  }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AisProtocolError) return error.code
    throw error
  }
  throw new Error('expected rejection')
}

describe('AIS 選單導覽失敗的診斷', () => {
  it('找不到群組 → menu_group_not_found（不是籠統的 menu_tree_contract_changed）', async () => {
    const steps: FixtureStep[] = [{ operation: 'read_grades_menu', fixture: 'menu-tree-root.html' }]
    expect(await codeOf(openAisFeature(session(steps), options({ menuGroups: ['不存在的群組'] })))).toBe(
      'menu_group_not_found',
    )
  })

  it('群組都在、但目標頁改名 → menu_target_not_found', async () => {
    expect(await codeOf(openAisFeature(session(groupSteps), options({ targetTitle: '成績查詢' })))).toBe(
      'menu_target_not_found',
    )
  })

  it('目標頁存在、但 program code 不同 → menu_loader_mismatch', async () => {
    expect(await codeOf(openAisFeature(session(groupSteps), options({ expectedProgramCode: 'STU9999' })))).toBe(
      'menu_loader_mismatch',
    )
  })

  it('目標頁存在、但 loader 路徑不同 → menu_loader_mismatch', async () => {
    const wrongLoader = new URL('https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_99.aspx?progcd=STU2020')
    expect(await codeOf(openAisFeature(session(groupSteps), options({ expectedLoaderUrl: wrongLoader })))).toBe(
      'menu_loader_mismatch',
    )
  })

  it('選單標題多空白仍視為同一個節點（AIS 偶爾會插空白或全形空白）', async () => {
    const steps: FixtureStep[] = [
      ...groupSteps,
      { operation: 'open_grades_feature', fixture: 'grades-loader.html' },
      { operation: 'read_grades_query_page', fixture: 'grades-query-page.html' },
    ]
    const result = await openAisFeature(
      session(steps),
      options({ menuGroups: [' 教務系統', '成績　系統'], targetTitle: ' 查詢 各式成績 ' }),
    )
    expect(result.queryUrl.pathname).toBe('/Application/GRD/GRD50/GRD5010_01.aspx')
  })

  it('正常路徑：回傳查詢頁 URL', async () => {
    const steps: FixtureStep[] = [
      ...groupSteps,
      { operation: 'open_grades_feature', fixture: 'grades-loader.html' },
      { operation: 'read_grades_query_page', fixture: 'grades-query-page.html' },
    ]
    const result = await openAisFeature(session(steps), options())
    expect(result.queryUrl.pathname).toBe('/Application/GRD/GRD50/GRD5010_01.aspx')
    expect(result.html).toContain('QUERY')
  })
})

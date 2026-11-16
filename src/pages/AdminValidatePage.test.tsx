// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminValidatePage from './AdminValidatePage'
import type { AdminValidateApi } from './AdminValidatePage'
import { ProgressApiError } from '../data/mockProgress'
import type { AdminTestResult, AdminVersion, AdminValidationResult } from '../api/admin'

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

const HASH = `sha256:${'a'.repeat(64)}`

const VERSION: AdminVersion = {
  versionId: 'cse-113-day@2',
  bundleId: 'cse-113-day',
  versionNo: 2,
  status: 'draft',
  schemaVersion: '1.0',
  contentHash: HASH,
  publishedAt: null,
  proxy: false,
  payload: {
    requirements: [{ id: 'R01' }, { id: 'R02' }],
    clauses: [{ clauseId: 'C01' }],
    sources: [{ sourceId: 'S113-01' }],
  },
  allowedActions: ['validate', 'test', 'submit'],
}

const VALIDATED: AdminValidationResult = {
  versionId: VERSION.versionId,
  valid: true,
  errors: [],
  checkedAt: '2026-11-17T04:00:00+08:00',
}

const TESTED: AdminTestResult = {
  versionId: VERSION.versionId,
  suite: 'empty-data',
  scenario: 'completed',
  passed: 3,
  failed: 0,
  overall: 'incomplete',
  totalCredits: 0,
  results: [{ name: 'R01 總學分', status: 'passed' }],
}

function makeApi(overrides: Partial<AdminValidateApi> = {}): AdminValidateApi {
  return {
    getAdminVersion: vi.fn(async () => VERSION),
    validateVersion: vi.fn(async () => VALIDATED),
    testVersion: vi.fn(async () => TESTED),
    submitVersion: vi.fn(async () => ({ versionId: VERSION.versionId, status: 'in-review' as const })),
    ...overrides,
  }
}

describe('管理端：驗證與測試（UI-08）', () => {
  it('沒有 versionId 時顯示請指定 versionId 的空狀態，不偷偷用 mock', () => {
    render(<AdminValidatePage versionId={null} api={makeApi()} />)
    expect(screen.getByRole('heading', { name: '請指定 versionId' })).toBeVisible()
  })

  it('沒有 prop 時從網址 ?versionId= 讀取版本', async () => {
    window.history.replaceState({}, '', '/admin-validate.html?versionId=cse-113-day@2')
    const api = makeApi()
    render(<AdminValidatePage api={api} />)

    expect(await screen.findByRole('heading', { name: '版本資訊' })).toBeVisible()
    expect(vi.mocked(api.getAdminVersion)).toHaveBeenCalledWith('cse-113-day@2')
  })

  it('載入成功顯示 metadata 與 payload 摘要', async () => {
    render(<AdminValidatePage versionId={VERSION.versionId} api={makeApi()} />)

    expect(await screen.findByRole('heading', { name: '版本資訊' })).toBeVisible()
    expect(screen.getAllByText(VERSION.versionId).length).toBeGreaterThan(0)
    expect(screen.getByText(HASH)).toBeVisible()
    expect(screen.getByText('草稿')).toBeVisible()

    expect(screen.getByText('requirements').parentElement).toHaveTextContent('2')
    expect(screen.getByText('clauses').parentElement).toHaveTextContent('1')
    expect(screen.getByText('sources').parentElement).toHaveTextContent('1')

    // allowedActions 有 submit 時（驗證與測試的理想狀態），送審可按。
    expect(screen.getByRole('button', { name: '送審' })).toBeEnabled()
  })

  it('422 會逐條顯示 error.details 的 field 與 reason', async () => {
    const user = userEvent.setup()
    const api = makeApi({
      validateVersion: vi.fn(async () => {
        throw new ProgressApiError(
          'RULE_VALIDATION_FAILED',
          '規則版本 cse-113-day@2 的結構驗證未通過（2 項）。',
          'req-422',
          {
            status: 422,
            details: [
              { field: 'payload.requirements[0].clauseId', reason: '必須指向存在的 C99' },
              { field: 'payload.clauses[1].text', reason: '不可為空' },
            ],
          },
        )
      }),
    })
    render(<AdminValidatePage versionId={VERSION.versionId} api={api} />)

    await user.click(await screen.findByRole('button', { name: '結構驗證' }))

    expect(await screen.findByRole('heading', { name: '規則內容未通過驗證' })).toBeVisible()
    expect(screen.getByText('payload.requirements[0].clauseId')).toBeVisible()
    expect(screen.getByText('必須指向存在的 C99')).toBeVisible()
    expect(screen.getByText('payload.clauses[1].text')).toBeVisible()
    expect(screen.getByText('不可為空')).toBeVisible()
  })

  it('409 顯示目前狀態不允許這個操作，不是籠統的發生錯誤', async () => {
    const user = userEvent.setup()
    const api = makeApi({
      validateVersion: vi.fn(async () => {
        throw new ProgressApiError('RULE_VERSION_IMMUTABLE', '目前是 in-review，不能執行結構驗證。', 'req-409', {
          status: 409,
          details: [{ field: 'status', reason: 'status=in-review', operation: '執行結構驗證' }],
        })
      }),
    })
    render(<AdminValidatePage versionId={VERSION.versionId} api={api} />)

    await user.click(await screen.findByRole('button', { name: '結構驗證' }))

    expect(await screen.findByRole('heading', { name: '目前狀態不允許這個操作' })).toBeVisible()
    expect(screen.getByText(/不能執行結構驗證/)).toBeVisible()
    expect(screen.getByText('status=in-review')).toBeVisible()
  })

  it('403 顯示沒有權限，不是發生錯誤', async () => {
    const user = userEvent.setup()
    const api = makeApi({
      validateVersion: vi.fn(async () => {
        throw new ProgressApiError('AUTH_DEPT_OUT_OF_SCOPE', '你的管理範圍不包含系所 cse。', 'req-403', {
          status: 403,
        })
      }),
    })
    render(<AdminValidatePage versionId={VERSION.versionId} api={api} />)

    await user.click(await screen.findByRole('button', { name: '結構驗證' }))

    expect(await screen.findByRole('heading', { name: '你沒有執行這個動作的權限' })).toBeVisible()
    expect(screen.getByText(/不包含系所 cse/)).toBeVisible()
  })

  it('allowedActions 沒有對應動作時按鈕 disabled', async () => {
    render(
      <AdminValidatePage
        versionId={VERSION.versionId}
        api={makeApi({ getAdminVersion: vi.fn(async () => ({ ...VERSION, allowedActions: [] })) })}
      />,
    )

    expect(await screen.findByRole('button', { name: '結構驗證' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '執行測試' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '送審' })).toBeDisabled()
  })

  it('預設送空資料檢核，結果標示 suite=empty-data 且缺額不算失敗', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    render(<AdminValidatePage versionId={VERSION.versionId} api={api} />)

    await user.click(await screen.findByRole('button', { name: '執行測試' }))

    expect(await screen.findByRole('heading', { name: '測試結果' })).toBeVisible()
    expect(screen.getByText('empty-data')).toBeVisible()
    expect(screen.getByText(/缺額不算失敗/)).toBeVisible()
    expect(vi.mocked(api.testVersion)).toHaveBeenCalledWith(VERSION.versionId, [])
  })
})

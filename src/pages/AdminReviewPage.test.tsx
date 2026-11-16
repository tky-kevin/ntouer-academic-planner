// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminReviewPage from './AdminReviewPage'
import type { AdminReviewApi } from './AdminReviewPage'
import { ProgressApiError } from '../data/mockProgress'
import type {
  AdminAuditItem,
  AdminAuditPage,
  AdminDiff,
  AdminPublishResult,
  AdminVersion,
} from '../api/admin'

const HASH = `sha256:${'b'.repeat(64)}`
const VERSION_ID = 'cse-113-day@3'

const VERSION: AdminVersion = {
  versionId: VERSION_ID,
  bundleId: 'cse-113-day',
  versionNo: 3,
  status: 'in-review',
  schemaVersion: '1.0',
  contentHash: HASH,
  publishedAt: null,
  proxy: false,
  payload: { requirements: [], clauses: [], sources: [] },
  allowedActions: ['approve', 'reject'],
}

const DIFF: AdminDiff = {
  versionId: VERSION_ID,
  bundleId: 'cse-113-day',
  versionNo: 3,
  status: 'in-review',
  previousVersionId: 'cse-113-day@2',
  summary: { added: 1, removed: 1, changed: 1 },
  requirements: [
    {
      kind: 'changed',
      id: 'R06',
      label: '系內選修 46',
      clauseId: 'C03',
      before: 'min: 46',
      after: 'min: 48',
    },
  ],
  clauses: [{ kind: 'added', id: 'C06', label: '永續領域下限 2' }],
  sources: [{ kind: 'removed', id: 'S113-07', label: '舊版手冊' }],
}

function auditItem(recordId: string, actorId: string, action: string): AdminAuditItem {
  return {
    recordId,
    versionId: VERSION_ID,
    action,
    actorId,
    actorRole: 'student',
    actorDeptScope: 'cse',
    at: '2026-11-17T03:20:41+08:00',
    detail: {},
    contentHash: HASH,
    diffFrom: null,
  }
}

const FIRST_AUDIT: AdminAuditPage = {
  items: [auditItem('1', 'actor-one', 'created')],
  nextCursor: '1',
  limit: 20,
}

const SECOND_AUDIT: AdminAuditPage = {
  items: [auditItem('2', 'actor-two', 'validated')],
  nextCursor: null,
  limit: 20,
}

const PUBLISHED: AdminPublishResult = {
  versionId: VERSION_ID,
  status: 'published',
  publishedAt: '2026-11-17T05:00:00+08:00',
  publishedBy: 'user-admin',
  proxy: true,
  superseded: ['cse-113-day@2'],
}

function makeApi(overrides: Partial<AdminReviewApi> = {}): AdminReviewApi {
  return {
    getAdminVersion: vi.fn(async () => VERSION),
    getDiff: vi.fn(async () => DIFF),
    getAudit: vi.fn(async () => FIRST_AUDIT),
    approveVersion: vi.fn(async () => ({ versionId: VERSION_ID, status: 'approved' as const })),
    rejectVersion: vi.fn(async () => ({ versionId: VERSION_ID, status: 'draft' as const })),
    publishVersion: vi.fn(async () => PUBLISHED),
    ...overrides,
  }
}

describe('管理端：審核與差異（UI-09）', () => {
  it('diff 分為新增、刪除、變更三區塊，changed 顯示 before→after', async () => {
    render(<AdminReviewPage versionId={VERSION_ID} api={makeApi()} />)

    expect(await screen.findByRole('heading', { name: '版本差異' })).toBeVisible()
    for (const label of ['新增', '刪除', '變更']) {
      expect(screen.getByRole('heading', { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    expect(screen.getByText('min: 46')).toBeVisible()
    expect(screen.getByText('min: 48')).toBeVisible()
    expect(screen.getByText('C06')).toBeVisible()
    expect(screen.getByText('S113-07')).toBeVisible()
  })

  it('退回時未填原因（含只有空白）不能送出，填了才可按', async () => {
    const user = userEvent.setup()
    render(<AdminReviewPage versionId={VERSION_ID} api={makeApi()} />)

    const reject = await screen.findByRole('button', { name: '退回' })
    expect(reject).toBeDisabled()

    await user.type(screen.getByLabelText(/退回原因/), '   ')
    expect(reject).toBeDisabled()

    await user.type(screen.getByLabelText(/退回原因/), '與手冊第 3 條不一致')
    expect(reject).toBeEnabled()
  })

  it('發布成功後顯示「已發布」與 proxy 值（含代理發布說明）', async () => {
    const user = userEvent.setup()
    const api = makeApi({
      getAdminVersion: vi.fn(async () => ({ ...VERSION, status: 'approved' as const, allowedActions: ['publish' as const] })),
    })
    render(<AdminReviewPage versionId={VERSION_ID} api={api} />)

    await user.click(await screen.findByRole('button', { name: '發布' }))

    expect(await screen.findByRole('heading', { name: '已發布' })).toBeVisible()
    expect(screen.getByText('true')).toBeVisible()
    expect(screen.getAllByText(/proxy=true/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/未經系所管理者審核/).length).toBeGreaterThan(0)
    expect(vi.mocked(api.publishVersion)).toHaveBeenCalledWith(VERSION_ID)
  })

  it('稽核紀錄用 cursor「載入更多」，追加下一頁後按鈕消失', async () => {
    const user = userEvent.setup()
    const getAudit = vi.fn().mockResolvedValueOnce(FIRST_AUDIT).mockResolvedValueOnce(SECOND_AUDIT)
    const api = makeApi({ getAudit })
    render(<AdminReviewPage versionId={VERSION_ID} api={api} />)

    expect(await screen.findByText(/actor-one/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '載入更多' }))

    expect(await screen.findByText(/actor-two/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '載入更多' })).not.toBeInTheDocument()
    expect(getAudit).toHaveBeenNthCalledWith(2, {
      versionId: VERSION_ID,
      cursor: '1',
      limit: 20,
    })
  })

  it('發布遇到 409 顯示目前狀態不允許這個操作', async () => {
    const user = userEvent.setup()
    const api = makeApi({
      getAdminVersion: vi.fn(async () => ({ ...VERSION, status: 'approved' as const, allowedActions: ['publish' as const] })),
      publishVersion: vi.fn(async () => {
        throw new ProgressApiError('RULE_VERSION_IMMUTABLE', '版本已被別人發布。', 'req-409', {
          status: 409,
          details: [{ field: 'status', reason: 'status=published' }],
        })
      }),
    })
    render(<AdminReviewPage versionId={VERSION_ID} api={api} />)

    await user.click(await screen.findByRole('button', { name: '發布' }))

    expect(await screen.findByRole('heading', { name: '目前狀態不允許這個操作' })).toBeVisible()
    expect(screen.getByText('status=published')).toBeVisible()
  })

  it('proxy 版本顯示未經系所審核的警示', async () => {
    render(
      <AdminReviewPage
        versionId={VERSION_ID}
        api={makeApi({ getAdminVersion: vi.fn(async () => ({ ...VERSION, proxy: true })) })}
      />,
    )

    expect(await screen.findByText('未經系所管理者審核')).toBeVisible()
  })
})

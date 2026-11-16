import { describe, expect, it } from 'vitest'
import { can, isProxyPublish } from './can.js'
import type { Action, Role } from './can.js'

type Subject = 'student' | 'deptAdmin' | 'sysadmin'

const SUBJECTS: Record<Subject, { role: Role; deptScopes: string[] }> = {
  student: { role: 'student', deptScopes: [] },
  deptAdmin: { role: 'student', deptScopes: ['cse'] },
  sysadmin: { role: 'sysadmin', deptScopes: [] },
}

const ACTIONS: Action[] = [
  'readPublishedRule',
  'editDraft',
  'validateDraft',
  'reviewDraft',
  'publishVersion',
  'assignDeptAdmin',
  'readPersonalData',
  'deletePublishedVersion',
]

// §8 的 8 列 × 3 欄；系所相關動作以 resourceDept='cse' 測試（deptAdmin 的範圍）。
const EXPECTED: Record<Action, Record<Subject, boolean>> = {
  readPublishedRule: { student: true, deptAdmin: true, sysadmin: true },
  editDraft: { student: false, deptAdmin: true, sysadmin: true },
  validateDraft: { student: false, deptAdmin: true, sysadmin: true },
  reviewDraft: { student: false, deptAdmin: true, sysadmin: true },
  publishVersion: { student: false, deptAdmin: true, sysadmin: true },
  assignDeptAdmin: { student: false, deptAdmin: false, sysadmin: true },
  readPersonalData: { student: true, deptAdmin: true, sysadmin: false },
  deletePublishedVersion: { student: false, deptAdmin: false, sysadmin: false },
}

const cells = ACTIONS.flatMap((action) =>
  (Object.keys(SUBJECTS) as Subject[]).map((subject) => ({
    action,
    subject,
    expected: EXPECTED[action][subject],
  })),
)

describe('權限矩陣：8 動作 × 3 主體＝24 格', () => {
  it.each(cells)('$action／$subject → $expected', ({ action, subject, expected }) => {
    const principal = SUBJECTS[subject]
    const allowed = can({
      role: principal.role,
      actorUserId: 'user-1',
      deptScopes: principal.deptScopes,
      action,
      resourceDept: 'cse',
      subjectUserId: 'user-1',
    })
    expect(allowed).toBe(expected)
  })
})

describe('關鍵案例（對應 §8 的注意事項）', () => {
  it('學生不能編輯草稿', () => {
    expect(
      can({ role: 'student', actorUserId: 'u', deptScopes: [], action: 'editDraft', resourceDept: 'cse' }),
    ).toBe(false)
  })

  it('系所管理員只能編輯自己系所', () => {
    const base = { role: 'student' as const, actorUserId: 'u', deptScopes: ['cse'], action: 'editDraft' as const }
    expect(can({ ...base, resourceDept: 'cse' })).toBe(true)
    expect(can({ ...base, resourceDept: 'mmd' })).toBe(false)
  })

  it('系統管理員可代理發布', () => {
    expect(
      can({ role: 'sysadmin', actorUserId: 'u', deptScopes: [], action: 'publishVersion', resourceDept: 'cse' }),
    ).toBe(true)
    expect(isProxyPublish({ role: 'sysadmin', activeDeptAdminCount: 0 })).toBe(true)
    expect(isProxyPublish({ role: 'sysadmin', activeDeptAdminCount: 1 })).toBe(false)
    expect(isProxyPublish({ role: 'student', activeDeptAdminCount: 0 })).toBe(false)
  })

  it('系所管理員不能審核其他系所', () => {
    expect(
      can({ role: 'student', actorUserId: 'u', deptScopes: ['cse'], action: 'reviewDraft', resourceDept: 'mmd' }),
    ).toBe(false)
  })

  it('已撤銷的指派不算有效', () => {
    // loadDeptScopes 撤銷後回空陣列；這裡驗「沒有範圍就不能做系所動作」。
    expect(
      can({ role: 'student', actorUserId: 'u', deptScopes: [], action: 'reviewDraft', resourceDept: 'cse' }),
    ).toBe(false)
  })

  it('學生只能讀自己的個人資料', () => {
    const base = { role: 'student' as const, actorUserId: 'u1', deptScopes: [], action: 'readPersonalData' as const }
    expect(can({ ...base, subjectUserId: 'u1' })).toBe(true)
    expect(can({ ...base, subjectUserId: 'u2' })).toBe(false)
  })

  it('系所管理員可以讀自己的資料，但不能讀別人的', () => {
    const base = { role: 'student' as const, actorUserId: 'u1', deptScopes: ['cse'], action: 'readPersonalData' as const }
    expect(can({ ...base, subjectUserId: 'u1' })).toBe(true)
    expect(can({ ...base, subjectUserId: 'u2' })).toBe(false)
  })

  it('刪除已發布版本一律拒絕', () => {
    for (const role of ['student', 'sysadmin'] as Role[]) {
      expect(can({ role, actorUserId: 'u', deptScopes: [], action: 'deletePublishedVersion' })).toBe(false)
    }
  })
})

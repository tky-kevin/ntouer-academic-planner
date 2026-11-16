// 權限判斷（#23）：主體 ＋ 動作 ＋ 資源（系所）三元組。
// 矩陣來源：docs/design/system-design.md §8（8 列 × 3 欄＝24 格）。
// 角色只有 student／sysadmin；「系所管理員」＝ student ＋ deptScopes 非空，不是第三種 role。
import type { QueryFn } from '../app.js'

export type Role = 'student' | 'sysadmin'
export type Action =
  | 'readPublishedRule'
  | 'editDraft'
  | 'validateDraft'
  | 'reviewDraft'
  | 'publishVersion'
  | 'assignDeptAdmin'
  | 'readPersonalData'
  | 'deletePublishedVersion'

const DEPT_SCOPED: ReadonlySet<Action> = new Set(['editDraft', 'validateDraft', 'reviewDraft', 'publishVersion'])

export interface CanInput {
  role: Role
  actorUserId: string
  deptScopes: readonly string[]
  action: Action
  resourceDept?: string | null
  subjectUserId?: string | null
}

export function isDeptScoped(action: Action): boolean {
  return DEPT_SCOPED.has(action)
}

export function can(input: CanInput): boolean {
  const { role, action, deptScopes, resourceDept, subjectUserId, actorUserId } = input

  switch (action) {
    case 'readPublishedRule':
      return true
    case 'assignDeptAdmin':
      return role === 'sysadmin'
    case 'readPersonalData':
      return role === 'student' && subjectUserId === actorUserId
    case 'deletePublishedVersion':
      return false
    case 'editDraft':
    case 'validateDraft':
    case 'reviewDraft':
    case 'publishVersion':
      if (role === 'sysadmin') return true
      if (!resourceDept) return false
      return deptScopes.includes(resourceDept)
  }
}

export function isProxyPublish(input: { role: Role; activeDeptAdminCount: number }): boolean {
  return input.role === 'sysadmin' && input.activeDeptAdminCount === 0
}

export async function loadDeptScopes(query: QueryFn, userId: string): Promise<string[]> {
  const result = await query(
    `select dept_id from department_admins where user_id = $1 and revoked_at is null order by dept_id`,
    [userId],
  )
  return (result.rows as Array<{ dept_id: string }>).map((row) => row.dept_id)
}

export async function countActiveDeptAdmins(query: QueryFn, deptId: string): Promise<number> {
  const result = await query(`select count(*)::int as count from department_admins where dept_id = $1 and revoked_at is null`, [
    deptId,
  ])
  return (result.rows[0] as { count: number }).count
}

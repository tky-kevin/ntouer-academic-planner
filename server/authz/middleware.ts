// 權限中介層：從 session 取角色與系所範圍 → can() → 403 或放行。
// 不快取 deptScopes（撤銷要立即生效）。
import type { QueryFn } from '../app.js'
import { can, countActiveDeptAdmins, isDeptScoped, isProxyPublish, loadDeptScopes } from './can.js'
import type { Action, Role } from './can.js'

export interface SessionLike {
  userId: string
  role: Role
}

export type AuthzResult =
  | { allowed: true; proxy: boolean }
  | { allowed: false; code: 'AUTH_FORBIDDEN' | 'AUTH_DEPT_OUT_OF_SCOPE' }

export async function authorize(input: {
  query: QueryFn
  session: SessionLike
  action: Action
  resourceDept?: string | null
  subjectUserId?: string | null
}): Promise<AuthzResult> {
  const { query, session, action, resourceDept, subjectUserId } = input
  const deptScopes = session.role === 'sysadmin' ? [] : await loadDeptScopes(query, session.userId)

  const allowed = can({
    role: session.role,
    actorUserId: session.userId,
    deptScopes,
    action,
    resourceDept,
    subjectUserId,
  })

  if (!allowed) {
    const outOfScope =
      session.role === 'student' &&
      isDeptScoped(action) &&
      Boolean(resourceDept) &&
      deptScopes.length > 0 &&
      !deptScopes.includes(resourceDept as string)
    return { allowed: false, code: outOfScope ? 'AUTH_DEPT_OUT_OF_SCOPE' : 'AUTH_FORBIDDEN' }
  }

  // 系統管理員只在「該系沒有有效管理員」時才能發布，而且要在版本上標 proxy。
  if (session.role === 'sysadmin' && action === 'publishVersion' && resourceDept) {
    const activeAdmins = await countActiveDeptAdmins(query, resourceDept)
    if (activeAdmins > 0) return { allowed: false, code: 'AUTH_FORBIDDEN' }
    return { allowed: true, proxy: isProxyPublish({ role: 'sysadmin', activeDeptAdminCount: activeAdmins }) }
  }

  return { allowed: true, proxy: false }
}

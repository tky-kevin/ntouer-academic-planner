import { describe, expect, it } from 'vitest'
import { authorize } from './middleware.js'
import type { QueryFn } from '../app.js'

function fakeQuery(options: { scopes?: string[]; activeAdmins?: number }): QueryFn {
  return async (text) => {
    if (text.includes('count(*)')) return { rows: [{ count: options.activeAdmins ?? 0 }] }
    if (text.includes('from department_admins')) {
      return { rows: (options.scopes ?? []).map((dept_id) => ({ dept_id })) }
    }
    return { rows: [] }
  }
}

describe('權限中介層', () => {
  it('系所管理員在自己系所可以編輯', async () => {
    const result = await authorize({
      query: fakeQuery({ scopes: ['cse'] }),
      session: { userId: 'u1', role: 'student' },
      action: 'editDraft',
      resourceDept: 'cse',
    })
    expect(result).toEqual({ allowed: true, proxy: false })
  })

  it('系所管理員動別的系所 → AUTH_DEPT_OUT_OF_SCOPE', async () => {
    const result = await authorize({
      query: fakeQuery({ scopes: ['cse'] }),
      session: { userId: 'u1', role: 'student' },
      action: 'reviewDraft',
      resourceDept: 'mmd',
    })
    expect(result).toEqual({ allowed: false, code: 'AUTH_DEPT_OUT_OF_SCOPE' })
  })

  it('沒有系所範圍的學生 → AUTH_FORBIDDEN（不是 out of scope）', async () => {
    const result = await authorize({
      query: fakeQuery({ scopes: [] }),
      session: { userId: 'u1', role: 'student' },
      action: 'editDraft',
      resourceDept: 'cse',
    })
    expect(result).toEqual({ allowed: false, code: 'AUTH_FORBIDDEN' })
  })

  it('sysadmin 在沒有管理員的系所發布 → 允許且 proxy=true', async () => {
    const result = await authorize({
      query: fakeQuery({ activeAdmins: 0 }),
      session: { userId: 'admin', role: 'sysadmin' },
      action: 'publishVersion',
      resourceDept: 'cse',
    })
    expect(result).toEqual({ allowed: true, proxy: true })
  })

  it('sysadmin 在仍有管理員的系所發布 → 拒絕', async () => {
    const result = await authorize({
      query: fakeQuery({ activeAdmins: 2 }),
      session: { userId: 'admin', role: 'sysadmin' },
      action: 'publishVersion',
      resourceDept: 'cse',
    })
    expect(result).toEqual({ allowed: false, code: 'AUTH_FORBIDDEN' })
  })
})

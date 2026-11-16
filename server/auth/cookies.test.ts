import { describe, expect, it } from 'vitest'
import { clearCookie, parseCookies, serializeCookie } from '../http/cookies.js'

describe('cookie 工具', () => {
  it('解析多個 cookie，值會 decode', () => {
    const parsed = parseCookies('a=1; planner_session=abc%3D; empty=')
    expect(parsed).toEqual({ a: '1', planner_session: 'abc=', empty: '' })
    expect(parseCookies(undefined)).toEqual({})
  })

  it('序列化帶 HttpOnly／SameSite／Path／Max-Age', () => {
    const cookie = serializeCookie('planner_session', 'token', {
      maxAgeSeconds: 604_800,
      path: '/',
      secure: true,
    })
    expect(cookie).toContain('planner_session=token')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=604800')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('清除 cookie 就是 Max-Age=0', () => {
    expect(clearCookie('planner_oauth', { path: '/auth' })).toContain('Max-Age=0')
  })
})

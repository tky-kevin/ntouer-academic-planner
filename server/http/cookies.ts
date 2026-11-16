// Cookie 的解析與序列化（只用標準函式庫）。
// 值一律假設是 base64url；解析時只做寬鬆處理，真正的驗證在各自的模組。

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!name) continue
    cookies[name] = decodeURIComponent(value)
  }
  return cookies
}

export interface CookieOptions {
  maxAgeSeconds?: number
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`)
  if (options.httpOnly !== false) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  return parts.join('; ')
}

export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 })
}

// 靜態檔案服務：把 Vite 建置產物（dist/）掛在 API 同一來源。
// 為什麼要這樣做：Google OIDC 的 redirect URI 與 cookie 都是同源設計（ADR-0003／ADR-0006），
// 前端若另起一個 port，登入後的導頁與 session cookie 會落在錯的地方。
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Reply, Route } from './app.js'
import { fail, makeMeta } from './http/envelope.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

function notFound(requestId: string, pathname: string): Reply {
  return {
    status: 404,
    body: fail(
      { code: 'RESOURCE_NOT_FOUND', message: `找不到路徑 ${pathname}。`, retryable: false },
      makeMeta(requestId),
    ),
    headers: { 'Cache-Control': 'no-store' },
  }
}

/** 只允許 dist 內的路徑；擋掉 `..`、絕對路徑與空位元組。 */
function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  if (decoded.includes('\0')) return null
  const relative = decoded.replace(/^\/+/, '')
  const resolved = path.resolve(root, relative)
  const rootResolved = path.resolve(root)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) return null
  return resolved
}

export interface StaticRoutesOptions {
  /** `dist/` 的絕對路徑。 */
  root: string
}

/**
 * 回傳兩個 GET route：
 *   1. `/` 與具副檔名的檔案（含 admin-validate.html、admin-review.html）
 *   2. `/*` 單頁應用 fallback：沒有副檔名的路徑回 index.html，其餘 404
 * 比 API／auth 路由晚掛，所以不會搶到它們。
 */
export function createStaticRoutes({ root }: StaticRoutesOptions): Route[] {
  const indexFile = path.join(root, 'index.html')

  const serveFile = (target: string): Reply => {
    const body = readFileSync(target)
    const cache = target.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable'
    return {
      status: 200,
      body,
      headers: { 'Content-Type': contentType(target), 'Cache-Control': cache },
    }
  }

  const tryFile = (target: string | null): Reply | null => {
    if (!target || !existsSync(target)) return null
    const stat = statSync(target)
    if (!stat.isFile()) return null
    return serveFile(target)
  }

  return [
    {
      method: 'GET',
      path: '/',
      handler: async ({ requestId }) => {
        const reply = tryFile(indexFile)
        return reply ?? notFound(requestId, '/')
      },
    },
    {
      method: 'GET',
      path: '/*',
      handler: async ({ requestId, url }) => {
        // API／auth 前綴一律回 404 envelope，不要被 SPA fallback 吃掉。
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
          return notFound(requestId, url.pathname)
        }
        const target = safeJoin(root, url.pathname)
        const file = tryFile(target)
        if (file) return file
        const last = url.pathname.split('/').pop() ?? ''
        if (!last.includes('.')) {
          const fallback = tryFile(indexFile)
          if (fallback) return fallback
        }
        return notFound(requestId, url.pathname)
      },
    },
  ]
}

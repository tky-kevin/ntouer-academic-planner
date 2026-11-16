// 請求層小工具：JSON body 讀取（有大小上限）與同源檢查（api-spec §2 的 CSRF 防線）。
import type { IncomingMessage } from 'node:http'

export class RequestBodyError extends Error {
  constructor(readonly reason: 'too-large' | 'invalid-json' | 'missing') {
    super(reason)
    this.name = 'RequestBodyError'
  }
}

const DEFAULT_LIMIT = 16 * 1024

/** 讀 JSON body；空 body 回 undefined（PATCH 這種全選填的端點需要它）。 */
export async function readJsonBody(req: IncomingMessage, limit = DEFAULT_LIMIT): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > limit) throw new RequestBodyError('too-large')
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new RequestBodyError('invalid-json')
  }
}

/** 變更類請求必須同源；沒有 Origin（curl、伺服器端呼叫）時放行，cookie 仍受 SameSite 保護。 */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

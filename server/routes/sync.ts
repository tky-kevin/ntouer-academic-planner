// `POST /api/me/sync/ais`、`POST /api/me/sync/ais/{syncId}`、`DELETE …`、`PATCH /api/me/profile`。
// 規格：docs/design/api-spec.md §7.6（同步）／§7.7（學籍補齊）。
// 安全：只有本人能同步自己的資料；帳密不落庫、不落日誌；回應只給遮蔽後的帳號。
import type { QueryFn, Reply, Route, RouteContext } from '../app.js'
import { fail, makeMeta, ok } from '../http/envelope.js'
import type { ErrorCodeLike } from '../http/envelope.js'
import { asObject, isSameOrigin, readJsonBody, RequestBodyError } from '../http/request.js'
import { resolveIdentity } from '../auth/identity.js'
import type { Identity } from '../auth/identity.js'
import { AisSyncService, SyncError } from '../ais/sync.js'

const NO_STORE = { 'Cache-Control': 'no-store' }

function unauthorized(requestId: string): Reply {
  return {
    status: 401,
    body: fail({ code: 'AUTH_REQUIRED', message: '請先登入。', retryable: false }, makeMeta(requestId)),
    headers: NO_STORE,
  }
}

function originMismatch(requestId: string): Reply {
  return {
    status: 403,
    body: fail({ code: 'AUTH_ORIGIN_MISMATCH', message: '請求來源與站台不同源。', retryable: false }, makeMeta(requestId)),
    headers: NO_STORE,
  }
}

function badRequest(requestId: string, message: string, details: unknown[] = []): Reply {
  return {
    status: 400,
    body: fail({ code: 'REQUEST_INVALID', message, details, retryable: false }, makeMeta(requestId)),
    headers: NO_STORE,
  }
}

function syncFailure(requestId: string, error: SyncError | unknown): Reply {
  if (error instanceof SyncError) {
    return {
      status: error.httpStatus,
      body: fail(
        {
          code: error.code as ErrorCodeLike,
          message: error.message,
          retryable: error.code !== 'SYNC_NOT_FOUND' && error.code !== 'AIS_CREDENTIALS_NOT_CONFIGURED',
        },
        makeMeta(requestId),
      ),
      headers: NO_STORE,
    }
  }
  return {
    status: 500,
    body: fail(
      { code: 'INTERNAL', message: '伺服器發生未預期的錯誤，請帶著 requestId 回報。', retryable: true },
      makeMeta(requestId),
    ),
    headers: NO_STORE,
  }
}

type BodyResult = { kind: 'ok'; value: Record<string, unknown> } | { kind: 'error'; reply: Reply }

async function readBodyOrReply(req: RouteContext['req'], requestId: string): Promise<BodyResult> {
  try {
    const raw = await readJsonBody(req)
    if (raw === undefined) return { kind: 'ok', value: {} }
    const object = asObject(raw)
    if (!object) return { kind: 'error', reply: badRequest(requestId, '請求 body 必須是 JSON 物件。') }
    return { kind: 'ok', value: object }
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return {
        kind: 'error',
        reply: badRequest(requestId, error.reason === 'too-large' ? '請求 body 過大。' : '請求 body 不是合法 JSON。'),
      }
    }
    throw error
  }
}

interface UserProfileRow {
  dept_id: string | null
  entry_year: number | null
  program: string
}

async function loadProfile(query: QueryFn, userId: string): Promise<UserProfileRow | null> {
  const result = await query(`select dept_id, entry_year, program from users where user_id = $1::uuid`, [userId])
  return (result.rows[0] as UserProfileRow | undefined) ?? null
}

export interface SyncRouteOptions {
  query: QueryFn
  service: AisSyncService
  devUserSub?: string
  nodeEnv?: string
}

export function createSyncRoutes({ query, service, devUserSub, nodeEnv }: SyncRouteOptions): Route[] {
  const identityFor = (ctx: RouteContext): Promise<Identity | null> =>
    resolveIdentity(ctx.req, query, { devUserSub, nodeEnv })

  return [
    {
      method: 'POST',
      path: '/api/me/sync/ais',
      handler: async (ctx) => {
        const { requestId } = ctx
        if (!isSameOrigin(ctx.req)) return originMismatch(requestId)
        const identity = await identityFor(ctx)
        if (!identity) return unauthorized(requestId)

        const body = await readBodyOrReply(ctx.req, requestId)
        if (body.kind === 'error') return body.reply
        const fields = body.value
        const account = typeof fields.account === 'string' ? fields.account : undefined
        const password = typeof fields.password === 'string' ? fields.password : undefined
        if ((account === undefined) !== (password === undefined)) {
          return badRequest(requestId, '帳號與密碼必須一起提供，或都不提供（改用伺服器設定的 AIS 帳密）。', [
            { field: 'account', reason: 'incomplete-credentials' },
          ])
        }

        try {
          const started = await service.start({ userId: identity.userId, account, password })
          return { status: 202, body: ok(started, makeMeta(requestId)), headers: NO_STORE }
        } catch (error) {
          return syncFailure(requestId, error)
        }
      },
    },
    {
      method: 'POST',
      path: '/api/me/sync/ais/:syncId',
      handler: async (ctx) => {
        const { requestId, params } = ctx
        if (!isSameOrigin(ctx.req)) return originMismatch(requestId)
        const identity = await identityFor(ctx)
        if (!identity) return unauthorized(requestId)

        const body = await readBodyOrReply(ctx.req, requestId)
        if (body.kind === 'error') return body.reply
        const captcha = body.value.captcha
        if (typeof captcha !== 'string') {
          return badRequest(requestId, '缺少 captcha（四碼英數字）。', [{ field: 'captcha', reason: 'required' }])
        }

        try {
          const result = await service.complete(identity.userId, params.syncId, captcha)
          const profile = await loadProfile(query, identity.userId)
          const missing: string[] = []
          if (!profile?.dept_id) missing.push('deptId')
          if (!profile?.entry_year) missing.push('entryYear')
          return {
            status: 200,
            body: ok(
              {
                status: 'succeeded' as const,
                counts: result.outcome.counts,
                dataSyncedAt: result.outcome.dataSyncedAt,
                unmatched: result.outcome.unmatched,
                profile: {
                  deptId: profile?.dept_id ?? null,
                  entryYear: profile?.entry_year ?? null,
                  program: profile?.program ?? 'day',
                  missing,
                },
                warnings: result.outcome.warnings,
                persisted: result.persisted,
              },
              makeMeta(requestId),
            ),
            headers: NO_STORE,
          }
        } catch (error) {
          return syncFailure(requestId, error)
        }
      },
    },
    {
      method: 'DELETE',
      path: '/api/me/sync/ais/:syncId',
      handler: async (ctx) => {
        const { requestId, params } = ctx
        if (!isSameOrigin(ctx.req)) return originMismatch(requestId)
        const identity = await identityFor(ctx)
        if (!identity) return unauthorized(requestId)
        const result = service.cancel(identity.userId, params.syncId)
        if (result === 'not-found') {
          return {
            status: 404,
            body: fail(
              { code: 'SYNC_NOT_FOUND', message: '找不到這個同步，可能已完成或已過期。', retryable: false },
              makeMeta(requestId),
            ),
            headers: NO_STORE,
          }
        }
        return { status: 204, headers: NO_STORE }
      },
    },
    {
      method: 'PATCH',
      path: '/api/me/profile',
      handler: async (ctx) => {
        const { requestId } = ctx
        if (!isSameOrigin(ctx.req)) return originMismatch(requestId)
        const identity = await identityFor(ctx)
        if (!identity) return unauthorized(requestId)

        const body = await readBodyOrReply(ctx.req, requestId)
        if (body.kind === 'error') return body.reply
        const fields = body.value

        const allowed = new Set(['deptId', 'entryYear', 'program'])
        for (const key of Object.keys(fields)) {
          if (!allowed.has(key)) {
            return badRequest(requestId, `不允許的欄位：${key}`, [{ field: key, reason: 'unknown-field' }])
          }
        }

        const details: unknown[] = []
        let deptId: string | null = null
        let entryYear: number | null = null
        let program: string | null = null

        if (fields.deptId !== undefined) {
          if (typeof fields.deptId !== 'string' || fields.deptId.trim() === '') {
            details.push({ field: 'deptId', reason: 'must-be-non-empty-string' })
          } else {
            deptId = fields.deptId.trim()
            const found = await query(`select dept_id from departments where dept_id = $1`, [deptId])
            if (found.rows.length === 0) details.push({ field: 'deptId', reason: 'unknown-department' })
          }
        }
        if (fields.entryYear !== undefined) {
          const value = fields.entryYear
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 130) {
            details.push({ field: 'entryYear', reason: 'must-be-integer-100-130' })
          } else entryYear = value
        }
        if (fields.program !== undefined) {
          if (fields.program !== 'day' && fields.program !== 'night') {
            details.push({ field: 'program', reason: "must-be-'day'-or-'night'" })
          } else program = fields.program
        }
        if (details.length > 0) return badRequest(requestId, '學籍資料不合法。', details)
        if (deptId === null && entryYear === null && program === null) {
          return badRequest(requestId, '至少提供一個欄位（deptId／entryYear／program）。')
        }

        const updated = await query(
          `update users
              set dept_id    = coalesce($2, dept_id),
                  entry_year = coalesce($3, entry_year),
                  program    = coalesce($4, program)
            where user_id = $1::uuid
          returning dept_id, entry_year, program`,
          [identity.userId, deptId, entryYear, program],
        )
        if (updated.rows.length === 0) return unauthorized(requestId)
        const row = updated.rows[0] as UserProfileRow
        return {
          status: 200,
          body: ok(
            { deptId: row.dept_id, entryYear: row.entry_year, program: row.program },
            makeMeta(requestId),
          ),
          headers: NO_STORE,
        }
      },
    },
  ]
}

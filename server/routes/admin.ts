// 管理端「規則版本發布流程」路由（Issue #14）。
// 規格：system-design.md §7–§8、api-spec.md §2–§6；端點名稱照 api-spec §6 登記，不自創。
//
// 狀態機（system-design.md §8）與本檔的落地方式：
//   draft --submit--> in-review --approve--> approved --publish--> published --新版本--> superseded
//   in-review --reject--> draft（必填 reason）
// design 圖上的 validating／testing 是「請求進行中」的暫態，不是可查詢的存放狀態：
// validate／test 都是同步請求，成功或失敗後版本仍停在 draft（失敗也停在 draft，與圖一致），
// 因此 submit 的合法前置是 draft（等效於 testing → in-review）。若資料庫真的有 validating／testing
//（例如人工改資料），本檔一律視為不可操作，回 409。
//
// 非法狀態轉移的錯誤碼：api-spec §4 的 409 只有 RULE_VERSION_IMMUTABLE 與
// RULE_VERSION_NOT_PUBLISHED；後者語意是「學生讀到非 published 版本」，不適用管理端，
// 因此一律用 RULE_VERSION_IMMUTABLE，並在 details 標明目前狀態與被拒絕的動作。
import type { IncomingMessage } from 'node:http'
import type { QueryFn, Reply, Route, RouteContext } from '../app.js'
import { fail, isoNow, makeMeta, ok } from '../http/envelope.js'
import type { ErrorCode } from '../http/envelope.js'
import { can, countActiveDeptAdmins, isDeptScoped, isProxyPublish, loadDeptScopes } from '../authz/can.js'
import type { Action } from '../authz/can.js'
import { resolveIdentity } from '../auth/identity.js'
import type { Identity } from '../auth/identity.js'
import { validateBundle } from '../../src/engine/ruleEngine.js'
import type { RuleBundle } from '../../src/engine/ruleEngine.js'
import { parseVersionId } from './rules.js'
import {
  hashContent,
  parseAuditQuery,
  parseCreateDraftBody,
  parseEmptyBody,
  parseRejectBody,
  parseTestBody,
  parseUpdateBody,
  readJsonBody,
  rejectUnknownQuery,
  runBundleTestSuite,
} from '../admin/validate.js'
import type { ParseResult, Problem } from '../admin/validate.js'
import {
  approveVersion,
  createDraftVersion,
  getBundle,
  getLatestVersion,
  getPreviousVersion,
  getVersion,
  listPublishedVersions,
  listReviewRecords,
  publishVersion,
  recordTestRun,
  recordValidation,
  rejectVersion,
  replaceProjection,
  submitVersion,
  updateDraftPayload,
} from '../admin/store.js'
import type { ActorSnapshot, BundleRow, VersionRow } from '../admin/store.js'
import { diffPayloads, summarizeDiff } from '../admin/diff.js'

export interface AdminRouteOptions {
  query: QueryFn
  /** 本機替身身分（users.google_sub）；正式環境不傳。 */
  devUserSub?: string
  /** 決定 resolveIdentity 是否允許 dev 身分；預設交給 resolveIdentity 讀 NODE_ENV。 */
  nodeEnv?: string
}

type Result<T> = { ok: true; value: T } | { ok: false; reply: Reply }

const BUNDLE_ID = /^[a-z0-9][a-z0-9-]*$/
const NO_STORE = { 'Cache-Control': 'no-store' }

function deny<T>(reply: Reply): Result<T> {
  return { ok: false, reply }
}

function errorReply(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  options: { details?: unknown[]; versionId?: string } = {},
): Reply {
  return {
    status,
    body: fail(
      {
        code,
        message,
        ...(options.details && options.details.length > 0 ? { details: options.details } : {}),
        retryable: false,
      },
      makeMeta(requestId, options.versionId),
    ),
    headers: NO_STORE,
  }
}

function okReply<T>(data: T, requestId: string, versionId?: string): Reply {
  return { status: 200, body: ok(data, makeMeta(requestId, versionId)), headers: NO_STORE }
}

function invalidReply(requestId: string, problems: readonly Problem[]): Reply {
  const first = problems[0]
  return errorReply(
    400,
    'REQUEST_INVALID',
    first ? `${first.field} 不合法：${first.reason}` : '請求內容不合法。',
    requestId,
    { details: problems.map((problem) => ({ field: problem.field, reason: problem.reason })) },
  )
}

function unauthorizedReply(requestId: string): Reply {
  return errorReply(401, 'AUTH_REQUIRED', '請先登入。', requestId)
}

function forbiddenReply(
  requestId: string,
  code: 'AUTH_FORBIDDEN' | 'AUTH_DEPT_OUT_OF_SCOPE',
  message: string,
): Reply {
  return errorReply(403, code, message, requestId)
}

function notFoundVersionReply(requestId: string, versionId: string): Reply {
  return errorReply(404, 'RULE_VERSION_NOT_FOUND', `找不到規則版本 ${versionId}。`, requestId)
}

function notFoundBundleReply(requestId: string, bundleId: string): Reply {
  return errorReply(404, 'RULE_BUNDLE_NOT_FOUND', `找不到規則包 ${bundleId}。`, requestId)
}

/** 非 draft 的內容修改／非法狀態轉移，一律 409 RULE_VERSION_IMMUTABLE（理由見檔頭）。 */
function immutableReply(requestId: string, version: VersionRow, operation: string): Reply {
  return errorReply(
    409,
    'RULE_VERSION_IMMUTABLE',
    `規則版本 ${version.version_id} 目前是 ${version.status}，不能${operation}。`,
    requestId,
    {
      versionId: version.version_id,
      details: [{ field: 'status', reason: `status=${version.status}`, operation }],
    },
  )
}

function validationFailedReply(requestId: string, versionId: string, errors: readonly string[]): Reply {
  return errorReply(
    422,
    'RULE_VALIDATION_FAILED',
    `規則版本 ${versionId} 的結構驗證未通過（${errors.length} 項）。`,
    requestId,
    {
      versionId,
      details: errors.map((reason, index) => ({ field: 'payload', reason, index })),
    },
  )
}

function testFailedReply(
  requestId: string,
  versionId: string,
  failures: ReadonlyArray<{ name: string; detail?: string }>,
): Reply {
  return errorReply(
    422,
    'RULE_TEST_FAILED',
    `規則版本 ${versionId} 的測試案例未全數通過（${failures.length} 項）。`,
    requestId,
    {
      versionId,
      details: failures.map((failure) => ({
        field: failure.name,
        reason: failure.detail ?? '未通過',
      })),
    },
  )
}

function internalReply(requestId: string): Reply {
  return errorReply(500, 'INTERNAL', '伺服器發生未預期的錯誤，請帶著 requestId 回報。', requestId)
}

// api-spec §2：變更類請求的 Origin 必須與 Host 同源。瀏覽器一定會帶 Origin；
// 沒有 Origin 的請求（curl、伺服器端呼叫）放行，真正的授權仍靠 cookie 與後端 can()。
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function beginRequest(
  ctx: RouteContext,
  options: AdminRouteOptions,
  config: { csrf: boolean; allowedQuery: readonly string[] },
): Promise<Result<{ identity: Identity }>> {
  const queryProblems = rejectUnknownQuery(ctx.url, config.allowedQuery)
  if (queryProblems.length > 0) return deny(invalidReply(ctx.requestId, queryProblems))

  if (config.csrf && !sameOrigin(ctx.req)) {
    return deny(errorReply(403, 'AUTH_ORIGIN_MISMATCH', '請求來源與站台不同源。', ctx.requestId))
  }

  const identity = await resolveIdentity(ctx.req, options.query, {
    devUserSub: options.devUserSub,
    nodeEnv: options.nodeEnv,
  })
  if (!identity) return deny(unauthorizedReply(ctx.requestId))
  return { ok: true, value: { identity } }
}

/**
 * can() 的三元組：主體（identity）＋動作＋資源系所。
 * 系所範圍每次請求重查（不快取），撤銷管理員後下一個請求就失效（api-spec §2）。
 */
async function authorizeFor(
  ctx: RouteContext,
  identity: Identity,
  action: Action,
  resourceDept: string | null,
): Promise<Result<string[]>> {
  const deptScopes = await loadDeptScopes(ctx.query, identity.userId)
  const allowed = can({
    role: identity.role,
    actorUserId: identity.userId,
    deptScopes,
    action,
    resourceDept,
  })
  if (allowed) return { ok: true, value: deptScopes }

  const outOfScope =
    identity.role === 'student' &&
    isDeptScoped(action) &&
    Boolean(resourceDept) &&
    deptScopes.length > 0 &&
    !deptScopes.includes(resourceDept as string)
  return deny(
    outOfScope
      ? forbiddenReply(ctx.requestId, 'AUTH_DEPT_OUT_OF_SCOPE', `你的管理範圍不包含系所 ${resourceDept}。`)
      : forbiddenReply(ctx.requestId, 'AUTH_FORBIDDEN', '你沒有執行這個動作的權限。'),
  )
}

async function loadVersion(ctx: RouteContext): Promise<Result<VersionRow>> {
  const raw = ctx.params.versionId ?? ''
  if (!parseVersionId(raw)) {
    return deny(
      invalidReply(ctx.requestId, [
        { field: 'versionId', reason: '格式必須是 bundleId@versionNo，例如 cse-113-day@1' },
      ]),
    )
  }
  const version = await getVersion(ctx.query, raw)
  if (!version) return deny(notFoundVersionReply(ctx.requestId, raw))
  return { ok: true, value: version }
}

interface VersionAccess {
  identity: Identity
  deptScopes: string[]
  version: VersionRow
}

async function versionAccess(
  ctx: RouteContext,
  options: AdminRouteOptions,
  action: Action,
  csrf: boolean,
): Promise<Result<VersionAccess>> {
  const begin = await beginRequest(ctx, options, { csrf, allowedQuery: [] })
  if (!begin.ok) return begin
  const version = await loadVersion(ctx)
  if (!version.ok) return version
  const authz = await authorizeFor(ctx, begin.value.identity, action, version.value.dept_id)
  if (!authz.ok) return authz
  return {
    ok: true,
    value: { identity: begin.value.identity, deptScopes: authz.value, version: version.value },
  }
}

async function parseBody<T>(
  ctx: RouteContext,
  parse: (value: unknown) => ParseResult<T>,
): Promise<Result<T>> {
  const body = await readJsonBody(ctx.req)
  if (!body.ok) return deny(invalidReply(ctx.requestId, body.problems))
  const parsed = parse(body.value)
  if (!parsed.ok) return deny(invalidReply(ctx.requestId, parsed.problems))
  return { ok: true, value: parsed.value }
}

function actorOf(identity: Identity, deptScopes: readonly string[]): ActorSnapshot {
  return {
    actorId: identity.userId,
    actorRole: identity.role,
    actorDeptScope: deptScopes.length > 0 ? deptScopes.join(',') : null,
  }
}

function schemaVersionOf(payload: RuleBundle): string {
  const value = (payload as unknown as Record<string, unknown>).schemaVersion
  return typeof value === 'string' && value.length > 0 ? value : '1.0'
}

/** review_records.diff_from 只存摘要：相對「同 bundle 前一版」的 added／removed／changed。 */
async function diffFromFor(
  ctx: RouteContext,
  bundleId: string,
  versionNo: number,
  payload: RuleBundle,
): Promise<unknown> {
  const previous = await getPreviousVersion(ctx.query, bundleId, versionNo)
  const summary = summarizeDiff(diffPayloads(previous?.payload ?? null, payload))
  return { previousVersionId: previous?.version_id ?? null, ...summary }
}

/**
 * 被 supersede 的舊版本也要留下「相對它的前一版」摘要，不能只記 supersededBy。
 * published 版本通常只有 0–1 個；逐一取前一版，結果以 version_id 為鍵交給 publish 的 SQL。
 */
async function supersededDiffFromFor(ctx: RouteContext, bundleId: string): Promise<Record<string, unknown>> {
  const published = await listPublishedVersions(ctx.query, bundleId)
  const map: Record<string, unknown> = {}
  for (const old of published) {
    const previous = await getPreviousVersion(ctx.query, bundleId, old.version_no)
    map[old.version_id] = {
      previousVersionId: previous?.version_id ?? null,
      ...summarizeDiff(diffPayloads(previous?.payload ?? null, old.payload)),
    }
  }
  return map
}

/** 沒有任何版本可複製時，用 rule_bundles 的識別欄位建一份最小草稿骨架。 */
function skeletonPayload(bundle: BundleRow): RuleBundle {
  return {
    schemaVersion: '1.0',
    bundleId: bundle.bundle_id,
    title: bundle.title,
    department: { departmentId: bundle.dept_id, name: bundle.title },
    // RuleBundle['scope'] 的程式內型別只宣告 entryYear／program；studentType 是 schema 欄位，
    // 這裡保留給 validateBundle 之後的 schema 檢查，不另開型別。
    scope: {
      entryYear: bundle.entry_year,
      program: bundle.program,
      studentType: '一般日間學士班主修生',
    } as RuleBundle['scope'],
    status: 'draft',
    sources: [],
    clauses: [],
    allocation: { totalMin: 0, pools: [] },
    requirements: [],
  }
}

/**
 * 發布前把 payload 投影到 rule_sources／rule_clauses 的前置檢查。
 * validateBundle() 不檢查 clause text／id 重複（它的 duplicates 用 Set，永遠是空集合），
 * 但資料庫的 NOT NULL 與 CHECK 會擋，所以在這裡先轉成 422，而不是讓它變成 500。
 */
function projectionProblems(payload: RuleBundle): Problem[] {
  const problems: Problem[] = []
  const sources = (payload.sources ?? []) as readonly unknown[]
  const clauses = (payload.clauses ?? []) as readonly unknown[]
  const sourceIds = new Set<string>()
  const clauseIds = new Set<string>()

  sources.forEach((raw, index) => {
    const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const sourceId = typeof source.sourceId === 'string' ? source.sourceId : ''
    if (!sourceId) {
      problems.push({ field: `payload.sources[${index}].sourceId`, reason: '必填' })
    } else if (sourceIds.has(sourceId)) {
      problems.push({ field: `payload.sources[${index}].sourceId`, reason: `重複的 sourceId ${sourceId}` })
    } else {
      sourceIds.add(sourceId)
    }
  })

  clauses.forEach((raw, index) => {
    const clause = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const clauseId = typeof clause.clauseId === 'string' ? clause.clauseId : ''
    if (!clauseId) {
      problems.push({ field: `payload.clauses[${index}].clauseId`, reason: '必填' })
    } else if (clauseIds.has(clauseId)) {
      problems.push({ field: `payload.clauses[${index}].clauseId`, reason: `重複的 clauseId ${clauseId}` })
    } else {
      clauseIds.add(clauseId)
    }
    if (typeof clause.sourceId !== 'string' || !sourceIds.has(clause.sourceId)) {
      problems.push({
        field: `payload.clauses[${index}].sourceId`,
        reason: '必須指向同一版本存在的 sourceId',
      })
    }
    if (typeof clause.text !== 'string' || clause.text.length === 0) {
      problems.push({ field: `payload.clauses[${index}].text`, reason: '不可為空（rule_clauses_text_check）' })
    }
  })

  return problems
}

export function createAdminRoutes(options: AdminRouteOptions): Route[] {
  return [
    // ─── 建立草稿 ────────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/rules/:bundleId/draft',
      handler: async (ctx) => {
        const begin = await beginRequest(ctx, options, { csrf: true, allowedQuery: [] })
        if (!begin.ok) return begin.reply

        const bundleId = ctx.params.bundleId ?? ''
        if (!BUNDLE_ID.test(bundleId)) {
          return invalidReply(ctx.requestId, [
            { field: 'bundleId', reason: '只接受小寫英數字與連字號，例如 cse-113-day' },
          ])
        }

        const bundle = await getBundle(ctx.query, bundleId)
        if (!bundle) return notFoundBundleReply(ctx.requestId, bundleId)

        const authz = await authorizeFor(ctx, begin.value.identity, 'editDraft', bundle.dept_id)
        if (!authz.ok) return authz.reply

        const body = await parseBody(ctx, (value) => parseCreateDraftBody(value, bundleId))
        if (!body.ok) return body.reply

        // 沒帶 payload 時：先複製最新版本（保留既有規則），沒有版本才用骨架。
        const latest = await getLatestVersion(ctx.query, bundleId)
        const payload = (body.value.payload ?? latest?.payload ?? skeletonPayload(bundle)) as unknown as RuleBundle
        const contentHash = hashContent(payload)
        const summary = summarizeDiff(diffPayloads(latest?.payload ?? null, payload))

        const created = await createDraftVersion(ctx.query, {
          bundleId,
          payload,
          schemaVersion: schemaVersionOf(payload),
          contentHash,
          actor: actorOf(begin.value.identity, authz.value),
          notes: null,
          detail: { copiedFrom: latest?.version_id ?? null },
          diffFrom: { previousVersionId: latest?.version_id ?? null, ...summary },
        })
        if (!created) return internalReply(ctx.requestId)

        return {
          status: 201,
          body: ok(
            {
              versionId: created.version_id,
              bundleId: created.bundle_id,
              versionNo: created.version_no,
              status: created.status,
              schemaVersion: created.schema_version,
              contentHash: created.content_hash,
              createdAt: isoNow(created.created_at),
            },
            makeMeta(ctx.requestId, created.version_id),
          ),
          headers: NO_STORE,
        }
      },
    },

    // ─── 更新草稿內容 ────────────────────────────────────────────────────────
    {
      method: 'PUT',
      path: '/api/admin/rules/:versionId',
      handler: async (ctx) => {
        const access = await versionAccess(ctx, options, 'editDraft', true)
        if (!access.ok) return access.reply
        const { version } = access.value
        if (version.status !== 'draft') return immutableReply(ctx.requestId, version, '修改內容')

        const body = await parseBody(ctx, (value) => parseUpdateBody(value, version.bundle_id))
        if (!body.ok) return body.reply

        // 整份 payload 取代（PUT 語意），不是部分合併；版本不可變，合併會讓「審的是哪一版」失焦。
        const payload = body.value as unknown as RuleBundle
        const contentHash = hashContent(payload)
        const updated = await updateDraftPayload(
          ctx.query,
          version.version_id,
          payload,
          contentHash,
          schemaVersionOf(payload),
        )
        if (!updated) {
          // 讀取後、更新前被別人改狀態（CAS 失敗）。
          return immutableReply(ctx.requestId, version, '修改內容')
        }

        // review_records.action 的 CHECK 只有八個值，沒有 'updated'（見資料庫設計 §3.9），
        // 所以內容編輯本身無法留下稽核列；後續 validate／submit 會帶上新 content_hash。
        return okReply(
          {
            versionId: version.version_id,
            status: updated.status,
            contentHash: updated.content_hash,
            updatedAt: isoNow(),
          },
          ctx.requestId,
          version.version_id,
        )
      },
    },

    // ─── 結構驗證 ────────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/rules/:versionId/validate',
      handler: async (ctx) => {
        const access = await versionAccess(ctx, options, 'validateDraft', true)
        if (!access.ok) return access.reply
        const { version, identity, deptScopes } = access.value
        if (version.status !== 'draft') return immutableReply(ctx.requestId, version, '執行結構驗證')

        const body = await parseBody(ctx, parseEmptyBody)
        if (!body.ok) return body.reply

        const result = validateBundle(version.payload)
        await recordValidation(ctx.query, version.version_id, version.content_hash, {
          ...actorOf(identity, deptScopes),
          detail: { ok: result.ok, errorCount: result.errors.length, errors: result.errors },
          diffFrom: await diffFromFor(ctx, version.bundle_id, version.version_no, version.payload),
        })

        if (!result.ok) return validationFailedReply(ctx.requestId, version.version_id, result.errors)
        return okReply(
          { versionId: version.version_id, valid: true, errors: [], checkedAt: isoNow() },
          ctx.requestId,
          version.version_id,
        )
      },
    },

    // ─── 跑測試案例 ──────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/rules/:versionId/test',
      handler: async (ctx) => {
        const access = await versionAccess(ctx, options, 'validateDraft', true)
        if (!access.ok) return access.reply
        const { version, identity, deptScopes } = access.value
        if (version.status !== 'draft') return immutableReply(ctx.requestId, version, '執行測試')

        const body = await parseBody(ctx, parseTestBody)
        if (!body.ok) return body.reply

        const suite = runBundleTestSuite(version.payload, body.value.records, body.value.scenario, body.value.statuses)
        await recordTestRun(ctx.query, {
          versionId: version.version_id,
          suite: suite.suite,
          passed: suite.passed,
          failed: suite.failed,
          detail: { scenario: body.value.scenario, results: suite.results.slice(0, 100) },
          contentHash: version.content_hash,
          actor: actorOf(identity, deptScopes),
          diffFrom: await diffFromFor(ctx, version.bundle_id, version.version_no, version.payload),
        })

        if (suite.failed > 0) {
          return testFailedReply(
            ctx.requestId,
            version.version_id,
            suite.results.filter((result) => result.status === 'failed'),
          )
        }

        return okReply(
          {
            versionId: version.version_id,
            suite: suite.suite,
            scenario: body.value.scenario,
            passed: suite.passed,
            failed: suite.failed,
            overall: suite.overall ?? null,
            totalCredits: suite.totalCredits ?? null,
            results: suite.results,
          },
          ctx.requestId,
          version.version_id,
        )
      },
    },

    // ─── 送審 ────────────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/rules/:versionId/submit',
      handler: async (ctx) => {
        const access = await versionAccess(ctx, options, 'editDraft', true)
        if (!access.ok) return access.reply
        const { version, identity, deptScopes } = access.value
        if (version.status !== 'draft') return immutableReply(ctx.requestId, version, '送審')

        const body = await parseBody(ctx, parseEmptyBody)
        if (!body.ok) return body.reply

        const updated = await submitVersion(ctx.query, version.version_id, 'draft', {
          actor: actorOf(identity, deptScopes),
          detail: { submittedFrom: 'draft' },
          diffFrom: await diffFromFor(ctx, version.bundle_id, version.version_no, version.payload),
        })
        if (!updated) return immutableReply(ctx.requestId, version, '送審')

        return okReply(
          {
            versionId: updated.version_id,
            status: updated.status,
            submittedAt: updated.submitted_at ? isoNow(updated.submitted_at) : null,
          },
          ctx.requestId,
          updated.version_id,
        )
      },
    },

    // ─── 核准 ────────────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/rules/:versionId/approve',
      handler: async (ctx) => {
        const access = await versionAccess(ctx, options, 'reviewDraft', true)
        if (!access.ok) return access.reply
        const { version, identity, deptScopes } = access.value
        if (version.status !== 'in-review') return immutableReply(ctx.requestId, version, '核准')

        const body = await parseBody(ctx, parseEmptyBody)
        if (!body.ok) return body.reply

        const updated = await approveVersion(ctx.query, version.version_id, 'in-review', {
          actor: actorOf(identity, deptScopes),
          detail: { reviewedBy: identity.userId, actorRole: identity.role },
          diffFrom: await diffFromFor(ctx, version.bundle_id, version.version_no, version.payload),
        })
        if (!updated) return immutableReply(ctx.requestId, version, '核准')

        return okReply(
          {
            versionId: updated.version_id,
            status: updated.status,
            reviewedBy: updated.reviewed_by,
            reviewedAt: updated.reviewed_at ? isoNow(updated.reviewed_at) : null,
          },
          ctx.requestId,
          updated.version_id,
        )
      },
    },

    // ─── 退回 ────────────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/rules/:versionId/reject',
      handler: async (ctx) => {
        const access = await versionAccess(ctx, options, 'reviewDraft', true)
        if (!access.ok) return access.reply
        const { version, identity, deptScopes } = access.value
        if (version.status !== 'in-review') return immutableReply(ctx.requestId, version, '退回')

        const body = await parseBody(ctx, parseRejectBody)
        if (!body.ok) return body.reply

        const updated = await rejectVersion(ctx.query, version.version_id, 'in-review', body.value.reason, {
          actor: actorOf(identity, deptScopes),
          detail: { reason: body.value.reason, reviewedBy: identity.userId },
          diffFrom: await diffFromFor(ctx, version.bundle_id, version.version_no, version.payload),
        })
        if (!updated) return immutableReply(ctx.requestId, version, '退回')

        return okReply(
          {
            versionId: updated.version_id,
            status: updated.status,
            notes: updated.notes,
            reviewedBy: updated.reviewed_by,
            reviewedAt: updated.reviewed_at ? isoNow(updated.reviewed_at) : null,
          },
          ctx.requestId,
          updated.version_id,
        )
      },
    },

    // ─── 發布 ────────────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/rules/:versionId/publish',
      handler: async (ctx) => {
        const access = await versionAccess(ctx, options, 'publishVersion', true)
        if (!access.ok) return access.reply
        const { version, identity, deptScopes } = access.value
        if (version.status !== 'approved') return immutableReply(ctx.requestId, version, '發布')

        // 系統管理員只能在「該系沒有有效管理員」時代理發布（system-design.md §8），
        // 而且要在版本上標 proxy=true；系所管理員發布一律 proxy=false。
        let proxy = false
        if (identity.role === 'sysadmin') {
          const activeAdmins = await countActiveDeptAdmins(ctx.query, version.dept_id)
          if (activeAdmins > 0) {
            return forbiddenReply(
              ctx.requestId,
              'AUTH_FORBIDDEN',
              `系所 ${version.dept_id} 仍有 ${activeAdmins} 位有效管理員，系統管理員不得代理發布。`,
            )
          }
          proxy = isProxyPublish({ role: 'sysadmin', activeDeptAdminCount: activeAdmins })
        }

        const body = await parseBody(ctx, parseEmptyBody)
        if (!body.ok) return body.reply

        // 發布當下重驗內容（設計的三道關卡不能只靠前端）；失敗停留 approved。
        const validation = validateBundle(version.payload)
        if (!validation.ok) {
          return validationFailedReply(ctx.requestId, version.version_id, validation.errors)
        }
        const projection = projectionProblems(version.payload)
        if (projection.length > 0) {
          return errorReply(
            422,
            'RULE_VALIDATION_FAILED',
            `規則版本 ${version.version_id} 無法投影成來源與條文卡（${projection.length} 項）。`,
            ctx.requestId,
            { versionId: version.version_id, details: projection },
          )
        }

        // 投影必須在 published 之前寫入：0017 的 trigger 禁止修改 published 版本的子資料列。
        await replaceProjection(ctx.query, version.version_id, version.payload)

        const published = await publishVersion(
          ctx.query,
          version.version_id,
          identity.userId,
          proxy,
          {
            actor: actorOf(identity, deptScopes),
            detail: { proxy, actorRole: identity.role, revalidated: true },
            diffFrom: await diffFromFor(ctx, version.bundle_id, version.version_no, version.payload),
          },
          await supersededDiffFromFor(ctx, version.bundle_id),
        )
        if (!published) return immutableReply(ctx.requestId, version, '發布')

        return okReply(
          {
            versionId: published.version.version_id,
            status: published.version.status,
            publishedAt: published.version.published_at ? isoNow(published.version.published_at) : null,
            publishedBy: published.version.published_by ?? identity.userId,
            proxy: published.version.proxy,
            superseded: published.supersededVersionIds,
          },
          ctx.requestId,
          published.version.version_id,
        )
      },
    },

    // ─── 版本 diff ───────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/admin/rules/:versionId/diff',
      handler: async (ctx) => {
        const access = await versionAccess(ctx, options, 'reviewDraft', false)
        if (!access.ok) return access.reply
        const { version } = access.value

        const previous = await getPreviousVersion(ctx.query, version.bundle_id, version.version_no)
        const diff = diffPayloads(previous?.payload ?? null, version.payload)

        return okReply(
          {
            versionId: version.version_id,
            bundleId: version.bundle_id,
            versionNo: version.version_no,
            status: version.status,
            previousVersionId: previous?.version_id ?? null,
            summary: diff.summary,
            requirements: diff.requirements,
            clauses: diff.clauses,
            sources: diff.sources,
          },
          ctx.requestId,
          version.version_id,
        )
      },
    },

    // ─── 稽核紀錄 ────────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/admin/audit',
      handler: async (ctx) => {
        const begin = await beginRequest(ctx, options, {
          csrf: false,
          allowedQuery: ['limit', 'cursor', 'versionId'],
        })
        if (!begin.ok) return begin.reply
        const { identity } = begin.value

        const query = parseAuditQuery(ctx.url)
        if (!query.ok) return invalidReply(ctx.requestId, query.problems)
        const { limit, cursor, versionId } = query.value

        let deptScopes: readonly string[] | null = null
        if (versionId) {
          const version = await getVersion(ctx.query, versionId)
          if (!version) return notFoundVersionReply(ctx.requestId, versionId)
          const authz = await authorizeFor(ctx, identity, 'reviewDraft', version.dept_id)
          if (!authz.ok) return authz.reply
        } else if (identity.role !== 'sysadmin') {
          const scopes = await loadDeptScopes(ctx.query, identity.userId)
          // 沒有被指派任何系所的人（含一般學生）不能讀稽核。
          if (scopes.length === 0 || !can({
            role: identity.role,
            actorUserId: identity.userId,
            deptScopes: scopes,
            action: 'reviewDraft',
            resourceDept: scopes[0],
          })) {
            return forbiddenReply(ctx.requestId, 'AUTH_FORBIDDEN', '你沒有讀取稽核紀錄的權限。')
          }
          deptScopes = scopes
        }

        const rows = await listReviewRecords(ctx.query, { limit, cursor, versionId, deptScopes })
        const hasMore = rows.length > limit
        const page = rows.slice(0, limit)
        const last = page[page.length - 1]

        return okReply(
          {
            items: page.map((row) => ({
              recordId: String(row.record_id),
              versionId: row.version_id,
              action: row.action,
              actorId: row.actor_id,
              actorRole: row.actor_role,
              actorDeptScope: row.actor_dept_scope,
              at: isoNow(row.at),
              detail: row.detail,
              contentHash: row.content_hash,
              diffFrom: row.diff_from,
            })),
            nextCursor: hasMore && last ? String(last.record_id) : null,
            limit,
          },
          ctx.requestId,
          versionId ?? undefined,
        )
      },
    },
  ]
}

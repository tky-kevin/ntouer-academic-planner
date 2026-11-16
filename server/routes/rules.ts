// `GET /api/rules/{versionId}`：docs/design/api-spec.md §7.4。
// 讀 rule_versions ＋ rule_sources ＋ rule_clauses；`include=payload` 才回整份 payload。
import type { QueryFn, Reply, Route, RouteContext } from '../app.js'
import { fail, isoNow, makeMeta, ok } from '../http/envelope.js'

export type Role = 'student' | 'sysadmin'

export interface VersionRow {
  version_id: string
  bundle_id: string
  version_no: number
  status: string
  schema_version: string
  content_hash: string
  published_at: Date | null
  proxy: boolean
  payload: unknown
  published_by_id: string | null
  published_by_email: string | null
}

export interface SourceRow {
  source_id: string
  title: string
  url: string | null
  locator: string
  retrieved_at: string | null
}

export interface ClauseRow {
  clause_id: string
  source_id: string
  locator: string
  text: string
  reading: string | null
}

const VERSION_ID = /^([A-Za-z0-9][A-Za-z0-9._-]*)@([1-9][0-9]*)$/

/** `bundleId@versionNo`；版本號不合法（含 `/`、0 開頭、缺 `@`）回 null，由呼叫端轉 400。 */
export function parseVersionId(raw: string): { bundleId: string; versionNo: number } | null {
  const match = VERSION_ID.exec(raw)
  if (!match) return null
  return { bundleId: match[1], versionNo: Number(match[2]) }
}

// #22 落地前沒有 session：一律視為學生（只能讀 published）。
// #22 會把這裡換成讀 ctx.session.role；route 其餘邏輯不用改。
function roleOf(_ctx: RouteContext): Role {
  return 'student'
}

export function versionQuery(query: QueryFn, versionId: string): Promise<VersionRow[]> {
  return query(
    `select v.version_id, v.bundle_id, v.version_no, v.status, v.schema_version, v.content_hash,
            v.published_at, v.proxy, v.payload,
            u.user_id as published_by_id, u.email as published_by_email
       from rule_versions v
       left join users u on u.user_id = v.published_by
      where v.version_id = $1`,
    [versionId],
  ).then((result) => result.rows as VersionRow[])
}

export function sourcesQuery(query: QueryFn, versionId: string): Promise<SourceRow[]> {
  return query(
    `select source_id, title, url, locator, to_char(retrieved_at, 'YYYY-MM-DD') as retrieved_at
       from rule_sources
      where version_id = $1
      order by source_id`,
    [versionId],
  ).then((result) => result.rows as SourceRow[])
}

export function clausesQuery(query: QueryFn, versionId: string): Promise<ClauseRow[]> {
  return query(
    `select clause_id, source_id, locator, text, reading
       from rule_clauses
      where version_id = $1
      order by clause_id`,
    [versionId],
  ).then((result) => result.rows as ClauseRow[])
}

function invalid(requestId: string, field: string, reason: string): Reply {
  return {
    status: 400,
    body: fail(
      {
        code: 'REQUEST_INVALID',
        message: `${field} 不合法：${reason}`,
        details: [{ field, reason }],
        retryable: false,
      },
      makeMeta(requestId),
    ),
  }
}

export function createRulesRoutes({ query }: { query: QueryFn }): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/rules/:versionId',
      handler: async (ctx) => {
        const { requestId } = ctx
        const rawVersionId = ctx.params.versionId ?? ''
        if (!parseVersionId(rawVersionId)) {
          return invalid(requestId, 'versionId', '格式必須是 bundleId@versionNo，例如 cse-113-day@1')
        }

        const include = ctx.url.searchParams.get('include')
        if (include !== null && include !== 'payload') return invalid(requestId, 'include', '只接受 payload')

        const versions = await versionQuery(query, rawVersionId)
        if (versions.length === 0) {
          return {
            status: 404,
            body: fail(
              { code: 'RULE_VERSION_NOT_FOUND', message: `找不到規則版本 ${rawVersionId}。`, retryable: false },
              makeMeta(requestId),
            ),
          }
        }

        const version = versions[0]
        if (roleOf(ctx) !== 'sysadmin' && version.status !== 'published') {
          return {
            status: 409,
            body: fail(
              {
                code: 'RULE_VERSION_NOT_PUBLISHED',
                message: `規則版本 ${rawVersionId} 目前是 ${version.status}，學生端只能讀已發布版本。`,
                details: [{ field: 'versionId', reason: `status=${version.status}` }],
                retryable: false,
              },
              makeMeta(requestId),
            ),
          }
        }

        const [sources, clauses] = await Promise.all([
          sourcesQuery(query, rawVersionId),
          clausesQuery(query, rawVersionId),
        ])

        const data: Record<string, unknown> = {
          versionId: version.version_id,
          bundleId: version.bundle_id,
          versionNo: version.version_no,
          status: version.status,
          schemaVersion: version.schema_version,
          contentHash: version.content_hash,
          publishedAt: version.published_at ? isoNow(version.published_at) : null,
          publishedBy: version.published_by_id
            ? { userId: version.published_by_id, email: version.published_by_email }
            : null,
          proxy: version.proxy,
          sources: sources.map((source) => ({
            sourceId: source.source_id,
            title: source.title,
            url: source.url,
            locator: source.locator,
            retrievedAt: source.retrieved_at,
          })),
          clauses: clauses.map((clause) => ({
            clauseId: clause.clause_id,
            sourceId: clause.source_id,
            locator: clause.locator,
            text: clause.text,
            reading: clause.reading,
          })),
        }
        if (include === 'payload') data.payload = version.payload

        return { status: 200, body: ok(data, makeMeta(requestId, version.version_id)) }
      },
    },
  ]
}

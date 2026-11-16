import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app.js'
import type { QueryFn } from '../app.js'
import { createRulesRoutes, parseVersionId } from './rules.js'

const silent = { info: () => undefined, error: () => undefined }
const open: Server[] = []

const publishedVersion = {
  version_id: 'cse-113-day@1',
  bundle_id: 'cse-113-day',
  version_no: 1,
  status: 'published',
  schema_version: '1.0',
  content_hash: 'sha256:abc',
  published_at: new Date('2026-11-10T10:00:00Z'),
  proxy: false,
  payload: { schemaVersion: '1.0', requirements: [] },
  published_by_id: '6f1c0000-0000-4000-8000-000000000001',
  published_by_email: 'chair@example.com',
}

const draftVersion = {
  ...publishedVersion,
  version_id: 'mmd-115-day@1',
  bundle_id: 'mmd-115-day',
  status: 'draft',
  published_at: null,
  published_by_id: null,
  published_by_email: null,
}

const sources = [
  { source_id: 'S113-01', title: '113 學年度新生手冊', url: 'https://example.edu/handbook', locator: '印刷頁 8–12', retrieved_at: '2026-10-14' },
]

const clauses = [
  { clause_id: 'R06', source_id: 'S113-01', locator: 'PDF 第 11 頁', text: '系內選修至少 46 學分。', reading: '系內選修…' },
  { clause_id: 'R07', source_id: 'S113-01', locator: 'PDF 第 12 頁', text: '外系選修至多 8 學分。', reading: null },
]

function fakeQuery(rows: { versions?: unknown[]; sources?: unknown[]; clauses?: unknown[] }): QueryFn {
  return async (text) => {
    if (text.includes('from rule_versions')) return { rows: rows.versions ?? [] }
    if (text.includes('from rule_sources')) return { rows: rows.sources ?? [] }
    if (text.includes('from rule_clauses')) return { rows: rows.clauses ?? [] }
    return { rows: [] }
  }
}

async function start(query: QueryFn): Promise<string> {
  const server = createServer(createApp({ query, routes: createRulesRoutes({ query }), logger: silent }))
  open.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  await Promise.all(
    open.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

describe('GET /api/rules/{versionId}', () => {
  it('已發布版本回 200，含來源、條文與 meta.ruleVersionId，且預設不回 payload', async () => {
    const base = await start(fakeQuery({ versions: [publishedVersion], sources, clauses }))
    const response = await fetch(`${base}/api/rules/cse-113-day@1`)
    const body = (await response.json()) as {
      data: Record<string, unknown> & { sources: unknown[]; clauses: unknown[] }
      meta: { ruleVersionId: string; requestId: string }
    }

    expect(response.status).toBe(200)
    expect(body.data.versionId).toBe('cse-113-day@1')
    expect(body.data.bundleId).toBe('cse-113-day')
    expect(body.data.versionNo).toBe(1)
    expect(body.data.status).toBe('published')
    expect(body.data.proxy).toBe(false)
    expect(body.data.sources).toEqual([
      { sourceId: 'S113-01', title: '113 學年度新生手冊', url: 'https://example.edu/handbook', locator: '印刷頁 8–12', retrievedAt: '2026-10-14' },
    ])
    expect(body.data.clauses).toHaveLength(2)
    expect(body.data.clauses[0]).toMatchObject({ clauseId: 'R06', sourceId: 'S113-01' })
    expect(body.data.publishedBy).toEqual({
      userId: '6f1c0000-0000-4000-8000-000000000001',
      email: 'chair@example.com',
    })
    expect(body.data).not.toHaveProperty('payload')
    expect(body.meta.ruleVersionId).toBe('cse-113-day@1')
  })

  it('include=payload 時回整份 payload', async () => {
    const base = await start(fakeQuery({ versions: [publishedVersion], sources, clauses }))
    const response = await fetch(`${base}/api/rules/cse-113-day@1?include=payload`)
    const body = (await response.json()) as { data: { payload: { schemaVersion: string } } }

    expect(response.status).toBe(200)
    expect(body.data.payload).toEqual({ schemaVersion: '1.0', requirements: [] })
  })

  it('學生讀非 published 版本回 409 RULE_VERSION_NOT_PUBLISHED', async () => {
    const base = await start(fakeQuery({ versions: [draftVersion] }))
    const response = await fetch(`${base}/api/rules/mmd-115-day@1`)
    const body = (await response.json()) as { error: { code: string; details: { field: string; reason: string }[] } }

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('RULE_VERSION_NOT_PUBLISHED')
    expect(body.error.details).toEqual([{ field: 'versionId', reason: 'status=draft' }])
  })

  it('版本不存在回 404 RULE_VERSION_NOT_FOUND', async () => {
    const base = await start(fakeQuery({ versions: [] }))
    const response = await fetch(`${base}/api/rules/cse-113-day@9`)
    const body = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(404)
    expect(body.error.code).toBe('RULE_VERSION_NOT_FOUND')
  })

  it('versionId 格式不合法（缺 @、版本號 0、帶 /）回 400', async () => {
    const base = await start(fakeQuery({ versions: [publishedVersion] }))

    for (const raw of ['cse-113-day', 'cse-113-day@0', 'cse%2F113-day@1']) {
      const response = await fetch(`${base}/api/rules/${raw}`)
      const body = (await response.json()) as { error: { code: string; details: { field: string }[] } }
      expect(response.status, raw).toBe(400)
      expect(body.error.code).toBe('REQUEST_INVALID')
      expect(body.error.details[0].field).toBe('versionId')
    }
  })

  it('include 只接受 payload', async () => {
    const base = await start(fakeQuery({ versions: [publishedVersion] }))
    const response = await fetch(`${base}/api/rules/cse-113-day@1?include=full`)
    const body = (await response.json()) as { error: { code: string; details: { field: string }[] } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('REQUEST_INVALID')
    expect(body.error.details[0].field).toBe('include')
  })

  it('parseVersionId 只接受 bundleId@正整數', () => {
    expect(parseVersionId('cse-113-day@1')).toEqual({ bundleId: 'cse-113-day', versionNo: 1 })
    expect(parseVersionId('cse-113-day@01')).toBeNull()
    expect(parseVersionId('cse-113-day@')).toBeNull()
    expect(parseVersionId('@1')).toBeNull()
    expect(parseVersionId('cse/113@1')).toBeNull()
  })
})

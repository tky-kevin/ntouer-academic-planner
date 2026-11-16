// 進入點：讀環境 → 建立 pg pool → 掛上 handler → 監聽。
// 只用 node:http 與 pg（ADR-0004：不引入 ORM）。
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { Pool } from 'pg'
import { createApp } from './app.js'
import type { QueryFn } from './app.js'
import { loadDotEnv, readAisConfig, readAuthConfig, readConfig } from './env.js'
import type { AisConfigValues, AuthConfigValues } from './env.js'
import { createRulesRoutes } from './routes/rules.js'
import { createProgressRoutes } from './routes/progress.js'
import { createAuthRoutes } from './routes/auth.js'
import { createSyncRoutes } from './routes/sync.js'
import { createAdminRoutes } from './routes/admin.js'
import { createStaticRoutes } from './static.js'
import { AisSyncService } from './ais/sync.js'
import { loadClassificationTable } from './ais/classify.js'

loadDotEnv()

let config: ReturnType<typeof readConfig>
let authConfig: AuthConfigValues
let aisConfig: AisConfigValues
try {
  config = readConfig()
  authConfig = readAuthConfig()
  aisConfig = readAisConfig()
} catch (error) {
  console.error(JSON.stringify({ level: 'error', message: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  // 資料庫不在時要「快速失敗」給 503，不要讓 /healthz 卡住。
  connectionTimeoutMillis: 2_000,
  idleTimeoutMillis: 10_000,
})

// pg 的 pool 在資料庫重啟時會在閒置連線上發出 error；沒有這個 listener，Node 會整個退出。
pool.on('error', (error) => {
  console.error(JSON.stringify({ level: 'error', message: `pg pool idle client error: ${error.message}` }))
})

const query: QueryFn = async (text, params) => {
  const result = await pool.query(text, params ? [...params] : undefined)
  return { rows: result.rows }
}

// 課程分類資料是同步的必要輸入：壞掉時寧可起不來，也不要同步出錯誤的分類。
let syncService: AisSyncService
try {
  syncService = new AisSyncService({ config: aisConfig, query, classification: loadClassificationTable() })
} catch (error) {
  console.error(
    JSON.stringify({
      level: 'error',
      message: `無法載入課程分類資料（data/rules/113-cse-classification.json）：${error instanceof Error ? error.message : String(error)}`,
    }),
  )
  process.exit(1)
}

// 前端建置產物存在才掛靜態服務；沒 build 過就只提供 API（訊息會顯示在啟動日誌）。
const distDir = path.resolve(process.cwd(), 'dist')
const staticRoutes = existsSync(path.join(distDir, 'index.html')) ? createStaticRoutes({ root: distDir }) : []

if (staticRoutes.length === 0) {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'dist/index.html 不存在：只提供 API。要讓 Google 登入與前端同源，請先 npm run build。',
    }),
  )
}

const identityOptions = { devUserSub: process.env.DEV_USER_SUB, nodeEnv: process.env.NODE_ENV }

const server = createServer(
  createApp({
    query,
    routes: [
      ...createRulesRoutes({ query }),
      ...createProgressRoutes({ query, ...identityOptions }),
      ...createAuthRoutes({ query, config: authConfig }),
      ...createSyncRoutes({ query, service: syncService, ...identityOptions }),
      ...createAdminRoutes({ query, ...identityOptions }),
      ...staticRoutes,
    ],
  }),
)

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ level: 'info', message: `API listening on http://${config.host}:${config.port}` }))
})

let closing = false
async function shutdown(signal: string): Promise<void> {
  if (closing) return
  closing = true
  console.log(JSON.stringify({ level: 'info', message: `收到 ${signal}，關閉中` }))
  syncService.disposeAll()
  server.close()
  await pool.end().catch(() => undefined)
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

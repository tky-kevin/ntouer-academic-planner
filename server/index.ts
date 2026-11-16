// 進入點：讀環境 → 建立 pg pool → 掛上 handler → 監聽。
// 只用 node:http 與 pg（ADR-0004：不引入 ORM）。
import { createServer } from 'node:http'
import { Pool } from 'pg'
import { createApp } from './app.js'
import type { QueryFn } from './app.js'
import { loadDotEnv, readConfig } from './env.js'

loadDotEnv()

let config: ReturnType<typeof readConfig>
try {
  config = readConfig()
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

const server = createServer(createApp({ query }))

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ level: 'info', message: `API listening on http://${config.host}:${config.port}` }))
})

let closing = false
async function shutdown(signal: string): Promise<void> {
  if (closing) return
  closing = true
  console.log(JSON.stringify({ level: 'info', message: `收到 ${signal}，關閉中` }))
  server.close()
  await pool.end().catch(() => undefined)
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

// 讀環境設定：本機有 `.env.local` 就補進 process.env；CI／部署直接吃環境變數。
// 只讀不寫，也不把值印出來（金鑰不得進日誌）。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface ServerConfig {
  host: string
  port: number
  databaseUrl: string
}

export interface AuthConfigValues {
  clientId: string
  clientSecret: string
  redirectUri: string
  sessionSecret: string
  secureCookies: boolean
}

export function loadDotEnv(root: string = process.cwd()): void {
  const file = path.join(root, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT 不合法：${env.PORT ?? '(未設定)'}`)
  }
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL 未設定：本機請放 .env.local，CI 請在 job env 提供。')
  }
  return { host: env.HOST ?? '127.0.0.1', port, databaseUrl }
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfigValues {
  const sessionSecret = env.SESSION_SECRET
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET 未設定：本機請放 .env.local，CI／部署請在環境變數提供。')
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/callback',
    sessionSecret,
    secureCookies: env.NODE_ENV === 'production',
  }
}

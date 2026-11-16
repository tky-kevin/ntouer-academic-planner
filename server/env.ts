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

// 解析 `.env` 風格的單行賦值：允許 `export ` 前綴、鍵名含數字、值用單／雙引號包住。
// 不做變數展開（`$FOO`）——展開會讓「值裡剛好有 $」的密碼被靜默改寫。
export function parseDotEnvLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (!match) return null
  let value = match[2].trim()
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1)
  }
  return { key: match[1], value }
}

export function loadDotEnv(root: string = process.cwd()): void {
  const file = path.join(root, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line)
    // 已存在的環境變數優先：CI／部署可以覆蓋 .env.local，不必改檔案。
    if (parsed && process.env[parsed.key] === undefined) process.env[parsed.key] = parsed.value
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

export interface AisConfigValues {
  /** `.env.local` 的預設 AIS 帳密；留空時只能用 UI 臨時輸入。 */
  account: string | null
  password: string | null
  /** 數字成績及格門檻；`null` 代表「不假設」，數字成績一律 unknown。 */
  gradePassingScore: number | null
  timetableYear: number | null
  timetableTerm: number | null
  captchaTtlSeconds: number
  syncTimeoutMs: number
  ocrUrl: string | null
  ocrToken: string | null
}

function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function optionalInt(value: string | undefined, name: string, min: number, max: number): number | null {
  const text = optionalText(value)
  if (text === null) return null
  const parsed = Number(text)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} 不合法：${text}（需為 ${min}–${max} 的整數）`)
  }
  return parsed
}

// AIS 設定：全部選填，缺值不阻止伺服器啟動（只有真正同步時才需要帳密）。
// 錯誤訊息不含任何值以外的敏感內容——這裡的值本來就不是密碼，但密碼本身永不驗證、永不輸出。
export function readAisConfig(env: NodeJS.ProcessEnv = process.env): AisConfigValues {
  const scoreText = optionalText(env.AIS_GRADE_PASSING_SCORE)
  let gradePassingScore: number | null = null
  if (scoreText !== null) {
    const parsed = Number(scoreText)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      throw new Error(`AIS_GRADE_PASSING_SCORE 不合法：需為 0–100 的數字，或留空（表示不假設及格分數）。`)
    }
    gradePassingScore = parsed
  }
  return {
    account: optionalText(env.AIS_ACCOUNT),
    password: optionalText(env.AIS_PASSWORD),
    gradePassingScore,
    timetableYear: optionalInt(env.AIS_TIMETABLE_YEAR, 'AIS_TIMETABLE_YEAR', 1, 999),
    timetableTerm: optionalInt(env.AIS_TIMETABLE_TERM, 'AIS_TIMETABLE_TERM', 1, 2),
    captchaTtlSeconds: optionalInt(env.AIS_SYNC_CAPTCHA_TTL_SECONDS, 'AIS_SYNC_CAPTCHA_TTL_SECONDS', 30, 900) ?? 300,
    syncTimeoutMs: optionalInt(env.AIS_SYNC_TIMEOUT_MS, 'AIS_SYNC_TIMEOUT_MS', 5_000, 300_000) ?? 60_000,
    ocrUrl: optionalText(env.AIS_OCR_URL),
    ocrToken: optionalText(env.AIS_OCR_TOKEN),
  }
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

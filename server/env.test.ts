import { describe, expect, it } from 'vitest'
import { parseDotEnvLine, readAisConfig, readConfig } from './env.js'

describe('server/env', () => {
  it('預設 127.0.0.1:3000', () => {
    const config = readConfig({ DATABASE_URL: 'postgres://planner:planner@localhost:5433/planner' })
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(3000)
  })

  it('PORT 不是合法埠號時丟錯（不是默默用 3000）', () => {
    expect(() => readConfig({ PORT: 'seven', DATABASE_URL: 'postgres://x' })).toThrow(/PORT/)
    expect(() => readConfig({ PORT: '70000', DATABASE_URL: 'postgres://x' })).toThrow(/PORT/)
  })

  it('缺 DATABASE_URL 時丟錯並說怎麼補', () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/)
  })
})

describe('server/env 的 .env 解析', () => {
  it('接受 export 前綴、數字鍵名與引號', () => {
    expect(parseDotEnvLine('export AIS_OCR_URL2="https://ocr.example"')).toEqual({
      key: 'AIS_OCR_URL2',
      value: 'https://ocr.example',
    })
    expect(parseDotEnvLine("AIS_PASSWORD='p@ss=word'")).toEqual({ key: 'AIS_PASSWORD', value: 'p@ss=word' })
  })

  it('忽略註解與空行，不展開 $ 變數（避免改寫密碼）', () => {
    expect(parseDotEnvLine('# AIS_ACCOUNT=x')).toBeNull()
    expect(parseDotEnvLine('   ')).toBeNull()
    expect(parseDotEnvLine('AIS_PASSWORD=$HOME')).toEqual({ key: 'AIS_PASSWORD', value: '$HOME' })
  })
})

describe('server/env 的 AIS 設定', () => {
  it('全部留空時不丟錯，回傳「未設定」而不是空字串', () => {
    const config = readAisConfig({})
    expect(config.account).toBeNull()
    expect(config.password).toBeNull()
    expect(config.gradePassingScore).toBeNull()
    expect(config.captchaTtlSeconds).toBe(300)
    expect(config.syncTimeoutMs).toBe(60_000)
  })

  it('及格門檻只接受 0–100，其餘丟錯（不預設 60）', () => {
    expect(readAisConfig({ AIS_GRADE_PASSING_SCORE: '60' }).gradePassingScore).toBe(60)
    expect(() => readAisConfig({ AIS_GRADE_PASSING_SCORE: '101' })).toThrow(/AIS_GRADE_PASSING_SCORE/)
    expect(() => readAisConfig({ AIS_GRADE_PASSING_SCORE: 'sixty' })).toThrow(/AIS_GRADE_PASSING_SCORE/)
  })

  it('驗證碼 TTL 與逾時有上下限', () => {
    expect(readAisConfig({ AIS_SYNC_CAPTCHA_TTL_SECONDS: '600' }).captchaTtlSeconds).toBe(600)
    expect(() => readAisConfig({ AIS_SYNC_CAPTCHA_TTL_SECONDS: '5' })).toThrow(/AIS_SYNC_CAPTCHA_TTL_SECONDS/)
    expect(() => readAisConfig({ AIS_SYNC_TIMEOUT_MS: '1' })).toThrow(/AIS_SYNC_TIMEOUT_MS/)
  })

  it('課表學期只接受 1–2', () => {
    expect(readAisConfig({ AIS_TIMETABLE_TERM: '2' }).timetableTerm).toBe(2)
    expect(() => readAisConfig({ AIS_TIMETABLE_TERM: '3' })).toThrow(/AIS_TIMETABLE_TERM/)
  })
})

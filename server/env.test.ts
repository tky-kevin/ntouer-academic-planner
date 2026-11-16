import { describe, expect, it } from 'vitest'
import { readConfig } from './env.js'

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

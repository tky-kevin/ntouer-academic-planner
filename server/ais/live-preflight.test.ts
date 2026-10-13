import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('真實測試缺少帳密時先拒絕，輸出安全代碼而非例外 stack 或私人資訊', () => {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-live-ais.ts'], {
    cwd: projectRoot, encoding: 'utf8', env: { ...process.env, AIS_ACCOUNT: '', AIS_PASSWORD: '' },
  })
  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  expect(JSON.parse(result.stderr.trim())).toEqual({ kind: 'invalidRequest', code: 'AIS_CREDENTIALS_NOT_CONFIGURED', retryable: false })
})

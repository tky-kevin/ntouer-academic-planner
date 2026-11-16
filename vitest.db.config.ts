// 需要真實 PostgreSQL 的測試：`npm run test:db`。
// 命名規則：檔名以 `.db.test.ts` 結尾；預設的 `npm test` 會排除它們，
// 這樣沒有資料庫的環境（例如只跑前端的人）仍可全綠，CI 的 `api` job 則一定有 DB。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.db.test.ts', 'src/**/*.db.test.ts'],
    // 目前還沒有 DB 測試（#22／#23 會加）；先讓基礎建設可以被驗證而不是紅燈。
    passWithNoTests: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})

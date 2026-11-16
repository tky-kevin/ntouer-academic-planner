import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 本機 Windows/Node 的遞迴 rm 在重建時崩潰；build 指令改由安全的逐檔清理腳本處理。
  build: {
    emptyOutDir: false,
    // 學生端（index.html）與管理端兩個真實頁面；沒有 router、沒有可見導覽。
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        'admin-validate': fileURLToPath(new URL('./admin-validate.html', import.meta.url)),
        'admin-review': fileURLToPath(new URL('./admin-review.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    // DB 測試需要真的 PostgreSQL，改用 `npm run test:db`（vitest.db.config.ts）。
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.test.ts'],
  },
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 本機 Windows/Node 的遞迴 rm 在重建時崩潰；build 指令改由安全的逐檔清理腳本處理。
  build: { emptyOutDir: false },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
  },
})

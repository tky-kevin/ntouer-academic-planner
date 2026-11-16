#!/bin/sh
# 容器啟動順序：等資料庫 → 套用遷移 →（可選）種子資料 → 交給 API。
# 只做部署編排，不改應用程式行為；全部用 node 執行，不依賴 curl／nc。
set -eu

cd /app

echo "[entrypoint] 等待資料庫..."
node scripts/wait-for-db.mjs

echo "[entrypoint] 套用遷移..."
node scripts/db/migrate.mjs

# 預設 0：正式環境不自動寫入種子資料；本機 demo 由 compose.yaml 設成 1。
if [ "${SEED_ON_START:-0}" = "1" ]; then
  echo "[entrypoint] 種子資料（SEED_ON_START=1）..."
  node scripts/db/seed.mjs
else
  echo "[entrypoint] 略過種子資料（SEED_ON_START 未設為 1）"
fi

echo "[entrypoint] 啟動 API..."
# 用 node --import tsx 直接跑 TypeScript：node 是前景行程，SIGTERM 會直接送到它，
# 沿用 server/index.ts 的 graceful shutdown（tsx CLI 會多一層子行程）。
exec node --import tsx server/index.ts

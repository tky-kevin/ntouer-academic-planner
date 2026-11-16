# syntax=docker/dockerfile:1
# 單一映像同時提供 API 與前端靜態檔（ADR-0006：同源，避免 CORS 與跨網域 cookie）。
# 只呼叫既有 script：`npm run build` 產 dist/；runtime 用與 `start:api` 相同的 tsx 跑 server/index.ts。
# 不掛載原始碼：容器跑的是 build stage 的產物。

# ── build：完整相依 ＋ 型別檢查 ＋ Vite 建置 ＋ client boundary 檢查
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── runtime：只有 production 相依、build 產物與執行期會讀的檔案
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app

# 為什麼 runtime 保留 tsx（devDependency）而不是編譯 server：
#   1. server/ 的 tsconfig（tsconfig.server.json）是 noEmit，`npm run build` 不會產出 JS；
#   2. server 會 import src/engine（例：routes/progress.ts → ../../src/engine/ruleEngine.js），
#      而 src/engine 內部是無副檔名的 ESM 匯入（'./checkCredits'），Node ESM 解析不到；
#   3. 用 tsx 跑 server/index.ts，容器執行的就是 `npm run start:api` 那一條路徑，不會有
#      「編譯產物與原始碼不一致」的第二套行為。
# 版本不另外寫死：直接讀 package.json 的 devDependencies.tsx，跟鎖檔保持一致。
COPY package.json package-lock.json ./
# tsx 在 package.json 是 devDependency，直接 `npm install tsx` 會被 NODE_ENV=production
# （omit=dev）跳過，還會按鎖檔重算整棵樹。因此在獨立 prefix 安裝後再合併進 /app/node_modules。
RUN TSX_VERSION="$(node -p "require('./package.json').devDependencies.tsx")" \
 && npm ci --omit=dev \
 && npm install --prefix /tmp/tsx-deps --no-save --no-package-lock "tsx@${TSX_VERSION}" \
 && cp -a /tmp/tsx-deps/node_modules/. /app/node_modules/ \
 && rm -rf /tmp/tsx-deps \
 && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/engine ./src/engine
# 執行期會讀規則資料：server/ais/classify.ts → data/rules/113-cse-classification.json。
COPY data ./data
COPY db ./db
COPY scripts ./scripts
COPY docs/design/examples ./docs/design/examples

# 檔案以 LF 撰寫；Windows 上 git 可能不保留 +x，這裡明確補上。
RUN chmod +x scripts/docker-entrypoint.sh

USER node
EXPOSE 3000

# /healthz 會真的打一次 select 1：DB 斷線時回 503，健康狀態就一起紅。
# ALPINE 沒有 curl，用 Node 內建 fetch，避免為了 healthcheck 再加套件。
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]

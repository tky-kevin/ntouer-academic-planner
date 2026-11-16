// 等 PostgreSQL 可用：用既有相依 pg 連線重試，最多 30 次、每次間隔 1 秒。
// 用法：node scripts/wait-for-db.mjs（需要 DATABASE_URL，會讀 .env.local）
// 不印出連線字串或密碼，只印嘗試次數與錯誤訊息。
import pg from "pg";
import { loadDatabaseEnv } from "./db/load-env.mjs";

const root = process.cwd();
const connectionString = loadDatabaseEnv(root);

const MAX_ATTEMPTS = 30;
const INTERVAL_MS = 1000;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("select 1");
    await client.end();
    console.log(`[wait-for-db] 資料庫可用（第 ${attempt} 次嘗試）`);
    process.exit(0);
  } catch (error) {
    await client.end().catch(() => undefined);
    console.error(`[wait-for-db] 第 ${attempt}/${MAX_ATTEMPTS} 次失敗：${error.message}`);
    if (attempt === MAX_ATTEMPTS) {
      console.error("[wait-for-db] 放棄：資料庫未在 30 秒內可用");
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

// 最小遷移 runner：依檔名順序套用 db/migrations/*.sql，並記錄在 schema_migrations。
// 用法：node scripts/db/migrate.mjs [--status]
// 說明：ADR-0004 決定用 node-pg-migrate；本檔是為了在沒有 CLI 的情況下也能
// 重現同一組 SQL（I2 時程內的最小實作），語意與 node-pg-migrate 的 up 相同：
// 單檔單一交易、已套用者跳過。
// 注意：每個檔案只套用 `-- Down Migration` 之前的那一段。整份檔案送進 PostgreSQL 會把
// Down 也執行掉（0018 就是這樣被沖掉的，見 0019 的說明）。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadDatabaseEnv } from "./load-env.mjs";
import { upSection } from "./migration-file.mjs";

const root = process.cwd();
const connectionString = loadDatabaseEnv(root);

const dir = path.join(root, "db/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const onlyStatus = process.argv.includes("--status");

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  await client.query(`create table if not exists schema_migrations (
    version    text primary key,
    applied_at timestamptz not null default now()
  )`);

  const applied = new Set(
    (await client.query("select version from schema_migrations")).rows.map((r) => r.version),
  );

  if (onlyStatus) {
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      console.log(`${applied.has(version) ? "applied" : "pending"}  ${version}`);
    }
    await client.end();
    return;
  }

  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = upSection(readFileSync(path.join(dir, file), "utf8"));
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [version]);
      await client.query("commit");
      count += 1;
      console.log("applied:", version);
    } catch (error) {
      await client.query("rollback");
      console.error(`failed: ${version} — ${error.message}`);
      await client.end();
      process.exit(1);
    }
  }
  console.log(count === 0 ? "沒有待套用的遷移" : `套用 ${count} 個遷移`);
  await client.end();
}

main().catch(async (error) => {
  console.error("migrate failed:", error.message);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});

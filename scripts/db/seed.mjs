// 套用 db/seed/*.sql，並把 docs/design/examples/*.json 建成 @1 的 draft 版本。
// 用法：node scripts/db/seed.mjs  （需要 DATABASE_URL，會讀 .env.local）
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";

const root = process.cwd();
for (const line of readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

const SAMPLES = [
  { file: "113-cse.json", bundleId: "cse-113-day" },
  { file: "115-mmd.json", bundleId: "mmd-115-day" },
];

async function main() {
  await client.connect();

  for (const sql of readdirSync(path.join(root, "db/seed")).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(readFileSync(path.join(root, "db/seed", sql), "utf8"));
    console.log("seed ok:", sql);
  }

  for (const sample of SAMPLES) {
    const raw = readFileSync(path.join(root, "docs/design/examples", sample.file), "utf8");
    const bundle = JSON.parse(raw);
    const versionId = `${sample.bundleId}@1`;
    const contentHash = "sha256:" + createHash("sha256").update(raw).digest("hex");

    const existing = await client.query("select 1 from rule_versions where version_id = $1", [versionId]);
    if (existing.rowCount > 0) {
      console.log("skip (already seeded):", versionId);
      continue;
    }

    await client.query("begin");
    try {
      await client.query(
        `insert into rule_versions
           (version_id, bundle_id, version_no, status, payload, schema_version, content_hash, notes)
         values ($1, $2, 1, 'draft', $3, $4, $5, $6)`,
        [
          versionId,
          sample.bundleId,
          bundle,
          bundle.schemaVersion ?? "1.0",
          contentHash,
          "由 docs/design/examples 匯入，樣本本身標示為 draft，未經審核",
        ],
      );

      for (const source of bundle.sources ?? []) {
        await client.query(
          `insert into rule_sources (version_id, source_id, title, url, locator, sha256, retrieved_at, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (version_id, source_id) do nothing`,
          [
            versionId,
            source.sourceId ?? source.id,
            source.title ?? "",
            source.url ?? null,
            source.locator ?? "",
            source.sha256 ?? null,
            source.retrievedAt ?? null,
            source.status ?? "active",
          ],
        );
      }

      for (const clause of bundle.clauses ?? []) {
        await client.query(
          `insert into rule_clauses (version_id, clause_id, source_id, locator, text, reading, status)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (version_id, clause_id) do nothing`,
          [
            versionId,
            clause.clauseId ?? clause.id,
            clause.sourceId,
            clause.locator ?? "",
            clause.text ?? "",
            clause.reading ?? null,
            clause.status ?? "verified",
          ],
        );
      }

      await client.query("commit");
      console.log("seeded version:", versionId, "| sources:", (bundle.sources ?? []).length, "| clauses:", (bundle.clauses ?? []).length);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  await client.end();
}

main().catch(async (error) => {
  console.error("seed failed:", error.message);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});

// 讀 .env.local 的共用邏輯：本機有檔案就補進 process.env，
// CI 沒有檔案時直接吃環境變數（GitHub Actions 的 service container 走這條）。
// 已存在的環境變數優先，不會被 .env.local 覆蓋。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadDatabaseEnv(root = process.cwd()) {
  const file = path.join(root, ".env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL 未設定：本機請放 .env.local，CI 請在 job env 提供（postgres://planner:planner@localhost:5433/planner）。",
    );
    process.exit(1);
  }
  return process.env.DATABASE_URL;
}

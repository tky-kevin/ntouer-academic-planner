#!/usr/bin/env node
/**
 * check-doc-links.mjs — 檢查 docs/ 與 data/ 底下所有 Markdown 的相對連結是否可解析。
 *
 * 掃描範圍：docs/**\/*.md、data/**\/*.md
 * 解析語法：Markdown 行內連結 `[文字](目標)`、圖片 `![說明](目標)`、HTML `<a href="目標">`
 * 忽略：`http:`／`https:`／`mailto:` 等外部 scheme、`//` 開頭的協定相對網址、純錨點 `#...`
 * 判定：目標（去掉 `#anchor` 與 `?query`）必須存在於磁碟；比對為**大小寫敏感**，
 *       以便與 CI（Ubuntu，case-sensitive filesystem）行為一致。
 *
 * 結束碼：0 = 全部通過；1 = 有壞連結（會列出檔案:行號與原因）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["docs", "data"];
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i; // http:, https:, mailto:, tel:, data: ...

/** 遞迴收集目錄下的 .md 檔 */
function collectMarkdown(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      collectMarkdown(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

const dirCache = new Map();
function readdirSafe(dir) {
  if (dirCache.has(dir)) return dirCache.get(dir);
  let value;
  try {
    value = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    value = null;
  }
  dirCache.set(dir, value);
  return value;
}

/**
 * 大小寫敏感的 existence check：逐段比對實際目錄項目名稱。
 * @returns {{ok: true} | {ok: false, reason: string, suggestion?: string}}
 */
function checkPathExact(absTarget) {
  const parsed = path.parse(absTarget);
  const parts = absTarget.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    const entries = readdirSafe(current);
    if (entries === null) return { ok: false, reason: `上層目錄不存在：${current}` };
    if (entries.some((e) => e.name === part)) {
      current = path.join(current, part);
      continue;
    }
    const ci = entries.find((e) => e.name.toLowerCase() === part.toLowerCase());
    if (ci) {
      return {
        ok: false,
        reason: `大小寫不符（repo 在 CI 是 case-sensitive）`,
        suggestion: ci.name,
      };
    }
    return { ok: false, reason: `找不到：${part}` };
  }
  return { ok: true };
}

// `[文字](目標)` / `![說明](目標)`，允許目標後的 `"title"`
const MD_LINK = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
// <a href="..."> 與 <a href='...'>
const HTML_LINK = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** 移除圍籬程式碼區塊的內容，避免把範例碼當成連結 */
function stripFencedBlocks(text) {
  const kept = [];
  let inFence = false;
  let fenceMarker = "";
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      if (!inFence) {
        inFence = true;
        fenceMarker = m[1][0];
        kept.push("");
        continue;
      }
      if (m[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = "";
        kept.push("");
        continue;
      }
    }
    kept.push(inFence ? "" : line);
  }
  return kept;
}

function isIgnorable(target) {
  if (target === "") return true;
  if (EXTERNAL.test(target)) return true;
  if (target.startsWith("//")) return true;
  if (target.startsWith("#")) return true;
  return false;
}

const mdFiles = SCAN_DIRS.flatMap((dir) => collectMarkdown(path.join(repoRoot, dir))).sort();
const problems = [];
let checkedLinks = 0;

for (const file of mdFiles) {
  const relFile = path.relative(repoRoot, file).split(path.sep).join("/");
  const fileDir = path.dirname(file);
  const lines = stripFencedBlocks(fs.readFileSync(file, "utf8"));

  lines.forEach((line, idx) => {
    if (!line) return;
    const targets = [];
    for (const m of line.matchAll(MD_LINK)) targets.push(m[1]);
    for (const m of line.matchAll(HTML_LINK)) targets.push(m[1] ?? m[2] ?? "");

    for (const rawTarget of targets) {
      if (isIgnorable(rawTarget)) continue;
      checkedLinks += 1;

      const hashIndex = rawTarget.indexOf("#");
      let targetPath = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget;
      const queryIndex = targetPath.indexOf("?");
      if (queryIndex >= 0) targetPath = targetPath.slice(0, queryIndex);

      let decoded;
      try {
        decoded = decodeURIComponent(targetPath);
      } catch {
        problems.push({
          where: `${relFile}:${idx + 1}`,
          target: rawTarget,
          reason: "目標含不合法的百分比編碼",
        });
        continue;
      }

      const absTarget = decoded.startsWith("/")
        ? path.join(repoRoot, decoded)
        : path.resolve(fileDir, decoded);

      const result = checkPathExact(absTarget);
      if (!result.ok) {
        problems.push({
          where: `${relFile}:${idx + 1}`,
          target: rawTarget,
          reason: result.reason,
          suggestion: result.suggestion,
        });
      }
    }
  });
}

console.log(`check-doc-links: 掃描 ${mdFiles.length} 個 Markdown，檢查 ${checkedLinks} 個相對連結`);

if (problems.length === 0) {
  console.log("check-doc-links: 0 個壞連結 ✅");
  process.exit(0);
}

console.error(`check-doc-links: 發現 ${problems.length} 個壞連結 ❌`);
for (const p of problems) {
  console.error(`  ${p.where}  ->  ${p.target}`);
  console.error(`      ${p.reason}${p.suggestion ? `（應為 ${p.suggestion}）` : ""}`);
}
process.exit(1);

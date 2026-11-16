// 驗證 113 資工 coverage rule 與規則包 clause 的對照完整性。
// 只用 Node 內建模組；用法：node scripts/verify-rule-coverage.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  coverage: "data/rules/113-cse-coverage.json",
  map: "data/rules/113-cse-coverage-map.json",
  bundle: "docs/design/examples/113-cse.json",
  courses: "data/rules/113-cse-course-map.json",
};

const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const errors = [];
const data = {};
for (const [key, rel] of Object.entries(files)) {
  try {
    data[key] = readJson(rel);
  } catch (err) {
    errors.push(`[${rel}] 無法讀取或解析 JSON：${err.message}`);
  }
}

if (errors.length === 0) {
  const { coverage, map, bundle, courses } = data;
  const coverageRules = coverage?.rules;
  const mappings = map?.mappings;
  const clauses = bundle?.clauses;
  const courseList = courses?.courses;

  if (!Array.isArray(coverageRules)) errors.push(`[${files.coverage}] 缺少 rules 陣列`);
  if (!Array.isArray(mappings)) errors.push(`[${files.map}] 缺少 mappings 陣列`);
  if (!Array.isArray(clauses)) errors.push(`[${files.bundle}] 缺少 clauses 陣列`);
  if (!Array.isArray(courseList)) errors.push(`[${files.courses}] 缺少 courses 陣列`);

  if (errors.length === 0) {
    const ruleIds = coverageRules.map((rule) => rule?.id);
    const ruleIdSet = new Set(ruleIds);
    const clauseIds = new Set(clauses.map((clause) => clause?.clauseId));

    if (ruleIds.length !== 46) {
      errors.push(`[${files.coverage}] 規則數為 ${ruleIds.length}，預期 46`);
    }
    if (ruleIdSet.size !== ruleIds.length) {
      const seen = new Set();
      for (const id of ruleIds) {
        if (seen.has(id)) errors.push(`[${files.coverage}] ${id}：ruleId 重複`);
        seen.add(id);
      }
    }

    const counts = new Map();
    for (const entry of mappings) {
      const id = entry?.ruleId;
      if (typeof id !== "string" || id.trim() === "") {
        errors.push(`[${files.map}] 第 ${mappings.indexOf(entry) + 1} 筆：缺少 ruleId`);
        continue;
      }
      if (!ruleIdSet.has(id)) {
        errors.push(`[${files.map}] ${id}：ruleId 不在 113-cse-coverage.json`);
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      if (count > 1) errors.push(`[${files.map}] ${id}：ruleId 重複 ${count} 次`);
    }
    for (const id of ruleIdSet) {
      if (!counts.has(id)) errors.push(`[${files.map}] ${id}：缺少對照`);
    }

    let nullCount = 0;
    for (const entry of mappings) {
      const id = entry?.ruleId;
      if (typeof id !== "string" || id.trim() === "") continue;
      if (!Object.hasOwn(entry, "clauseId")) {
        errors.push(`[${files.map}] ${id}：缺少 clauseId（查不到請填 null 並寫 reason）`);
        continue;
      }
      const { clauseId } = entry;
      if (clauseId === null) {
        nullCount += 1;
        if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
          errors.push(`[${files.map}] ${id}：clauseId 為 null 但 reason 為空`);
        }
      } else if (typeof clauseId !== "string" || clauseId.trim() === "") {
        errors.push(`[${files.map}] ${id}：clauseId 必須是非空字串或 null`);
      } else if (!clauseIds.has(clauseId)) {
        errors.push(`[${files.map}] ${id}：clauseId「${clauseId}」不存在於 ${files.bundle} 的 clauses`);
      }
    }

    for (const [index, course] of courseList.entries()) {
      const name = course?.courseName;
      if (typeof name !== "string" || name.trim() === "") {
        errors.push(`[${files.courses}] 第 ${index + 1} 筆：缺少 courseName`);
        continue;
      }
      if (!Object.hasOwn(course, "courseCode")) {
        errors.push(`[${files.courses}] ${name}：缺少 courseCode（查不到請填 null）`);
        continue;
      }
      if (course.courseCode !== null && (typeof course.courseCode !== "string" || course.courseCode.trim() === "")) {
        errors.push(`[${files.courses}] ${name}：courseCode 若非 null 必須是非空字串`);
      }
    }

    if (errors.length === 0) {
      const suffix = nullCount > 0 ? `（${nullCount} 筆 clauseId:null 已附理由）` : "";
      console.log(`46/46 mapped${suffix}`);
      process.exit(0);
    }
  }
}

console.error(`規則覆蓋驗證失敗（${errors.length} 項）：`);
for (const message of errors) console.error(`- ${message}`);
process.exit(1);

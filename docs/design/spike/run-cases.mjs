// 邊緣案例驗證：採計上限、重複採計、抵免／免修、例外衝突、未知狀態、多系所格式
// 用法：node 設計/spike/run-cases.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluate, validateBundle } from "./rule-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const load = (p) => JSON.parse(readFileSync(join(here, "..", p), "utf8"));

const cse = load("examples/113-cse.json");
const mmd = load("examples/115-mmd.json");

let pass = 0;
let fail = 0;
const log = [];

function check(name, cond, detail = "") {
  if (cond) { pass += 1; log.push(`  PASS  ${name}${detail ? " ｜ " + detail : ""}`); }
  else { fail += 1; log.push(`  FAIL  ${name}${detail ? " ｜ " + detail : ""}`); }
}
function info(name, detail) { log.push(`  INFO  ${name} ｜ ${detail}`); }

// ── 測試資料建構 ────────────────────────────────────────────────
const rec = (courseCode, credits, opts = {}) => ({
  courseCode, credits, status: opts.status ?? "pass",
  category: opts.category ?? "ELE", owner: opts.owner ?? "own", tags: opts.tags ?? []
});

function cseComplete() {
  const rows = [];
  const ce = [
    ["國文(上)", 2, ["chinese"]], ["國文(下)", 2, ["chinese"]],
    ["大一英文(上)", 2, ["english"]], ["大一英文(下)", 2, ["english"]],
    ["進階英文", 2, ["advancedEnglish"]],
    ["海洋科學概論", 2, ["ocean"]], ["人工智慧概論", 2, ["ai"]],
    ["博雅-人文A", 2, ["general", "domainHuman"]], ["博雅-人文B", 2, ["general", "domainHuman"]],
    ["博雅-社會A", 2, ["general", "domainSociety"]], ["博雅-社會B", 2, ["general", "domainSociety"]],
    ["博雅-科技A", 2, ["general", "domainTech"]], ["博雅-科技B", 2, ["general", "domainTech"]],
    ["博雅-永續A", 2, ["general", "domainSustain"]]
  ];
  for (const [n, c, t] of ce) rows.push(rec(n, c, { category: "CE", tags: t }));

  const req = [
    ["程式設計", 3], ["離散數學", 3], ["計算機概論", 3], ["微積分(上)", 3], ["微積分(下)", 3],
    ["程式設計(二)", 3], ["線性代數", 3], ["數位邏輯", 3], ["數位邏輯實驗", 1], ["資料結構", 3],
    ["機率論", 3], ["計算機組織學", 3], ["演算法", 3], ["電腦網路", 3], ["作業系統", 3],
    ["資工系專題(一)", 3], ["資工系專題(二)", 3], ["資訊專題討論", 1]
  ];
  for (const [n, c] of req) rows.push(rec(n, c, { category: "REQ" }));

  for (let i = 1; i <= 4; i += 1) rows.push(rec(`核心選修${i}`, 3, { tags: ["inner", "core"] }));
  for (let i = 1; i <= 11; i += 1) rows.push(rec(`系內選修${i}`, 3, { tags: ["inner"] }));
  rows.push(rec("系內選修12", 1, { tags: ["inner"] }));

  rows.push(rec("外系A", 3, { owner: "other" }));
  rows.push(rec("外系B", 3, { owner: "other" }));
  rows.push(rec("外系C", 3, { owner: "other" }));
  rows.push(rec("外系D", 2, { owner: "other" }));
  return rows;
}

const allMet = {
  englishThreshold: "met", conduct: "met", peFourSemesters: "met", swimming: "met", advancedEnglishEligibility: "met"
};
const reqById = (result, id) => result.requirements.find((r) => r.id === id);

// ── 1. 規則包結構驗證 ───────────────────────────────────────────
log.push("1. 規則包結構驗證");
const v1 = validateBundle(cse);
const v2 = validateBundle(mmd);
check("資工樣本通過結構驗證", v1.ok, v1.errors.join("; "));
check("商船樣本通過結構驗證", v2.ok, v2.errors.join("; "));
const broken = JSON.parse(JSON.stringify(cse));
broken.requirements[1].clauseId = "C99";
check("錯誤條文參照被擋下", validateBundle(broken).ok === false, validateBundle(broken).errors[0]);

// ── 2. 完整達標但仍有未解衝突 ───────────────────────────────────
log.push("2. 完整達標與衝突");
const r1 = evaluate(cse, cseComplete(), { statuses: allMet });
check("總學分 135", r1.totalCredits === 135, `實際 ${r1.totalCredits}`);
check("三池 28／50／46", r1.poolTotals.ce === 28 && r1.poolTotals.req === 50 && r1.poolTotals.inner === 46,
  `${r1.poolTotals.ce}/${r1.poolTotals.req}/${r1.poolTotals.inner}`);
check("必修 18 門全滿足", reqById(r1, "R04").state === "met");
check("核心 12 為系內子集合、不另計總學分", reqById(r1, "R07").state === "met" && r1.totalCredits === 135);
check("未解衝突使結果停在未確認", r1.overall === "unconfirmed", r1.overall);

// ── 3. 不足門檻與缺額 ──────────────────────────────────────────
log.push("3. 缺額計算");
const short = cseComplete().filter((r) => r.courseCode !== "系內選修11" && r.courseCode !== "系內選修12" && r.courseCode !== "外系D");
const r2 = evaluate(cse, short, { statuses: allMet });
check("缺額 6 學分", reqById(r2, "R01").gap === 6, `gap ${reqById(r2, "R01").gap}`);
check("系內選修同時不足", reqById(r2, "R06").state === "notMet");
check("總學分不足 → 未完成", r2.overall === "incomplete");

// ── 4. 採計上限：電資學院非指定學程 6 學分 ──────────────────────
log.push("4. 採計上限");
const withCollege = [...cseComplete(),
  rec("電資共通1", 3, { tags: ["collegeNonProgram"] }),
  rec("電資共通2", 3, { tags: ["collegeNonProgram"] }),
  rec("電資共通3", 3, { tags: ["collegeNonProgram"] })];
const r3 = evaluate(cse, withCollege, { statuses: allMet });
check("超出上限只計 6，總學分 +6", r3.totalCredits === 141, `實際 ${r3.totalCredits}`);
const cappedRow = r3.trace.filter((t) => t.cappedBy === "CAP-COLLEGE");
check("trace 標記被上限截斷", cappedRow.length >= 1 && cappedRow[0].credits <= 3, JSON.stringify(cappedRow[0] ?? {}));

// 博雅單一領域上限 4
const overDomain = [...cseComplete(), rec("博雅-人文C", 2, { category: "CE", tags: ["general", "domainHuman"] })];
const r4 = evaluate(cse, overDomain, { statuses: allMet });
check("博雅人文超修不增加 R13 認列", reqById(r4, "R13").credits === 14, `R13 ${reqById(r4, "R13").credits}`);

// ── 5. 重複採計：同課多筆、同時符合兩池 ─────────────────────────
log.push("5. 重複採計");
const dupRows = [...cseComplete(),
  rec("系內選修1", 3, { tags: ["inner"] }),
  rec("系內選修1", 3, { tags: ["inner"], owner: "other" })];
const r5 = evaluate(cse, dupRows, { statuses: allMet });
check("同課多筆只計一次", r5.totalCredits === 135, `實際 ${r5.totalCredits}`);
check("歸屬只落在一個池", r5.claimed["系內選修1"].pool === "inner", r5.claimed["系內選修1"].pool);

// ── 6. 抵免與免修 ──────────────────────────────────────────────
log.push("6. 抵免與免修");
const transferRows = cseComplete().filter((r) => !r.courseCode.startsWith("大一英文"))
  .concat([rec("大一英文(抵免)", 4, { status: "transfer", category: "CE", tags: ["english"] })]);
const r6 = evaluate(cse, transferRows, { statuses: allMet });
check("抵免計入學分且滿足大一英文", reqById(r6, "R09").state === "met" && r6.totalCredits === 135, `total ${r6.totalCredits}`);

const waivedRows = cseComplete().map((r) => (r.courseCode === "數位邏輯實驗" ? { ...r, status: "waived" } : r));
const r7 = evaluate(cse, waivedRows, { statuses: allMet });
check("免修滿足指定必修", reqById(r7, "R04").state === "met");
check("免修不給學分，必修學分不足 1", reqById(r7, "R03").gap === 1, `gap ${reqById(r7, "R03").gap}`);
check("免修後總學分降為 134", r7.totalCredits === 134, `total ${r7.totalCredits}`);

// ── 7. 未知狀態與衝突解除 ──────────────────────────────────────
log.push("7. 未知狀態與衝突解除");
const r8 = evaluate(cse, cseComplete(), { statuses: { ...allMet, englishThreshold: undefined } });
check("英文門檻未知 → 尚未確認", r8.overall === "unconfirmed" && reqById(r8, "R15").state === "unknown");
const resolved = JSON.parse(JSON.stringify(cse));
resolved.conflicts[0].resolution = "resolved-by-owner";
const r9 = evaluate(resolved, cseComplete(), { statuses: allMet });
check("衝突解除後可達完整", r9.overall === "complete", r9.overall);

// ── 8. 多系所：商船主領域選修與管理級子集合 ─────────────────────
log.push("8. 多系所格式");
const mmdRows = [];
for (let i = 1; i <= 14; i += 1) mmdRows.push(rec(`共同教育${i}`, 2, { category: "CE" }));
for (let i = 1; i <= 14; i += 1) mmdRows.push(rec(`專業必修${i}`, 5, { category: "REQ" }));
for (let i = 1; i <= 10; i += 1) mmdRows.push(rec(`主領域${i}`, 2, { tags: ["mainField"] }));
for (let i = 1; i <= 6; i += 1) mmdRows.push(rec(`管理級${i}`, 3, { tags: ["mainField", "managerial"] }));
const r10 = evaluate(mmd, mmdRows, { statuses: { conduct: "met" } });
check("商船總學分 136", r10.totalCredits === 136, `實際 ${r10.totalCredits}（CE ${r10.poolTotals.ce}／必修 ${r10.poolTotals.req}／主領域 ${r10.poolTotals.mainField}）`);
check("主領域 38 與管理級 18 同時滿足", reqById(r10, "R05").state === "met" && reqById(r10, "R06").state === "met");
check("管理級為子集合、不重複計入總學分", r10.totalCredits === 136);
check("未確認的海上實習不阻擋畢業判定", reqById(r10, "R08").required === false);

// ── 9. 情境切換 ────────────────────────────────────────────────
log.push("9. 情境切換");
const partial = cseComplete().map((r, i) => (i < 3 ? { ...r, status: "inProgress" } : r));
const r11 = evaluate(cse, partial, { statuses: allMet, scenario: "completed" });
const r12 = evaluate(cse, partial, { statuses: allMet, scenario: "inProgress" });
check("修課中課程不計入已完成", r11.totalCredits < r12.totalCredits, `${r11.totalCredits} → ${r12.totalCredits}`);

// ── 輸出 ──────────────────────────────────────────────────────
console.log(log.join("\n"));
console.log(`\n結果：${pass} 通過、${fail} 失敗（共 ${pass + fail} 項）`);
process.exit(fail === 0 ? 0 : 1);

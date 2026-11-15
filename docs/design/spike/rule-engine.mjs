// NTOUER 規則引擎可行性 spike（不是產品程式碼）
// 目的：用最小實作驗證「規則包」格式能表達採計上限、重複採計、抵免／免修、
// 例外衝突與未知狀態，並產生可追溯的計算結果。
// 限制：不處理資料庫、權限、API；selector 只支援類別／擁有者／標籤。

const SEL = /^(category|owner|tag|code|dept):([A-Za-z0-9_\-\u4e00-\u9fff]+)$/;

export function parseSelector(sel) {
  const m = SEL.exec(sel);
  if (!m) throw new Error(`selector 格式錯誤：${sel}`);
  return { kind: m[1], value: m[2] };
}

function matches(selector, rec) {
  const { kind, value } = parseSelector(selector);
  switch (kind) {
    case "category": return rec.category === value;
    case "owner": return (rec.owner ?? "own") === value;
    case "tag": return Array.isArray(rec.tags) && rec.tags.includes(value);
    case "code": return rec.courseCode === value;
    case "dept": return rec.dept === value;
    default: return false;
  }
}

function matchesAny(selectors, rec) {
  return selectors.some((s) => matches(s, rec));
}

// 修課狀態 → 是否參與本次情境
export function isEligible(rec, scenario) {
  const order = { completed: 1, inProgress: 2, planned: 3 };
  const need = order[scenario] ?? 1;
  switch (rec.status) {
    case "pass":
    case "transfer":   // 抵免：有學分
    case "waived":     // 免修：滿足條件但 0 學分
      return true;
    case "inProgress":
      return need >= 2;
    case "planned":
      return need >= 3;
    default:
      return false;    // fail / excluded / unknown
  }
}

function creditsOf(rec) {
  return rec.status === "waived" ? 0 : Number(rec.credits) || 0;
}

function dedupe(records) {
  const seen = new Map();
  for (const r of records) {
    const key = r.courseCode;
    const prev = seen.get(key);
    // 同課取最佳一次：及格優先於修課中／計畫，其次取學分高者
    const rank = (x) => ({ pass: 4, transfer: 4, waived: 3, inProgress: 2, planned: 1 }[x.status] ?? 0);
    if (!prev || rank(r) > rank(prev)) seen.set(key, r);
  }
  return [...seen.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

// 依上限逐筆累加；cap 只在本計算內計數（每次評估重新起算）
function sumWithCaps(records, selectors, caps, poolId) {
  const used = new Map();
  let total = 0;
  const counted = [];
  const skipped = [];
  for (const rec of records) {
    if (!matchesAny(selectors, rec)) continue;
    let allowed = creditsOf(rec);
    if (allowed <= 0) {
      counted.push({ courseCode: rec.courseCode, credits: 0, note: rec.status });
      continue;
    }
    let cappedBy = null;
    for (const cap of caps) {
      if (cap.scope === "pool" && cap.poolId && cap.poolId !== poolId) continue;
      if (!matchesAny(cap.selectors, rec)) continue;
      const u = used.get(cap.capId) ?? 0;
      const remain = Math.max(0, cap.max - u);
      if (remain < allowed) {
        allowed = remain;
        cappedBy = cap.capId;
      }
    }
    if (allowed <= 0) {
      skipped.push({ courseCode: rec.courseCode, credits: 0, note: `達上限 ${cappedBy}` });
      continue;
    }
    for (const cap of caps) {
      if (cap.scope === "pool" && cap.poolId && cap.poolId !== poolId) continue;
      if (matchesAny(cap.selectors, rec)) used.set(cap.capId, (used.get(cap.capId) ?? 0) + allowed);
    }
    total += allowed;
    counted.push({ courseCode: rec.courseCode, credits: allowed, cappedBy });
  }
  return { total, counted, skipped };
}

function allocate(bundle, records) {
  const { pools = [], precedence = pools.map((p) => p.poolId), caps = [] } = bundle.allocation;
  const byId = new Map(pools.map((p) => [p.poolId, p]));
  const order = precedence.length ? precedence : pools.map((p) => p.poolId);
  const claimed = new Map();
  const poolTotals = Object.fromEntries(order.map((id) => [id, 0]));
  const capUsed = new Map();
  const trace = [];

  for (const poolId of order) {
    const pool = byId.get(poolId);
    if (!pool) throw new Error(`precedence 指向不存在的 pool：${poolId}`);
    for (const rec of records) {
      if (claimed.has(rec.courseCode)) continue;
      if (!matchesAny(pool.selectors, rec)) continue;
      let credit = creditsOf(rec);
      if (pool.perCourseCreditsMax != null) credit = Math.min(credit, pool.perCourseCreditsMax);
      let cappedBy = null;
      for (const cap of caps) {
        if (cap.scope === "pool" && cap.poolId && cap.poolId !== poolId) continue;
        if (!matchesAny(cap.selectors, rec)) continue;
        const u = capUsed.get(cap.capId) ?? 0;
        const remain = Math.max(0, cap.max - u);
        if (remain < credit) { credit = remain; cappedBy = cap.capId; }
      }
      const room = pool.max == null ? Infinity : Math.max(0, pool.max - poolTotals[poolId]);
      credit = Math.min(credit, room);
      if (credit <= 0) {
        trace.push({ courseCode: rec.courseCode, pool: poolId, credits: 0, cappedBy, reason: cappedBy ? `上限 ${cappedBy}` : "池已滿" });
        continue;
      }
      for (const cap of caps) {
        if (cap.scope === "pool" && cap.poolId && cap.poolId !== poolId) continue;
        if (matchesAny(cap.selectors, rec)) capUsed.set(cap.capId, (capUsed.get(cap.capId) ?? 0) + credit);
      }
      claimed.set(rec.courseCode, { pool: poolId, credits: credit });
      poolTotals[poolId] += credit;
      trace.push({ courseCode: rec.courseCode, pool: poolId, credits: credit, cappedBy });
    }
  }
  return { poolTotals, claimed, trace };
}

const MET = "met";
const NOT_MET = "notMet";
const UNKNOWN = "unknown";

function stateFromCredits(credits, min) {
  if (credits >= min) return MET;
  return NOT_MET;
}

function combineAnd(states) {
  if (states.includes(NOT_MET)) return NOT_MET;
  if (states.includes(UNKNOWN)) return UNKNOWN;
  return MET;
}

function combineOr(states) {
  if (states.includes(MET)) return MET;
  if (states.includes(UNKNOWN)) return UNKNOWN;
  return NOT_MET;
}

function evaluateRequirement(node, ctx) {
  const base = { id: node.id, name: node.name, clauseId: node.clauseId, required: node.required !== false };

  switch (node.kind) {
    case "total": {
      const credits = ctx.totalCredits;
      return { ...base, kind: "total", state: stateFromCredits(credits, node.min), credits, min: node.min, gap: Math.max(0, node.min - credits) };
    }
    case "pool": {
      const credits = ctx.poolTotals[node.poolId] ?? 0;
      const min = node.min ?? ctx.pools[node.poolId]?.min ?? 0;
      return { ...base, kind: "pool", state: stateFromCredits(credits, min), credits, min, gap: Math.max(0, min - credits) };
    }
    case "credits": {
      const { total, counted, skipped } = sumWithCaps(ctx.records, node.selectors ?? [], ctx.caps, node.poolId);
      return { ...base, kind: "credits", state: stateFromCredits(total, node.min), credits: total, min: node.min, gap: Math.max(0, node.min - total), counted, skipped };
    }
    case "courseSet": {
      const wanted = node.courses ?? [];
      const done = wanted.filter((c) => ctx.records.some((r) => r.courseCode === c));
      const missed = wanted.filter((c) => !ctx.records.some((r) => r.courseCode === c));
      let state;
      if (node.mode === "all") state = missed.length === 0 ? MET : NOT_MET;
      else if (node.mode === "any") state = done.length > 0 ? MET : NOT_MET;
      else if (node.mode === "minCount") state = done.length >= (node.minCount ?? 1) ? MET : NOT_MET;
      else {
        const credits = ctx.records.filter((r) => wanted.includes(r.courseCode)).reduce((s, r) => s + creditsOf(r), 0);
        state = stateFromCredits(credits, node.minCredits ?? 0);
      }
      return { ...base, kind: "courseSet", state, missing: missed.slice(0, 5), missingCount: missed.length };
    }
    case "status": {
      const raw = ctx.statuses[node.statusKey];
      const state = raw === "met" ? MET : raw === "notMet" ? NOT_MET : UNKNOWN;
      return { ...base, kind: "status", state, statusKey: node.statusKey };
    }
    case "and":
    case "or": {
      const children = (node.children ?? []).map((c) => evaluateRequirement(c, ctx));
      const states = children.map((c) => c.state);
      return { ...base, kind: node.kind, state: node.kind === "and" ? combineAnd(states) : combineOr(states), children };
    }
    default:
      throw new Error(`未知的 requirement 種類：${node.kind}`);
  }
}

export function evaluate(bundle, records, opts = {}) {
  const scenario = opts.scenario ?? "completed";
  const statuses = opts.statuses ?? {};
  const caps = bundle.allocation.caps ?? [];
  const poolDefs = Object.fromEntries((bundle.allocation.pools ?? []).map((p) => [p.poolId, p]));

  const eligible = dedupe(records.filter((r) => isEligible(r, scenario)));
  const { poolTotals, claimed, trace } = allocate(bundle, eligible);
  const totalCredits = Object.values(poolTotals).reduce((a, b) => a + b, 0);

  const ctx = { records: eligible, poolTotals, pools: poolDefs, caps, statuses, totalCredits };
  const requirements = bundle.requirements.map((r) => evaluateRequirement(r, ctx));
  const required = requirements.filter((r) => r.required);

  const openConflicts = (bundle.conflicts ?? []).filter((c) => (c.resolution ?? "open") === "open");

  let overall;
  if (required.some((r) => r.state === NOT_MET)) overall = "incomplete";
  else if (required.some((r) => r.state === UNKNOWN) || openConflicts.length > 0) overall = "unconfirmed";
  else overall = "complete";

  return {
    bundleId: bundle.bundleId,
    scenario,
    overall,
    totalCredits,
    poolTotals,
    requirements,
    openConflicts,
    trace,
    claimed: Object.fromEntries(claimed)
  };
}

// 結構驗證：發布前的第一道關卡（不依賴外部套件）
export function validateBundle(bundle) {
  const errors = [];
  const need = ["schemaVersion", "bundleId", "department", "scope", "status", "sources", "clauses", "allocation", "requirements"];
  for (const k of need) if (!(k in bundle)) errors.push(`缺少必要欄位：${k}`);
  if (!bundle.department?.departmentId) errors.push("department.departmentId 必填");
  if (!Number.isInteger(bundle.scope?.entryYear)) errors.push("scope.entryYear 必須是整數");

  const sourceIds = new Set((bundle.sources ?? []).map((s) => s.sourceId));
  const clauseIds = new Set((bundle.clauses ?? []).map((c) => c.clauseId));
  const poolIds = new Set((bundle.allocation?.pools ?? []).map((p) => p.poolId));

  const dup = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);
  if (dup([...sourceIds]).length) errors.push("sourceId 重複");
  if (dup([...(bundle.clauses ?? []).map((c) => c.clauseId)]).length) errors.push("clauseId 重複");
  if (dup([...(bundle.requirements ?? []).map((r) => r.id)]).length) errors.push("requirement id 重複");

  for (const c of bundle.clauses ?? []) if (!sourceIds.has(c.sourceId)) errors.push(`clause ${c.clauseId} 指向不存在的 source ${c.sourceId}`);
  for (const p of bundle.allocation?.pools ?? []) {
    for (const s of p.selectors ?? []) if (!SEL.test(s)) errors.push(`pool ${p.poolId} selector 格式錯誤：${s}`);
  }
  for (const cap of bundle.allocation?.caps ?? []) {
    for (const s of cap.selectors ?? []) if (!SEL.test(s)) errors.push(`cap ${cap.capId} selector 格式錯誤：${s}`);
    if (cap.clauseId && !clauseIds.has(cap.clauseId)) errors.push(`cap ${cap.capId} 指向不存在的 clause ${cap.clauseId}`);
  }
  for (const id of bundle.allocation?.precedence ?? []) if (!poolIds.has(id)) errors.push(`precedence 指向不存在的 pool ${id}`);

  const walk = (node, path) => {
    if (!node.id) errors.push(`${path} 缺少 id`);
    if (node.clauseId && !clauseIds.has(node.clauseId)) errors.push(`${path} 指向不存在的 clause ${node.clauseId}`);
    if (["pool"].includes(node.kind) && node.poolId && !poolIds.has(node.poolId)) errors.push(`${path} 指向不存在的 pool ${node.poolId}`);
    if (node.kind === "credits") for (const s of node.selectors ?? []) if (!SEL.test(s)) errors.push(`${path} selector 格式錯誤：${s}`);
    if (node.kind === "courseSet" && (!node.courses || node.courses.length === 0)) errors.push(`${path} courseSet 缺 courses`);
    for (const c of node.children ?? []) walk(c, `${path}.${c.id ?? "?"}`);
  };
  (bundle.requirements ?? []).forEach((r) => walk(r, `requirement ${r.id}`));

  return { ok: errors.length === 0, errors };
}

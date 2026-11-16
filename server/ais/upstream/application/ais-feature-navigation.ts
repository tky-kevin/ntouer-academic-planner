import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aisText } from "./ais-response.js";
import type { GatewaySession } from "./ports/gateway-session.js";
import {
  applyAisMenuExpandCallback,
  buildAisMenuExpandBody,
  parseAisMenuPage,
  type AisMenuNode,
  type AisMenuState,
} from "../protocol/ais/menu-tree-parser.js";
import { parseAisFeatureLoader } from "../protocol/ais/feature-loader-parser.js";
import { AisProtocolError } from "../protocol/ais/protocol-error.js";

/**
 * Planner 對 upstream 的唯一修改：把「選單導覽失敗」拆成可診斷的代碼，
 * 並在 AIS_DEBUG_DUMP 開啟時把當下的選單節點存檔。
 *
 * 為什麼：原本所有失敗都丟 menu_tree_contract_changed，線上出錯時無法分辨是
 * 「群組改名」「目標頁改名」「loader 換路徑」還是「頁面格式真的變了」。
 * 行為不變（仍然是 fail-closed、仍然要求唯一候選），只是讓失敗可被診斷。
 */

const mainFrameUrl = new URL("https://ais.ntou.edu.tw/MainFrame.aspx");
const menuUrl = new URL("https://ais.ntou.edu.tw/MenuTree.aspx");

/**
 * 直接 GET 查詢頁。AIS 的查詢頁只靠 session cookie，不需要先展開選單；
 * 選單只是「發現 URL」的機制，而 URL 我們已經知道。
 * 回 null 代表不能用（登入頁、錯誤頁、或頁面標記不符），呼叫端改走選單導覽。
 */
async function tryDirectQuery(
  session: GatewaySession,
  options: Readonly<{
    expectedQueryUrl: URL;
    operation: "timetable" | "grades";
    assertAuthenticated(html: string): void;
  }>,
): Promise<Readonly<{ queryUrl: URL; html: string }> | null> {
  let html: string;
  try {
    const response = await session.transport.execute({
      operation: `try_direct_${options.operation}_query_page`,
      method: "GET",
      url: options.expectedQueryUrl,
      headers: {
        accept: "text/html,application/xhtml+xml",
        referer: mainFrameUrl.href,
      },
      maximumResponseBytes: 524_288,
      timeoutMs: 10_000,
    });
    if (response.status !== 200) return null;
    html = aisText(response, `try_direct_${options.operation}`, ["text/html"]);
    options.assertAuthenticated(html);
  } catch {
    return null;
  }
  const marker =
    options.operation === "grades"
      ? /name=["']Q_AYEARSMS["']/iu
      : /name=["']Q_AYEAR["']/iu;
  if (!marker.test(html)) return null;
  if (/GenericErrorPage|<title>\s*(登入|Login)/iu.test(html)) return null;
  return { queryUrl: options.expectedQueryUrl, html };
}

export async function openAisFeature(
  session: GatewaySession,
  options: Readonly<{
    menuGroups: readonly string[];
    targetTitle: string;
    expectedLoaderUrl: URL;
    expectedProgramCode: string;
    expectedQueryUrl: URL;
    operation: "timetable" | "grades";
    assertAuthenticated(html: string): void;
    /**
     * 先直接 GET 查詢頁（同一份 session cookie），失敗才走選單導覽。
     * AIS 的選單是舊版 ASP.NET TreeView，改版或連續 postback 都會壞；查詢頁本身只看 session。
     */
    directQueryFirst?: boolean;
  }>,
): Promise<Readonly<{ queryUrl: URL; html: string }>> {
  if (options.directQueryFirst === true) {
    const direct = await tryDirectQuery(session, options);
    if (direct !== null) return direct;
  }
  const menu = await session.transport.execute({
    operation: `read_${options.operation}_menu`,
    method: "GET",
    url: menuUrl,
    headers: {
      accept: "text/html,application/xhtml+xml",
      referer: mainFrameUrl.href,
    },
    maximumResponseBytes: 1_048_576,
    timeoutMs: 10_000,
  });
  const menuHtml = aisText(menu, `read_${options.operation}`, ["text/html"]);
  options.assertAuthenticated(menuHtml);
  let state = parseAisMenuPage(menuHtml);
  // AIS 是舊版 ASP.NET 站台：短時間連續 postback 會回 403 系統錯誤頁。
  // 每次展開之間留一點間隔；測試可設 AIS_MENU_EXPAND_DELAY_MS=0。
  const delayMs = Math.min(5_000, Math.max(0, Number(process.env.AIS_MENU_EXPAND_DELAY_MS ?? 250) || 0));
  const pause = async (): Promise<void> => {
    if (delayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  };
  const expand = async (node: AisMenuNode): Promise<void> => {
    await pause();
    const body = buildAisMenuExpandBody(state, node);
    debugExpansion(options, node, body, state.mode);
    const expanded = await session.transport.execute({
      operation: `expand_${options.operation}_menu_group`,
      method: "POST",
      url: menuUrl,
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: menuUrl.origin,
        referer: menuUrl.href,
      },
      body,
      maximumResponseBytes: 1_048_576,
      timeoutMs: 10_000,
    });
    const callback = aisText(expanded, `read_${options.operation}`, [
      "text/plain",
      "text/html",
    ]);
    options.assertAuthenticated(callback);
    state = applyAisMenuExpandCallback(state, node, callback);
    expandedPaths.add(node.postbackPath ?? node.title);
  };
  const expandedPaths = new Set<string>();
  const isExpandedOrAncestor = (node: AisMenuNode): boolean => {
    const nodePath = node.postbackPath ?? node.title;
    if (expandedPaths.has(nodePath)) return true;
    // 展開祖先節點會把子樹收起來（ASP.NET TreeView 是 toggle），所以 BFS 必須避開。
    if (state.mode !== "postback") return false;
    for (const expanded of expandedPaths) {
      if (expanded.startsWith(`${nodePath}\\`)) return true;
    }
    return false;
  };

  let configuredPathComplete = true;
  for (const segment of options.menuGroups) {
    const matches = state.nodes.filter(
      (node) => node.kind === "group" && sameTitle(node.title, segment),
    );
    if (matches.length === 0) {
      // 設定的群組路徑走不下去（AIS 可能改名或搬家）：交給下面的廣度搜尋，
      // 真的找不到才回報 menu_group_not_found。
      configuredPathComplete = false;
      break;
    }
    if (matches.length > 1 || matches[0] === undefined) {
      fail(state, options, "menu_target_ambiguous");
    }
    await expand(matches[0]);
  }

  const findTargets = (current: AisMenuState) =>
    current.nodes.filter(
      (node) => node.kind === "page" && sameTitle(node.title, options.targetTitle),
    );
  let targets = findTargets(state);

  // 設定的群組路徑找不到時，改用有上限的廣度搜尋（AIS 可能把功能搬到別的群組）。
  // 只在 postback 模式做：舊版 populate 模式有 fixture 測試固定在跑，不要多發請求。
  if (targets.length === 0 && state.mode === "postback") {
    const queue: AisMenuNode[] = state.nodes.filter(
      (node) => node.kind === "group" && !isExpandedOrAncestor(node),
    );
    let budget = 30;
    while (queue.length > 0 && budget > 0 && targets.length === 0) {
      const group = queue.shift();
      if (group === undefined) break;
      if (isExpandedOrAncestor(group)) continue;
      budget -= 1;
      await expand(group);
      targets = findTargets(state);
      for (const node of state.nodes) {
        if (node.kind !== "group") continue;
        if (!isExpandedOrAncestor(node)) queue.push(node);
      }
    }
  }

  if (targets.length === 0) {
    fail(state, options, configuredPathComplete ? "menu_target_not_found" : "menu_group_not_found");
  }
  if (targets.length > 1) fail(state, options, "menu_target_ambiguous");
  const target = targets[0];
  if (target === undefined || target.loaderUrl === null) {
    fail(state, options, "menu_loader_mismatch");
  }
  const directQuery = samePath(target.loaderUrl, options.expectedQueryUrl);
  // 新版 MenuTree 的頁面連結可能不帶 progcd；帶了就必須相符，沒帶則以路徑判定。
  const programOk =
    target.programCode === null ||
    target.programCode === options.expectedProgramCode;
  if (
    (!directQuery && !samePath(target.loaderUrl, options.expectedLoaderUrl)) ||
    !programOk
  ) {
    fail(state, options, "menu_loader_mismatch");
  }

  // 有些版本的選單直接連查詢頁，有些連 loader（loader 會用 script 轉到查詢頁）。
  if (directQuery) {
    const page = await session.transport.execute({
      operation: `read_${options.operation}_query_page`,
      method: "GET",
      url: target.loaderUrl,
      headers: {
        accept: "text/html,application/xhtml+xml",
        referer: menuUrl.href,
      },
      maximumResponseBytes: 524_288,
      timeoutMs: 10_000,
    });
    const html = aisText(page, `read_${options.operation}`, ["text/html"]);
    options.assertAuthenticated(html);
    return { queryUrl: target.loaderUrl, html };
  }

  const loaderUrl = target.loaderUrl;
  const loader = await session.transport.execute({
    operation: `open_${options.operation}_feature`,
    method: "GET",
    url: loaderUrl,
    headers: {
      accept: "text/html,application/xhtml+xml",
      referer: menuUrl.href,
    },
    maximumResponseBytes: 262_144,
    timeoutMs: 10_000,
  });
  const loaderHtml = aisText(loader, `read_${options.operation}`, [
    "text/html",
  ]);
  options.assertAuthenticated(loaderHtml);
  const queryUrl = parseAisFeatureLoader(
    loaderHtml,
    loaderUrl,
    options.expectedQueryUrl,
  );
  const page = await session.transport.execute({
    operation: `read_${options.operation}_query_page`,
    method: "GET",
    url: queryUrl,
    headers: {
      accept: "text/html,application/xhtml+xml",
      referer: loaderUrl.href,
    },
    maximumResponseBytes: 524_288,
    timeoutMs: 10_000,
  });
  const html = aisText(page, `read_${options.operation}`, ["text/html"]);
  options.assertAuthenticated(html);
  return { queryUrl, html };
}

/** 路徑比對忽略大小寫與 query（`?progcd=` 會隨版本改變）。 */
function samePath(left: URL, right: URL): boolean {
  return left.pathname.toLowerCase() === right.pathname.toLowerCase();
}



/** AIS 選單標題偶爾多一個空白或全形空白；比對前先去掉所有空白。 */
function sameTitle(left: string, right: string): boolean {
  return normalizeTitle(left) === normalizeTitle(right);
}

function normalizeTitle(value: string): string {
  return value.replace(/[\s\u3000]+/gu, "").trim();
}

type FailCode =
  | "menu_group_not_found"
  | "menu_target_not_found"
  | "menu_target_ambiguous"
  | "menu_loader_mismatch";

function fail(
  state: AisMenuState,
  options: Readonly<{
    menuGroups: readonly string[];
    targetTitle: string;
    expectedLoaderUrl: URL;
    expectedProgramCode: string;
    operation: "timetable" | "grades";
  }>,
  code: FailCode,
): never {
  debugMenu(state, options, code);
  throw new AisProtocolError(code);
}

/**
 * 除錯用：把每次展開實際送出的 postback 參數寫進 `expansions.jsonl`（只在 AIS_DEBUG_DUMP 設定時）。
 * 不含 cookie／viewstate 值，只有節點路徑與 __EVENTARGUMENT。
 */
function debugExpansion(
  options: Readonly<{ operation: "timetable" | "grades" }>,
  node: AisMenuNode,
  body: string,
  mode: string,
): void {
  const dir = process.env.AIS_DEBUG_DUMP?.trim();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const params = new URLSearchParams(body);
    appendFileSync(
      path.join(dir, "expansions.jsonl"),
      `${JSON.stringify({
        at: new Date().toISOString(),
        operation: options.operation,
        mode,
        title: node.title,
        kind: node.kind,
        postbackPath: node.postbackPath,
        eventTarget: params.get("__EVENTTARGET"),
        eventArgument: params.get("__EVENTARGUMENT"),
      })}\n`,
      "utf8",
    );
  } catch {
    // 除錯輸出失敗不影響流程。
  }
}

/**
 * `AIS_DEBUG_DUMP` 有設才寫檔（統一由 transport.ts 的 dumpResponse 決定目錄）。
 * 只寫選單標題、種類、programCode 與 loader URL，不寫任何個人資料。
 */
function debugMenu(
  state: AisMenuState,
  options: Readonly<{
    targetTitle: string;
    expectedProgramCode: string;
    operation: "timetable" | "grades";
  }>,
  code: FailCode,
): void {
  const dir = process.env.AIS_DEBUG_DUMP?.trim();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${options.operation}-${code}.json`);
    const payload = {
      operation: options.operation,
      code,
      expectedTargetTitle: options.targetTitle,
      expectedProgramCode: options.expectedProgramCode,
      nodes: state.nodes.map((node) => ({
        title: node.title,
        kind: node.kind,
        programCode: node.programCode,
        loaderPath: node.loaderUrl?.pathname ?? null,
      })),
    };
    writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // 除錯輸出失敗不影響錯誤路徑。
  }
}

import { cellText } from "./html-table.js";
import { AisProtocolError } from "./protocol-error.js";

type MenuExpansion = Readonly<{
  index: number;
  text: string;
  path: string;
  databound: string;
  datapath: string;
  parentIsLast: string;
}>;

export type AisMenuNode = Readonly<{
  title: string;
  kind: "group" | "page";
  programCode: string | null;
  loaderUrl: URL | null;
  expansion: MenuExpansion | null;
  /**
   * 新版 MenuTree（`__doPostBack('Menu_TreeView','tNTOU\\STU')`）的節點路徑。
   * 舊版（TreeView_PopulateNode）為 null。
   */
  postbackPath: string | null;
}>;

/**
 * AIS 的 MenuTree 有兩種實作：
 * - `populate`：舊版 TreeView_PopulateNode callback（fixture 與 2026-11 前的線上版本）
 * - `postback`：標準 ASP.NET TreeView `__doPostBack('Menu_TreeView', 't<path>')`（2026-11-17 實測）
 * 兩者都要能解析，否則改版一次整個成績流程就掛。
 */
export type AisMenuMode = "populate" | "postback";

export type AisMenuState = Readonly<{
  fields: ReadonlyMap<string, string>;
  lastIndex: number;
  mode: AisMenuMode;
  nodes: readonly AisMenuNode[];
}>;

const menuUrl = new URL("https://ais.ntou.edu.tw/MenuTree.aspx");
const allowedFields = new Set([
  "__EVENTTARGET",
  "__EVENTARGUMENT",
  "__VIEWSTATE",
  "__VIEWSTATEGENERATOR",
  "__EVENTVALIDATION",
  "__VIEWSTATEENCRYPTED",
  "Menu_TreeView_ExpandState",
  "Menu_TreeView_SelectedNode",
  "Menu_TreeView_PopulateLog",
]);

export function parseAisMenuPage(html: string): AisMenuState {
  const fields = parseHiddenFields(html);
  for (const required of ["__VIEWSTATE", "__EVENTVALIDATION"]) {
    if ((fields.get(required) ?? "") === "") contractChanged();
  }
  const lastIndexRaw = html.match(/Menu_TreeView_Data\.lastIndex\s*=\s*["']?(\d+)/iu)?.[1];
  if (lastIndexRaw !== undefined) {
    const lastIndex = Number(lastIndexRaw);
    if (!Number.isSafeInteger(lastIndex) || lastIndex < 0 || lastIndex > 10_000) {
      contractChanged();
    }
    return { fields, lastIndex, mode: "populate", nodes: parseMenuNodes(html) };
  }
  // 沒有 TreeView_Data 就是新版 postback 形式；連 Menu_TreeView 都沒有才是真的壞掉。
  if (!/Menu_TreeView/iu.test(html)) contractChanged();
  const nodes = parsePostbackMenuNodes(html);
  if (nodes.length === 0) contractChanged();
  return { fields, lastIndex: 0, mode: "postback", nodes };
}

export function buildAisMenuExpandBody(
  state: AisMenuState,
  node: AisMenuNode,
): string {
  if (state.mode === "postback") {
    if (node.kind !== "group" || !node.postbackPath) contractChanged();
    const body = new URLSearchParams();
    for (const [name, value] of state.fields) body.set(name, value);
    body.set("__EVENTTARGET", "Menu_TreeView");
    // `t` 前綴＝展開／摺疊該節點；`s` 是選取，不能用來展開。
    body.set("__EVENTARGUMENT", `t${node.postbackPath}`);
    const encoded = body.toString();
    if (new TextEncoder().encode(encoded).byteLength > 524_288) contractChanged();
    return encoded;
  }
  const expansion = node.expansion;
  if (node.kind !== "group" || expansion === null) contractChanged();
  const body = new URLSearchParams();
  for (const [name, value] of state.fields) body.set(name, value);
  body.set("__CALLBACKID", "Menu_TreeView");
  body.set(
    "__CALLBACKPARAM",
    `${expansion.index}|${state.lastIndex}|${expansion.databound}f${expansion.parentIsLast}|` +
      `${expansion.text.length}|${expansion.text}${expansion.datapath.length}|` +
      `${expansion.datapath}${expansion.path}`,
  );
  const encoded = body.toString();
  if (new TextEncoder().encode(encoded).byteLength > 524_288) {
    contractChanged();
  }
  return encoded;
}

export function applyAisMenuExpandCallback(
  state: AisMenuState,
  node: AisMenuNode,
  raw: string,
): AisMenuState {
  if (state.mode === "postback") {
    // 新版 postback 回的是 HTML（通常是整頁）；沒有 hidden fields 時沿用舊的。
    const fields = new Map(state.fields);
    for (const [name, value] of parseHiddenFields(raw)) fields.set(name, value);
    const nodes = parsePostbackMenuNodes(raw);
    if (nodes.length === 0) contractChanged();
    return { fields, lastIndex: 0, mode: "postback", nodes };
  }
  if (node.expansion === null) contractChanged();
  const frame = parseCallbackFrame(raw);
  const firstSeparator = frame.result.indexOf("|");
  const secondSeparator = frame.result.indexOf("|", firstSeparator + 1);
  const nextIndex = Number(frame.result.slice(0, firstSeparator));
  if (
    firstSeparator < 0 ||
    secondSeparator < 0 ||
    !Number.isSafeInteger(nextIndex) ||
    nextIndex < 0 ||
    nextIndex > 10_000
  ) {
    contractChanged();
  }
  const expandState = frame.result.slice(firstSeparator + 1, secondSeparator);
  const fragment = frame.result.slice(secondSeparator + 1);
  if ([...expandState].length > 100_000 || [...fragment].length > 1_048_576) {
    contractChanged();
  }
  const fields = new Map(state.fields);
  if (frame.validation !== "") {
    if ([...frame.validation].length > 262_144) contractChanged();
    fields.set("__EVENTVALIDATION", frame.validation);
  }
  fields.set(
    "Menu_TreeView_ExpandState",
    `${fields.get("Menu_TreeView_ExpandState") ?? ""}${expandState}`,
  );
  fields.set(
    "Menu_TreeView_PopulateLog",
    `${fields.get("Menu_TreeView_PopulateLog") ?? ""}${node.expansion.index},`,
  );
  return { fields, lastIndex: nextIndex, mode: "populate", nodes: parseMenuNodes(fragment) };
}

function parseMenuNodes(html: string): readonly AisMenuNode[] {
  const nodes: AisMenuNode[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)) {
    const title = cellText(match[2] ?? "");
    const href = attribute(match[1] ?? "", "href");
    if (title === "" || [...title].length > 120 || href === "") continue;
    const expansion = parseExpansion(title, href);
    const page = expansion === null ? parsePageTarget(href) : null;
    if (expansion === null && page === undefined) continue;
    const node: AisMenuNode = {
      title,
      kind: expansion === null ? "page" : "group",
      programCode: page?.programCode ?? null,
      loaderUrl: page?.loaderUrl ?? null,
      expansion,
      postbackPath: null,
    };
    const key = `${node.kind}\u0000${title}\u0000${node.loaderUrl?.href ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      nodes.push(node);
    }
  }
  if (nodes.length > 500) contractChanged();
  return nodes;
}

/**
 * 新版 MenuTree：每個節點有兩個 anchor
 * - `t<path>`：展開圖示（沒有文字）
 * - `s<path>`：節點標籤（有 title 屬性）
 * 葉節點直接連到 Application 底下的 _.aspx（loader）或查詢頁。
 */
function parsePostbackMenuNodes(html: string): readonly AisMenuNode[] {
  const nodes: AisMenuNode[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)) {
    const attrs = match[1] ?? "";
    const href = attribute(attrs, "href");
    if (href === "") continue;
    const text = cellText(match[2] ?? "");
    const title = (attribute(attrs, "title") || text).trim();
    if (title === "" || [...title].length > 120) continue;

    if (href.includes("__doPostBack")) {
      const rawArgument = /__doPostBack\(\s*['"]Menu_TreeView['"]\s*,\s*['"]([^'"]*)['"]\s*\)/iu.exec(href)?.[1];
      if (rawArgument === undefined || !rawArgument.startsWith("s")) continue;
      // href 是 JavaScript 字串，`\\` 是跳脫過的單一反斜線（路徑分隔）。
      const argument = rawArgument.replace(/\\\\/gu, "\\");
      const nodePath = argument.slice(1);
      // ASP.NET TreeView 的路徑會用 `$` 當節點序號（例如 `NTOU\\STU\\STU$0002`）。
      if (!/^[A-Za-z0-9_$\\.-]{1,200}$/u.test(nodePath)) contractChanged();
      const key = `group\u0000${title}\u0000${nodePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({
        title,
        kind: "group",
        programCode: null,
        loaderUrl: null,
        expansion: null,
        postbackPath: nodePath,
      });
      continue;
    }

    const page = parsePageTarget(href);
    if (page === undefined) continue;
    const key = `page\u0000${title}\u0000${page.loaderUrl.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push({
      title,
      kind: "page",
      programCode: page.programCode,
      loaderUrl: page.loaderUrl,
      expansion: null,
      postbackPath: null,
    });
  }
  if (nodes.length > 500) contractChanged();
  return nodes;
}

function parseExpansion(title: string, href: string): MenuExpansion | null {
  if (!/TreeView_PopulateNode/iu.test(href)) return null;
  const index = Number(
    href.match(/TreeView_PopulateNode\([^,]+,\s*(\d+)/iu)?.[1],
  );
  const values = [
    ...href.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/gu),
  ].map((match) => decodeJavaScriptString(match[1] ?? match[2] ?? ""));
  const [lineType, text, path, databound, datapath, parentIsLast] =
    values.slice(-6);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > 10_000 ||
    lineType === undefined ||
    text !== title ||
    path === undefined ||
    databound === undefined ||
    datapath === undefined ||
    parentIsLast === undefined ||
    values.some((value) => [...value].length > 512)
  ) {
    contractChanged();
  }
  return { index, text, path, databound, datapath, parentIsLast };
}

function parsePageTarget(
  href: string,
): Readonly<{ loaderUrl: URL; programCode: string | null }> | undefined {
  const page = href.match(/([A-Za-z0-9_./-]+\.aspx(?:\?[^"' <>\s)]*)?)/iu)?.[1];
  if (page === undefined) return undefined;
  let target: URL;
  try {
    target = new URL(page.replaceAll("&amp;", "&"), menuUrl);
  } catch {
    contractChanged();
  }
  if (
    target.origin !== menuUrl.origin ||
    !target.pathname.startsWith("/Application/") ||
    !target.pathname.toLowerCase().endsWith(".aspx") ||
    target.hash !== ""
  ) {
    return undefined;
  }
  const programCode = target.searchParams.get("progcd");
  if (programCode === null) return { loaderUrl: target, programCode: null };
  if (!/^[A-Za-z0-9_-]{1,40}$/u.test(programCode)) contractChanged();
  return { loaderUrl: target, programCode };
}

function parseHiddenFields(html: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  for (const match of html.matchAll(/<input\b[^>]*>/giu)) {
    const type = attribute(match[0], "type").toLowerCase();
    const name = attribute(match[0], "name");
    if (type !== "hidden" || !allowedFields.has(name)) continue;
    if (fields.has(name)) contractChanged();
    const value = attribute(match[0], "value");
    if ([...value].length > 262_144) contractChanged();
    fields.set(name, value);
  }
  return fields;
}

function parseCallbackFrame(raw: string): Readonly<{
  validation: string;
  result: string;
}> {
  if (raw.startsWith("s")) return { validation: "", result: raw.slice(1) };
  if (raw.startsWith("e") || raw.startsWith("<script")) contractChanged();
  const separator = raw.indexOf("|");
  const validationLength = Number(raw.slice(0, separator));
  if (
    separator < 0 ||
    !Number.isSafeInteger(validationLength) ||
    validationLength < 0 ||
    validationLength > 262_144
  ) {
    contractChanged();
  }
  const validationStart = separator + 1;
  const validation = raw.slice(
    validationStart,
    validationStart + validationLength,
  );
  if ([...validation].length !== validationLength) contractChanged();
  return {
    validation,
    result: raw.slice(validationStart + validationLength),
  };
}

function attribute(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value =
    tag
      .match(
        new RegExp(
          `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
          "iu",
        ),
      )
      ?.slice(1)
      .find((candidate) => candidate !== undefined) ?? "";
  return decodeHtmlAttribute(value);
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/gu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function decodeJavaScriptString(value: string): string {
  return value
    .replace(/\\u([0-9a-f]{4})/giu, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\x([0-9a-f]{2})/giu, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\(["'\\])/gu, "$1");
}

function contractChanged(): never {
  throw new AisProtocolError("menu_tree_contract_changed");
}

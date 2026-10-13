import { aisText } from "./ais-response.js";
import type { GatewaySession } from "./ports/gateway-session.js";
import {
  applyAisMenuExpandCallback,
  buildAisMenuExpandBody,
  parseAisMenuPage,
} from "../protocol/ais/menu-tree-parser.js";
import { parseAisFeatureLoader } from "../protocol/ais/feature-loader-parser.js";
import { AisProtocolError } from "../protocol/ais/protocol-error.js";

const mainFrameUrl = new URL("https://ais.ntou.edu.tw/MainFrame.aspx");
const menuUrl = new URL("https://ais.ntou.edu.tw/MenuTree.aspx");

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
  }>,
): Promise<Readonly<{ queryUrl: URL; html: string }>> {
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

  for (const segment of options.menuGroups) {
    const matches = state.nodes.filter(
      (node) => node.kind === "group" && node.title === segment,
    );
    if (matches.length !== 1 || matches[0] === undefined) changed();
    const node = matches[0];
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
      body: buildAisMenuExpandBody(state, node),
      maximumResponseBytes: 1_048_576,
      timeoutMs: 10_000,
    });
    const callback = aisText(expanded, `read_${options.operation}`, [
      "text/plain",
      "text/html",
    ]);
    options.assertAuthenticated(callback);
    state = applyAisMenuExpandCallback(state, node, callback);
  }

  const targets = state.nodes.filter(
    (node) => node.kind === "page" && node.title === options.targetTitle,
  );
  const target = targets[0];
  if (
    targets.length !== 1 ||
    target?.loaderUrl === null ||
    target === undefined ||
    target.loaderUrl.href !== options.expectedLoaderUrl.href ||
    target.programCode !== options.expectedProgramCode
  )
    changed();
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

function changed(): never {
  throw new AisProtocolError("menu_tree_contract_changed");
}

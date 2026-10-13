import { AisProtocolError } from "./protocol-error.js";

const origin = "https://ais.ntou.edu.tw";

export function assertAuthenticatedAisShell(html: string): void {
  parseAuthenticatedAisShell(html);
}

export function parseAuthenticatedAisShell(html: string): Readonly<{
  titleUrl: URL;
  menuUrl: URL;
  mainUrl: URL;
}> {
  const expected = new Map([
    ["titleFrame", "/title.aspx"],
    ["menuFrame", "/MenuTree.aspx"],
    ["mainFrame", "/portal.aspx"],
  ]);
  const frames = new Map<string, URL>();
  for (const match of html.matchAll(/<(?:frame|iframe)\b[^>]*>/giu)) {
    const name = attribute(match[0], "name");
    const source = attribute(match[0], "src");
    if (name === null || source === null || frames.has(name)) continue;
    let url: URL;
    try {
      url = new URL(source, origin);
    } catch {
      throw new AisProtocolError("missing_required_header");
    }
    frames.set(name, url);
  }
  for (const [name, path] of expected) {
    const url = frames.get(name);
    if (url === undefined || url.origin !== origin || url.pathname !== path) {
      throw new AisProtocolError("missing_required_header");
    }
    if (name !== "titleFrame" && (url.search !== "" || url.hash !== "")) {
      throw new AisProtocolError("missing_required_header");
    }
  }
  const title = frames.get("titleFrame");
  if (
    title === undefined ||
    title.hash !== "" ||
    [...title.searchParams].length !== 1 ||
    !title.searchParams.has("XX")
  ) {
    throw new AisProtocolError("missing_required_header");
  }
  return {
    titleUrl: title,
    menuUrl: frames.get("menuFrame")!,
    mainUrl: frames.get("mainFrame")!,
  };
}

function attribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "iu",
  ).exec(tag);
  return match === null ? null : (match[1] ?? match[2] ?? "");
}

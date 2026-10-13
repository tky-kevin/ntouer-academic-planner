import { AisProtocolError } from "./protocol-error.js";

export type GradesDetailRequest = Readonly<{
  url: URL;
  body: string;
}>;

const expectedDetailPath = "/Application/GRD/GRD50/GRD5010_02.aspx";

/**
 * GRD5010 first returns a student-result grid for some accounts/terms. The
 * observed row action is the only trusted bridge to the grade detail page.
 */
export function parseGradesDetailRequest(
  html: string,
  queryUrl: URL,
): GradesDetailRequest | null {
  const actions = [
    ...html.matchAll(
      /doEdit1_2\(\s*[^,]+,\s*(["'])(.*?)\1\s*,\s*(["'])(.*?)\3\s*\)/giu,
    ),
  ];
  if (actions.length === 0) return null;
  if (actions.length !== 1) {
    throw new AisProtocolError("grades_detail_target_changed");
  }
  const action = actions[0]!;
  const mode = decodeHtml(action[4] ?? "")
    .trim()
    .toUpperCase();
  const parts = decodeHtml(action[2] ?? "").split("|");
  if (
    mode !== "MOD" ||
    parts.length !== 2 ||
    parts[0] !== "STNO" ||
    !/^[A-Za-z0-9_-]{1,80}$/u.test(parts[1] ?? "")
  ) {
    throw new AisProtocolError("grades_detail_target_changed");
  }

  const pages = [
    ...html.matchAll(/\bvar\s+viewpage\s*=\s*(["'])([^"']+\.aspx)\1/giu),
  ];
  if (pages.length !== 1) {
    throw new AisProtocolError("grades_detail_target_changed");
  }
  let url: URL;
  try {
    url = new URL(decodeHtml(pages[0]?.[2] ?? ""), queryUrl);
  } catch {
    throw new AisProtocolError("grades_detail_target_changed");
  }
  const expectedUrl = new URL(expectedDetailPath, queryUrl.origin);
  if (url.href !== expectedUrl.href) {
    throw new AisProtocolError("grades_detail_target_changed");
  }

  return {
    url,
    body: new URLSearchParams({ Mode: mode, STNO: parts[1]! }).toString(),
  };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/gu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

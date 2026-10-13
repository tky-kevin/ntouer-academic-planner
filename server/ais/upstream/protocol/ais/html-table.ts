import { AisProtocolError } from "./protocol-error.js";

export function tableById(html: string, id: string): string {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const table = html.match(
    new RegExp(
      `<table\\b(?=[^>]*\\bid=["']${escapedId}["'])[^>]*>([\\s\\S]*?)<\\/table>`,
      "iu",
    ),
  )?.[1];
  if (table === undefined) throw new AisProtocolError("missing_table");
  return table;
}

export function tableRows(table: string): readonly string[] {
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map(
    (match) => match[1] ?? "",
  );
}

export function rowCells(row: string): readonly string[] {
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)].map(
    (match) => match[1] ?? "",
  );
}

export function cellLines(html: string): readonly string[] {
  return decodeHtml(
    html.replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " "),
  )
    .split(/\n+/u)
    .map(normalizeText)
    .filter((value) => value !== "");
}

export function cellText(html: string): string {
  return normalizeText(decodeHtml(html.replace(/<[^>]+>/gu, " ")));
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Normalize rich AIS text without destroying authored line boundaries. */
export function normalizeMultilineText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/gu, " ").trim())
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trim();
}

export function findHeader(
  headers: readonly string[],
  patterns: readonly RegExp[],
): number {
  return headers.findIndex((header) =>
    patterns.some((pattern) => pattern.test(header)),
  );
}

export function requireHeader(
  headers: readonly string[],
  patterns: readonly RegExp[],
): number {
  const index = findHeader(headers, patterns);
  if (index < 0) throw new AisProtocolError("missing_required_header");
  return index;
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

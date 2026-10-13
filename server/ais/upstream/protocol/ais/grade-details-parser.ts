import {
  cellText,
  findHeader,
  requireHeader,
  rowCells,
  tableRows,
} from "./html-table.js";
import { AisProtocolError } from "./protocol-error.js";

export type AisContinuousAssessment = Readonly<{
  termId: string;
  courseCode: string;
  classSection: string | null;
  courseTitle: string;
  instructor: string | null;
  score: string;
  recordedAtDisplay: string | null;
}>;

export type AisGradeDetails = Readonly<{
  midtermAssessment: string | null;
  finalAssessment: string | null;
  semesterScore: string | null;
  midtermDisqualification: string | null;
  finalDisqualification: string | null;
  continuousAssessments: readonly AisContinuousAssessment[];
}>;

const maximumRows = 500;

export function parseAisGradeDetailsCallback(raw: string): AisGradeDetails {
  const payloads = callbackPayloads(raw);
  let lastError: unknown;
  for (const payload of payloads) {
    try {
      return parseAisGradeDetailsHtml(payload);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new AisProtocolError("invalid_callback_envelope");
}

export function parseAisGradeDetailsHtml(html: string): AisGradeDetails {
  if (/GenericErrorPage\.htm/iu.test(html))
    throw new AisProtocolError("generic_error");
  const result: AisGradeDetails = {
    midtermAssessment: elementText(html, "M_MARK1"),
    midtermDisqualification: elementText(html, "M_MARK2"),
    finalAssessment: elementText(html, "M_MARK3"),
    finalDisqualification: elementText(html, "M_MARK4"),
    semesterScore: elementText(html, "M_SMS_FMARK"),
    continuousAssessments: parseContinuousAssessments(html),
  };
  if (
    ["M_MARK1", "M_MARK2", "M_MARK3", "M_MARK4", "M_SMS_FMARK"].some(
      (id) => !hasElement(html, id),
    )
  ) {
    throw new AisProtocolError("missing_required_header");
  }
  return result;
}

function parseContinuousAssessments(
  html: string,
): readonly AisContinuousAssessment[] {
  const table = html.match(
    /<table\b(?=[^>]*\bid=["']DataGrid["'])[^>]*>([\s\S]*?)<\/table>/iu,
  )?.[1];
  if (table === undefined) {
    if (/查無符合資料|查無資料|無資料/iu.test(html)) return [];
    throw new AisProtocolError("missing_table");
  }
  const rows = tableRows(table);
  if (
    rows.length <= 2 &&
    rows.some((row) => /查無符合資料|查無資料|無資料/iu.test(cellText(row)))
  ) {
    return [];
  }
  const headerRowIndex = rows.findIndex((row) => {
    const headers = rowCells(row).map(cellText);
    return (
      findHeader(headers, [/學年期/u]) >= 0 &&
      findHeader(headers, [/平時成績/u]) >= 0
    );
  });
  if (headerRowIndex < 0) throw new AisProtocolError("missing_required_header");
  const headers = rowCells(rows[headerRowIndex] ?? "").map(cellText);
  const indexes = {
    term: requireHeader(headers, [/學年期/u]),
    code: requireHeader(headers, [/課號/u]),
    classSection: requireHeader(headers, [/開課班別/u]),
    title: requireHeader(headers, [/課程名稱/u]),
    instructor: requireHeader(headers, [/教師/u]),
    score: requireHeader(headers, [/^平時成績$/u]),
    date: requireHeader(headers, [/平時成績日期/u]),
  };
  const result: AisContinuousAssessment[] = [];
  for (const row of rows.slice(headerRowIndex + 1)) {
    const cells = rowCells(row).map(cellText);
    if (cells.every((cell) => cell === "")) continue;
    if (result.length >= maximumRows)
      throw new AisProtocolError("invalid_grade_row");
    const termId = cells[indexes.term] ?? "";
    const courseCode = cells[indexes.code] ?? "";
    const courseTitle = cells[indexes.title] ?? "";
    const score = cells[indexes.score] ?? "";
    if (
      !/^\d{3}[1-4]$/u.test(termId) ||
      courseCode === "" ||
      courseTitle === "" ||
      score === ""
    ) {
      throw new AisProtocolError("invalid_grade_row");
    }
    result.push({
      termId,
      courseCode: bounded(courseCode, 80),
      classSection: nullable(cells[indexes.classSection], 80),
      courseTitle: bounded(courseTitle, 200),
      instructor: nullable(cells[indexes.instructor], 200),
      score: bounded(score, 40),
      recordedAtDisplay: nullable(cells[indexes.date], 80),
    });
  }
  return result;
}

function callbackPayloads(raw: string): readonly string[] {
  const deltas = [...raw.matchAll(/\|(\d+)\|updatePanel\|[^|]*\|/gu)];
  if (deltas.length === 0) return [raw];
  return deltas.map((delta) => {
    const length = Number(delta[1]);
    const start = (delta.index ?? 0) + delta[0].length;
    const payload = raw.slice(start, start + length);
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 1_048_576 ||
      payload.length !== length
    ) {
      throw new AisProtocolError("invalid_callback_length");
    }
    return payload;
  });
}

function hasElement(html: string, id: string): boolean {
  return new RegExp(`\\bid=["']${id}["']`, "iu").test(html);
}

function elementText(html: string, id: string): string | null {
  const match = new RegExp(
    `<([a-z][a-z0-9:-]*)\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "iu",
  ).exec(html);
  return match === null ? null : nullable(cellText(match[2] ?? ""), 80);
}

function bounded(value: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized === "" || [...normalized].length > maximum)
    throw new AisProtocolError("invalid_grade_value");
  return normalized;
}

function nullable(value: string | undefined, maximum: number): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : bounded(normalized, maximum);
}

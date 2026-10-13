import { unwrapAisCallbackOrHtml } from "./callback.js";
import { cellText, findHeader, rowCells, tableRows } from "./html-table.js";
import { assertAisGradesQuery, type AisGradesQuery } from "./grades-query.js";
import {
  AisProtocolError,
  type AisProtocolFailureCode,
} from "./protocol-error.js";

export type AisCourseGrade = Readonly<{
  id: string;
  termId: string;
  courseCode: string;
  classSection: string | null;
  courseTitle: string;
  credits: number;
  requirement: "required" | "elective" | "unknown";
  selection: string;
  instructor: string | null;
  provisionalScore: string | null;
  semesterScore: string | null;
  otherScore: string | null;
}>;

export type AisConductGrade = Readonly<{
  termId: string;
  score: string;
}>;

export type AisAcademicRank = Readonly<{
  position: number;
  cohortSize: number;
}>;

export type AisRankPublicationSchedule = Readonly<{
  display: string;
  termId: string | null;
  rocDate: Readonly<{ year: number; month: number; day: number }> | null;
}>;

export type AisStudentAcademicProfile = Readonly<{
  academicSystem: string | null;
  division: string | null;
  college: string | null;
  department: string | null;
  yearLevel: number | null;
  className: string | null;
  studentNumber: string | null;
  name: string | null;
  enrollmentStatus: string | null;
  currentIdentity: string | null;
}>;

export type AisGradeSummary = Readonly<{
  exemptCredits: number | null;
  earnedCredits: number | null;
  attemptedCredits: number | null;
  currentAverageScore: number | null;
  historicalCumulativeCredits: number | null;
  classRank: AisAcademicRank | null;
  departmentRank: AisAcademicRank | null;
  rankPublicationSchedule: AisRankPublicationSchedule | null;
}>;

export type AisGradesResult = Readonly<{
  query: AisGradesQuery;
  courses: readonly AisCourseGrade[];
  conductGrades: readonly AisConductGrade[];
  profile: AisStudentAcademicProfile | null;
  summary: AisGradeSummary;
}>;

const maximumCourses = 500;
const maximumTextLength = 200;

export function parseAisGradesCallback(
  callback: string,
  query: AisGradesQuery,
): AisGradesResult {
  assertQuery(query);
  const payloads = gradeCallbackPayloads(callback);
  let lastError: unknown;
  let emptyResult: AisGradesResult | undefined;
  for (const payload of payloads) {
    try {
      const result = parseAisGradesHtml(payload, query);
      if (
        result.courses.length > 0 ||
        result.conductGrades.length > 0 ||
        result.profile !== null ||
        payloads.length === 1
      ) {
        return result;
      }
      emptyResult = result;
    } catch (error) {
      lastError = error;
    }
  }
  if (emptyResult !== undefined) return emptyResult;
  if (lastError instanceof Error) throw lastError;
  throw new AisProtocolError("invalid_callback_envelope");
}

function gradeCallbackPayloads(raw: string): readonly string[] {
  const deltas = [...raw.matchAll(/\|(\d+)\|updatePanel\|[^|]*\|/gu)];
  if (deltas.length === 0) return [unwrapAisCallbackOrHtml(raw)];
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

export function parseAisGradesHtml(
  html: string,
  query: AisGradesQuery,
): AisGradesResult {
  assertQuery(query);
  if (/GenericErrorPage\.htm/iu.test(html))
    throw new AisProtocolError("generic_error");

  const metadata = parseMetadata(html);
  if (
    /查無(?:符合)?資料|無資料|沒有資料/iu.test(html) ||
    isEmptyGradeTable(html)
  ) {
    return emptyGrades(query, metadata);
  }

  const rows = gradeGridRows(html, query);
  const headerRowIndex = rows.findIndex((row) => {
    const headers = rowCells(row).map(cellText);
    return isGradeHeaderRow(headers);
  });
  if (headerRowIndex < 0)
    throw new AisProtocolError("grades_grid_header_changed");

  const headers = rowCells(rows[headerRowIndex] ?? "").map(cellText);
  const indexes = {
    term: requireGradeHeader(
      headers,
      [/學年期/u, /學年度學期/u, /^學期$/u],
      "grades_term_header_changed",
    ),
    code: requireGradeHeader(
      headers,
      [/課號/u, /科目代碼/u],
      "grades_code_header_changed",
    ),
    classSection: requireGradeHeader(
      headers,
      [/開課班別/u, /開課班級/u, /^班別$/u],
      "grades_class_section_header_changed",
    ),
    credits: requireGradeHeader(
      headers,
      [/學分/u, /學分數/u],
      "grades_credits_header_changed",
    ),
    selection: requireGradeHeader(
      headers,
      [/選別/u, /必選修/u, /修別/u],
      "grades_selection_header_changed",
    ),
    title: requireGradeHeader(
      headers,
      [/課程名稱/u, /課名/u, /科目名稱/u, /^科目$/u],
      "grades_title_header_changed",
    ),
    instructor: findHeader(headers, [/教師/u]),
    provisional: findHeader(headers, [/暫存學期總成績/u, /暫存成績/u]),
    semester: requireGradeHeader(
      headers,
      [
        /^學期總成績$/u,
        /^學期成績$/u,
        /^總成績$/u,
        /^百分成績$/u,
        /^成績$/u,
        /^分數$/u,
        /^等第$/u,
      ],
      "grades_semester_header_changed",
    ),
    other: findHeader(headers, [/其他成績/u]),
  };

  const courses: AisCourseGrade[] = [];
  const conductGrades: AisConductGrade[] = [];
  const ids = new Set<string>();
  const conductTerms = new Set<string>();
  for (const row of rows.slice(headerRowIndex + 1)) {
    const cells = rowCells(row).map(cellText);
    if (cells.every((value) => value === "")) continue;
    const termId = cells[indexes.term] ?? "";
    const code = cells[indexes.code] ?? "";
    const title = cells[indexes.title] ?? "";
    if (!/^\d{3}[1-4]$/u.test(termId)) {
      throw new AisProtocolError("invalid_grade_row");
    }
    // The detail page returns full history after a semester-scoped search.
    // Validate every row's term, then project only the explicit API query.
    if (!matchesQuery(termId, query)) continue;
    if (code === "" && /操行/u.test(title)) {
      const score = gradeValue(cells[indexes.semester]);
      if (score === null || conductTerms.has(termId)) {
        throw new AisProtocolError("invalid_grade_row");
      }
      conductTerms.add(termId);
      conductGrades.push({ termId, score });
      continue;
    }
    if (code === "" || title === "") {
      throw new AisProtocolError("invalid_grade_row");
    }
    const selection = cells[indexes.selection] ?? "";
    const classSection = nullableField(cells[indexes.classSection], 80);
    const instructor =
      indexes.instructor >= 0
        ? nullableField(cells[indexes.instructor], maximumTextLength)
        : null;
    assertField(code, 80);
    assertField(title, maximumTextLength);
    assertField(selection, 80);
    if (courses.length >= maximumCourses)
      throw new AisProtocolError("invalid_grade_row");
    const id = `${termId}-${code}-${classSection ?? ""}`;
    if (ids.has(id)) throw new AisProtocolError("invalid_grade_row");
    ids.add(id);
    courses.push({
      id,
      termId,
      courseCode: code,
      classSection,
      courseTitle: title,
      credits: strictNumber(cells[indexes.credits] ?? "", 20),
      requirement: /必/u.test(selection)
        ? "required"
        : /選/u.test(selection)
          ? "elective"
          : "unknown",
      selection,
      instructor,
      provisionalScore:
        indexes.provisional >= 0
          ? gradeValue(cells[indexes.provisional])
          : null,
      semesterScore: gradeValue(cells[indexes.semester]),
      otherScore: indexes.other >= 0 ? gradeValue(cells[indexes.other]) : null,
    });
  }
  return { query, courses, conductGrades, ...metadata };
}

function emptyGrades(
  query: AisGradesQuery,
  metadata: Pick<AisGradesResult, "profile" | "summary">,
): AisGradesResult {
  return { query, courses: [], conductGrades: [], ...metadata };
}

function parseMetadata(
  html: string,
): Pick<AisGradesResult, "profile" | "summary"> {
  const ids = [
    "M_ASYS_NAME",
    "M_DEGREE_NAME",
    "M_COLLEGE_NAME",
    "M_FACULTY_NAME",
    "M_GRADE",
    "M_CLASSNO",
    "M_STNO",
    "M_CH_NAME",
    "M_STUDY_STATUS_NAME",
    "M_PRESENT_TYPE",
    "M_WARE_CRD",
    "M_PASS_CRD",
    "M_CRD_TOTAL",
    "M_AVG_MARK",
    "M_CRD",
    "M_CLASS_RANK",
    "M_FACULTY_RANK",
    "MLSMS_RANK_SDATE",
  ] as const;
  const values = new Map(ids.map((id) => [id, elementTextById(html, id)]));
  const present = [...values.values()].filter((value) => value !== undefined);
  if (present.length === 0) return emptyMetadata();
  if (present.length !== ids.length)
    throw new AisProtocolError("grades_metadata_contract_changed");

  const text = (id: (typeof ids)[number]): string | null =>
    nullableField(values.get(id), maximumTextLength);
  const numeric = (
    id: (typeof ids)[number],
    maximum: number,
  ): number | null => {
    const value = values.get(id)?.trim() ?? "";
    return value === "" ? null : strictNumber(value, maximum);
  };
  return {
    profile: {
      academicSystem: text("M_ASYS_NAME"),
      division: text("M_DEGREE_NAME"),
      college: text("M_COLLEGE_NAME"),
      department: text("M_FACULTY_NAME"),
      yearLevel: numeric("M_GRADE", 99),
      className: text("M_CLASSNO"),
      studentNumber: text("M_STNO"),
      name: text("M_CH_NAME"),
      enrollmentStatus: text("M_STUDY_STATUS_NAME"),
      currentIdentity: text("M_PRESENT_TYPE"),
    },
    summary: {
      exemptCredits: numeric("M_WARE_CRD", 2_000),
      earnedCredits: numeric("M_PASS_CRD", 2_000),
      attemptedCredits: numeric("M_CRD_TOTAL", 2_000),
      currentAverageScore: numeric("M_AVG_MARK", 100),
      historicalCumulativeCredits: numeric("M_CRD", 2_000),
      classRank: parseRank(values.get("M_CLASS_RANK") ?? ""),
      departmentRank: parseRank(values.get("M_FACULTY_RANK") ?? ""),
      rankPublicationSchedule: parseRankSchedule(
        values.get("MLSMS_RANK_SDATE") ?? "",
      ),
    },
  };
}

function emptyMetadata(): Pick<AisGradesResult, "profile" | "summary"> {
  return {
    profile: null,
    summary: {
      exemptCredits: null,
      earnedCredits: null,
      attemptedCredits: null,
      currentAverageScore: null,
      historicalCumulativeCredits: null,
      classRank: null,
      departmentRank: null,
      rankPublicationSchedule: null,
    },
  };
}

function elementTextById(html: string, id: string): string | undefined {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const paired = new RegExp(
    `<([a-z][a-z0-9:-]*)\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "iu",
  ).exec(html);
  if (paired !== null) return cellText(paired[2] ?? "");
  const input = new RegExp(
    `<input\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>`,
    "iu",
  ).exec(html)?.[0];
  return input === undefined
    ? undefined
    : decodeAttribute(input.match(/\bvalue=["']([^"']*)/iu)?.[1] ?? "");
}

function parseRank(value: string): AisAcademicRank | null {
  const match = value.trim().match(/^(\d+)\s*[/／]\s*(\d+)$/u);
  if (match === null) return null;
  const position = Number(match[1]);
  const cohortSize = Number(match[2]);
  if (
    !Number.isSafeInteger(position) ||
    !Number.isSafeInteger(cohortSize) ||
    position < 1 ||
    cohortSize < position ||
    cohortSize > 100_000
  ) {
    return null;
  }
  return { position, cohortSize };
}

function parseRankSchedule(value: string): AisRankPublicationSchedule | null {
  const display = nullableField(value, maximumTextLength);
  if (display === null) return null;
  const match = display.match(
    /^\((\d{3}[1-4])學年期\)(\d{3})\/(\d{1,2})\/(\d{1,2})$/u,
  );
  if (match === null) return { display, termId: null, rocDate: null };
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const validDate = month >= 1 && month <= 12 && day >= 1 && day <= 31;
  return {
    display,
    termId: match[1] ?? null,
    rocDate: validDate ? { year, month, day } : null,
  };
}

function matchesQuery(termId: string, query: AisGradesQuery): boolean {
  if (!/^\d{3}[1-4]$/u.test(termId)) return false;
  if (query.kind === "history") return true;
  if (query.kind === "semester") return termId === query.termId;
  return termId.startsWith(String(query.rocYear));
}

function assertQuery(query: AisGradesQuery): void {
  try {
    assertAisGradesQuery(query);
  } catch {
    throw new AisProtocolError("invalid_callback_envelope");
  }
}

function gradeGridRows(html: string, query: AisGradesQuery): readonly string[] {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)].map(
    (match) => match[1] ?? "",
  );
  for (const table of tables) {
    const rows = tableRows(table);
    if (rows.some((row) => isGradeHeaderRow(rowCells(row).map(cellText)))) {
      return rows;
    }
  }
  const pageText = cellText(html);
  if (
    /查無|尚無/u.test(pageText) ||
    /沒有.{0,12}(?:成績|資料)/u.test(pageText) ||
    /there is no matching data/iu.test(pageText)
  ) {
    throw new AisProtocolError("grades_no_data_message_changed");
  }
  if (/<form\b/iu.test(html) && /RB_TYPE_1|QUERY_BTN/iu.test(html)) {
    if (
      query.kind === "semester" &&
      responseQueryValue(html, "Q_AYEARSMS") !== query.termId
    ) {
      throw new AisProtocolError("grades_query_term_not_applied");
    }
    if (hasUnrecognizedGradeResultTable(tables, html)) {
      throw new AisProtocolError("grades_result_table_unrecognized");
    }
    throw new AisProtocolError("grades_query_result_missing");
  }
  const hasTitle = /課程名稱|課名|科目名稱|科目/u.test(pageText);
  const hasScore = /學期成績|學期總成績|總成績|百分成績|成績|分數|等第/u.test(
    pageText,
  );
  if (hasScore && !hasTitle) {
    throw new AisProtocolError("grades_title_header_changed");
  }
  if (hasTitle && !hasScore) {
    throw new AisProtocolError("grades_semester_header_changed");
  }
  if (tables.length === 0) throw new AisProtocolError("missing_table");
  throw new AisProtocolError("grades_grid_header_changed");
}

function hasUnrecognizedGradeResultTable(
  tables: readonly string[],
  html: string,
): boolean {
  if (
    /\bdata-th\s*=\s*(["'])[^"']*(?:課|科目|學分|成績|分數|等第)[^"']*\1/iu.test(
      html,
    )
  ) {
    return true;
  }
  return tables.some((table) => {
    const rows = tableRows(table);
    return rows.length >= 2 && rows.some((row) => rowCells(row).length >= 4);
  });
}

function responseQueryValue(html: string, name: string): string | null {
  for (const match of html.matchAll(/<input\b[^>]*>/giu)) {
    const tag = match[0];
    const controlName = decodeAttribute(
      tag.match(/\bname\s*=\s*(["'])(.*?)\1/iu)?.[2] ?? "",
    );
    if (controlName !== name) continue;
    return decodeAttribute(
      tag.match(/\bvalue\s*=\s*(["'])(.*?)\1/iu)?.[2] ?? "",
    );
  }
  return null;
}

function isGradeHeaderRow(headers: readonly string[]): boolean {
  const title = findHeader(headers, [
    /課程名稱/u,
    /課名/u,
    /科目名稱/u,
    /^科目$/u,
  ]);
  const score = findHeader(headers, [
    /學期成績/u,
    /學期總成績/u,
    /總成績/u,
    /百分成績/u,
    /^成績$/u,
    /^分數$/u,
    /等第/u,
  ]);
  return title >= 0 && score >= 0;
}

function requireGradeHeader(
  headers: readonly string[],
  patterns: readonly RegExp[],
  code: AisProtocolFailureCode,
): number {
  const index = findHeader(headers, patterns);
  if (index < 0) throw new AisProtocolError(code);
  return index;
}

function isEmptyGradeTable(html: string): boolean {
  const tables = [
    ...html.matchAll(
      /<table\b(?=[^>]*\bid=["']DataGrid["'])[^>]*>([\s\S]*?)<\/table>/giu,
    ),
  ].map((match) => match[1] ?? "");
  return (
    tables.length > 0 &&
    tables.every((table) => {
      const rows = tableRows(table);
      if (rows.length === 0 || rows.length > 2) return false;
      const cells = rows.flatMap((row) => rowCells(row).map(cellText));
      return cells.length <= 4 && cells.every((value) => value.length <= 32);
    }) &&
    !tables.some((table) =>
      tableRows(table).some((row) => {
        const headers = rowCells(row).map(cellText);
        return (
          findHeader(headers, [/學年期/u]) >= 0 &&
          findHeader(headers, [/課號/u]) >= 0
        );
      }),
    )
  );
}

function strictNumber(value: string, maximum: number): number {
  if (!/^\d+(?:\.\d+)?$/u.test(value.trim()))
    throw new AisProtocolError("invalid_credits");
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum) {
    throw new AisProtocolError("invalid_credits");
  }
  return number;
}

function gradeValue(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if ([...normalized].length > 40)
    throw new AisProtocolError("invalid_grade_value");
  return normalized;
}

function nullableField(
  value: string | undefined,
  maximumLength: number,
): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if ([...normalized].length > maximumLength)
    throw new AisProtocolError("invalid_grade_value");
  return normalized;
}

function assertField(value: string, maximumLength: number): void {
  if (value === "" || [...value].length > maximumLength) {
    throw new AisProtocolError("invalid_grade_row");
  }
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

import { unwrapAisCallback } from "./callback.js";
import { cellText, normalizeText, tableById, tableRows } from "./html-table.js";
import {
  legacyCourseRequirement,
  parseAisCourseRequirement,
  type CourseRequirementKind,
} from "./course-requirement.js";
import { AisProtocolError } from "./protocol-error.js";

export type AisCatalogCourse = Readonly<{
  id: string;
  identityKey: string;
  termId: string;
  serial: number;
  courseCode: string;
  courseTitle: string;
  department: string;
  section: string;
  instructors: readonly string[];
  teacherDepartment: string | null;
  englishMedium: boolean;
  credits: number;
  requirement: "required" | "elective" | "unknown";
  requirementKind?: CourseRequirementKind;
  requirementRawCode?: string | null;
  requirementRawLabel?: string;
  enrollment: number;
  enrollmentLimitDisplay: string;
  practicum: string | null;
  hours: number;
  coTeaching: number;
  duration: string | null;
  detailEventTarget: string;
}>;

const expectedHeaders = [
  "序號",
  "學期",
  "課號",
  "課名",
  "開課單位",
  "年級班別",
  "授課老師",
  "老師單位",
  "全程英語",
  "學分",
  "選別",
  "人數",
  "人數限制上／下限",
  "實習",
  "時數",
  "合開",
  "期限",
] as const;

type ParsedCell = Readonly<{
  attributes: ReadonlyMap<string, string>;
  html: string;
}>;

/** Parse only the evidenced TKE2210 QUERY_BTN1 17-column DataGrid. */
export function parseAisCourseCatalogCallback(
  raw: string,
  snapshotFingerprint: string,
  partitionFingerprint: string,
): readonly AisCatalogCourse[] {
  const html = unwrapAisCallback(raw);
  if (/GenericErrorPage\.htm/iu.test(html))
    throw new AisProtocolError("generic_error");
  const rows = tableRows(tableById(html, "DataGrid"));
  if (rows.length === 0)
    throw new AisProtocolError("course_catalog_header_changed");
  const header = cellsWithAttributes(rows[0] ?? "");
  if (isExactEmptyResult(header, rows)) return [];
  const headerLabels = header.map((cell) => cellText(cell.html));
  assertExactLabelSet(headerLabels, "course_catalog_header_changed");
  assertIdentityToken(snapshotFingerprint);
  assertIdentityToken(partitionFingerprint);

  const courses: AisCatalogCourse[] = [];
  for (const row of rows.slice(1)) {
    const cells = cellsWithAttributes(row);
    if (cells.length === 0) continue;
    if (cells.length !== expectedHeaders.length) {
      throw new AisProtocolError("invalid_course_catalog_row");
    }
    const labels = cells.map((cell) => cell.attributes.get("data-th") ?? "");
    assertExactLabelSet(labels, "course_catalog_row_labels_changed");
    const cellsByLabel = new Map(
      labels.map((label, index) => [label, cells[index]!]),
    );
    const value = (label: (typeof expectedHeaders)[number]): string =>
      cellText(cellsByLabel.get(label)?.html ?? "");
    const serial = parseInteger(value("序號"), 1, 9999);
    const termId = requiredText(value("學期"));
    if (!/^\d{4}$/u.test(termId)) invalidValue();
    const courseCode = requiredText(value("課號"));
    const courseTitle = requiredText(value("課名"));
    const department = requiredText(value("開課單位"));
    const section = requiredText(value("年級班別"));
    const instructor = nullableText(value("授課老師"));
    const teacherDepartment = nullableText(value("老師單位"));
    const selection = requiredText(value("選別"));
    const parsedRequirement = parseAisCourseRequirement(selection);
    const identityKey = `${termId}|${courseCode}|${department}|${section}`;
    const detailEventTarget = parseDetailEventTarget(
      cellsByLabel.get("課號")?.html ?? "",
    );
    courses.push({
      id: `catalog-${termId}-${stableDigest(identityKey)}`,
      identityKey,
      termId,
      serial,
      courseCode,
      courseTitle,
      department,
      section,
      instructors: instructor === null ? [] : [instructor],
      teacherDepartment,
      englishMedium: parseBoolean(value("全程英語")),
      credits: parseNumber(value("學分"), 0, 20),
      requirement: legacyCourseRequirement(parsedRequirement.kind),
      requirementKind: parsedRequirement.kind,
      requirementRawCode: parsedRequirement.rawCode,
      requirementRawLabel: parsedRequirement.rawLabel,
      enrollment: parseInteger(value("人數"), 0, 99_999),
      // The observed heading/value order is not sufficient evidence to infer
      // which number is a minimum or maximum; preserve the validated display.
      enrollmentLimitDisplay: parseCapacity(value("人數限制上／下限")),
      practicum: nullableText(value("實習")),
      hours: parseInteger(value("時數"), 0, 999),
      coTeaching: parseInteger(value("合開"), 0, 999),
      duration: nullableText(value("期限")),
      detailEventTarget,
    });
  }
  return courses;
}

function assertExactLabelSet(
  labels: readonly string[],
  code: "course_catalog_header_changed" | "course_catalog_row_labels_changed",
): void {
  const actual = new Set(labels);
  if (
    labels.length !== expectedHeaders.length ||
    actual.size !== expectedHeaders.length ||
    expectedHeaders.some((label) => !actual.has(label))
  ) {
    throw new AisProtocolError(code);
  }
}

function parseDetailEventTarget(html: string): string {
  const decoded = html
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/&amp;/giu, "&");
  const target = decoded.match(
    /__doPostBack\(['"](DataGrid\$ctl\d{2,4}\$COSID)['"]/u,
  )?.[1];
  if (target === undefined)
    throw new AisProtocolError("course_detail_target_changed");
  return target;
}

function isExactEmptyResult(
  header: readonly ParsedCell[],
  rows: readonly string[],
): boolean {
  return (
    rows.length === 1 &&
    header.length === 1 &&
    cellText(header[0]?.html ?? "") === "查無符合資料!!"
  );
}

function cellsWithAttributes(row: string): readonly ParsedCell[] {
  return [...row.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/giu)].map(
    (match) => ({
      attributes: parseAttributes(match[1] ?? ""),
      html: match[2] ?? "",
    }),
  );
}

function parseAttributes(value: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of value.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu,
  )) {
    const name = (match[1] ?? "").toLowerCase();
    if (name !== "" && !attributes.has(name)) {
      attributes.set(
        name,
        normalizeText(match[2] ?? match[3] ?? match[4] ?? ""),
      );
    }
  }
  return attributes;
}

function requiredText(value: string | undefined): string {
  const normalized = normalizeText(value ?? "");
  if (normalized === "" || [...normalized].length > 200) invalidValue();
  return normalized;
}

function nullableText(value: string | undefined): string | null {
  const normalized = normalizeText(value ?? "");
  if ([...normalized].length > 200) invalidValue();
  return normalized === "" ? null : normalized;
}

function parseInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number {
  const normalized = normalizeText(value ?? "");
  if (!/^\d+$/u.test(normalized)) invalidValue();
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    invalidValue();
  return parsed;
}

function parseNumber(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number {
  const normalized = normalizeText(value ?? "");
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) invalidValue();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum)
    invalidValue();
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  const normalized = normalizeText(value ?? "").toLowerCase();
  if (["是", "y", "yes", "true", "1"].includes(normalized)) return true;
  if (["否", "n", "no", "false", "0"].includes(normalized)) return false;
  invalidValue();
}

function parseCapacity(value: string | undefined): string {
  const normalized = normalizeText(value ?? "");
  if (!/^\d{1,5}(?:\s*[/／~～-]\s*\d{1,5})?$/u.test(normalized)) invalidValue();
  return normalized;
}

function stableDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function assertIdentityToken(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new AisProtocolError("course_catalog_contract_changed");
  }
}

function invalidValue(): never {
  throw new AisProtocolError("invalid_course_catalog_value");
}

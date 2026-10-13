import { unwrapAisCallbackOrHtml } from "./callback.js";
import {
  cellLines,
  cellText,
  findHeader,
  normalizeText,
  requireHeader,
  rowCells,
  tableById,
  tableRows,
} from "./html-table.js";
import { AisProtocolError } from "./protocol-error.js";

export type AisTimetableSlot = Readonly<{
  id: string;
  termId: string;
  courseCode: string;
  courseTitle: string;
  department: string;
  section: string;
  credits: number;
  requirement: "required" | "elective" | "generalEducation" | "unknown";
  instructor: string | null;
  instructorDepartment: string | null;
  enrollment: number;
  enrollmentLimitDisplay: string;
  practicum: string | null;
  hours: number;
  coTeaching: boolean;
  duration: string | null;
  classroom: string | null;
  weekday: number;
  periodId: string;
}>;

export type AisTimetablePeriod = Readonly<{
  id: string;
  label: string;
  order: number;
  startsAt: AisTimetableClockTime | null;
  endsAt: AisTimetableClockTime | null;
}>;

export type AisTimetableClockTime = Readonly<{
  hour: number;
  minute: number;
}>;

type CourseMetadata = Readonly<{
  termId: string;
  code: string;
  title: string;
  department: string;
  section: string;
  credits: number;
  requirement: AisTimetableSlot["requirement"];
  instructor: string | null;
  instructorDepartment: string | null;
  enrollment: number;
  enrollmentLimitDisplay: string;
  practicum: string | null;
  hours: number;
  coTeaching: boolean;
  duration: string | null;
}>;

const maximumTimetableSlots = 500;

export function parseAisTimetableCallbacks(
  courseListCallbacks: string | readonly string[],
  timetableCallback: string,
  expectedTermId: string,
): readonly AisTimetableSlot[] {
  if (!/^\d{3}[1-2]$/u.test(expectedTermId)) {
    throw new AisProtocolError("invalid_callback_envelope");
  }
  const callbacks =
    typeof courseListCallbacks === "string"
      ? [courseListCallbacks]
      : courseListCallbacks;
  if (callbacks.length === 0)
    throw new AisProtocolError("missing_course_metadata");

  const courses = parseCourseMetadata(
    callbacks.map(unwrapAisCallbackOrHtml),
    expectedTermId,
  );
  const rows = tableRows(
    tableById(unwrapAisCallbackOrHtml(timetableCallback), "table2"),
  );
  if (rows.length === 0) throw new AisProtocolError("invalid_table_row");
  assertTimetableGridHeader(rows[0] ?? "");

  const slots: AisTimetableSlot[] = [];
  const periodIds = new Set<string>();
  for (const row of rows.slice(1)) {
    const cells = rowCells(row);
    if (cells.length < 8) throw new AisProtocolError("invalid_table_row");
    const periodId = parsePeriodCell(cells[0] ?? "").id;
    if (
      periodId === "" ||
      [...periodId].length > 24 ||
      periodIds.has(periodId)
    ) {
      throw new AisProtocolError("invalid_table_row");
    }
    periodIds.add(periodId);
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const cell = cells[dayIndex + 1];
      if (cell === undefined) throw new AisProtocolError("invalid_table_row");
      const anchors = [...cell.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/giu)].map(
        (match) => match[1] ?? "",
      );
      for (const source of anchors.length > 0 ? anchors : [cell]) {
        const lines = cellLines(source);
        const title = lines[0] ?? "";
        const code = lines[1] ?? "";
        if (title === "" && code === "") continue;
        if (
          lines.length < 4 ||
          !bounded(lines[2] ?? "", 120) ||
          !bounded(lines[3] ?? "", 80)
        ) {
          throw new AisProtocolError("invalid_timetable_slot");
        }
        const metadata =
          courses.get(courseKey(code)) ?? courses.get(courseKey(title));
        if (metadata === undefined)
          throw new AisProtocolError("missing_course_metadata");
        const stableCode = metadata.code || code || title;
        slots.push({
          id: `${stableCode}-${dayIndex + 1}-${periodId}`,
          termId: metadata.termId,
          courseCode: metadata.code || code,
          courseTitle: metadata.title || title,
          department: metadata.department,
          section: metadata.section,
          credits: metadata.credits,
          requirement: metadata.requirement,
          instructor: metadata.instructor,
          instructorDepartment: metadata.instructorDepartment,
          enrollment: metadata.enrollment,
          enrollmentLimitDisplay: metadata.enrollmentLimitDisplay,
          practicum: metadata.practicum,
          hours: metadata.hours,
          coTeaching: metadata.coTeaching,
          duration: metadata.duration,
          classroom: lines[4] || null,
          weekday: dayIndex + 1,
          periodId,
        });
      }
    }
  }
  assertSlots(slots);
  return slots;
}

export function parseAisTimetablePeriods(
  timetableCallback: string,
): readonly AisTimetablePeriod[] {
  const rows = tableRows(
    tableById(unwrapAisCallbackOrHtml(timetableCallback), "table2"),
  );
  if (rows.length === 0) throw new AisProtocolError("invalid_table_row");
  assertTimetableGridHeader(rows[0] ?? "");
  const periods = rows.slice(1).map((row, order) => {
    const cells = rowCells(row);
    if (cells.length < 8) throw new AisProtocolError("invalid_table_row");
    return { ...parsePeriodCell(cells[0] ?? ""), order };
  });
  if (
    periods.length > 100 ||
    new Set(periods.map((period) => period.id)).size !== periods.length
  ) {
    throw new AisProtocolError("invalid_table_row");
  }
  return periods;
}

function parseCourseMetadata(
  htmlPages: readonly string[],
  expectedTermId: string,
): ReadonlyMap<string, CourseMetadata> {
  const courses = new Map<string, CourseMetadata>();
  for (const html of htmlPages) {
    const rows = tableRows(tableById(html, "DataGrid"));
    const headerRowIndex = rows.findIndex((row) => {
      const headers = rowCells(row).map(cellText);
      return (
        findHeader(headers, [/課號/u]) >= 0 &&
        findHeader(headers, [/課名/u, /課程名稱/u, /科目名稱/u]) >= 0
      );
    });
    if (headerRowIndex < 0)
      throw new AisProtocolError("missing_required_header");

    const headers = rowCells(rows[headerRowIndex] ?? "").map(cellText);
    const termIndex = requireHeader(headers, [/學期/u]);
    const codeIndex = requireHeader(headers, [/課號/u]);
    const titleIndex = requireHeader(headers, [
      /課名/u,
      /課程名稱/u,
      /科目名稱/u,
    ]);
    const creditsIndex = requireHeader(headers, [/學分/u]);
    const departmentIndex = requireHeader(headers, [/開課系所/u, /開課單位/u]);
    const sectionIndex = requireHeader(headers, [/班別/u, /開課班別/u]);
    const selectionIndex = requireHeader(headers, [
      /選別/u,
      /必選修/u,
      /修別/u,
    ]);
    const instructorIndex = requireHeader(headers, [
      /^教師(?:姓名)?$/u,
      /^授課(?:教師|老師)$/u,
    ]);
    const instructorDepartmentIndex = requireHeader(headers, [/^老師單位$/u]);
    const enrollmentIndex = requireHeader(headers, [/^人數$/u]);
    const enrollmentLimitIndex = requireHeader(headers, [
      /^人數限制上[／/]下限$/u,
    ]);
    const practicumIndex = requireHeader(headers, [/^實習$/u]);
    const hoursIndex = requireHeader(headers, [/^時數$/u]);
    const coTeachingIndex = requireHeader(headers, [/^合開$/u]);
    const durationIndex = requireHeader(headers, [/^期限$/u]);
    const serialIndex = requireHeader(headers, [/^(?:序號|流水號)$/u]);
    const requiredIndexes = [
      serialIndex,
      termIndex,
      codeIndex,
      titleIndex,
      departmentIndex,
      sectionIndex,
      instructorIndex,
      instructorDepartmentIndex,
      creditsIndex,
      selectionIndex,
      enrollmentIndex,
      enrollmentLimitIndex,
      practicumIndex,
      hoursIndex,
      coTeachingIndex,
      durationIndex,
    ];
    if (
      headers.length !== requiredIndexes.length ||
      new Set(requiredIndexes).size !== requiredIndexes.length
    ) {
      throw new AisProtocolError("missing_required_header");
    }

    for (const row of rows.slice(headerRowIndex + 1)) {
      const cells = rowCells(row).map(cellText);
      if (cells.length !== headers.length) {
        throw new AisProtocolError("invalid_table_row");
      }
      const termId = cells[termIndex] ?? "";
      const code = cells[codeIndex] ?? "";
      const title = cells[titleIndex] ?? "";
      const department = cells[departmentIndex] ?? "";
      const section = cells[sectionIndex] ?? "";
      if (code === "" && title === "") continue;
      if (
        code === "" ||
        title === "" ||
        termId !== expectedTermId ||
        !bounded(department, 120) ||
        !bounded(section, 80)
      )
        throw new AisProtocolError("invalid_timetable_slot");
      const selection = cells[selectionIndex] ?? "";
      strictInteger(cells[serialIndex] ?? "", 1, 9999);
      const metadata: CourseMetadata = {
        termId,
        code,
        title,
        department,
        section,
        credits: strictCredits(cells[creditsIndex] ?? ""),
        requirement: /必/u.test(selection)
          ? "required"
          : /選/u.test(selection)
            ? "elective"
            : /通識/u.test(selection)
              ? "generalEducation"
              : "unknown",
        instructor:
          (cells[instructorIndex] ?? "") !== ""
            ? (cells[instructorIndex] ?? null)
            : null,
        instructorDepartment: nullableMetadata(
          cells[instructorDepartmentIndex] ?? "",
          120,
        ),
        enrollment: strictInteger(cells[enrollmentIndex] ?? "", 0, 99_999),
        enrollmentLimitDisplay: strictEnrollmentLimit(
          cells[enrollmentLimitIndex] ?? "",
        ),
        practicum: nullableMetadata(cells[practicumIndex] ?? "", 80),
        hours: strictInteger(cells[hoursIndex] ?? "", 0, 999),
        coTeaching: strictBoolean(cells[coTeachingIndex] ?? ""),
        duration: nullableMetadata(cells[durationIndex] ?? "", 80),
      };
      courses.set(courseKey(code), metadata);
      courses.set(courseKey(title), metadata);
    }
  }
  return courses;
}

function assertTimetableGridHeader(row: string): void {
  const headers = rowCells(row).map(cellText);
  const expectedWeekdays = [
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六",
    "星期日",
  ];
  if (
    headers.length !== 8 ||
    !["", "節次"].includes(headers[0] ?? "") ||
    expectedWeekdays.some((label, index) => headers[index + 1] !== label)
  ) {
    throw new AisProtocolError("missing_required_header");
  }
}

function assertSlots(slots: readonly AisTimetableSlot[]): void {
  if (slots.length > maximumTimetableSlots)
    throw new AisProtocolError("invalid_timetable_slot");
  const ids = new Set<string>();
  for (const slot of slots) {
    if (
      !bounded(slot.id, 160) ||
      ids.has(slot.id) ||
      !bounded(slot.courseCode, 80) ||
      !bounded(slot.courseTitle, 200) ||
      !Number.isFinite(slot.credits) ||
      slot.credits < 0 ||
      slot.credits > 20 ||
      !nullableBounded(slot.instructor, 200) ||
      !nullableBounded(slot.instructorDepartment, 120) ||
      !Number.isSafeInteger(slot.enrollment) ||
      slot.enrollment < 0 ||
      slot.enrollment > 99_999 ||
      !bounded(slot.enrollmentLimitDisplay, 80) ||
      !nullableBounded(slot.practicum, 80) ||
      !Number.isSafeInteger(slot.hours) ||
      slot.hours < 0 ||
      slot.hours > 999 ||
      !nullableBounded(slot.duration, 80) ||
      !nullableBounded(slot.classroom, 200) ||
      !Number.isInteger(slot.weekday) ||
      slot.weekday < 1 ||
      slot.weekday > 7 ||
      !bounded(slot.termId, 4) ||
      !bounded(slot.department, 120) ||
      !bounded(slot.section, 80) ||
      !bounded(slot.periodId, 24)
    ) {
      throw new AisProtocolError("invalid_timetable_slot");
    }
    ids.add(slot.id);
  }
}

function parsePeriodCell(html: string): Omit<AisTimetablePeriod, "order"> {
  const lines = cellLines(html);
  const label = lines[0] ?? "";
  if (!bounded(label, 40)) throw new AisProtocolError("invalid_table_row");
  const id = canonicalPeriodId(label);
  if (lines.length === 1) {
    return { id, label, startsAt: null, endsAt: null };
  }
  if (lines.length !== 4 || lines[2] !== "~") {
    throw new AisProtocolError("invalid_table_row");
  }
  const startsAt = strictClockTime(lines[1] ?? "");
  const endsAt = strictClockTime(lines[3] ?? "");
  if (
    startsAt.hour * 60 + startsAt.minute >=
    endsAt.hour * 60 + endsAt.minute
  ) {
    throw new AisProtocolError("invalid_table_row");
  }
  return { id, label, startsAt, endsAt };
}

function canonicalPeriodId(label: string): string {
  const token = label.match(/^第?\s*([^\s第節]+)\s*節$/u)?.[1] ?? label;
  const normalized = String.fromCodePoint(
    ...[...token].map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0xff10 && code <= 0xff19 ? code - 0xfee0 : code;
    }),
  );
  if (/^\d{1,2}$/u.test(normalized)) return String(Number(normalized));
  const chinese = new Map<string, number>([
    ["零", 0],
    ["〇", 0],
    ["一", 1],
    ["二", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
    ["十", 10],
    ["十一", 11],
    ["十二", 12],
    ["十三", 13],
    ["十四", 14],
  ]).get(normalized);
  if (chinese !== undefined) return String(chinese);
  if (!bounded(normalized, 24)) throw new AisProtocolError("invalid_table_row");
  return normalized;
}

function strictClockTime(value: string): AisTimetableClockTime {
  const match = value.match(/^(\d{1,2}):(\d{2})$/u);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (
    match === null ||
    !Number.isSafeInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isSafeInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new AisProtocolError("invalid_table_row");
  }
  return { hour, minute };
}

function strictInteger(
  value: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d+$/u.test(value.trim())) {
    throw new AisProtocolError("invalid_timetable_slot");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AisProtocolError("invalid_timetable_slot");
  }
  return parsed;
}

function strictEnrollmentLimit(value: string): string {
  const normalized = normalizeText(value);
  if (
    [...normalized].length > 80 ||
    !/^\d{1,5}(?:\s*[/／~～-]\s*\d{1,5})?$/u.test(normalized)
  ) {
    throw new AisProtocolError("invalid_timetable_slot");
  }
  return normalized;
}

function strictBoolean(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (["是", "y", "yes", "true", "1"].includes(normalized)) return true;
  if (["否", "n", "no", "false", "0"].includes(normalized)) return false;
  throw new AisProtocolError("invalid_timetable_slot");
}

function nullableMetadata(value: string, maximumLength: number): string | null {
  const normalized = normalizeText(value);
  if ([...normalized].length > maximumLength) {
    throw new AisProtocolError("invalid_timetable_slot");
  }
  return normalized === "" ? null : normalized;
}

function bounded(value: string, maximumLength: number): boolean {
  return value.trim().length > 0 && [...value].length <= maximumLength;
}

function nullableBounded(value: string | null, maximumLength: number): boolean {
  return value === null || bounded(value, maximumLength);
}

function courseKey(value: string): string {
  return normalizeText(value)
    .normalize("NFKC")
    .toLocaleUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function strictCredits(value: string): number {
  if (!/^\d+(?:\.\d+)?$/u.test(value.trim()))
    throw new AisProtocolError("invalid_credits");
  const credits = Number(value);
  if (!Number.isFinite(credits) || credits < 0 || credits > 20) {
    throw new AisProtocolError("invalid_credits");
  }
  return credits;
}

import { interpretCourseReferenceMaterial } from "../../application/course-reference-material.js";
import {
  decodeHtml,
  normalizeMultilineText,
  normalizeText,
} from "./html-table.js";
import {
  parseAisCourseRequirement,
  type CourseRequirementKind,
} from "./course-requirement.js";
import { AisProtocolError } from "./protocol-error.js";

export type AisCourseMeetingSlot = Readonly<{
  sourceCode: string;
  weekday: number;
  periodCode: string;
  room: string | null;
}>;

export type AisCourseDetailWarning = Readonly<{
  field: string;
  code:
    | "control_missing"
    | "invalid_format"
    | "out_of_range"
    | "unknown_value"
    | "value_too_long"
    | "cardinality_mismatch"
    | "inconsistent_value";
  observedValue: string;
}>;

export type AisBilingualText = Readonly<{
  zh: string | null;
  en: string | null;
}>;

export type AisCourseDetail = Readonly<{
  processedTermId: string;
  termId: string;
  courseCode: string;
  courseTitle: string;
  englishTitle: string | null;
  department: string;
  section: string;
  instructorsDisplay: string | null;
  crossDepartment: boolean | null;
  credits: number | null;
  hours: number | null;
  maximumEnrollment: number | null;
  minimumEnrollment: number | null;
  englishMedium: boolean | null;
  requirementDisplay: string | null;
  requirementKind: CourseRequirementKind;
  requirementRawCode: string | null;
  requirementRawLabel: string | null;
  durationDisplay: string | null;
  practicumDisplay: string | null;
  meetingSlots: readonly AisCourseMeetingSlot[];
  scheduleStatus: "complete" | "partial" | "not_scheduled" | "unknown";
  distanceLearningDisplay: string | null;
  primaryArea: string | null;
  secondaryArea: string | null;
  enrollment: number | null;
  enrollmentNote: string | null;
  graduateLevelsCombined: boolean | null;
  description: string | null;
  remark: string | null;
  notes: readonly string[];
  coInstructorsDisplay: string | null;
  coreCompetencies: string | null;
  objective: AisBilingualText;
  prerequisites: AisBilingualText;
  outline: AisBilingualText;
  teachingMethod: AisBilingualText;
  references: AisBilingualText;
  syllabus: AisBilingualText;
  evaluation: AisBilingualText;
  referenceText: string | null;
  referenceLinks: readonly string[];
  sustainableDevelopmentGoals: readonly string[];
  featureDomains: readonly string[];
  curriculumAttribute: string | null;
  sourceReference: Readonly<{
    pkno: string;
    rowstamp: string | null;
  }>;
  warnings: readonly AisCourseDetailWarning[];
}>;

const identityControlIds = [
  "M_AYEARSMS",
  "AYEARSMS",
  "M_COSID",
  "CH_LESSON",
  "M_FACULTY_NAME",
  "M_GRADE",
] as const;

const optionalControlIds = [
  "M_LECTR_TCH_CH",
  "M_IS_CROSS_FACULTY_MERGE",
  "M_ENG_LESSON",
  "M_CRD",
  "M_LECTR_HOUR",
  "M_MAX_ST",
  "M_MIN_ST",
  "M_COS_ENGLISH_FG",
  "M_MUST",
  "M_COSTERM",
  "M_CLASS_LAB",
  "M_SEG",
  "M_CLSSRM_ID",
  "M_IS_LONGDIST_CURRI",
  "M_MAIN_NAME",
  "M_CHILD_NAME",
  "M_CHOICE_QTY",
  "M_IS_MAST_DOCTOR_MERGE",
  "M_DESCRIPTION",
  "M_RMK",
  "TCH_NAME_LIST",
  "L_CORE_ABILITY",
  "M_CH_TARGET",
  "M_ENG_TARGET",
  "M_CH_PREOBJ",
  "M_ENG_PREOBJ",
  "M_CH_OBJECT",
  "M_ENG_OBJECT",
  "M_CH_TEACH",
  "M_ENG_TEACH",
  "M_CH_REF",
  "M_ENG_REF",
  "M_CH_TEACHSCH",
  "M_ENG_TEACHSCH",
  "M_CH_TYPE",
  "M_ENG_TYPE",
  "M_DOWNLOAD_ADDR",
  "L_SUSTAINABLE_DEVE_GOAL",
  "L_TRAIT_DOMAIN",
  "M_CURRI_EXPL",
  "ROWSTAMP",
] as const;

const maximumWarningCount = 100;

const richTextIds = new Set<string>([
  "M_DESCRIPTION",
  "M_RMK",
  "M_CH_TARGET",
  "M_ENG_TARGET",
  "M_CH_PREOBJ",
  "M_ENG_PREOBJ",
  "M_CH_OBJECT",
  "M_ENG_OBJECT",
  "M_CH_TEACH",
  "M_ENG_TEACH",
  "M_CH_REF",
  "M_ENG_REF",
  "M_CH_TEACHSCH",
  "M_ENG_TEACHSCH",
  "M_CH_TYPE",
  "M_ENG_TYPE",
]);

/** Parse the evidenced TKE2240_03 detail leaf by stable control IDs. */
export function parseAisCourseDetailPage(html: string): AisCourseDetail {
  const pkno = html.match(
    /<form\b[^>]*\baction=["'][^"']*TKE2240_03\.aspx\?PKNO=(\d{1,12})["']/iu,
  )?.[1];
  if (pkno === undefined) {
    throw new AisProtocolError("course_detail_contract_changed");
  }
  const warnings: AisCourseDetailWarning[] = [];
  const missingControls = new Set<string>();
  const values = new Map<string, string>();
  for (const id of identityControlIds) {
    values.set(id, requiredControlValueById(html, id));
  }
  for (const id of optionalControlIds) {
    const value = controlValueById(html, id);
    if (value === null) {
      missingControls.add(id);
      warn(warnings, id, "control_missing", "");
      values.set(id, "");
    } else {
      values.set(id, value);
    }
  }

  const processedTermId = term(values, "M_AYEARSMS");
  const termId = term(values, "AYEARSMS");
  if (processedTermId !== termId)
    throw new AisProtocolError("course_detail_term_mismatch");

  const timeCodes = commaList(values.get("M_SEG") ?? "", true);
  const rooms = commaList(values.get("M_CLSSRM_ID") ?? "", true);
  const meetingSlots: AisCourseMeetingSlot[] = [];
  for (const [index, sourceCode] of timeCodes.entries()) {
    const parsed = /^(?<weekday>[1-7])(?<period>[0-9A-Z]{1,3})$/u.exec(
      sourceCode,
    );
    if (parsed === null) {
      warn(warnings, `M_SEG[${index}]`, "invalid_format", sourceCode);
      continue;
    }
    meetingSlots.push({
      sourceCode,
      weekday: Number(parsed.groups?.weekday),
      periodCode: parsed.groups?.period ?? "",
      room: nullable(rooms[index] ?? ""),
    });
  }
  if (rooms.length > 0 && rooms.length !== timeCodes.length)
    warn(
      warnings,
      "M_CLSSRM_ID",
      "cardinality_mismatch",
      values.get("M_CLSSRM_ID") ?? "",
    );
  const scheduleStatus = missingControls.has("M_SEG")
    ? "unknown"
    : timeCodes.length === 0
      ? "not_scheduled"
      : meetingSlots.length === timeCodes.length &&
          rooms.length === timeCodes.length
        ? "complete"
        : "partial";

  const description = nullableMultiline(values.get("M_DESCRIPTION") ?? "");
  const remark = nullableMultiline(values.get("M_RMK") ?? "");
  const notes = [description, remark].filter(
    (value, index, all): value is string =>
      value !== null && all.indexOf(value) === index,
  );
  const requirementValue = values.get("M_MUST") ?? "";
  const requirement =
    requirementValue === ""
      ? null
      : [...requirementValue].length > 120
        ? (() => {
            warn(warnings, "M_MUST", "value_too_long", requirementValue);
            return null;
          })()
        : parseAisCourseRequirement(requirementValue);
  const referenceValue = values.get("M_DOWNLOAD_ADDR") ?? "";
  const referenceMaterial =
    [...referenceValue].length > 20_000
      ? (() => {
          warn(warnings, "M_DOWNLOAD_ADDR", "value_too_long", referenceValue);
          return interpretCourseReferenceMaterial(null);
        })()
      : interpretCourseReferenceMaterial(referenceValue);
  for (const token of referenceMaterial.malformedTokens) {
    warn(warnings, "M_DOWNLOAD_ADDR", "invalid_format", token);
  }

  return {
    processedTermId,
    termId,
    courseCode: required(values, "M_COSID", 80),
    courseTitle: required(values, "CH_LESSON", 200),
    englishTitle: nullableBounded(values, "M_ENG_LESSON", 300, warnings),
    department: required(values, "M_FACULTY_NAME", 300),
    section: required(values, "M_GRADE", 80),
    instructorsDisplay: nullableBounded(
      values,
      "M_LECTR_TCH_CH",
      500,
      warnings,
    ),
    crossDepartment: yesNo(values, "M_IS_CROSS_FACULTY_MERGE", warnings),
    credits: decimal(values, "M_CRD", 0, 20, warnings),
    hours: decimal(values, "M_LECTR_HOUR", 0, 100, warnings),
    maximumEnrollment: integer(values, "M_MAX_ST", 0, 99_999, warnings),
    minimumEnrollment: integer(values, "M_MIN_ST", 0, 99_999, warnings),
    englishMedium: yesNo(values, "M_COS_ENGLISH_FG", warnings),
    requirementDisplay: requirement?.rawLabel ?? null,
    requirementKind: requirement?.kind ?? "unknown",
    requirementRawCode: requirement?.rawCode ?? null,
    requirementRawLabel: requirement?.rawLabel ?? null,
    durationDisplay: nullableBounded(values, "M_COSTERM", 120, warnings),
    practicumDisplay: nullableBounded(values, "M_CLASS_LAB", 120, warnings),
    meetingSlots,
    scheduleStatus,
    distanceLearningDisplay: nullableBounded(
      values,
      "M_IS_LONGDIST_CURRI",
      120,
      warnings,
    ),
    primaryArea: nullableBounded(values, "M_MAIN_NAME", 200, warnings),
    secondaryArea: nullableBounded(values, "M_CHILD_NAME", 200, warnings),
    enrollment: integer(values, "M_CHOICE_QTY", 0, 99_999, warnings),
    enrollmentNote: enrollmentNote(html),
    graduateLevelsCombined: yesNo(values, "M_IS_MAST_DOCTOR_MERGE", warnings),
    description,
    remark,
    notes,
    coInstructorsDisplay: nullableBounded(
      values,
      "TCH_NAME_LIST",
      1_000,
      warnings,
    ),
    coreCompetencies: nullableBounded(
      values,
      "L_CORE_ABILITY",
      20_000,
      warnings,
    ),
    objective: bilingual(values, "M_CH_TARGET", "M_ENG_TARGET", warnings),
    prerequisites: bilingual(values, "M_CH_PREOBJ", "M_ENG_PREOBJ", warnings),
    outline: bilingual(values, "M_CH_OBJECT", "M_ENG_OBJECT", warnings),
    teachingMethod: bilingual(values, "M_CH_TEACH", "M_ENG_TEACH", warnings),
    references: bilingual(values, "M_CH_REF", "M_ENG_REF", warnings),
    syllabus: bilingual(values, "M_CH_TEACHSCH", "M_ENG_TEACHSCH", warnings),
    evaluation: bilingual(values, "M_CH_TYPE", "M_ENG_TYPE", warnings),
    referenceText: referenceMaterial.text,
    referenceLinks: referenceMaterial.links,
    sustainableDevelopmentGoals: codedList(
      values.get("L_SUSTAINABLE_DEVE_GOAL") ?? "",
    ),
    featureDomains: codedList(values.get("L_TRAIT_DOMAIN") ?? ""),
    curriculumAttribute: nullableBounded(values, "M_CURRI_EXPL", 120, warnings),
    sourceReference: {
      pkno,
      rowstamp: nullable(values.get("ROWSTAMP") ?? ""),
    },
    warnings,
  };
}

function controlValueById(html: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const inputTag = html.match(
    new RegExp(`<input\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>`, "iu"),
  )?.[0];
  if (inputTag !== undefined) {
    const value = inputTag.match(/\bvalue=(?:["']([^"']*)["']|([^\s>]+))/iu);
    return normalizeText(decodeHtml(value?.[1] ?? value?.[2] ?? ""));
  }
  const match = html.match(
    new RegExp(
      `<([a-z][a-z0-9]*)\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`,
      "iu",
    ),
  );
  if (match === null) return null;
  const decoded = decodeHtml(
    (match[2] ?? "")
      .replace(/<br\s*\/?\s*>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  );
  return richTextIds.has(id)
    ? normalizeMultilineText(decoded)
    : normalizeText(decoded);
}

function requiredControlValueById(html: string, id: string): string {
  const value = controlValueById(html, id);
  if (value === null)
    throw new AisProtocolError("course_detail_contract_changed");
  return value;
}

function enrollmentNote(html: string): string | null {
  const escaped = "M_CHOICE_QTY";
  const match = html.match(
    new RegExp(
      `<span\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>[\\s\\S]*?<\\/span>\\s*<span\\b[^>]*\\bclass=["'][^"']*note-text[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`,
      "iu",
    ),
  );
  if (match === null) return null;
  const value = normalizeText(
    decodeHtml((match[1] ?? "").replace(/<[^>]+>/gu, " ")),
  )
    .replace(/^[（(]\s*/u, "")
    .replace(/\s*[）)]$/u, "");
  return nullable(value);
}

function nullableMultiline(value: string): string | null {
  const normalized = normalizeMultilineText(value);
  return normalized === "" ? null : normalized;
}

function required(
  values: ReadonlyMap<string, string>,
  id: string,
  maximum: number,
): string {
  const value = values.get(id) ?? "";
  if (value === "" || [...value].length > maximum) invalidValue();
  return value;
}

function nullableBounded(
  values: ReadonlyMap<string, string>,
  id: string,
  maximum: number,
  warnings: AisCourseDetailWarning[],
): string | null {
  const value = values.get(id) ?? "";
  if ([...value].length > maximum) {
    warn(warnings, id, "value_too_long", value);
    return null;
  }
  return richTextIds.has(id) ? nullableMultiline(value) : nullable(value);
}

function nullable(value: string): string | null {
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
}

function term(values: ReadonlyMap<string, string>, id: string): string {
  const value = values.get(id) ?? "";
  if (!/^\d{4}$/u.test(value)) invalidValue();
  return value;
}

function yesNo(
  values: ReadonlyMap<string, string>,
  id: string,
  warnings: AisCourseDetailWarning[],
): boolean | null {
  const value = values.get(id) ?? "";
  if (value === "") return null;
  if (/^是(?:$|[（(])/u.test(value)) return true;
  if (/^否(?:$|[（(])/u.test(value)) return false;
  warn(warnings, id, "unknown_value", value);
  return null;
}

function integer(
  values: ReadonlyMap<string, string>,
  id: string,
  minimum: number,
  maximum: number,
  warnings: AisCourseDetailWarning[],
): number | null {
  const value = values.get(id) ?? "";
  if (value === "") return null;
  if (!/^\d+$/u.test(value)) {
    warn(warnings, id, "invalid_format", value);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    warn(warnings, id, "out_of_range", value);
    return null;
  }
  return parsed;
}

function decimal(
  values: ReadonlyMap<string, string>,
  id: string,
  minimum: number,
  maximum: number,
  warnings: AisCourseDetailWarning[],
): number | null {
  const value = values.get(id) ?? "";
  if (value === "") return null;
  if (!/^\d+(?:\.\d+)?$/u.test(value)) {
    warn(warnings, id, "invalid_format", value);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    warn(warnings, id, "out_of_range", value);
    return null;
  }
  return parsed;
}

function bilingual(
  values: ReadonlyMap<string, string>,
  chineseId: string,
  englishId: string,
  warnings: AisCourseDetailWarning[],
): AisBilingualText {
  return {
    zh: nullableBounded(values, chineseId, 100_000, warnings),
    en: nullableBounded(values, englishId, 100_000, warnings),
  };
}

function commaList(value: string, preserveEmpty: boolean): readonly string[] {
  if (normalizeText(value) === "") return [];
  const values = value.split(/[,，]/u).map(normalizeText);
  return preserveEmpty ? values : values.filter((item) => item !== "");
}

/** Split only before the next numeric code; punctuation inside a label is data. */
function codedList(value: string): readonly string[] {
  const normalized = normalizeText(value);
  if (normalized === "") return [];
  return normalized
    .split(/[、,，;；]\s*(?=\d{1,2}-)/u)
    .map(normalizeText)
    .filter((item) => item !== "");
}

function warn(
  warnings: AisCourseDetailWarning[],
  field: string,
  code: AisCourseDetailWarning["code"],
  observedValue: string,
): void {
  if (warnings.length >= maximumWarningCount) return;
  warnings.push({
    field,
    code,
    observedValue:
      [...observedValue].length <= 500
        ? observedValue
        : `${[...observedValue].slice(0, 500).join("")}…`,
  });
}

function invalidValue(): never {
  throw new AisProtocolError("invalid_course_detail_value");
}

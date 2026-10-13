import { normalizeText } from "./html-table.js";
import { AisProtocolError } from "./protocol-error.js";

export type CourseRequirementKind =
  | "required"
  | "elective"
  | "generalEducation"
  | "summer"
  | "education"
  | "service"
  | "interUniversity"
  | "extension"
  | "unknown";

export type AisCourseRequirement = Readonly<{
  rawCode: string | null;
  rawLabel: string;
  kind: CourseRequirementKind;
}>;

const requirementKinds: Readonly<Record<string, CourseRequirementKind>> = {
  A: "required",
  B: "elective",
  C: "generalEducation",
  D: "summer",
  H: "education",
  T: "service",
  L: "interUniversity",
  R: "extension",
};

/** Preserve the AIS selection value while deriving only evidenced semantics. */
export function parseAisCourseRequirement(value: string): AisCourseRequirement {
  const rawLabel = normalizeText(value);
  if (rawLabel === "" || [...rawLabel].length > 120) {
    throw new AisProtocolError("invalid_course_requirement_value");
  }
  const rawCode = /^([A-Z])(?:\s*[-－]|$)/u.exec(rawLabel)?.[1] ?? null;
  const kind =
    rawCode === null
      ? /必修/u.test(rawLabel)
        ? "required"
        : /選修/u.test(rawLabel)
          ? "elective"
          : "unknown"
      : (requirementKinds[rawCode] ?? "unknown");
  return {
    rawCode,
    rawLabel,
    kind,
  };
}

export function legacyCourseRequirement(
  kind: CourseRequirementKind,
): "required" | "elective" | "unknown" {
  return kind === "required" || kind === "elective" ? kind : "unknown";
}

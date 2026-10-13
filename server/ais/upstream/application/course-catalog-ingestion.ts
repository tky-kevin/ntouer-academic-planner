import type { AisCatalogCourse } from "../protocol/ais/course-catalog-parser.js";
import type { AisCourseDetail } from "../protocol/ais/course-detail-parser.js";
import { classifyCourseTitle } from "./course-classification.js";

export type CourseCatalogPartition = Readonly<{
  academicYear: string;
}>;

export type CourseCatalogSourceOccurrence = Readonly<{
  partition: CourseCatalogPartition;
  pageNumber: number;
  serial: number;
}>;

export type CatalogOfferingCandidate = Readonly<{
  identityKey: string;
  list: AisCatalogCourse;
  detail: AisCourseDetail | null;
  occurrences: readonly CourseCatalogSourceOccurrence[];
}>;

export type CatalogQuarantineReason =
  | "requested_academic_year_mismatch"
  | "identity_collision"
  | "detail_identity_mismatch";

export type CatalogQuarantineRecord = Readonly<{
  reason: CatalogQuarantineReason;
  identityKey: string;
  occurrence: CourseCatalogSourceOccurrence;
}>;

export type CourseCatalogPartitionResult = Readonly<{
  candidates: readonly CatalogOfferingCandidate[];
  quarantine: readonly CatalogQuarantineRecord[];
}>;

/**
 * Pure ingestion boundary. Wrong-year rows never enter a requested-year
 * snapshot, and conflicting rows are quarantined instead of last-write-wins.
 */
export function reconcileCourseCatalogPartition(
  requested: CourseCatalogPartition,
  pages: readonly Readonly<{
    pageNumber: number;
    courses: readonly AisCatalogCourse[];
  }>[],
): CourseCatalogPartitionResult {
  const candidates = new Map<string, CatalogOfferingCandidate>();
  const quarantine: CatalogQuarantineRecord[] = [];

  for (const page of pages) {
    for (const course of page.courses) {
      const occurrence = {
        partition: requested,
        pageNumber: page.pageNumber,
        serial: course.serial,
      };
      if (course.termId.slice(0, 3) !== requested.academicYear) {
        quarantine.push({
          reason: "requested_academic_year_mismatch",
          identityKey: course.identityKey,
          occurrence,
        });
        continue;
      }
      const existing = candidates.get(course.identityKey);
      if (existing === undefined) {
        candidates.set(course.identityKey, {
          identityKey: course.identityKey,
          list: course,
          detail: null,
          occurrences: [occurrence],
        });
        continue;
      }
      if (!sameImmutableListShape(existing.list, course)) {
        candidates.delete(course.identityKey);
        quarantine.push({
          reason: "identity_collision",
          identityKey: course.identityKey,
          occurrence,
        });
        continue;
      }
      candidates.set(course.identityKey, {
        ...existing,
        occurrences: [...existing.occurrences, occurrence],
      });
    }
  }
  return { candidates: [...candidates.values()], quarantine };
}

export function attachCourseDetail(
  candidate: CatalogOfferingCandidate,
  detail: AisCourseDetail,
): CatalogOfferingCandidate | CatalogQuarantineRecord {
  if (
    detail.termId !== candidate.list.termId ||
    detail.courseCode !== candidate.list.courseCode ||
    !compatibleCourseTitle(detail.courseTitle, candidate.list.courseTitle) ||
    !compatibleSection(detail.section, candidate.list.section) ||
    !compatibleDisplay(detail.department, candidate.list.department)
  ) {
    return {
      reason: "detail_identity_mismatch",
      identityKey: candidate.identityKey,
      occurrence: candidate.occurrences[0] ?? {
        partition: {
          academicYear: candidate.list.termId.slice(0, 3),
        },
        pageNumber: 0,
        serial: candidate.list.serial,
      },
    };
  }
  const warnings = [...detail.warnings];
  const listRequirementKind =
    candidate.list.requirementKind ?? candidate.list.requirement;
  const listRequirementRawLabel =
    candidate.list.requirementRawLabel ??
    (candidate.list.requirement === "required"
      ? "A-必修"
      : candidate.list.requirement === "elective"
        ? "B-選修"
        : "unknown");
  if (
    detail.requirementRawLabel !== null &&
    (detail.requirementRawLabel !== listRequirementRawLabel ||
      detail.requirementKind !== listRequirementKind)
  ) {
    warnings.push({
      field: "M_MUST",
      code: "inconsistent_value",
      observedValue: detail.requirementRawLabel,
    });
  }
  const titleClassifications = classifyCourseTitle(
    candidate.list.courseTitle,
  ).classifications.map((item) =>
    normalizedClassification(item.canonicalLabel),
  );
  const detailClassification = normalizedClassification(
    detail.curriculumAttribute ?? "",
  );
  if (
    (detailClassification !== "" || titleClassifications.length > 0) &&
    !titleClassifications.includes(detailClassification)
  ) {
    warnings.push({
      field: "M_CURRI_EXPL",
      code: "inconsistent_value",
      observedValue: detail.curriculumAttribute ?? "",
    });
  }
  return {
    ...candidate,
    detail:
      warnings.length === detail.warnings.length
        ? detail
        : { ...detail, warnings },
  };
}

/** Merge listing-only provenance into the rebuildable stored detail JSON. */
export function storedCourseDetail(
  candidate: CatalogOfferingCandidate,
): AisCourseDetail {
  if (candidate.detail === null) {
    throw new Error("course_catalog_detail_required");
  }
  return {
    ...candidate.detail,
    requirementKind:
      candidate.list.requirementKind ?? candidate.detail.requirementKind,
    requirementRawCode:
      candidate.list.requirementRawCode ?? candidate.detail.requirementRawCode,
    requirementRawLabel:
      candidate.list.requirementRawLabel ??
      candidate.detail.requirementRawLabel,
  };
}

function normalizedClassification(value: string): string {
  return value.replace(/[【】（）()\s]/gu, "");
}

const observedListOnlyCourseTitleSuffixes = new Set([
  "(人格)",
  "(全球)",
  "(全球 )",
  "(歷史)",
  "(民主)",
  "(科技)",
  "(經典)",
  "(美學)",
  "(自然)",
  "【跨域永續】",
  "【社會脈動】",
  "【人文探索】",
  "【人文採索】",
  "【科技創新】",
]);

function compatibleCourseTitle(detail: string, list: string): boolean {
  if (detail === list) return true;
  for (const suffix of observedListOnlyCourseTitleSuffixes) {
    if (`${detail}${suffix}` === list || `${detail} ${suffix}` === list)
      return true;
  }
  return false;
}

function sameImmutableListShape(
  left: AisCatalogCourse,
  right: AisCatalogCourse,
): boolean {
  return (
    left.termId === right.termId &&
    left.courseCode === right.courseCode &&
    left.courseTitle === right.courseTitle &&
    left.department === right.department &&
    left.section === right.section &&
    left.credits === right.credits &&
    left.requirement === right.requirement &&
    left.requirementKind === right.requirementKind &&
    left.requirementRawCode === right.requirementRawCode &&
    left.requirementRawLabel === right.requirementRawLabel
  );
}

function compatibleDisplay(detail: string, list: string): boolean {
  const normalizedDetail = detail
    .replace(/[（(][^）)]*[）)]/gu, "")
    .replace(/\s+/gu, "");
  const normalizedList = list
    .replace(/[（(][^）)]*[）)]/gu, "")
    .replace(/\s+/gu, "");
  return normalizedDetail === normalizedList;
}

function compatibleSection(detail: string, list: string): boolean {
  const normalize = (value: string): string => value.replace(/[年班\s]/gu, "");
  return normalize(detail) === normalize(list);
}

import type {
  AisTimetablePeriod,
  AisTimetableSlot,
} from "../protocol/ais/timetable-parser.js";
import { classifyCourseTitle } from "./course-classification.js";

export function toTimetableApiResponse(
  slots: readonly AisTimetableSlot[],
  periods: readonly AisTimetablePeriod[],
  term: Readonly<{ rocYear: number; term: number }>,
  fetchedAt: Date,
): unknown {
  const termId = `${String(term.rocYear).padStart(3, "0")}${term.term}`;
  const groups = new Map<string, AisTimetableSlot[]>();
  for (const slot of slots) {
    if (slot.termId !== termId) throw new Error("timetable_term_mismatch");
    const key = [
      slot.termId,
      slot.courseCode,
      slot.department,
      slot.section,
    ].join("\u0000");
    const current = groups.get(key) ?? [];
    current.push(slot);
    groups.set(key, current);
  }

  const offerings = [...groups.entries()].map(([key, courseSlots]) => {
    const first = courseSlots[0];
    if (first === undefined) throw new Error("empty_timetable_group");
    const id = `timetable-${termId}-${stableDigest(key)}`;
    const classifiedTitle = classifyCourseTitle(first.courseTitle);
    return {
      id,
      term,
      course: { code: first.courseCode, title: classifiedTitle.baseTitle },
      sourceTitle: classifiedTitle.rawTitle,
      department: first.department,
      section: first.section,
      credits: first.credits,
      requirement: first.requirement,
      instructors: first.instructor === null ? [] : [first.instructor],
      instructorDepartment: first.instructorDepartment,
      practicum: first.practicum,
      hours: first.hours,
      coTeaching: first.coTeaching,
      duration: first.duration,
      meetings: groupMeetings(courseSlots),
      classifications: classifiedTitle.classifications.map(
        (classification) => ({
          key: classification.key,
          label: classification.canonicalLabel,
          rawLabel: classification.rawLabel,
          source: "courseTitleSuffix",
          normalizationVersion: classification.normalizationVersion,
        }),
      ),
      enrollment: {
        enrolled: first.enrollment,
        capacity: null,
        limitDisplay: first.enrollmentLimitDisplay,
      },
    };
  });
  const selectedOfferingIds = offerings.map((offering) => offering.id);
  if (new Set(selectedOfferingIds).size !== selectedOfferingIds.length) {
    throw new Error("timetable_offering_id_collision");
  }
  return {
    contractVersion: "1.0",
    term,
    periods,
    selectedOfferingIds,
    offerings,
    fetchedAt: fetchedAt.toISOString(),
  };
}

function groupMeetings(slots: readonly AisTimetableSlot[]): readonly unknown[] {
  const weekdays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ] as const;
  const grouped = new Map<
    string,
    { weekday: number; location: string | null; periods: string[] }
  >();
  for (const slot of slots) {
    const key = `${slot.weekday}\u0000${slot.classroom ?? ""}`;
    const current = grouped.get(key) ?? {
      weekday: slot.weekday,
      location: slot.classroom,
      periods: [],
    };
    if (!current.periods.includes(slot.periodId)) {
      current.periods.push(slot.periodId);
    }
    grouped.set(key, current);
  }
  return [...grouped.values()].map((meeting) => ({
    weekday: weekdays[meeting.weekday - 1],
    periods: meeting.periods,
    location: meeting.location,
  }));
}

function stableDigest(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

import type {
  AisAcademicRank,
  AisCourseGrade,
  AisGradesResult,
} from "../protocol/ais/grades-parser.js";

type GradeOutcome = Readonly<{
  kind:
    | "numeric"
    | "passed"
    | "failed"
    | "withdrawn"
    | "exempt"
    | "incomplete"
    | "unpublished"
    | "other";
  display: string | null;
  numericScore: number | null;
}>;

export function toGradesApiResponse(
  parsed: AisGradesResult,
  fetchedAt: Date,
): unknown {
  if (parsed.query.kind !== "semester")
    throw new Error("semester_query_required");
  const termId = parsed.query.termId;
  const rocYear = Number(termId.slice(0, 3));
  const term = Number(termId.slice(3));
  const outcomes = parsed.courses.map((course) =>
    outcome(course.semesterScore),
  );
  const rank = (value: AisAcademicRank | null) =>
    value === null
      ? null
      : {
          position: value.position,
          cohortSize: value.cohortSize,
          observedAt: fetchedAt.toISOString(),
        };
  const conduct = parsed.conductGrades.find((value) => value.termId === termId);
  const termGpa = computeTermGpa(parsed.courses, outcomes);

  return {
    contractVersion: "1.0",
    term: { rocYear, term },
    courses: parsed.courses.map((course, index) => ({
      id: course.id,
      offeringId: null,
      course: { code: course.courseCode, title: course.courseTitle },
      credits: course.credits,
      requirement: course.requirement,
      instructor: course.instructor,
      outcome: outcomes[index],
    })),
    summary: {
      termGpa,
      cumulativeGpa: null,
      classRank: rank(parsed.summary.classRank),
      departmentRank: rank(parsed.summary.departmentRank),
      earnedCredits: parsed.summary.earnedCredits,
      attemptedCredits: parsed.summary.attemptedCredits,
      exemptCredits: parsed.summary.exemptCredits,
      currentAverageScore: parsed.summary.currentAverageScore,
      cumulativeEarnedCredits: parsed.summary.historicalCumulativeCredits,
      conductScore: conduct === undefined ? null : outcome(conduct.score),
      rankPublicationSchedule:
        parsed.summary.rankPublicationSchedule?.display ?? null,
      sources: {
        termGpa: termGpa === null ? null : "computed",
        cumulativeGpa: null,
        classRank: parsed.summary.classRank === null ? null : "ais",
        departmentRank: parsed.summary.departmentRank === null ? null : "ais",
        earnedCredits: parsed.summary.earnedCredits === null ? null : "ais",
        attemptedCredits:
          parsed.summary.attemptedCredits === null ? null : "ais",
        exemptCredits: parsed.summary.exemptCredits === null ? null : "ais",
        currentAverageScore:
          parsed.summary.currentAverageScore === null ? null : "ais",
        cumulativeEarnedCredits:
          parsed.summary.historicalCumulativeCredits === null ? null : "ais",
        conductScore: conduct === undefined ? null : "ais",
        rankPublicationSchedule:
          parsed.summary.rankPublicationSchedule === null ? null : "ais",
      },
    },
    fetchedAt: fetchedAt.toISOString(),
  };
}

function outcome(value: string | null): GradeOutcome {
  const display = value?.trim() || null;
  if (display === null)
    return { kind: "unpublished", display: null, numericScore: null };
  if (/^\d+(?:\.\d+)?$/u.test(display)) {
    const numericScore = Number(display);
    if (numericScore >= 0 && numericScore <= 100) {
      return { kind: "numeric", display, numericScore };
    }
  }
  if (display === "通過")
    return { kind: "passed", display, numericScore: null };
  if (display === "抵") return { kind: "exempt", display, numericScore: null };
  if (/^W$/iu.test(display))
    return { kind: "withdrawn", display, numericScore: null };
  if (display.startsWith("*"))
    return { kind: "failed", display, numericScore: null };
  if (display.startsWith("+"))
    return { kind: "unpublished", display, numericScore: null };
  return { kind: "other", display, numericScore: null };
}

function computeTermGpa(
  courses: readonly AisCourseGrade[],
  outcomes: readonly GradeOutcome[],
): number | null {
  if (
    courses.length === 0 ||
    outcomes.some((value) => value.kind !== "numeric")
  ) {
    return null;
  }
  let credits = 0;
  let qualityPoints = 0;
  courses.forEach((course, index) => {
    const score = outcomes[index]?.numericScore ?? 0;
    const points =
      score >= 80 ? 4 : score >= 70 ? 3 : score >= 60 ? 2 : score >= 50 ? 1 : 0;
    credits += course.credits;
    qualityPoints += course.credits * points;
  });
  return credits === 0 ? null : Math.round((qualityPoints / credits) * 10) / 10;
}

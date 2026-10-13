export type AisGradesQuery =
  | Readonly<{ kind: "semester"; termId: string }>
  | Readonly<{ kind: "academic_year"; rocYear: number }>
  | Readonly<{ kind: "history" }>;

export function assertAisGradesQuery(query: AisGradesQuery): void {
  if (query.kind === "semester") {
    if (!/^\d{3}[1-4]$/u.test(query.termId)) throw new Error("invalid_term");
    return;
  }
  if (query.kind === "academic_year") {
    if (
      !Number.isSafeInteger(query.rocYear) ||
      query.rocYear < 1 ||
      query.rocYear > 999
    ) {
      throw new Error("invalid_year");
    }
  }
}

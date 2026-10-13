export type CourseReferenceMaterial = Readonly<{
  text: string | null;
  links: readonly string[];
  malformedTokens: readonly string[];
}>;

/** Interprets the evidenced free-text AIS course material location field. */
export function interpretCourseReferenceMaterial(
  value: string | null | undefined,
): CourseReferenceMaterial {
  const text = value?.replace(/\s+/gu, " ").trim() || null;
  if (text === null) return { text: null, links: [], malformedTokens: [] };

  const links: string[] = [];
  for (const match of text.matchAll(
    /\bhttps?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[^\s<>"'\u3400-\u9fff，。；、）】]*)?/giu,
  )) {
    const candidate = (match[0] ?? "").replace(/[),.;!?]+$/u, "");
    try {
      const parsed = new URL(candidate);
      if (
        ["http:", "https:"].includes(parsed.protocol) &&
        !links.includes(parsed.href)
      ) {
        links.push(parsed.href);
      }
    } catch {
      // The bounded malformed token collection below reports this safely.
    }
  }

  const malformedTokens = [
    ...text.matchAll(/\bhttps?[;：]\s*\/\/[^\s<>"']*/giu),
  ]
    .map((match) => match[0] ?? "")
    .filter(
      (token, index, all) => token !== "" && all.indexOf(token) === index,
    );
  return { text, links, malformedTokens };
}

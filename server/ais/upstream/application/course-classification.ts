export const courseClassificationNormalizationVersion = 1;

export type CourseClassification = Readonly<{
  key: string;
  canonicalLabel: string;
  rawLabel: string;
  source: "course_title_suffix";
  normalizationVersion: number;
}>;

export type ClassifiedCourseTitle = Readonly<{
  rawTitle: string;
  baseTitle: string;
  classifications: readonly CourseClassification[];
}>;

type ClassificationAlias = Readonly<{
  rawLabel: string;
  key: string;
  canonicalLabel: string;
}>;

const classificationAliases: readonly ClassificationAlias[] = [
  {
    rawLabel: "【跨域永續】",
    key: "cross-disciplinary-sustainability",
    canonicalLabel: "跨域永續",
  },
  {
    rawLabel: "【社會脈動】",
    key: "social-trends",
    canonicalLabel: "社會脈動",
  },
  {
    rawLabel: "【人文探索】",
    key: "humanities-exploration",
    canonicalLabel: "人文探索",
  },
  {
    rawLabel: "【人文採索】",
    key: "humanities-exploration",
    canonicalLabel: "人文探索",
  },
  {
    rawLabel: "【科技創新】",
    key: "technology-innovation",
    canonicalLabel: "科技創新",
  },
  { rawLabel: "(人格)", key: "personality", canonicalLabel: "人格" },
  { rawLabel: "(全球 )", key: "global", canonicalLabel: "全球" },
  { rawLabel: "(全球)", key: "global", canonicalLabel: "全球" },
  { rawLabel: "(歷史)", key: "history", canonicalLabel: "歷史" },
  { rawLabel: "(民主)", key: "democracy", canonicalLabel: "民主" },
  { rawLabel: "(科技)", key: "technology", canonicalLabel: "科技" },
  { rawLabel: "(經典)", key: "classics", canonicalLabel: "經典" },
  { rawLabel: "(美學)", key: "aesthetics", canonicalLabel: "美學" },
  { rawLabel: "(自然)", key: "nature", canonicalLabel: "自然" },
];

/**
 * Extracts only manually reviewed AIS title suffixes. Unknown suffixes remain
 * part of the raw/base title so a fuzzy guess can never change course identity.
 */
export function classifyCourseTitle(rawTitle: string): ClassifiedCourseTitle {
  const alias = classificationAliases.find(({ rawLabel }) =>
    rawTitle.endsWith(rawLabel),
  );
  if (alias === undefined) {
    return { rawTitle, baseTitle: rawTitle, classifications: [] };
  }
  const baseTitle = rawTitle.slice(0, -alias.rawLabel.length).trimEnd();
  if (baseTitle === "") {
    return { rawTitle, baseTitle: rawTitle, classifications: [] };
  }
  return {
    rawTitle,
    baseTitle,
    classifications: [
      {
        key: alias.key,
        canonicalLabel: alias.canonicalLabel,
        rawLabel: alias.rawLabel,
        source: "course_title_suffix",
        normalizationVersion: courseClassificationNormalizationVersion,
      },
    ],
  };
}

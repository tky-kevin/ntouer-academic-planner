import type { AisCatalogCourse } from "../../protocol/ais/course-catalog-parser.js";
import type { AisCourseDetail } from "../../protocol/ais/course-detail-parser.js";
import type { CourseCatalogPartition } from "../course-catalog-ingestion.js";

export type CourseCatalogSourcePage = Readonly<{
  pageNumber: number;
  totalPages: number;
  totalRows: number;
  courses: readonly AisCatalogCourse[];
}>;

/** AIS-specific navigation lives behind this application boundary. */
export interface CourseCatalogSource {
  partitions(): Promise<readonly CourseCatalogPartition[]>;
  pages(
    partition: CourseCatalogPartition,
  ): AsyncIterable<CourseCatalogSourcePage>;
  /**
   * Opens exactly one listing page and retains only the navigation state needed
   * by detail() in the same execution. Bounded execution adapters use this
   * instead of replaying every preceding page.
   */
  page?(
    partition: CourseCatalogPartition,
    pageNumber: number,
  ): Promise<CourseCatalogSourcePage>;
  detail(course: AisCatalogCourse): Promise<AisCourseDetail>;
}

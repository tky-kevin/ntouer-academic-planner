import type { AisTransport } from "../../application/ports/ais-transport.js";
import type {
  CourseCatalogSource,
  CourseCatalogSourcePage,
} from "../../application/ports/course-catalog-source.js";
import type { CourseCatalogPartition } from "../../application/course-catalog-ingestion.js";
import { aisText } from "../../application/ais-response.js";
import { GatewayError } from "../../application/gateway-error.js";
import { parseAisCourseCatalogCallback } from "./course-catalog-parser.js";
import {
  aisCourseCatalogRoutes,
  courseCatalogPublicEntryQuery,
  buildCourseCatalogDetailBody,
  buildCourseCatalogPageBody,
  buildCourseCatalogPageSizeBody,
  buildCourseCatalogSelectionBody,
  buildCourseCatalogUnitQueryBody,
  courseCatalogAllowedInputNames,
  mergeCourseCatalogCallbackState,
  parseAisCourseCatalogDetailUrl,
  parseAisCourseCatalogPagination,
  parseAisCourseCatalogPublicEntryRedirect,
  parseAisCourseCatalogPublicShellTarget,
  parseAisCourseCatalogUnitOptions,
  type AisCourseCatalogPagination,
} from "./course-catalog-query.js";
import { parseAisCourseDetailPage } from "./course-detail-parser.js";
import { AisProtocolError } from "./protocol-error.js";
import { parseWebFormsQueryPage } from "./webforms-query.js";

const origin = "https://ais.ntou.edu.tw";
const queryUrl = new URL(aisCourseCatalogRoutes.query, origin);
const publicShellUrl = new URL(aisCourseCatalogRoutes.publicShell, origin);
publicShellUrl.searchParams.set(
  "mainPage",
  Buffer.from(
    `${aisCourseCatalogRoutes.entry}?${courseCatalogPublicEntryQuery}`,
    "utf16le",
  ).toString("base64"),
);

export type AisCourseCatalogSourceSelection = Readonly<{
  academicYears: readonly string[];
}>;

type DetailReference = Readonly<{
  stateKey: string;
  eventTarget: string;
}>;

type OpenedListing = Readonly<{
  state: ReadonlyMap<string, string>;
  raw: string;
  pagination: AisCourseCatalogPagination;
}>;

/** Guest-first TKE2210 adapter; no credential-bearing request is emitted. */
export class AisCourseCatalogSource implements CourseCatalogSource {
  private readonly pageStates = new Map<string, ReadonlyMap<string, string>>();
  private readonly detailReferences = new Map<string, DetailReference>();

  constructor(
    private readonly transport: AisTransport,
    private readonly selection: AisCourseCatalogSourceSelection,
  ) {
    assertSelection(selection);
  }

  async partitions(): Promise<readonly CourseCatalogPartition[]> {
    const html = await this.freshQueryPage();
    const options = parseAisCourseCatalogUnitOptions(html);
    const years = new Set(options.years.map((option) => option.value));
    for (const academicYear of this.selection.academicYears) {
      if (!years.has(academicYear)) {
        throw new AisProtocolError("course_catalog_options_changed");
      }
    }
    return this.selection.academicYears.map((academicYear) => ({
      academicYear,
    }));
  }

  async *pages(
    partition: CourseCatalogPartition,
  ): AsyncIterable<CourseCatalogSourcePage> {
    const opened = await this.openFirstListingPage(partition);
    let { state, raw, pagination } = opened;
    for (
      let pageNumber = 1;
      pageNumber <= pagination.totalPages;
      pageNumber += 1
    ) {
      if (pageNumber > 1) {
        const pageBody = buildCourseCatalogPageBody(state, pageNumber);
        raw = await this.callback("course_catalog_page", pageBody);
        state = mergeCourseCatalogCallbackState(stateFromBody(pageBody), raw);
        pagination = parseAisCourseCatalogPagination(raw);
        if (pagination.currentPage !== pageNumber) {
          throw new AisProtocolError("course_catalog_pagination_changed");
        }
      }
      const courses = parseAisCourseCatalogCallback(
        raw,
        "source",
        partition.academicYear,
      );
      this.rememberPage(partition, pageNumber, state, courses);
      yield {
        pageNumber,
        totalPages: pagination.totalPages,
        totalRows: pagination.totalRows,
        courses,
      };
    }
  }

  async page(
    partition: CourseCatalogPartition,
    pageNumber: number,
  ): Promise<CourseCatalogSourcePage> {
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      throw new AisProtocolError("course_catalog_pagination_changed");
    }
    const opened = await this.openFirstListingPage(partition);
    let { state, raw, pagination } = opened;
    if (pageNumber > pagination.totalPages) {
      throw new AisProtocolError("course_catalog_pagination_changed");
    }
    if (pageNumber > 1) {
      const pageBody = buildCourseCatalogPageBody(state, pageNumber);
      raw = await this.callback("course_catalog_page", pageBody);
      state = mergeCourseCatalogCallbackState(stateFromBody(pageBody), raw);
      pagination = parseAisCourseCatalogPagination(raw);
      if (pagination.currentPage !== pageNumber) {
        throw new AisProtocolError("course_catalog_pagination_changed");
      }
    }
    const courses = parseAisCourseCatalogCallback(
      raw,
      "source",
      partition.academicYear,
    );
    this.rememberPage(partition, pageNumber, state, courses);
    return {
      pageNumber,
      totalPages: pagination.totalPages,
      totalRows: pagination.totalRows,
      courses,
    };
  }

  async detail(course: Parameters<CourseCatalogSource["detail"]>[0]) {
    const reference = this.detailReferences.get(course.id);
    const state =
      reference === undefined
        ? undefined
        : this.pageStates.get(reference.stateKey);
    if (reference === undefined || state === undefined) {
      throw new AisProtocolError("course_detail_target_changed");
    }
    const detailBody = buildCourseCatalogDetailBody(
      state,
      reference.eventTarget,
    );
    const callback = await this.callback(
      "course_catalog_detail_target",
      detailBody,
    );
    const url = parseAisCourseCatalogDetailUrl(callback, queryUrl);
    const response = await this.transport.execute({
      operation: "course_catalog_detail",
      method: "GET",
      url,
      headers: { accept: "text/html", referer: queryUrl.href },
      maximumResponseBytes: 524_288,
      timeoutMs: 15_000,
    });
    const html = aisText(response, "course_catalog_detail", ["text/html"]);
    assertAuthenticatedHtml(html, "course_catalog_detail");
    return parseAisCourseDetailPage(html);
  }

  private async freshQueryPage(): Promise<string> {
    const shellResponse = await this.transport.execute({
      operation: "course_catalog_public_shell",
      method: "GET",
      url: publicShellUrl,
      headers: {
        accept: "text/html",
        referer:
          "https://academic.ntou.edu.tw/p/412-1005-1126-1.php?Lang=zh-tw",
      },
      maximumResponseBytes: 524_288,
      timeoutMs: 15_000,
    });
    const shellHtml = aisText(shellResponse, "course_catalog_public_shell", [
      "text/html",
    ]);
    assertNotLoginHtml(shellHtml, "course_catalog_public_shell");
    const entryUrl = parseAisCourseCatalogPublicShellTarget(shellHtml);
    if (
      entryUrl.origin !== origin ||
      entryUrl.pathname !== aisCourseCatalogRoutes.entry ||
      entryUrl.searchParams.get("progcd") !== "TKE2214"
    ) {
      throw new AisProtocolError("course_catalog_public_entry_changed");
    }

    const entryResponse = await this.transport.execute({
      operation: "course_catalog_public_entry",
      method: "GET",
      url: entryUrl,
      headers: { accept: "text/html", referer: publicShellUrl.href },
      maximumResponseBytes: 262_144,
      timeoutMs: 15_000,
    });
    const entryHtml = aisText(entryResponse, "course_catalog_public_entry", [
      "text/html",
    ]);
    assertNotLoginHtml(entryHtml, "course_catalog_public_entry");
    parseAisCourseCatalogPublicEntryRedirect(entryHtml);

    const queryResponse = await this.transport.execute({
      operation: "course_catalog_query_page",
      method: "GET",
      url: queryUrl,
      headers: { accept: "text/html", referer: entryUrl.href },
      maximumResponseBytes: 524_288,
      timeoutMs: 15_000,
    });
    const queryHtml = aisText(queryResponse, "course_catalog_query_page", [
      "text/html",
    ]);
    assertAuthenticatedHtml(queryHtml, "course_catalog_query_page");
    return queryHtml;
  }

  private async openFirstListingPage(
    partition: CourseCatalogPartition,
  ): Promise<OpenedListing> {
    const html = await this.freshQueryPage();
    let state = parseWebFormsQueryPage(
      html,
      queryUrl,
      courseCatalogAllowedInputNames,
    );
    for (const [operation, control, value] of [
      [
        "course_catalog_select_academic_year",
        "Q_AYEAR",
        partition.academicYear,
      ],
      ["course_catalog_select_term", "Q_SMS", ""],
      ["course_catalog_select_degree", "Q_DEGREE_CODE", ""],
    ] as const) {
      const selectionBody = buildCourseCatalogSelectionBody(
        state,
        control,
        value,
      );
      const selectionRaw = await this.callback(operation, selectionBody);
      state = mergeCourseCatalogCallbackState(
        stateFromBody(selectionBody),
        selectionRaw,
      );
    }
    const queryBody = buildCourseCatalogUnitQueryBody(state, partition);
    let raw = await this.callback("course_catalog_unit_query", queryBody);
    state = mergeCourseCatalogCallbackState(stateFromBody(queryBody), raw);
    let pagination = parseAisCourseCatalogPagination(raw);
    if (pagination.currentPage !== 1) {
      throw new AisProtocolError("course_catalog_pagination_changed");
    }
    const pageSizeBody = buildCourseCatalogPageSizeBody(state);
    raw = await this.callback("course_catalog_page_size", pageSizeBody);
    state = mergeCourseCatalogCallbackState(stateFromBody(pageSizeBody), raw);
    pagination = parseAisCourseCatalogPagination(raw);
    if (pagination.currentPage !== 1 || pagination.pageSize !== 100) {
      throw new AisProtocolError("course_catalog_pagination_changed");
    }
    return { state, raw, pagination };
  }

  private rememberPage(
    partition: CourseCatalogPartition,
    pageNumber: number,
    state: ReadonlyMap<string, string>,
    courses: readonly Parameters<CourseCatalogSource["detail"]>[0][],
  ): void {
    const stateKey = `${partition.academicYear}|${pageNumber}`;
    this.pageStates.set(stateKey, new Map(state));
    for (const course of courses) {
      this.detailReferences.set(course.id, {
        stateKey,
        eventTarget: course.detailEventTarget,
      });
    }
  }

  private async callback(operation: string, body: string): Promise<string> {
    const response = await this.transport.execute({
      operation,
      method: "POST",
      url: queryUrl,
      headers: {
        accept: "*/*",
        "accept-language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "x-microsoftajax": "Delta=true",
        "x-requested-with": "XMLHttpRequest",
      },
      body,
      maximumResponseBytes: 1_048_576,
      timeoutMs: 20_000,
    });
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("text/html")) {
      const html = aisText(response, operation, ["text/html"]);
      assertAuthenticatedHtml(html, operation);
      throw new AisProtocolError("course_catalog_callback_changed");
    }
    return aisText(response, operation, ["text/plain"]);
  }
}

function assertAuthenticatedHtml(html: string, operation: string): void {
  if (containsLoginHtml(html)) {
    throw new GatewayError(
      401,
      "authenticationRequired",
      operation,
      true,
      "AIS_SESSION_EXPIRED",
    );
  }
}

function assertNotLoginHtml(html: string, operation: string): void {
  if (containsLoginHtml(html)) {
    throw new GatewayError(
      502,
      "contractChanged",
      operation,
      false,
      "AIS_PUBLIC_LOGIN_REDIRECT",
    );
  }
}

function stateFromBody(body: string): ReadonlyMap<string, string> {
  return new Map(new URLSearchParams(body));
}

function containsLoginHtml(html: string): boolean {
  return (
    /<form\b[^>]*\baction\s*=\s*(["'])\/?Default\.aspx\1/iu.test(html) &&
    /\bname\s*=\s*(["'])(?:LoginPWD|M_PW)\1/iu.test(html) &&
    /\bname\s*=\s*(["'])M_PORTAL_LOGIN_ACNT\1/iu.test(html)
  );
}

function assertSelection(selection: AisCourseCatalogSourceSelection): void {
  if (
    selection.academicYears.length === 0 ||
    new Set(selection.academicYears).size !== selection.academicYears.length ||
    selection.academicYears.some(
      (academicYear) => !/^\d{3}$/u.test(academicYear),
    )
  ) {
    throw new AisProtocolError("invalid_course_catalog_query");
  }
}

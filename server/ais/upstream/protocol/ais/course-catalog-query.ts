import { unwrapAisCallback } from "./callback.js";
import { decodeHtml, normalizeText } from "./html-table.js";
import { AisProtocolError } from "./protocol-error.js";

export const aisCourseCatalogRoutes = Object.freeze({
  publicShell: "/outside.aspx",
  entry: "/Application/TKE/TKE22/TKE2214_.aspx",
  query: "/Application/TKE/TKE22/TKE2210_01.aspx",
  detail: "/Application/TKE/TKE22/TKE2240_03.aspx",
});

export const courseCatalogPublicEntryQuery = "progcd=TKE2214";

export const courseCatalogAllowedInputNames = new Set([
  "__EVENTTARGET",
  "__EVENTARGUMENT",
  "__LASTFOCUS",
  "__VIEWSTATE",
  "__VIEWSTATEGENERATOR",
  "__VIEWSTATEENCRYPTED",
  "__EVENTVALIDATION",
  "ActivePageControl",
  "ColumnFilter",
  "SAYEAR",
  "QUERY_TYPE",
  "QUERY_COND",
  "Q_AYEAR",
  "Q_SMS",
  "Q_AYEARSMS",
  "Q_DEGREE_CODE",
  "Q_FACULTY_CODE",
  "Q_GRADE",
  "Q_CLASSID",
  "radioButtonClass",
  "Q_CH_LESSON",
  "radioButtonQuery",
  "Q_TCH_FACULTY_CODE",
  "Q_WEEK",
  "Q_CLASS",
  "Q_CLSSRM_BUILD",
  "Q_CLSSRM_ID",
  "hidLastTab",
  "hdnSelectedTab",
  "PC$PageSize",
  "PC$PageNo",
  "PC2$PageSize",
  "PC2$PageNo",
]);

export type AisCourseCatalogUnitQuery = Readonly<{
  academicYear: string;
}>;

export type AisCourseCatalogSelectionControl =
  "Q_AYEAR" | "Q_SMS" | "Q_DEGREE_CODE";

export type AisCourseCatalogPagination = Readonly<{
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
}>;

export type AisSelectOption = Readonly<{
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
}>;

export type AisCourseCatalogUnitOptions = Readonly<{
  years: readonly AisSelectOption[];
  terms: readonly AisSelectOption[];
  degrees: readonly AisSelectOption[];
  faculties: readonly AisSelectOption[];
  grades: readonly AisSelectOption[];
  classes: readonly AisSelectOption[];
}>;

/** Reproduce the three AutoPostBacks that refresh TKE2210 dependent state. */
export function buildCourseCatalogSelectionBody(
  baseFields: ReadonlyMap<string, string>,
  control: AisCourseCatalogSelectionControl,
  value: string,
): string {
  if (
    (control === "Q_AYEAR" && !/^\d{3}$/u.test(value)) ||
    (control !== "Q_AYEAR" && value !== "")
  )
    invalidRequest();
  const fields = requestFields(baseFields);
  clearSubmitControls(fields);
  fields.set(control, value);
  fields.set("__EVENTTARGET", control);
  fields.set("__LASTFOCUS", "");
  fields.set("ScriptManager1", `AjaxPanel|${control}`);
  fields.set("__ASYNCPOST", "true");
  return boundedBody(fields);
}

/** Change an existing unit-query result to the evidenced 100-row page size. */
export function buildCourseCatalogPageSizeBody(
  baseFields: ReadonlyMap<string, string>,
): string {
  const fields = requestFields(baseFields);
  clearSubmitControls(fields);
  fields.set("PC$PageSize", "100");
  fields.set("ActivePageControl", "PC");
  fields.set("__EVENTTARGET", "ReQuery");
  fields.set("ScriptManager1", "AjaxPanel|ReQuery");
  fields.set("__ASYNCPOST", "true");
  return boundedBody(fields);
}

/** Build the evidenced TKE2210 單位查詢 request. Blank values mean 全部. */
export function buildCourseCatalogUnitQueryBody(
  baseFields: ReadonlyMap<string, string>,
  query: AisCourseCatalogUnitQuery,
): string {
  assertUnitQuery(query);
  const fields = requestFields(baseFields);
  clearSubmitControls(fields);
  fields.set("Q_AYEAR", query.academicYear);
  fields.set("Q_SMS", "");
  fields.set("Q_DEGREE_CODE", "");
  fields.set("Q_FACULTY_CODE", "");
  fields.set("Q_GRADE", "");
  fields.set("Q_CLASSID", "");
  fields.set("QUERY_TYPE", "1");
  fields.set("__EVENTTARGET", "Q_DEGREE_CODE");
  fields.set("__LASTFOCUS", "");
  fields.set("QUERY_BTN1", "查詢");
  fields.set("ScriptManager1", "AjaxPanel|QUERY_BTN1");
  fields.set("__ASYNCPOST", "true");
  return boundedBody(fields);
}

/** Submit the visible page number through the page's evidenced ReQuery path. */
export function buildCourseCatalogPageBody(
  baseFields: ReadonlyMap<string, string>,
  pageNumber: number,
): string {
  if (
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > 99_999
  )
    invalidRequest();
  const fields = requestFields(baseFields);
  clearSubmitControls(fields);
  fields.set("PC$PageSize", "100");
  fields.set("PC$PageNo", String(pageNumber));
  fields.set("ActivePageControl", "PC");
  fields.set("__EVENTTARGET", "ReQuery");
  fields.set("ScriptManager1", "AjaxPanel|ReQuery");
  fields.set("__ASYNCPOST", "true");
  return boundedBody(fields);
}

export function buildCourseCatalogDetailBody(
  baseFields: ReadonlyMap<string, string>,
  eventTarget: string,
): string {
  if (!/^DataGrid\$ctl\d{2,4}\$COSID$/u.test(eventTarget)) invalidRequest();
  const fields = requestFields(baseFields);
  clearSubmitControls(fields);
  fields.set("__EVENTTARGET", eventTarget);
  fields.set("__EVENTARGUMENT", "");
  fields.set("ScriptManager1", `AjaxPanel|${eventTarget}`);
  fields.set("__ASYNCPOST", "true");
  return boundedBody(fields);
}

/** Merge ASP.NET hidden fields emitted after every callback into the next request state. */
export function mergeCourseCatalogCallbackState(
  previous: ReadonlyMap<string, string>,
  raw: string,
): ReadonlyMap<string, string> {
  const next = new Map(previous);
  for (const match of raw.matchAll(
    /(?:^|\|)hiddenField\|(__[A-Z0-9_]+)\|([^|]*)/giu,
  )) {
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    if (courseCatalogAllowedInputNames.has(name)) next.set(name, value);
  }
  for (const required of [
    "__VIEWSTATE",
    "__VIEWSTATEGENERATOR",
    "__EVENTVALIDATION",
  ]) {
    if ((next.get(required) ?? "") === "")
      throw new AisProtocolError("course_catalog_state_missing");
  }
  return next;
}

export function parseAisCourseCatalogPagination(
  raw: string,
): AisCourseCatalogPagination {
  const html = unwrapAisCallback(raw);
  const currentPage = parsePositiveInteger(inputValue(html, "PC_PageNo"));
  const totalPages = parsePositiveInteger(elementText(html, "PC_TotalPage"));
  const totalRows = parseNonNegativeInteger(elementText(html, "PC_TotalRow"));
  const pageSize = parsePositiveInteger(pageSizeValue(html));
  if (
    pageSize > 100 ||
    totalPages !== Math.max(1, Math.ceil(totalRows / pageSize))
  ) {
    throw new AisProtocolError("course_catalog_pagination_changed");
  }
  if (currentPage > totalPages)
    throw new AisProtocolError("course_catalog_pagination_changed");
  return { currentPage, pageSize, totalPages, totalRows };
}

export function parseAisCourseCatalogUnitOptions(
  html: string,
): AisCourseCatalogUnitOptions {
  return {
    years: selectOptions(html, "Q_AYEAR", false),
    terms: selectOptions(html, "Q_SMS", false),
    degrees: selectOptions(html, "Q_DEGREE_CODE", true),
    faculties: selectOptions(html, "Q_FACULTY_CODE", true),
    grades: selectOptions(html, "Q_GRADE", true),
    classes: selectOptions(html, "Q_CLASSID", true),
  };
}

/** Pin the official guest shell to the historical TKE2214 bootstrap page. */
export function parseAisCourseCatalogPublicShellTarget(html: string): URL {
  const iframe = html.match(/<iframe\b[^>]*\bid=["']mainIFrame["'][^>]*>/giu);
  if (iframe === null || iframe.length !== 1)
    throw new AisProtocolError("course_catalog_public_entry_changed");

  const expectedSource = `${aisCourseCatalogRoutes.entry}?${courseCatalogPublicEntryQuery}`;
  const source = attribute(iframe[0] ?? "", "src", true);
  if (source !== expectedSource)
    throw new AisProtocolError("course_catalog_public_entry_changed");
  return new URL(
    source,
    new URL(aisCourseCatalogRoutes.publicShell, "https://ais.ntou.edu.tw"),
  );
}

/** Require the bootstrap's explicit same-frame redirect onto TKE2210_01. */
export function parseAisCourseCatalogPublicEntryRedirect(html: string): void {
  const matches = [
    ...html.matchAll(
      /top\.mainFrame\.location\.href\s*=\s*(["'])(?:\.\/)?TKE2210_01\.aspx\1/giu,
    ),
  ];
  if (matches.length !== 1)
    throw new AisProtocolError("course_catalog_public_entry_changed");
}

/** Extract only the allowlisted detail leaf URL revealed by a COSID postback. */
export function parseAisCourseCatalogDetailUrl(raw: string, baseUrl: URL): URL {
  const html = decodeHtml(unwrapAisCallback(raw));
  const matches = [
    ...html.matchAll(
      /(?:\.\/)?Application\/TKE\/TKE22\/TKE2240_03\.aspx\?PKNO=(\d{1,12})#?/giu,
    ),
  ];
  const ids = [...new Set(matches.map((match) => match[1] ?? ""))];
  if (ids.length !== 1)
    throw new AisProtocolError("course_detail_target_changed");
  const url = new URL(
    `${aisCourseCatalogRoutes.detail}?PKNO=${ids[0]}`,
    baseUrl,
  );
  if (
    url.origin !== baseUrl.origin ||
    url.pathname !== aisCourseCatalogRoutes.detail
  )
    throw new AisProtocolError("course_detail_target_changed");
  return url;
}

function assertUnitQuery(query: AisCourseCatalogUnitQuery): void {
  if (!/^\d{3}$/u.test(query.academicYear)) invalidRequest();
}

function requestFields(
  baseFields: ReadonlyMap<string, string>,
): URLSearchParams {
  const fields = new URLSearchParams();
  for (const [name, value] of baseFields) {
    if (courseCatalogAllowedInputNames.has(name)) fields.set(name, value);
  }
  for (const required of [
    "__VIEWSTATE",
    "__VIEWSTATEGENERATOR",
    "__EVENTVALIDATION",
  ]) {
    if ((fields.get(required) ?? "") === "")
      throw new AisProtocolError("course_catalog_state_missing");
  }
  return fields;
}

function clearSubmitControls(fields: URLSearchParams): void {
  for (const name of [
    "QUERY_BTN1",
    "PC$ShowRows",
    "PC$ToGo",
    "ScriptManager1",
    "__ASYNCPOST",
  ])
    fields.delete(name);
  fields.set("__EVENTTARGET", "");
  fields.set("__EVENTARGUMENT", "");
}

function boundedBody(fields: URLSearchParams): string {
  const body = fields.toString();
  if (new TextEncoder().encode(body).byteLength > 524_288)
    throw new AisProtocolError("invalid_callback_length");
  return body;
}

function inputValue(html: string, id: string): string {
  const input = elementTag(html, "input", id);
  return attribute(input, "value");
}

function selectedOptionValue(html: string, id: string): string {
  const select = elementContent(html, "select", id);
  const selected = select.match(/<option\b(?=[^>]*\bselected\b)([^>]*)>/iu);
  if (selected === null)
    throw new AisProtocolError("course_catalog_pagination_changed");
  return attribute(selected[1] ?? "", "value");
}

function pageSizeValue(html: string): string {
  if (
    new RegExp(`<input\\b(?=[^>]*\\bid=["']PC_PageSize["'])`, "iu").test(html)
  ) {
    return inputValue(html, "PC_PageSize");
  }
  return selectedOptionValue(html, "PC_PageSize");
}

function elementText(html: string, id: string): string {
  return normalizeText(
    decodeHtml(
      elementContent(html, "(?:span|label|div)", id).replace(/<[^>]+>/gu, " "),
    ),
  );
}

function elementTag(html: string, tag: string, id: string): string {
  const escaped = escapeRegExp(id);
  const match = html.match(
    new RegExp(`<${tag}\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>`, "iu"),
  );
  if (match === null)
    throw new AisProtocolError("course_catalog_pagination_changed");
  return match[0];
}

function elementContent(html: string, tag: string, id: string): string {
  const escaped = escapeRegExp(id);
  const match = html.match(
    new RegExp(
      `<${tag}\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>([\\s\\S]*?)<\\/(?:${tag})>`,
      "iu",
    ),
  );
  if (match === null)
    throw new AisProtocolError("course_catalog_pagination_changed");
  return match[1] ?? "";
}

function selectOptions(
  html: string,
  name: string,
  requireAllOption: boolean,
): readonly AisSelectOption[] {
  const escaped = escapeRegExp(name);
  const match = html.match(
    new RegExp(
      `<select\\b(?=[^>]*\\bname=["']${escaped}["'])[^>]*>([\\s\\S]*?)<\\/select>`,
      "iu",
    ),
  );
  if (match === null)
    throw new AisProtocolError("course_catalog_options_changed");
  const options = [
    ...(match[1] ?? "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu),
  ].map((option) => ({
    value: attribute(option[1] ?? "", "value", true),
    label: normalizeText(
      decodeHtml((option[2] ?? "").replace(/<[^>]+>/gu, " ")),
    ),
    selected: /\bselected\b/iu.test(option[1] ?? ""),
    disabled: /\bdisabled\b/iu.test(option[1] ?? ""),
  }));
  if (
    options.length === 0 ||
    (requireAllOption && !options.some((option) => option.value === ""))
  )
    throw new AisProtocolError("course_catalog_options_changed");
  return options;
}

function attribute(source: string, name: string, allowMissing = false): string {
  const escaped = escapeRegExp(name);
  const match = source.match(
    new RegExp(
      `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "iu",
    ),
  );
  if (match === null) {
    if (allowMissing) return "";
    throw new AisProtocolError("course_catalog_pagination_changed");
  }
  return decodeHtml(match[1] ?? match[2] ?? match[3] ?? "");
}

function parsePositiveInteger(value: string): number {
  const parsed = parseNonNegativeInteger(value);
  if (parsed < 1)
    throw new AisProtocolError("course_catalog_pagination_changed");
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  if (!/^\d+$/u.test(value))
    throw new AisProtocolError("course_catalog_pagination_changed");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new AisProtocolError("course_catalog_pagination_changed");
  return parsed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function invalidRequest(): never {
  throw new AisProtocolError("invalid_course_catalog_query");
}

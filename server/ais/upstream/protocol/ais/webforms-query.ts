import { AisProtocolError } from "./protocol-error.js";
import { assertAisGradesQuery, type AisGradesQuery } from "./grades-query.js";

const requiredHiddenFields = [
  "__VIEWSTATE",
  "__VIEWSTATEGENERATOR",
  "__EVENTVALIDATION",
];

type SuccessfulControlType =
  | "hidden"
  | "text"
  | "number"
  | "radio"
  | "select-one"
  | "select-multiple"
  | "textarea";

export type WebFormsControlPolicy = Readonly<{
  controls: ReadonlyMap<string, SuccessfulControlType>;
}>;

export const timetableQueryControlPolicy = policy({
  __EVENTTARGET: "hidden",
  __EVENTARGUMENT: "hidden",
  __CRYSTALSTATECrystalReportViewer: "hidden",
  __VIEWSTATE: "hidden",
  __VIEWSTATEGENERATOR: "hidden",
  __VIEWSTATEENCRYPTED: "hidden",
  __EVENTVALIDATION: "hidden",
  ActivePageControl: "hidden",
  ColumnFilter: "hidden",
  SAYEAR: "hidden",
  printType: "hidden",
  M_STNO: "hidden",
  QUERY_COND: "hidden",
  Q_AYEARSMS: "hidden",
  Q_STNO: "hidden",
  PC$PageSize: "number",
  PC$PageNo: "number",
  PC2$PageSize: "number",
  PC2$PageNo: "number",
  Q_AYEAR: "select-one",
  Q_SMS: "select-one",
});

export const gradesQueryControlPolicy = policy({
  __EVENTTARGET: "hidden",
  __EVENTARGUMENT: "hidden",
  __VIEWSTATE: "hidden",
  __VIEWSTATEGENERATOR: "hidden",
  __VIEWSTATEENCRYPTED: "hidden",
  __EVENTVALIDATION: "hidden",
  ActivePageControl: "hidden",
  ColumnFilter: "hidden",
  QUERY_TYPE_TEMP: "hidden",
  AYEARSMS_TEMP: "hidden",
  AYEAR_TEMP: "hidden",
  DEGREE_CODE: "hidden",
  QUERY_TYPE: "radio",
  Q_AYEARSMS: "text",
  Q_AYEAR: "text",
  PC$PageSize: "number",
  PC$PageNo: "number",
  PC2$PageSize: "number",
  PC2$PageNo: "number",
});

export const gradesDetailControlPolicy = policy({
  __EVENTTARGET: "hidden",
  __EVENTARGUMENT: "hidden",
  __CRYSTALSTATECrystalReportViewer: "hidden",
  __VIEWSTATE: "hidden",
  __VIEWSTATEGENERATOR: "hidden",
  __VIEWSTATEENCRYPTED: "hidden",
  __EVENTVALIDATION: "hidden",
  ActivePageControl: "hidden",
  ColumnFilter: "hidden",
  QUERY_TYPE: "hidden",
  QUERY_VALUE: "hidden",
  STNO: "hidden",
  STUDY_STATUS: "hidden",
  ASYS_CODE: "hidden",
  DEGREE_CODE: "hidden",
  COLLEGE_CODE: "hidden",
  FACULTY_CODE: "hidden",
  TEACH_GRP: "hidden",
  GRAD_YYMM: "hidden",
  IS_MOMENT: "hidden",
  SMS_FMARK_DESC: "hidden",
  TEMP_SMS_FMARK_DESC: "hidden",
  MARK_INPT_METHOD: "hidden",
});

export function parseWebFormsQueryPage(
  html: string,
  expectedUrl: URL,
  allowedInputNames: ReadonlySet<string>,
): ReadonlyMap<string, string>;
export function parseWebFormsQueryPage(
  html: string,
  expectedUrl: URL,
  controlPolicy: WebFormsControlPolicy,
): URLSearchParams;
export function parseWebFormsQueryPage(
  html: string,
  expectedUrl: URL,
  allowedControls: ReadonlySet<string> | WebFormsControlPolicy,
): ReadonlyMap<string, string> | URLSearchParams {
  const forms = [
    ...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/giu),
  ].filter((match) => {
    const attributes = parseAttributes(match[1] ?? "");
    return (
      attributes.get("name") === "QUERY" && attributes.get("id") === "QUERY"
    );
  });
  if (forms.length !== 1) throw new AisProtocolError("missing_required_header");
  const attributes = parseAttributes(forms[0]?.[1] ?? "");
  let action: URL;
  try {
    action = new URL(attributes.get("action") ?? "", expectedUrl);
  } catch {
    throw new AisProtocolError("invalid_callback_envelope");
  }
  if (
    action.href !== expectedUrl.href ||
    attributes.get("method")?.toLowerCase() !== "post"
  ) {
    throw new AisProtocolError("invalid_callback_envelope");
  }

  const fields = isControlPolicy(allowedControls)
    ? new URLSearchParams()
    : new Map<string, string>();
  let fieldCount = 0;
  const append = (name: string, value: string): void => {
    if (!validControlName(name) || [...value].length > 262_144) {
      throw new AisProtocolError("invalid_callback_length");
    }
    fieldCount += 1;
    if (fieldCount > 512) {
      throw new AisProtocolError("invalid_callback_length");
    }
    if (fields.has(name)) {
      throw new AisProtocolError("invalid_callback_envelope");
    }
    if (fields instanceof URLSearchParams) {
      fields.append(name, value);
    } else {
      fields.set(name, value);
    }
  };

  for (const match of (forms[0]?.[2] ?? "").matchAll(/<input\b[^>]*>/giu)) {
    const input = parseAttributes(match[0]);
    const name = input.get("name");
    if (name === undefined || input.has("disabled")) continue;
    const type = (input.get("type") ?? "text").toLowerCase();
    if (["checkbox", "radio"].includes(type) && !input.has("checked")) continue;
    if (["submit", "button", "reset", "file", "image"].includes(type)) continue;
    if (!allowsControl(allowedControls, name, type)) continue;
    append(
      name,
      input.get("value") ??
        (type === "checkbox" || type === "radio" ? "on" : ""),
    );
  }

  for (const match of (forms[0]?.[2] ?? "").matchAll(
    /<select\b([^>]*)>([\s\S]*?)<\/select>/giu,
  )) {
    const select = parseAttributes(match[1] ?? "");
    const name = select.get("name");
    if (name === undefined || select.has("disabled")) continue;
    const selectType = select.has("multiple")
      ? "select-multiple"
      : "select-one";
    if (!allowsControl(allowedControls, name, selectType)) continue;
    const options = [
      ...(match[2] ?? "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu),
    ].map((option) => ({
      attributes: parseAttributes(option[1] ?? ""),
      text: decodeHtml((option[2] ?? "").replace(/<[^>]+>/gu, "")).trim(),
    }));
    const enabled = options.filter(
      (option) => !option.attributes.has("disabled"),
    );
    let selected = enabled.filter((option) =>
      option.attributes.has("selected"),
    );
    if (
      !select.has("multiple") &&
      selected.length === 0 &&
      enabled[0] !== undefined
    ) {
      selected = [enabled[0]];
    }
    if (!select.has("multiple") && selected.length > 1) {
      selected = [selected[selected.length - 1]!];
    }
    if (!select.has("multiple") && selected.length === 0) {
      throw new AisProtocolError("invalid_callback_envelope");
    }
    for (const option of selected) {
      append(name, option.attributes.get("value") ?? option.text);
    }
  }

  for (const match of (forms[0]?.[2] ?? "").matchAll(
    /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/giu,
  )) {
    const textarea = parseAttributes(match[1] ?? "");
    const name = textarea.get("name");
    if (name === undefined || textarea.has("disabled")) continue;
    if (!allowsControl(allowedControls, name, "textarea")) continue;
    append(name, decodeHtml(match[2] ?? ""));
  }

  for (const name of requiredHiddenFields) {
    if ((fields.get(name) ?? "") === "") {
      throw new AisProtocolError("missing_required_header");
    }
  }
  return fields;
}

export function deriveTimetableAcademicTermOptions(
  html: string,
  expectedUrl: URL,
): readonly Readonly<{ rocYear: number; term: number }>[] {
  parseWebFormsQueryPage(html, expectedUrl, timetableQueryControlPolicy);
  const form = queryFormBody(html);
  const years = integerSelectOptions(form, "Q_AYEAR", 1, 999);
  const terms = integerSelectOptions(form, "Q_SMS", 1, 4);
  const regularTerms = terms.values
    .filter((term) => term === 1 || term === 2)
    .sort((left, right) => left - right);
  if (regularTerms.length === 0) {
    throw new AisProtocolError("invalid_callback_envelope");
  }

  return years.values
    .filter((rocYear) => rocYear <= years.selected)
    .sort((left, right) => right - left)
    .flatMap((rocYear) =>
      regularTerms
        .filter((term) => rocYear < years.selected || term <= terms.selected)
        .map((term) => ({ rocYear, term })),
    );
}

function queryFormBody(html: string): string {
  const forms = [
    ...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/giu),
  ].filter((match) => {
    const attributes = parseAttributes(match[1] ?? "");
    return (
      attributes.get("name") === "QUERY" && attributes.get("id") === "QUERY"
    );
  });
  if (forms.length !== 1) throw new AisProtocolError("missing_required_header");
  return forms[0]?.[2] ?? "";
}

function integerSelectOptions(
  form: string,
  name: string,
  minimum: number,
  maximum: number,
): Readonly<{ values: readonly number[]; selected: number }> {
  const selects = [
    ...form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/giu),
  ].filter((match) => parseAttributes(match[1] ?? "").get("name") === name);
  if (selects.length !== 1) {
    throw new AisProtocolError("invalid_callback_envelope");
  }
  const options = [
    ...(selects[0]?.[2] ?? "").matchAll(
      /<option\b([^>]*)>([\s\S]*?)<\/option>/giu,
    ),
  ].map((option) => {
    const attributes = parseAttributes(option[1] ?? "");
    const text = decodeHtml((option[2] ?? "").replace(/<[^>]+>/gu, "")).trim();
    const value = (attributes.get("value") ?? text).trim();
    if (!/^\d{1,3}$/u.test(value)) {
      throw new AisProtocolError("invalid_callback_envelope");
    }
    const parsed = Number(value);
    if (parsed < minimum || parsed > maximum) {
      throw new AisProtocolError("invalid_callback_envelope");
    }
    return {
      enabled: !attributes.has("disabled"),
      selected: attributes.has("selected"),
      value: parsed,
    };
  });
  if (
    options.length === 0 ||
    options.length !== new Set(options.map((option) => option.value)).size
  ) {
    throw new AisProtocolError("invalid_callback_envelope");
  }
  const enabled = options.filter((option) => option.enabled);
  const selected = enabled.filter((option) => option.selected);
  if (enabled.length === 0 || selected.length > 1) {
    throw new AisProtocolError("invalid_callback_envelope");
  }
  return {
    values: enabled.map((option) => option.value),
    selected: (selected[0] ?? enabled[0])!.value,
  };
}

export function buildTimetableQueryBody(
  baseFields: WebFormsFields,
  term: Readonly<{ rocYear: number; term: number }>,
  operation: "list" | "grid",
): string {
  assertRegularTerm(term);
  const fields = safeBaseFields(baseFields);
  replaceField(fields, "Q_AYEAR", String(term.rocYear));
  replaceField(fields, "Q_SMS", String(term.term));
  if (baseFields.has("Q_AYEARSMS")) {
    replaceField(fields, "Q_AYEARSMS", `${term.rocYear}${term.term}`);
  }
  const control = operation === "list" ? "QUERY_BTN1" : "QUERY_BTN3";
  if (operation === "list") {
    if (baseFields.has("PC$PageSize")) {
      replaceField(fields, "PC$PageSize", "100");
    }
    if (baseFields.has("PC2$PageSize")) {
      replaceField(fields, "PC2$PageSize", "100");
    }
  }
  replaceField(fields, control, operation === "list" ? "選課清單" : "選課課表");
  return boundedBody(fields);
}

export function buildGradesQueryBody(
  baseFields: WebFormsFields,
  query: AisGradesQuery,
): string {
  try {
    assertAisGradesQuery(query);
  } catch {
    throw new AisProtocolError("invalid_callback_envelope");
  }
  const fields = safeBaseFields(baseFields);
  const queryType =
    query.kind === "semester"
      ? semesterQueryType(baseFields)
      : query.kind === "academic_year"
        ? "RB_TYPE_2"
        : "RB_TYPE_3";
  replaceField(fields, "QUERY_TYPE", queryType);
  if (baseFields.has("QUERY_TYPE_TEMP")) {
    replaceField(fields, "QUERY_TYPE_TEMP", queryType);
  }
  if (query.kind === "semester") {
    replaceField(fields, "Q_AYEARSMS", query.termId);
    const rocYear = query.termId.slice(0, 3);
    if (baseFields.has("Q_AYEAR")) {
      replaceField(fields, "Q_AYEAR", rocYear);
    }
    if (baseFields.has("AYEARSMS_TEMP")) {
      replaceField(fields, "AYEARSMS_TEMP", query.termId);
    }
    if (baseFields.has("AYEAR_TEMP")) {
      replaceField(fields, "AYEAR_TEMP", query.termId);
    }
  }
  if (query.kind === "academic_year") {
    replaceField(fields, "Q_AYEAR", String(query.rocYear));
    if (baseFields.has("AYEAR_TEMP")) {
      replaceField(fields, "AYEAR_TEMP", String(query.rocYear));
    }
  }
  if (baseFields.has("PC$PageSize")) {
    replaceField(fields, "PC$PageSize", "100");
  }
  if (baseFields.has("PC2$PageSize")) {
    replaceField(fields, "PC2$PageSize", "100");
  }
  replaceField(fields, "QUERY_BTN1", "查詢");
  return boundedBody(fields);
}

export function buildGradesDetailPostbackBody(
  html: string,
  detailUrl: URL,
): string | null {
  const postbacks = [
    ...html.matchAll(/__doPostBack\(\s*(["'])ReQuery\1\s*,\s*(["'])\2\s*\)/giu),
  ];
  if (postbacks.length === 0) return null;
  if (postbacks.length !== 1) {
    throw new AisProtocolError("grades_detail_target_changed");
  }
  const fields = parseWebFormsQueryPage(
    html,
    detailUrl,
    gradesDetailControlPolicy,
  );
  const body = safeBaseFields(fields);
  replaceField(body, "__EVENTTARGET", "ReQuery");
  replaceField(body, "__EVENTARGUMENT", "");
  return boundedBody(body);
}

function semesterQueryType(baseFields: WebFormsFields): string {
  const value = baseFields.get("QUERY_TYPE");
  if (value !== "RB_TYPE_1" && value !== "1") {
    throw new AisProtocolError("invalid_callback_envelope");
  }
  return value;
}

function safeBaseFields(baseFields: WebFormsFields): URLSearchParams {
  const fields = new URLSearchParams();
  for (const [name, value] of baseFields) {
    if ([...name].length > 80 || [...value].length > 262_144) {
      throw new AisProtocolError("invalid_callback_length");
    }
    fields.append(name, value);
  }
  return fields;
}

function replaceField(
  fields: URLSearchParams,
  name: string,
  value: string,
): void {
  fields.delete(name);
  fields.append(name, value);
}

type WebFormsFields = Iterable<readonly [string, string]> & {
  has(name: string): boolean;
  get(name: string): string | null | undefined;
};

function policy(
  controls: Readonly<Record<string, SuccessfulControlType>>,
): WebFormsControlPolicy {
  return { controls: new Map(Object.entries(controls)) };
}

function isControlPolicy(
  value: ReadonlySet<string> | WebFormsControlPolicy,
): value is WebFormsControlPolicy {
  return "controls" in value;
}

function allowsControl(
  allowed: ReadonlySet<string> | WebFormsControlPolicy,
  name: string,
  actualType: string,
): boolean {
  if (!isControlPolicy(allowed)) return allowed.has(name);
  const expectedType = allowed.controls.get(name);
  if (expectedType === undefined || expectedType !== actualType) {
    throw new AisProtocolError("invalid_callback_envelope");
  }
  return true;
}

function validControlName(value: string): boolean {
  return (
    value !== "" &&
    [...value].length <= 160 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function boundedBody(fields: URLSearchParams): string {
  const encoded = fields.toString();
  if (new TextEncoder().encode(encoded).byteLength > 524_288) {
    throw new AisProtocolError("invalid_callback_length");
  }
  return encoded;
}

function assertRegularTerm(
  term: Readonly<{ rocYear: number; term: number }>,
): void {
  if (
    !Number.isSafeInteger(term.rocYear) ||
    term.rocYear < 1 ||
    term.rocYear > 999 ||
    (term.term !== 1 && term.term !== 2)
  ) {
    throw new AisProtocolError("invalid_callback_envelope");
  }
}

function parseAttributes(value: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of value.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu,
  )) {
    const name = (match[1] ?? "").toLowerCase();
    if (name !== "" && !attributes.has(name)) {
      attributes.set(name, decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
    }
  }
  return attributes;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

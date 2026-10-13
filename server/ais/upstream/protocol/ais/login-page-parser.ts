const aisOrigin = "https://ais.ntou.edu.tw";
const maximumHtmlBytes = 262_144;

export type AisPasswordVariant = "current" | "legacy";

export type AisLoginForm = Readonly<{
  hiddenFields: ReadonlyMap<string, string>;
  captchaUrl: URL;
  passwordVariant: AisPasswordVariant;
}>;

export type AisLoginPageFailureCode =
  | "login_page_too_large"
  | "invalid_login_form"
  | "missing_login_hidden_field"
  | "invalid_login_hidden_field"
  | "invalid_login_control"
  | "missing_login_captcha"
  | "invalid_login_captcha_url";

export class AisLoginPageError extends Error {
  constructor(readonly code: AisLoginPageFailureCode) {
    super(code);
    this.name = "AisLoginPageError";
  }
}

const hiddenNames = [
  "__VIEWSTATE",
  "__VIEWSTATEGENERATOR",
  "__VIEWSTATEENCRYPTED",
  "__EVENTVALIDATION",
] as const;
const passwordVariants = {
  current: "LoginPWD",
  legacy: "M_PW",
} as const;

export function parseAisLoginPage(html: string): AisLoginForm {
  if (new TextEncoder().encode(html).byteLength > maximumHtmlBytes) {
    throw new AisLoginPageError("login_page_too_large");
  }
  const forms = [
    ...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/giu),
  ].filter((match) => {
    const attributes = parseAttributes(match[1] ?? "");
    return isLoginAction(attributes.get("action"));
  });
  if (forms.length !== 1) throw new AisLoginPageError("invalid_login_form");
  const formAttributes = parseAttributes(forms[0]?.[1] ?? "");
  if (formAttributes.get("method")?.toLowerCase() !== "post") {
    throw new AisLoginPageError("invalid_login_form");
  }

  const formHtml = forms[0]?.[2] ?? "";
  const controls = new Map<string, ReadonlyMap<string, string>>();
  for (const match of formHtml.matchAll(/<input\b[^>]*>/giu)) {
    const attributes = parseAttributes(match[0], true);
    const name = attributes.get("name");
    if (name === undefined) continue;
    if (controls.has(name))
      throw new AisLoginPageError("invalid_login_control");
    controls.set(name, attributes);
  }

  const hiddenFields = new Map<string, string>();
  for (const name of hiddenNames) {
    const control = controls.get(name);
    if (control === undefined)
      throw new AisLoginPageError("missing_login_hidden_field");
    if (control.get("type")?.toLowerCase() !== "hidden") {
      throw new AisLoginPageError("invalid_login_hidden_field");
    }
    const value = control.get("value") ?? "";
    if (value.length > 131_072)
      throw new AisLoginPageError("invalid_login_hidden_field");
    hiddenFields.set(name, value);
  }
  for (const required of [
    "__VIEWSTATE",
    "__VIEWSTATEGENERATOR",
    "__EVENTVALIDATION",
  ]) {
    if ((hiddenFields.get(required) ?? "") === "") {
      throw new AisLoginPageError("invalid_login_hidden_field");
    }
  }
  validateLength(controls, "M_PORTAL_LOGIN_ACNT", 10);
  validateLength(controls, "M_PW2", 4);
  if (controls.get("LGOIN_BTN")?.get("value") !== "登入/Login") {
    throw new AisLoginPageError("invalid_login_control");
  }
  const variants = Object.entries(passwordVariants).filter(([, name]) =>
    controls.has(name),
  );
  if (variants.length !== 1)
    throw new AisLoginPageError("invalid_login_control");
  const [variant, passwordName] = variants[0] as [AisPasswordVariant, string];
  const password = controls.get(passwordName);
  if (
    password?.get("type")?.toLowerCase() !== "password" ||
    (password.has("maxlength") && password.get("maxlength") !== "12")
  ) {
    throw new AisLoginPageError("invalid_login_control");
  }

  const images = [...formHtml.matchAll(/<img\b[^>]*>/giu)].filter(
    (match) => parseAttributes(match[0]).get("id") === "importantImg",
  );
  if (images.length !== 1) throw new AisLoginPageError("missing_login_captcha");
  const source = parseAttributes(images[0]?.[0] ?? "").get("src");
  if (source === undefined)
    throw new AisLoginPageError("missing_login_captcha");
  return {
    hiddenFields,
    captchaUrl: validateCaptchaUrl(source),
    passwordVariant: variant,
  };
}

function validateLength(
  controls: ReadonlyMap<string, ReadonlyMap<string, string>>,
  name: string,
  length: number,
): void {
  if (controls.get(name)?.get("maxlength") !== String(length)) {
    throw new AisLoginPageError("invalid_login_control");
  }
}

function isLoginAction(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const url = new URL(value, `${aisOrigin}/Default.aspx`);
    return (
      url.origin === aisOrigin &&
      url.pathname === "/Default.aspx" &&
      url.search === ""
    );
  } catch {
    return false;
  }
}

function validateCaptchaUrl(source: string): URL {
  let url: URL;
  try {
    url = new URL(source, `${aisOrigin}/Default.aspx`);
  } catch {
    throw new AisLoginPageError("invalid_login_captcha_url");
  }
  const query = [...url.searchParams];
  if (
    url.origin !== aisOrigin ||
    !/^\/Temp\/Captcha\/[A-Za-z0-9_-]{24}\.png$/u.test(url.pathname) ||
    query.length !== 1 ||
    !/^[A-Za-z0-9_-]{1,32}$/u.test(query[0]?.[0] ?? "") ||
    (query[0]?.[1].length ?? 0) < 1 ||
    (query[0]?.[1].length ?? 0) > 128
  ) {
    throw new AisLoginPageError("invalid_login_captcha_url");
  }
  return url;
}

const duplicateNameAliases: Readonly<Record<string, string>> = {
  M_PORTAL_LOGIN_ACNT: "Account Text",
  LoginPWD: "Password Text",
};

function parseAttributes(
  value: string,
  allowKnownDuplicateName = false,
): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  let acceptedDuplicateName = false;
  for (const match of value.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu,
  )) {
    const name = (match[1] ?? "").toLowerCase();
    if (name === "") continue;
    const decoded = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
    if (attributes.has(name)) {
      const canonicalName = attributes.get(name);
      if (
        allowKnownDuplicateName &&
        name === "name" &&
        !acceptedDuplicateName &&
        canonicalName !== undefined &&
        duplicateNameAliases[canonicalName] === decoded
      ) {
        acceptedDuplicateName = true;
        continue;
      }
      throw new AisLoginPageError("invalid_login_control");
    }
    attributes.set(name, decoded);
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

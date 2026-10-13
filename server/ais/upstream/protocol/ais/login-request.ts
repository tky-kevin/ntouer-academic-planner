import type { AisLoginForm, AisPasswordVariant } from "./login-page-parser.js";

const passwordNames: Readonly<Record<AisPasswordVariant, string>> = {
  current: "LoginPWD",
  legacy: "M_PW",
};

export function buildAisLoginBody(
  form: Pick<AisLoginForm, "hiddenFields" | "passwordVariant">,
  credentials: Readonly<{
    account: string;
    password: string;
    captchaCode: string;
  }>,
): string {
  const account = credentials.account.trim().toUpperCase();
  const captchaCode = credentials.captchaCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/u.test(account)) throw new Error("invalid_account");
  if (
    [...credentials.password].length < 1 ||
    [...credentials.password].length > 12 ||
    /[\u0000-\u001f\u007f]/u.test(credentials.password)
  ) {
    throw new Error("invalid_password");
  }
  if (!/^[A-Z0-9]{4}$/u.test(captchaCode)) throw new Error("invalid_captcha");

  const body = new URLSearchParams();
  for (const [name, value] of form.hiddenFields) body.set(name, value);
  body.set("M_PORTAL_LOGIN_ACNT", account);
  body.set(passwordNames[form.passwordVariant], credentials.password);
  body.set("M_PW2", captchaCode);
  body.set("LGOIN_BTN", "登入/Login");
  return body.toString();
}

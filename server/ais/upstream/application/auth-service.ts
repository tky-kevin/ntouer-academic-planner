import { aisText } from "./ais-response.js";
import { GatewayError } from "./gateway-error.js";
import type {
  CaptchaSolver,
  AccountScopeDeriver,
  GatewaySession,
  GatewaySessionStore,
} from "./ports/gateway-session.js";
import {
  assertAuthenticatedAisShell,
  parseAuthenticatedAisShell,
} from "../protocol/ais/authenticated-shell-parser.js";
import {
  AisLoginPageError,
  parseAisLoginPage,
} from "../protocol/ais/login-page-parser.js";
import { buildAisLoginBody } from "../protocol/ais/login-request.js";
import { AisProtocolError } from "../protocol/ais/protocol-error.js";

const loginUrl = new URL("https://ais.ntou.edu.tw/Default.aspx");
const loginBootstrapUrl = new URL("https://ais.ntou.edu.tw/DefaultQ.aspx");
const authenticatedShellUrl = new URL("https://ais.ntou.edu.tw/MainFrame.aspx");
const logoutUrl = new URL("https://ais.ntou.edu.tw/LogOut.aspx");
const logoutCompletionUrl = new URL("https://ais.ntou.edu.tw/Logout.htm");
const maximumAttempts = 3;
const captchaFailurePattern = /驗證碼.*(?:錯誤|有誤)|(?:錯誤|有誤).*驗證碼/u;

export class AuthService {
  constructor(
    private readonly sessions: GatewaySessionStore,
    private readonly captchaSolver: CaptchaSolver,
    private readonly accountScopes: AccountScopeDeriver,
  ) {}

  createSession(): Promise<Readonly<{ id: string; csrfToken: string }>> {
    return this.sessions.create();
  }

  async logout(sessionId: string): Promise<void> {
    try {
      await this.sessions.use(sessionId, async (session) => {
        if (!session.authenticated) return;
        const logout = await execute(session, {
          operation: "logout",
          method: "GET",
          url: logoutUrl,
          headers: { accept: "text/html" },
          maximumResponseBytes: 262_144,
          timeoutMs: 10_000,
        });
        aisText(logout, "logout", ["text/html"]);
        const completion = await execute(session, {
          operation: "complete_logout",
          method: "GET",
          url: logoutCompletionUrl,
          headers: { accept: "text/html", referer: logoutUrl.href },
          maximumResponseBytes: 262_144,
          timeoutMs: 10_000,
        });
        aisText(completion, "logout", ["text/html"]);
        session.authenticated = false;
      });
    } finally {
      await this.sessions.delete(sessionId);
    }
  }

  async login(
    sessionId: string,
    credentials: Readonly<{ account: string; password: string }>,
  ): Promise<string> {
    const result = await this.sessions.use(sessionId, async (session) => {
      session.authenticated = false;
      for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        const challenge = await this.challenge(session);
        const captchaCode = normalizeCaptchaCode(
          await this.captchaSolver.solve(challenge.image),
        );
        if (captchaCode === null) {
          if (attempt < maximumAttempts) continue;
          throw captchaUnavailable();
        }

        let body: string;
        try {
          body = buildAisLoginBody(challenge.form, {
            ...credentials,
            captchaCode,
          });
        } catch {
          throw new GatewayError(
            400,
            "invalidRequest",
            "login",
            false,
            "INVALID_LOGIN_REQUEST",
          );
        }
        const response = await execute(session, {
          operation: "login",
          method: "POST",
          url: loginUrl,
          headers: {
            accept: "text/html",
            "content-type": "application/x-www-form-urlencoded",
            referer: loginUrl.href,
          },
          body,
          maximumResponseBytes: 262_144,
          timeoutMs: 15_000,
        });
        const html = aisText(response, "login", ["text/html"]);
        const followsScriptRedirect = redirectsToAuthenticatedShell(html);
        try {
          let authenticatedHtml = html;
          if (followsScriptRedirect) {
            const shellResponse = await execute(session, {
              operation: "login_shell",
              method: "GET",
              url: authenticatedShellUrl,
              headers: { accept: "text/html", referer: loginUrl.href },
              maximumResponseBytes: 262_144,
              timeoutMs: 10_000,
            });
            authenticatedHtml = aisText(shellResponse, "login", ["text/html"]);
          }
          assertAuthenticatedAisShell(authenticatedHtml);
          if (followsScriptRedirect) {
            await bootstrapAuthenticatedFrames(
              session,
              parseAuthenticatedAisShell(authenticatedHtml),
            );
          }
          const cacheScope = await this.accountScopes.derive(
            credentials.account.trim().toUpperCase(),
          );
          session.authenticated = true;
          return cacheScope;
        } catch (error) {
          if (!followsScriptRedirect && looksLikeLoginPage(html)) {
            if (captchaFailurePattern.test(html) && attempt < maximumAttempts) {
              continue;
            }
            throw new GatewayError(
              401,
              "authenticationRequired",
              "login",
              true,
              captchaFailurePattern.test(html)
                ? "CAPTCHA_RECOGNITION_EXHAUSTED"
                : "AIS_LOGIN_REJECTED",
            );
          }
          if (error instanceof AisProtocolError) {
            throw contractChanged("login", "AIS_AUTH_SHELL_CHANGED");
          }
          throw error;
        }
      }
      throw captchaUnavailable();
    });
    if (result === null) throw sessionRequired("login");
    return result;
  }

  private async challenge(session: GatewaySession): Promise<
    Readonly<{
      form: ReturnType<typeof parseAisLoginPage>;
      image: Uint8Array;
    }>
  > {
    const pageResponse = await execute(session, {
      operation: "create_auth_challenge",
      method: "GET",
      url: loginUrl,
      headers: { accept: "text/html" },
      maximumResponseBytes: 262_144,
      timeoutMs: 10_000,
    });
    let html = aisText(pageResponse, "create_auth_challenge", ["text/html"]);
    let form;
    try {
      form = parseAisLoginPage(html);
    } catch (error) {
      if (
        error instanceof AisLoginPageError &&
        error.code === "missing_login_captcha" &&
        requiresCaptchaBootstrap(html)
      ) {
        const bootstrap = await execute(session, {
          operation: "bootstrap_auth_captcha",
          method: "GET",
          url: loginBootstrapUrl,
          headers: { accept: "text/html", referer: loginUrl.href },
          maximumResponseBytes: 262_144,
          timeoutMs: 10_000,
        });
        const bootstrapHtml = aisText(bootstrap, "create_auth_challenge", [
          "text/html",
        ]);
        if (!returnsToLoginPage(bootstrapHtml)) {
          throw contractChanged(
            "create_auth_challenge",
            "AIS_CAPTCHA_BOOTSTRAP_CHANGED",
          );
        }
        const refreshed = await execute(session, {
          operation: "refresh_auth_challenge",
          method: "GET",
          url: loginUrl,
          headers: { accept: "text/html", referer: loginBootstrapUrl.href },
          maximumResponseBytes: 262_144,
          timeoutMs: 10_000,
        });
        html = aisText(refreshed, "create_auth_challenge", ["text/html"]);
        try {
          form = parseAisLoginPage(html);
        } catch {
          throw contractChanged(
            "create_auth_challenge",
            "AIS_LOGIN_FORM_CHANGED",
          );
        }
      } else if (error instanceof AisLoginPageError) {
        throw contractChanged(
          "create_auth_challenge",
          "AIS_LOGIN_FORM_CHANGED",
        );
      } else {
        throw error;
      }
    }
    const imageResponse = await execute(session, {
      operation: "fetch_auth_captcha",
      method: "GET",
      url: form.captchaUrl,
      headers: { accept: "image/png" },
      maximumResponseBytes: 65_536,
      timeoutMs: 10_000,
    });
    const contentType = imageResponse.headers
      .get("content-type")
      ?.toLowerCase();
    if (
      imageResponse.status !== 200 ||
      contentType?.startsWith("image/png") !== true ||
      imageResponse.body.length < 8 ||
      !isPng(imageResponse.body)
    ) {
      throw contractChanged("create_auth_challenge", "AIS_CAPTCHA_CHANGED");
    }
    return { form, image: imageResponse.body };
  }
}

async function bootstrapAuthenticatedFrames(
  session: GatewaySession,
  frames: Readonly<{ titleUrl: URL; menuUrl: URL; mainUrl: URL }>,
): Promise<void> {
  for (const [operation, url] of [
    ["bootstrap_auth_title", frames.titleUrl],
    ["bootstrap_auth_menu", frames.menuUrl],
    ["bootstrap_auth_portal", frames.mainUrl],
  ] as const) {
    const response = await execute(session, {
      operation,
      method: "GET",
      url,
      headers: { accept: "text/html", referer: authenticatedShellUrl.href },
      maximumResponseBytes: 524_288,
      timeoutMs: 10_000,
    });
    aisText(response, "login", ["text/html"]);
  }
}

function requiresCaptchaBootstrap(html: string): boolean {
  return /<script>\s*location\.href\s*=\s*["']DefaultQ\.aspx["'];?\s*<\/script>/iu.test(
    html,
  );
}

function returnsToLoginPage(html: string): boolean {
  return /location\.href\s*=\s*["']Default\.aspx["']/iu.test(html);
}

function redirectsToAuthenticatedShell(html: string): boolean {
  return /\btop\.location\.href\s*=\s*(["'])MainFrame\.aspx\1\s*;?/iu.test(
    html,
  );
}

async function execute(
  session: GatewaySession,
  request: Parameters<GatewaySession["transport"]["execute"]>[0],
) {
  try {
    return await session.transport.execute(request);
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(
      503,
      "externalUnavailable",
      request.operation,
      true,
      "AIS_TRANSPORT_FAILURE",
    );
  }
}

function normalizeCaptchaCode(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{4}$/u.test(normalized) ? normalized : null;
}

function isPng(value: Uint8Array): boolean {
  return [137, 80, 78, 71, 13, 10, 26, 10].every(
    (byte, index) => value[index] === byte,
  );
}

function looksLikeLoginPage(html: string): boolean {
  try {
    parseAisLoginPage(html);
    return true;
  } catch {
    return false;
  }
}

function captchaUnavailable(): GatewayError {
  return new GatewayError(
    503,
    "externalUnavailable",
    "login",
    true,
    "CAPTCHA_RECOGNITION_EXHAUSTED",
  );
}

function contractChanged(operation: string, code: string): GatewayError {
  return new GatewayError(502, "contractChanged", operation, false, code);
}

function sessionRequired(operation: string): GatewayError {
  return new GatewayError(
    401,
    "authenticationRequired",
    operation,
    true,
    "SESSION_REQUIRED",
  );
}

import { aisText } from "./ais-response.js";
import { openAisFeature } from "./ais-feature-navigation.js";
import { GatewayError } from "./gateway-error.js";
import { toGradesApiResponse } from "./grades-response.js";
import type { Clock, GatewaySessionStore } from "./ports/gateway-session.js";
import {
  parseAisGradesCallback,
  type AisGradesResult,
} from "../protocol/ais/grades-parser.js";
import type { AisGradesQuery } from "../protocol/ais/grades-query.js";
import { AisProtocolError } from "../protocol/ais/protocol-error.js";
import { parseGradesDetailRequest } from "../protocol/ais/grades-detail-navigation.js";
import {
  buildGradesQueryBody,
  buildGradesDetailPostbackBody,
  gradesQueryControlPolicy,
  parseWebFormsQueryPage,
} from "../protocol/ais/webforms-query.js";

const gradesUrl = new URL(
  "https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_01.aspx",
);
const gradesLoaderUrl = new URL(
  "https://ais.ntou.edu.tw/Application/GRD/GRD50/GRD5010_.aspx?progcd=STU2020",
);
export class GradesService {
  constructor(
    private readonly sessions: GatewaySessionStore,
    private readonly clock: Clock,
  ) {}

  /** Planner adapter: expose typed semester/year/history data before API projection. */
  async readSnapshot(sessionId: string, query: AisGradesQuery) {
    const data = await this.readQuery(sessionId, query, "read_grades_snapshot");
    return { data, fetchedAt: this.clock.now().toISOString() };
  }

  async readSemester(
    sessionId: string,
    rocYear: number,
    term: number,
  ): Promise<unknown> {
    if (
      !Number.isSafeInteger(rocYear) ||
      rocYear < 1 ||
      rocYear > 999 ||
      ![1, 2, 3, 4].includes(term)
    ) {
      throw new GatewayError(
        400,
        "invalidRequest",
        "read_grades",
        false,
        "INVALID_ACADEMIC_TERM",
      );
    }
    const termId = `${rocYear}${term}`;
    const result = await this.readQuery(
      sessionId,
      { kind: "semester", termId },
      "read_grades",
    );
    return toGradesApiResponse(result, this.clock.now());
  }

  async readCapabilities(sessionId: string): Promise<unknown> {
    const result = await this.readQuery(
      sessionId,
      { kind: "history" },
      "read_grades_capabilities",
    );
    const termIds = new Set([
      ...result.courses.map((course) => course.termId),
      ...result.conductGrades.map((grade) => grade.termId),
    ]);
    const selections = [...termIds]
      .sort((left, right) => right.localeCompare(left))
      .map((termId) => ({
        rocYear: Number(termId.slice(0, 3)),
        term: Number(termId[3]),
      }));
    return {
      contractVersion: "1.0",
      feature: "grades",
      source: "aisObservedHistory",
      checkedAt: this.clock.now().toISOString(),
      selections,
    };
  }

  private async readQuery(
    sessionId: string,
    query: AisGradesQuery,
    operation: string,
  ): Promise<AisGradesResult> {
    const result = await this.sessions.use(sessionId, async (session) => {
      if (!session.authenticated) throw sessionRequired(operation);
      try {
        const page = await openAisFeature(session, {
          menuGroups: ["教務系統", "成績系統"],
          targetTitle: "查詢各式成績",
          expectedLoaderUrl: gradesLoaderUrl,
          expectedProgramCode: "STU2020",
          expectedQueryUrl: gradesUrl,
          operation: "grades",
          directQueryFirst: true,
          assertAuthenticated: (html) => {
            if (looksLikeLogin(html)) {
              session.authenticated = false;
              throw sessionRequired(operation);
            }
          },
        });
        const fields = parseWebFormsQueryPage(
          page.html,
          page.queryUrl,
          gradesQueryControlPolicy,
        );
        const response = await session.transport.execute({
          operation:
            query.kind === "history" ? "query_grades_history" : "query_grades",
          method: "POST",
          url: page.queryUrl,
          headers: {
            accept: "text/html,application/xhtml+xml",
            "content-type": "application/x-www-form-urlencoded",
            origin: page.queryUrl.origin,
            referer: page.queryUrl.href,
          },
          body: buildGradesQueryBody(fields, query),
          maximumResponseBytes: 1_048_576,
          timeoutMs: 15_000,
        });
        let callback = aisText(response, "read_grades", [
          "text/plain",
          "text/html",
        ]);
        const detail = parseGradesDetailRequest(callback, page.queryUrl);
        if (detail !== null) {
          const detailResponse = await session.transport.execute({
            operation: "open_grades_detail",
            method: "POST",
            url: detail.url,
            headers: {
              accept: "text/html,application/xhtml+xml",
              "content-type": "application/x-www-form-urlencoded",
              origin: detail.url.origin,
              referer: page.queryUrl.href,
            },
            body: detail.body,
            maximumResponseBytes: 1_048_576,
            timeoutMs: 15_000,
          });
          callback = aisText(detailResponse, "read_grades", [
            "text/plain",
            "text/html",
          ]);
          const postbackBody = buildGradesDetailPostbackBody(
            callback,
            detail.url,
          );
          if (postbackBody !== null) {
            const detailResult = await session.transport.execute({
              operation: "query_grades_detail",
              method: "POST",
              url: detail.url,
              headers: {
                accept: "text/html,application/xhtml+xml",
                "content-type": "application/x-www-form-urlencoded",
                origin: detail.url.origin,
                referer: detail.url.href,
              },
              body: postbackBody,
              maximumResponseBytes: 1_048_576,
              timeoutMs: 15_000,
            });
            callback = aisText(detailResult, "read_grades", [
              "text/plain",
              "text/html",
            ]);
          }
        }
        return parseAisGradesCallback(callback, query);
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        if (error instanceof AisProtocolError) {
          throw new GatewayError(
            502,
            "contractChanged",
            operation,
            false,
            `AIS_GRADES_${error.code.toUpperCase()}`,
          );
        }
        throw new GatewayError(
          503,
          "externalUnavailable",
          operation,
          true,
          "AIS_GRADES_UNAVAILABLE",
        );
      }
    });
    if (result === null) throw sessionRequired(operation);
    return result;
  }
}

function looksLikeLogin(html: string): boolean {
  return /M_PORTAL_LOGIN_ACNT|LGOIN_BTN/iu.test(html);
}

function sessionRequired(operation = "read_grades"): GatewayError {
  return new GatewayError(
    401,
    "authenticationRequired",
    operation,
    true,
    "SESSION_REQUIRED",
  );
}

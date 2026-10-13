import { aisText } from "./ais-response.js";
import { openAisFeature } from "./ais-feature-navigation.js";
import { GatewayError } from "./gateway-error.js";
import type { Clock, GatewaySessionStore } from "./ports/gateway-session.js";
import { toTimetableApiResponse } from "./timetable-response.js";
import { AisProtocolError } from "../protocol/ais/protocol-error.js";
import {
  parseAisTimetableCallbacks,
  parseAisTimetablePeriods,
} from "../protocol/ais/timetable-parser.js";
import {
  buildTimetableQueryBody,
  deriveTimetableAcademicTermOptions,
  parseWebFormsQueryPage,
  timetableQueryControlPolicy,
} from "../protocol/ais/webforms-query.js";

const queryUrl = new URL(
  "https://ais.ntou.edu.tw/Application/TKE/TKE22/TKE2240_01.aspx",
);
const loaderUrl = new URL(
  "https://ais.ntou.edu.tw/Application/TKE/TKE22/TKE2240_.aspx?progcd=STU1220",
);

export class TimetableService {
  constructor(
    private readonly sessions: GatewaySessionStore,
    private readonly clock: Clock,
  ) {}

  async readCapabilities(sessionId: string): Promise<unknown> {
    const result = await this.sessions.use(sessionId, async (session) => {
      if (!session.authenticated) throw sessionRequired();
      try {
        const page = await openAisFeature(session, {
          menuGroups: ["教務系統", "選課系統"],
          targetTitle: "學生個人選課清單課表列印",
          expectedLoaderUrl: loaderUrl,
          expectedProgramCode: "STU1220",
          expectedQueryUrl: queryUrl,
          operation: "timetable",
          assertAuthenticated: (html) => assertAuthenticated(html, session),
        });
        const selections = [
          ...deriveTimetableAcademicTermOptions(page.html, page.queryUrl),
        ].sort(
          (left, right) =>
            right.rocYear - left.rocYear || left.term - right.term,
        );
        if (selections.length === 0 || selections.length > 80) {
          throw new AisProtocolError("invalid_callback_envelope");
        }
        return {
          contractVersion: "1.0",
          feature: "timetable",
          source: "aisQueryOptionDerivation",
          checkedAt: this.clock.now().toISOString(),
          selections,
        };
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        if (error instanceof AisProtocolError) {
          throw new GatewayError(
            502,
            "contractChanged",
            "read_timetable_capabilities",
            false,
            "AIS_TIMETABLE_CAPABILITIES_CONTRACT_CHANGED",
          );
        }
        throw new GatewayError(
          503,
          "externalUnavailable",
          "read_timetable_capabilities",
          true,
          "AIS_TIMETABLE_CAPABILITIES_UNAVAILABLE",
        );
      }
    });
    if (result === null) throw sessionRequired();
    return result;
  }

  async readSemester(
    sessionId: string,
    rocYear: number,
    term: number,
  ): Promise<unknown> {
    const snapshot = await this.readSnapshot(sessionId, rocYear, term);
    return toTimetableApiResponse(snapshot.slots, snapshot.periods, { rocYear, term }, new Date(snapshot.fetchedAt));
  }

  /** Planner adapter: keep enrollments and meeting slots separate. */
  async readSnapshot(sessionId: string, rocYear: number, term: number) {
    if (
      !Number.isSafeInteger(rocYear) ||
      rocYear < 1 ||
      rocYear > 999 ||
      ![1, 2].includes(term)
    ) {
      throw new GatewayError(
        400,
        "invalidRequest",
        "read_timetable",
        false,
        "INVALID_ACADEMIC_TERM",
      );
    }
    const result = await this.sessions.use(sessionId, async (session) => {
      if (!session.authenticated) throw sessionRequired();
      try {
        const page = await openAisFeature(session, {
          menuGroups: ["教務系統", "選課系統"],
          targetTitle: "學生個人選課清單課表列印",
          expectedLoaderUrl: loaderUrl,
          expectedProgramCode: "STU1220",
          expectedQueryUrl: queryUrl,
          operation: "timetable",
          assertAuthenticated: (html) => assertAuthenticated(html, session),
        });
        const fields = parseWebFormsQueryPage(
          page.html,
          page.queryUrl,
          timetableQueryControlPolicy,
        );
        const headers = {
          accept: "text/html,application/xhtml+xml",
          "content-type": "application/x-www-form-urlencoded",
          origin: page.queryUrl.origin,
          referer: page.queryUrl.href,
        };
        const list = await session.transport.execute({
          operation: "query_timetable_list",
          method: "POST",
          url: page.queryUrl,
          headers,
          body: buildTimetableQueryBody(fields, { rocYear, term }, "list"),
          maximumResponseBytes: 1_048_576,
          timeoutMs: 15_000,
        });
        const grid = await session.transport.execute({
          operation: "query_timetable_grid",
          method: "POST",
          url: page.queryUrl,
          headers,
          body: buildTimetableQueryBody(fields, { rocYear, term }, "grid"),
          maximumResponseBytes: 1_048_576,
          timeoutMs: 15_000,
        });
        const listCallback = aisText(list, "read_timetable", [
          "text/plain",
          "text/html",
        ]);
        const gridCallback = aisText(grid, "read_timetable", [
          "text/plain",
          "text/html",
        ]);
        assertAuthenticated(listCallback, session);
        assertAuthenticated(gridCallback, session);
        return {
          slots: parseAisTimetableCallbacks(
            listCallback,
            gridCallback,
            `${String(rocYear).padStart(3, "0")}${term}`,
          ),
          periods: parseAisTimetablePeriods(gridCallback),
          fetchedAt: this.clock.now().toISOString(),
        };
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        if (error instanceof AisProtocolError) {
          throw new GatewayError(
            502,
            "contractChanged",
            "read_timetable",
            false,
            "AIS_TIMETABLE_CONTRACT_CHANGED",
          );
        }
        throw new GatewayError(
          503,
          "externalUnavailable",
          "read_timetable",
          true,
          "AIS_TIMETABLE_UNAVAILABLE",
        );
      }
    });
    if (result === null) throw sessionRequired();
    return result;
  }
}

function assertAuthenticated(
  html: string,
  session: { authenticated: boolean },
): void {
  if (/M_PORTAL_LOGIN_ACNT|LGOIN_BTN/iu.test(html)) {
    session.authenticated = false;
    throw sessionRequired();
  }
}

function sessionRequired(): GatewayError {
  return new GatewayError(
    401,
    "authenticationRequired",
    "read_timetable",
    true,
    "SESSION_REQUIRED",
  );
}

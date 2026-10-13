import type { AisResponse } from "./ports/ais-transport.js";
import { GatewayError } from "./gateway-error.js";

export function aisText(
  response: AisResponse,
  operation: string,
  allowedContentTypes: readonly string[],
): string {
  if (response.status < 200 || response.status >= 300) {
    throw new GatewayError(
      503,
      "externalUnavailable",
      operation,
      true,
      "AIS_HTTP_FAILURE",
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!allowedContentTypes.some((value) => contentType.startsWith(value))) {
    throw new GatewayError(
      502,
      "contractChanged",
      operation,
      false,
      "AIS_CONTENT_TYPE_CHANGED",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(response.body);
  } catch {
    throw new GatewayError(
      502,
      "contractChanged",
      operation,
      false,
      "AIS_TEXT_ENCODING_CHANGED",
    );
  }
}

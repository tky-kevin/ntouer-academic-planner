export type GatewayFailureKind =
  | "authenticationRequired"
  | "externalUnavailable"
  | "contractChanged"
  | "invalidRequest"
  | "sessionChanged"
  | "storageUnavailable"
  | "unknown";

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly kind: GatewayFailureKind,
    readonly operation: string,
    readonly retryable: boolean,
    readonly diagnosticCode: string,
  ) {
    super(diagnosticCode);
    this.name = "GatewayError";
  }
}

export function gatewayErrorBody(error: GatewayError): unknown {
  return {
    error: {
      kind: error.kind,
      operation: error.operation,
      retryable: error.retryable,
      diagnosticCode: error.diagnosticCode,
    },
  };
}

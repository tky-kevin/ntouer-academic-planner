import { GatewayError } from './upstream/application/gateway-error.js'
import { AisProtocolError } from './upstream/protocol/ais/protocol-error.js'

export type AisFailureKind = 'authenticationRequired' | 'externalUnavailable' | 'contractChanged' | 'invalidRequest' | 'dataInvalid'

export class PlannerAisError extends Error {
  constructor(readonly kind: AisFailureKind, readonly code: string, readonly retryable = false) {
    super(code)
    this.name = 'PlannerAisError'
  }
}

export function safeAisError(error: unknown): PlannerAisError {
  if (error instanceof PlannerAisError) return error
  if (error instanceof GatewayError) {
    const kind: AisFailureKind = ['authenticationRequired', 'externalUnavailable', 'contractChanged', 'invalidRequest'].includes(error.kind)
      ? error.kind as AisFailureKind : 'externalUnavailable'
    return new PlannerAisError(kind, error.diagnosticCode, error.retryable)
  }
  if (error instanceof AisProtocolError) return new PlannerAisError('contractChanged', `AIS_${error.code.toUpperCase()}`)
  return new PlannerAisError('externalUnavailable', 'AIS_UNAVAILABLE', true)
}

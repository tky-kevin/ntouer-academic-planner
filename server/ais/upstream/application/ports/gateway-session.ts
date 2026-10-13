import type { AisTransport } from "./ais-transport.js";

export type GatewaySession = {
  readonly transport: AisTransport;
  readonly csrfToken: string;
  authenticated: boolean;
};

export interface GatewaySessionStore {
  create(): Promise<Readonly<{ id: string; csrfToken: string }>>;
  use<T>(
    id: string,
    operation: (session: GatewaySession) => Promise<T>,
  ): Promise<T | null>;
  delete(id: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface RandomTokenSource {
  token(): string;
}

/** Derives a stable pseudonymous cache partition without exposing an account. */
export interface AccountScopeDeriver {
  derive(account: string): Promise<string>;
}

/** Hosting-specific OCR adapter. Images and recognized codes are ephemeral. */
export interface CaptchaSolver {
  solve(png: Uint8Array): Promise<string | null>;
}

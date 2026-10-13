export type AisRequest = Readonly<{
  operation: string;
  method: "GET" | "POST";
  url: URL;
  headers: Readonly<Record<string, string>>;
  body?: string;
  maximumResponseBytes: number;
  timeoutMs: number;
}>;

export type AisResponse = Readonly<{
  status: number;
  headers: Headers;
  body: Uint8Array;
}>;

/**
 * Hosting-neutral authenticated transport. Cookie state stays inside the
 * implementation and is never returned by a feature parser.
 */
export interface AisTransport {
  execute(request: AisRequest): Promise<AisResponse>;
}

export interface AisTransportFactory {
  create(): AisTransport;
}

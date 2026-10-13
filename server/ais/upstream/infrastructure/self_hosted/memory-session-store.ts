import { randomBytes } from "node:crypto";

import type { AisTransportFactory } from "../../application/ports/ais-transport.js";
import type {
  Clock,
  GatewaySession,
  GatewaySessionStore,
  RandomTokenSource,
} from "../../application/ports/gateway-session.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class CryptoTokenSource implements RandomTokenSource {
  token(): string {
    return randomBytes(32).toString("base64url");
  }
}

export class MemoryGatewaySessionStore implements GatewaySessionStore {
  private readonly sessions = new Map<
    string,
    Readonly<{ session: GatewaySession; createdAt: number; lastUsedAt: number }>
  >();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly transports: AisTransportFactory,
    private readonly tokens: RandomTokenSource,
    private readonly clock: Clock,
    private readonly idleTtlMs = 30 * 60_000,
    private readonly absoluteTtlMs = 8 * 60 * 60_000,
  ) {}

  async create(): Promise<Readonly<{ id: string; csrfToken: string }>> {
    this.prune();
    const id = this.tokens.token();
    const csrfToken = this.tokens.token();
    const now = this.clock.now().getTime();
    this.sessions.set(id, {
      session: {
        transport: this.transports.create(),
        csrfToken,
        authenticated: false,
      },
      createdAt: now,
      lastUsedAt: now,
    });
    return { id, csrfToken };
  }

  async use<T>(
    id: string,
    operation: (session: GatewaySession) => Promise<T>,
  ): Promise<T | null> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(id, tail);
    await previous;
    try {
      const entry = this.sessions.get(id);
      if (entry === undefined || this.expired(entry)) {
        this.sessions.delete(id);
        return null;
      }
      const result = await operation(entry.session);
      this.sessions.set(id, {
        ...entry,
        lastUsedAt: this.clock.now().getTime(),
      });
      return result;
    } finally {
      release();
      if (this.tails.get(id) === tail) this.tails.delete(id);
    }
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  private expired(
    entry: Readonly<{ createdAt: number; lastUsedAt: number }>,
  ): boolean {
    const now = this.clock.now().getTime();
    return (
      now - entry.lastUsedAt > this.idleTtlMs ||
      now - entry.createdAt > this.absoluteTtlMs
    );
  }

  private prune(): void {
    for (const [id, entry] of this.sessions) {
      if (this.expired(entry)) this.sessions.delete(id);
    }
  }
}

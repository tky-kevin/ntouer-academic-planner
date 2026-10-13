import { readFileSync } from 'node:fs'
import type { AisRequest, AisResponse, AisTransport } from '../upstream/application/ports/ais-transport.js'

export function fixture(name: string): string {
  if (!/^[a-z0-9-]+(?:\.callback)?\.(html|txt)$/.test(name)) throw new Error('Invalid fixture name')
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
}
export interface FixtureStep { operation: string; fixture?: string; body?: string | Uint8Array; contentType?: string; status?: number; method?: 'GET' | 'POST' }
export class ScriptedTransport implements AisTransport {
  readonly requests: AisRequest[] = []
  private cursor = 0
  constructor(private readonly steps: readonly FixtureStep[]) {}
  async execute(request: AisRequest): Promise<AisResponse> {
    const step = this.steps[this.cursor++]
    if (!step || request.operation !== step.operation || (step.method && step.method !== request.method)) {
      throw new Error(`Fixture operation mismatch: expected ${step?.operation ?? 'end'}, received ${request.operation}`)
    }
    this.requests.push(request)
    const value = step.fixture ? fixture(step.fixture) : step.body ?? ''
    return { status: step.status ?? 200, headers: new Headers({ 'content-type': step.contentType ?? 'text/html; charset=utf-8' }), body: typeof value === 'string' ? new TextEncoder().encode(value) : value }
  }
  assertComplete(): void { if (this.cursor !== this.steps.length) throw new Error(`Unconsumed fixture steps: ${this.steps.length - this.cursor}`) }
}

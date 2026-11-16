import { describe, expect, it } from 'vitest'
import {
  assertStateMatches,
  buildAuthorizationUrl,
  createPkcePair,
  readStateCookie,
  signStateCookie,
  verifyIdToken,
} from './oidc.js'

const config = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:3000/auth/callback',
}

function makeToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${header}.${payload}.signature`
}

const now = new Date('2026-11-17T02:00:00Z')
const validClaims = {
  iss: 'https://accounts.google.com',
  aud: config.clientId,
  exp: Math.floor(now.getTime() / 1000) + 600,
  iat: Math.floor(now.getTime() / 1000) - 10,
  nonce: 'nonce-1',
  sub: 'google-sub-1',
  email: 'student@example.edu',
}

const signatureOk = async () => true

describe('Google OIDC', () => {
  it('授權網址包含 code_challenge 與 state', () => {
    const url = new URL(
      buildAuthorizationUrl({ config, state: 'state-1', codeChallenge: 'challenge-1', nonce: 'nonce-1' }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe(config.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(url.searchParams.get('scope')).toBe('openid email')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state-1')
  })

  it('state 不符時拒絕', () => {
    expect(() => assertStateMatches('expected', 'expected')).not.toThrow()
    expect(() => assertStateMatches('expected', 'different')).toThrow(/state/)
    expect(() => assertStateMatches('expected', '')).toThrow(/state/)
    expect(() => assertStateMatches('expected', null)).toThrow(/state/)
  })

  it('aud 不符時拒絕', async () => {
    await expect(
      verifyIdToken(makeToken({ ...validClaims, aud: 'someone-else' }), {
        clientId: config.clientId,
        now,
        verifySignature: signatureOk,
      }),
    ).rejects.toThrow(/aud/)
  })

  it('過期的 id token 被拒絕', async () => {
    await expect(
      verifyIdToken(makeToken({ ...validClaims, exp: Math.floor(now.getTime() / 1000) - 1 }), {
        clientId: config.clientId,
        now,
        verifySignature: signatureOk,
      }),
    ).rejects.toThrow(/過期/)
  })

  it('缺少 sub 時拒絕', async () => {
    const withoutSub: Record<string, unknown> = { ...validClaims }
    delete withoutSub.sub
    await expect(
      verifyIdToken(makeToken(withoutSub), { clientId: config.clientId, now, verifySignature: signatureOk }),
    ).rejects.toThrow(/sub/)
  })

  it('簽章驗不過就拒絕（nonce 也要對）', async () => {
    await expect(
      verifyIdToken(makeToken(validClaims), {
        clientId: config.clientId,
        now,
        verifySignature: async () => false,
      }),
    ).rejects.toThrow(/簽章/)

    await expect(
      verifyIdToken(makeToken({ ...validClaims, nonce: 'other' }), {
        clientId: config.clientId,
        nonce: 'nonce-1',
        now,
        verifySignature: signatureOk,
      }),
    ).rejects.toThrow(/nonce/)
  })

  it('PKCE 是 S256；state cookie 可簽章、可過期、被改過就失效', () => {
    const { verifier, challenge } = createPkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge).not.toBe(verifier)

    const secret = 'test-session-secret'
    const payload = { state: 's1', verifier, nonce: 'n1', expiresAt: Date.now() + 60_000 }
    const cookie = signStateCookie(payload, secret)
    expect(readStateCookie(cookie, secret)).toEqual(payload)
    expect(readStateCookie(cookie, 'other-secret')).toBeNull()
    expect(readStateCookie(`${cookie}x`, secret)).toBeNull()
    expect(readStateCookie(signStateCookie({ ...payload, expiresAt: Date.now() - 1 }, secret), secret)).toBeNull()
  })
})

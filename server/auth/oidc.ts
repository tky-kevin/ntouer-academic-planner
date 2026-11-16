// Google OIDC 的純函式：授權網址、PKCE、state cookie、ID token 驗證。
// 規格：docs/design/system-design.md §14、docs/design/api-spec.md §6.1、ADR-0003。
// 不在這裡碰資料庫或 HTTP server，才能離線測（AC 要求「不得連網」）。
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignatureBytes,
} from 'node:crypto'

export interface OidcConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface StatePayload {
  state: string
  verifier: string
  nonce: string
  expiresAt: number
}

export interface IdTokenClaims {
  iss: string
  aud: string | string[]
  exp: number
  iat?: number
  nonce?: string
  sub?: string
  email?: string
  email_verified?: boolean
  [claim: string]: unknown
}

export interface IdTokenHeader {
  alg?: string
  kid?: string
  [claim: string]: unknown
}

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createNonce(): string {
  return base64url(randomBytes(16))
}

export function buildAuthorizationUrl(input: {
  config: OidcConfig
  state: string
  codeChallenge: string
  nonce: string
}): string {
  const url = new URL(AUTHORIZE_ENDPOINT)
  url.searchParams.set('client_id', input.config.clientId)
  url.searchParams.set('redirect_uri', input.config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email')
  url.searchParams.set('state', input.state)
  url.searchParams.set('nonce', input.nonce)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** state 不符就丟錯（不建立 session）。 */
export function assertStateMatches(expected: string, received: string | null | undefined): void {
  if (!received || expected.length !== received.length) {
    throw new Error('state 不符')
  }
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
    throw new Error('state 不符')
  }
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function signStateCookie(payload: StatePayload, secret: string): string {
  const body = base64url(JSON.stringify(payload))
  return `${body}.${sign(body, secret)}`
}

export function readStateCookie(value: string | undefined, secret: string, now: Date = new Date()): StatePayload | null {
  if (!value) return null
  const [body, signature] = value.split('.')
  if (!body || !signature) return null
  const expected = sign(body, secret)
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload
    if (!payload.state || !payload.verifier || payload.expiresAt <= now.getTime()) return null
    return payload
  } catch {
    return null
  }
}

interface JwtParts {
  header: IdTokenHeader
  claims: IdTokenClaims
  signature: Buffer
  signedData: string
}

export function decodeJwt(token: string): JwtParts {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('id token 格式錯誤')
  const [encodedHeader, encodedClaims, encodedSignature] = parts
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as IdTokenHeader
  const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')) as IdTokenClaims
  return {
    header,
    claims,
    signature: Buffer.from(encodedSignature, 'base64url'),
    signedData: `${encodedHeader}.${encodedClaims}`,
  }
}

interface Jwk {
  kid?: string
  kty: string
  n?: string
  e?: string
  alg?: string
  [key: string]: unknown
}

let jwksCache: { expiresAt: number; keys: Jwk[] } | null = null

async function fetchGoogleKeys(): Promise<Jwk[]> {
  const now = Date.now()
  if (jwksCache && jwksCache.expiresAt > now) return jwksCache.keys
  const response = await fetch(JWKS_URL)
  if (!response.ok) throw new Error('無法取得 Google 公鑰')
  const body = (await response.json()) as { keys: Jwk[] }
  jwksCache = { keys: body.keys, expiresAt: now + 60 * 60 * 1000 }
  return body.keys
}

/** 用 Google 的 JWKS 驗 RS256 簽章；測試以 `verifySignature` 注入取代。 */
export async function verifyGoogleSignature(parts: JwtParts): Promise<boolean> {
  if (parts.header.alg !== 'RS256') return false
  const keys = await fetchGoogleKeys()
  const jwk = keys.find((key) => key.kid === parts.header.kid)
  if (!jwk) return false
  const key = createPublicKey({ key: jwk as unknown as import('node:crypto').JsonWebKey, format: 'jwk' })
  return verifySignatureBytes('RSA-SHA256', Buffer.from(parts.signedData), key, parts.signature)
}

export interface VerifyIdTokenOptions {
  clientId: string
  nonce?: string
  now?: Date
  verifySignature?: (parts: JwtParts) => Promise<boolean>
}

/** 驗 `iss`／`aud`／`exp`／`nonce`／`sub`；失敗丟錯，訊息不含 token。 */
export async function verifyIdToken(token: string, options: VerifyIdTokenOptions): Promise<IdTokenClaims> {
  const parts = decodeJwt(token)
  const verify = options.verifySignature ?? verifyGoogleSignature
  if (!(await verify(parts))) throw new Error('id token 簽章驗證失敗')

  const { claims } = parts
  const now = options.now ?? new Date()

  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error('id token 的 iss 不正確')
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(options.clientId)) throw new Error('id token 的 aud 不正確')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) throw new Error('id token 已過期')
  if (claims.iat !== undefined && claims.iat * 1000 > now.getTime() + 5 * 60 * 1000) {
    throw new Error('id token 的 iat 不在合理範圍')
  }
  if (options.nonce !== undefined && claims.nonce !== options.nonce) throw new Error('id token 的 nonce 不符')
  if (!claims.sub) throw new Error('id token 缺少 sub')

  return claims
}

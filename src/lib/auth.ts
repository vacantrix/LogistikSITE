import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

/**
 * Простая самодостаточная аутентификация платформы:
 * — пароли хранятся как scrypt-хеш с солью;
 * — сессия — подписанная HMAC-SHA256 кука (HttpOnly, SameSite=Lax, 7 дней).
 */

export const SESSION_COOKIE = 'aemz_session'
const SESSION_TTL_MS = 7 * 24 * 3600_000

const SECRET = process.env.AUTH_SECRET ?? 'aemz-logistika-demo-secret-2024'

export interface SessionUser {
  id: string
  login: string
  name: string
  role: 'logist' | 'carrier'
  carrierId: string | null
}

// ——— пароли ———

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

// ——— сессия ———

const b64url = (v: Buffer | string): string =>
  Buffer.from(v).toString('base64url')

const sign = (payload: string): string =>
  createHmac('sha256', SECRET).update(payload).digest('base64url')

export function createSessionToken(user: SessionUser): string {
  const body = b64url(JSON.stringify({ ...user, exp: Date.now() + SESSION_TTL_MS }))
  return `${body}.${sign(body)}`
}

export function readSessionToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = sign(body)
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionUser & { exp: number }
    if (!data.exp || data.exp < Date.now()) return null
    return { id: data.id, login: data.login, name: data.name, role: data.role, carrierId: data.carrierId }
  } catch {
    return null
  }
}

/** Сессия текущего запроса (server-side) */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  return readSessionToken(store.get(SESSION_COOKIE)?.value)
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: false, // в демо-контуре без HTTPS; прод-контур за прокси переключит на true
  path: '/',
  maxAge: SESSION_TTL_MS / 1000,
}

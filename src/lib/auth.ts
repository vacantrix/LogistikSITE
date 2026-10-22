import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies, headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Аутентификация платформы:
 * — пароли хранятся как scrypt-хеш с солью;
 * — сессия — подписанный HMAC-SHA256 токен (7 дней);
 * — токен передаётся кукой (HttpOnly, SameSite=Lax) — основной способ;
 * — если браузер не возвращает куку (окно предпросмотра во встроенном фрейме,
 *   сторонние куки заблокированы браузером) — тот же токен можно передать
 *   заголовком Authorization: Bearer или query-параметром t (для <img src>);
 * — каждый API-маршрут сам проверяет сессию и роль через requireUser().
 */

export const SESSION_COOKIE = 'aemz_session'
const SESSION_TTL_MS = 7 * 24 * 3600_000

export type Role = 'logist' | 'carrier'

export interface SessionUser {
  id: string
  login: string
  name: string
  role: Role
  carrierId: string | null
}

/**
 * Секрет подписи сессий. В проде обязателен (AUTH_SECRET), иначе любой подделает куку.
 * В разработке без переменной — случайный секрет на время жизни процесса
 * (после перезапуска сервера придётся войти заново).
 */
let devSecret: string | null = null
function secret(): string {
  const env = process.env.AUTH_SECRET
  if (env && env.length >= 32) return env
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET не задан или короче 32 символов — сессии не могут быть подписаны')
  }
  if (!devSecret) {
    devSecret = randomBytes(32).toString('hex')
    console.warn('[auth] AUTH_SECRET не задан — используется временный секрет разработки')
  }
  return devSecret
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
  createHmac('sha256', secret()).update(payload).digest('base64url')

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
    if (data.role !== 'logist' && data.role !== 'carrier') return null
    return { id: data.id, login: data.login, name: data.name, role: data.role, carrierId: data.carrierId ?? null }
  } catch {
    return null
  }
}

/** Сессия текущего запроса (server-side): кука, при её отсутствии — заголовок Authorization: Bearer */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const fromCookie = readSessionToken(store.get(SESSION_COOKIE)?.value)
  if (fromCookie) return fromCookie
  // Фолбэк для контекстов, где браузер не принимает/не отдаёт куки (iframe предпросмотра):
  // клиент хранит тот же подписанный токен и передаёт его заголовком.
  const h = await headers()
  const authz = h.get('authorization')
  if (authz?.toLowerCase().startsWith('bearer ')) {
    return readSessionToken(authz.slice(7).trim())
  }
  return null
}

/** Проверка роли и (для перевозчика) доступа к площадке — общая для requireUser* */
async function accessChecked(user: SessionUser, roles: Role[]): Promise<SessionUser | NextResponse> {
  if (roles.length > 0 && !roles.includes(user.role)) {
    return NextResponse.json({ error: 'Недостаточно прав для этого действия' }, { status: 403 })
  }
  if (user.role === 'carrier') {
    if (!user.carrierId) return NextResponse.json({ error: 'Учётная запись не привязана к перевозчику' }, { status: 403 })
    const carrier = await db.carrier.findUnique({ where: { id: user.carrierId }, select: { access: true } })
    if (!carrier?.access) return NextResponse.json({ error: 'Доступ перевозчика к площадке закрыт' }, { status: 403 })
  }
  return user
}

/**
 * Проверка доступа для API-маршрута. Возвращает пользователя или готовый ответ 401/403:
 *
 *   const auth = await requireUser('logist')
 *   if (auth instanceof NextResponse) return auth
 *
 * Для перевозчика дополнительно проверяется, что учётка привязана к перевозчику и его
 * доступ к площадке не закрыт: логист может отозвать доступ, а сессия живёт 7 дней.
 */
export async function requireUser(...roles: Role[]): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Требуется вход в систему' }, { status: 401 })
  return accessChecked(user, roles)
}

/**
 * Вариант requireUser для маршрутов, которые отдаются как <img src> и не могут
 * послать заголовок Authorization: токен принимается также query-параметром t
 * (тот же подписанный токен сессии; клиент добавляет его через secureFileUrl()).
 */
export async function requireUserViaRequest(req: NextRequest, ...roles: Role[]): Promise<SessionUser | NextResponse> {
  const fromQuery = readSessionToken(req.nextUrl.searchParams.get('t'))
  if (fromQuery) return accessChecked(fromQuery, roles)
  return requireUser(...roles)
}

/** Кто смотрит данные — для фильтрации ответов (ставки, документы, справочник) */
export interface Viewer {
  role: Role
  carrierId: string | null
}

export const viewerOf = (u: SessionUser): Viewer => ({ role: u.role, carrierId: u.carrierId })

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  // в проде кука только по HTTPS; для демо-стенда без HTTPS — COOKIE_INSECURE=1
  secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== '1',
  path: '/',
  maxAge: SESSION_TTL_MS / 1000,
}

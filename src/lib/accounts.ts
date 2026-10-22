/**
 * Мультиаккаунт (Task 74): возможность одновременно работать под разными
 * учётными записями платформы — например, логист в одной вкладке и перевозчик
 * в другой, без взаимных «выбрасываний» при входе/выходе.
 *
 * Хранилища:
 *  — sessionStorage `aemz_session_token` — токен АКТИВНОЙ сессии этой вкладки
 *    (у каждой вкладки свой, поэтому вкладки независимы);
 *  — localStorage `aemz_accounts` — реестр сохранённых аккаунтов этого браузера
 *    (userId → токен + карточка пользователя): новая вкладка продолжает с последнего
 *    активного аккаунта, а меню аккаунта предлагает быстрое переключение;
 *  — localStorage `aemz_last_account` — id последнего активного аккаунта.
 *
 * Токены — те же подписанные HMAC-сессии сервера; подпись на клиенте не проверяем
 * (это делает сервер), но просроченные из реестра убираем по exp из payload.
 */
import type { SessionUserDTO } from '@/lib/types'

/** Токен активной сессии этой вкладки (был общий ключ в localStorage — теперь здесь, у вкладки) */
export const ACTIVE_TOKEN_KEY = 'aemz_session_token'
/** Прежний общий ключ в localStorage — мигрируется один раз при первом заходе */
const LEGACY_TOKEN_KEY = 'aemz_session_token'
const REGISTRY_KEY = 'aemz_accounts'
const LAST_KEY = 'aemz_last_account'

export type AccountRole = 'logist' | 'carrier'

export interface SavedAccount {
  userId: string
  login: string
  name: string
  role: AccountRole
  carrierId: string | null
  token: string
  savedAt: number
}

const b64urlDecode = (v: string): string => {
  const b64 = v.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  return atob(b64 + pad)
}

/** Payload токена без проверки подписи (подпись проверяет сервер) — для exp и карточки аккаунта */
export function decodeToken(token: string): { user: SessionUserDTO; exp: number } | null {
  try {
    const [body] = token.split('.')
    if (!body) return null
    const data = JSON.parse(b64urlDecode(body)) as Partial<SessionUserDTO> & { exp?: number }
    if (!data || typeof data.exp !== 'number' || !data.id || (data.role !== 'logist' && data.role !== 'carrier')) return null
    return {
      exp: data.exp,
      user: { id: data.id, login: data.login ?? '', name: data.name ?? '', role: data.role, carrierId: data.carrierId ?? null },
    }
  } catch {
    return null
  }
}

function isExpired(token: string): boolean {
  const dec = decodeToken(token)
  return !dec || dec.exp <= Date.now()
}

/** Сохранённые аккаунты браузера, свежие сверху, просроченные отфильтрованы */
export function listAccounts(): SavedAccount[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return (arr as SavedAccount[])
      .filter((a) => a && typeof a.token === 'string' && typeof a.userId === 'string' && !isExpired(a.token))
      .sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

function writeRegistry(list: SavedAccount[]): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(list))
  } catch { /* приватный режим — реестр недоступен, работаем на сессии вкладки */ }
}

/** Добавить/обновить аккаунт в реестре и сделать его последним активным */
export function upsertAccount(user: SessionUserDTO, token: string): void {
  const list = listAccounts().filter((a) => a.userId !== user.id && a.token !== token)
  list.unshift({ userId: user.id, login: user.login, name: user.name, role: user.role, carrierId: user.carrierId, token, savedAt: Date.now() })
  writeRegistry(list)
  setLastAccountId(user.id)
}

/** Удалить аккаунт по токену (выход или протухшая сессия) — остальные не трогаем */
export function removeAccountByToken(token: string): void {
  const list = listAccounts().filter((a) => a.token !== token)
  writeRegistry(list)
  const last = getLastAccountId()
  if (last && !list.some((a) => a.userId === last)) setLastAccountId(list[0]?.userId ?? null)
}

export function accountByToken(token: string): SavedAccount | null {
  return listAccounts().find((a) => a.token === token) ?? null
}

export function accountById(userId: string): SavedAccount | null {
  return listAccounts().find((a) => a.userId === userId) ?? null
}

/**
 * Включить сохранённый аккаунт в ЭТОЙ вкладке (меню аккаунта, «Продолжить как»):
 * его токен становится активной сессией вкладки, аккаунт — последним активным.
 * Вызвавший обновляет интерфейс (перезагрузка/перечитывание сессии).
 */
export function activateAccount(userId: string): boolean {
  const acc = accountById(userId)
  if (!acc) return false
  try {
    sessionStorage.setItem(ACTIVE_TOKEN_KEY, acc.token)
    setLastAccountId(userId)
  } catch { /* приватный режим — сессия вкладки недоступна */ }
  return true
}

/**
 * «Добавить аккаунт»: снимаем сессию только этой вкладки, реестр аккаунтов и
 * сессии других вкладок не трогаем — после входа новой учёткой всё продолжит работать.
 */
export function beginAddAccount(): void {
  try {
    sessionStorage.removeItem(ACTIVE_TOKEN_KEY)
  } catch { /* приватный режим */ }
}

export function getLastAccountId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export function setLastAccountId(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(LAST_KEY, userId)
    else localStorage.removeItem(LAST_KEY)
  } catch { /* приватный режим */ }
}

/**
 * Разовая миграция со старой схемы (один токен на весь браузер в localStorage):
 * переносим его в реестр и сессию вкладки, из общего хранилища удаляем.
 */
export function migrateLegacyToken(): void {
  if (typeof window === 'undefined') return
  try {
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY)
    if (!legacy) return
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    if (!isExpired(legacy) && !accountByToken(legacy)) {
      const dec = decodeToken(legacy)
      if (dec) upsertAccount(dec.user, legacy)
    }
  } catch { /* ничего критичного — просто начнём с чистого листа */ }
}

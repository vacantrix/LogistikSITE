'use client'

import { withBasePath } from '@/lib/kontur/base-path'

// Клиентский дубль сессии токеном (localStorage → Authorization: Bearer).
// Нужен для встроенного превью (iframe): браузеры блокируют сторонние cookie,
// и cookie-сессия после успешного входа не сохраняется — токен держит вход
// до явного выхода. В отдельной вкладке работают оба канала одновременно.
// Отдельный ключ от платформы LogistikSITE (у неё тоже aemz_session_token):
// иначе вход в диспетчерскую затирал бы сессию портала и наоборот.
const KEY = 'aemz_dispatch_token'
/** Токен активной вкладки единой платформы (см. lib/accounts.ts) */
const PLATFORM_KEY = 'aemz_session_token'

export function saveSessionToken(token: string | null | undefined) {
  try {
    if (token) window.localStorage.setItem(KEY, token)
    else window.localStorage.removeItem(KEY)
  } catch {
    /* приватный режим — остаёмся на cookie-сессии */
  }
}

export function clearSessionToken() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** fetch с заголовком Authorization, если сохранён токен сессии */
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  try {
    // Сначала сессия этой вкладки платформы: в объединённом интерфейсе
    // именно она определяет, кто смотрит Контур. Старый токен диспетчерской —
    // только резерв для отдельного кабинета.
    const platform = window.sessionStorage.getItem(PLATFORM_KEY)
    const token = platform || window.localStorage.getItem(KEY)
    if (token) headers.set('Authorization', `Bearer ${token}`)
  } catch {
    /* ignore */
  }
  const url = typeof input === 'string' ? withBasePath(input) : input
  return fetch(url, { ...init, headers })
}

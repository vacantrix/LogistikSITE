'use client'

/**
 * Общий клиентский хелпер ИИ-разделов: fetch к платформенным API с токеном
 * вкладки (кука сессии идёт сама). Раньше копия жила в ai-offer-list и
 * ai-assistant — теперь один источник для всех виджетов чата.
 */
import { getSessionToken } from '@/lib/api'

export async function aiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  try {
    const token = getSessionToken()
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  } catch {
    /* приватный режим — остаёмся на cookie-сессии */
  }
  return fetch(path, { ...init, headers })
}

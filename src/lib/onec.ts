/**
 * Интеграция с 1С — общий слой.
 *
 * Схема обмена (первая очередь):
 *   • GET  /api/integration/1c/ping         — проверка связи и ключа
 *   • GET  /api/integration/1c/dictionaries — справочники (перевозчики, водители, ТС, прицепы)
 *   • GET  /api/integration/1c/requests     — заявки/рейсы со статусами
 *   • POST /api/integration/1c/requests     — черновик заявки из 1С (логист публикует его на площадке)
 *   • GET  /api/integration/1c/etrn         — данные ЭТрН для 1С:ERP
 *   • POST /api/integration/1c/etrn        — подтверждения ЭТрН из 1С (SENT/SIGNED)
 *
 * Авторизация: только заголовок X-API-Key (ключ в адресе попадал бы в логи прокси).
 * Ключ задаётся переменной окружения ONEC_API_KEY (не короче 24 символов).
 * Ключа по умолчанию нет: без переменной интеграция выключена и отвечает 503.
 */
import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { RequestStatus } from '@/lib/types'

export const ONEC_VERSION = '1.1.0'

/** Ключ интеграции или null, если интеграция не настроена */
export function onecApiKey(): string | null {
  const key = process.env.ONEC_API_KEY
  return key && key.length >= 24 ? key : null
}

/** Ключ для показа в интерфейсе: только начало и конец */
export function onecKeyMasked(): string | null {
  const key = onecApiKey()
  return key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null
}

const digest = (v: string) => createHash('sha256').update(v).digest()

export function onecAuthorized(req: NextRequest): boolean {
  const key = onecApiKey()
  const header = req.headers.get('x-api-key')
  if (!key || !header) return false
  // сравнение за постоянное время (хеши одной длины)
  return timingSafeEqual(digest(header), digest(key))
}

export function onecUnauthorized(): NextResponse {
  if (!onecApiKey()) {
    return NextResponse.json({ ok: false, error: 'Интеграция с 1С не настроена: задайте ONEC_API_KEY на сервере' }, { status: 503 })
  }
  return NextResponse.json(
    { ok: false, error: 'Не авторизован: передайте API-ключ в заголовке X-API-Key' },
    { status: 401 },
  )
}

export function onecBadRequest(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400 })
}

export function onecMeta(count: number, extra: Record<string, unknown> = {}) {
  return { count, generatedAt: new Date().toISOString(), ...extra }
}

/** Человекочитаемые статусы заявок для 1С (дублируют REQUEST_STATUS_META) */
export const ONEC_STATUS_RU: Record<RequestStatus, string> = {
  DRAFT: 'Черновик',
  PUBLISHED: 'На площадке',
  AWARDED: 'Перевозчик выбран',
  DOCS_REVIEW: 'Документы проверяются',
  AT_LOGIST: 'Подготовка к рейсу',
  CONFIRMED: 'Рейс выполняется',
  CLOSED: 'Рейс закрыт',
  DELETED: 'Удалена',
}

export const ONEC_ETRN_RU: Record<string, string> = {
  NONE: 'Не выпущена',
  SENT: 'Отправлена на подпись',
  SIGNED: 'Подписана',
}

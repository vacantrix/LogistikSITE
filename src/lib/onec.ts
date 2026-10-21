/**
 * Интеграция с 1С — общий слой.
 *
 * Схема обмена (первая очередь):
 *   • GET  /api/integration/1c/ping         — проверка связи и ключа
 *   • GET  /api/integration/1c/dictionaries — справочники (перевозчики, водители, ТС, прицепы)
 *   • GET  /api/integration/1c/requests     — заявки/рейсы со статусами
 *   • GET  /api/integration/1c/etrn         — данные ЭТрН для 1С:ERP
 *   • POST /api/integration/1c/etrn        — подтверждения ЭТрН из 1С (SENT/SIGNED)
 *
 * Авторизация: заголовок X-API-Key (или ?apikey= для быстрых проверок).
 * Ключ задаётся переменной окружения ONEC_API_KEY, по умолчанию — демо-ключ.
 */
import { NextRequest, NextResponse } from 'next/server'
import type { RequestStatus } from '@/lib/types'

export const ONEC_API_KEY = process.env.ONEC_API_KEY ?? 'aemz-1c-demo-2024'
export const ONEC_VERSION = '1.0.0'

export function onecAuthorized(req: NextRequest): boolean {
  const header = req.headers.get('x-api-key')
  if (header === ONEC_API_KEY) return true
  return req.nextUrl.searchParams.get('apikey') === ONEC_API_KEY
}

export function onecUnauthorized(): NextResponse {
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
  PUBLISHED: 'На площадке',
  AWARDED: 'Перевозчик выбран',
  DOCS_REVIEW: 'Документы проверяются',
  AT_LOGIST: 'Подготовка к рейсу',
  CONFIRMED: 'Данные в 1С',
  CLOSED: 'Рейс закрыт',
}

export const ONEC_ETRN_RU: Record<string, string> = {
  NONE: 'Не выпущена',
  SENT: 'Отправлена на подпись',
  SIGNED: 'Подписана',
}

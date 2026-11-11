import { NextRequest, NextResponse } from 'next/server'

/**
 * Контракт интеграции с 1С (демо-режим).
 *
 * Целевой процесс: Сбыт формирует заявки в 1С → диспетчерская назначает ТС и
 * водителя → водитель видит заявку в приложении. Здесь отыграны оба направления:
 *
 * GET /api/1c/orders
 *   → список заявок, назначенных водителю (зеркало HTTP-сервиса 1С
 *     `get_driver_orders`; в проде серверный прокси ходит в 1С по расписанию,
 *     ключ — в Vault, как и для 2ГИС). Ответ идемпотентный.
 *
 * POST /api/1c/orders
 *   body: { orderId, action: 'ACCEPT' | 'PRETRIP_STEP' | 'START_ROUTE', stepId?, at? }
 *   → обратный канал: водитель взял заявку / выполнил шаг фотофиксации /
 *     начал маршрут. В проде пишется в 1С (статус заявки + печатная форма
 *     предрейсового осмотра). Демо: журнал в памяти процесса.
 */

import { DEMO_ORDERS } from '@/lib/demo/orders-data'

type OrderAction = 'ACCEPT' | 'PRETRIP_STEP' | 'START_ROUTE'

interface OrderEventLog {
  at: string
  orderId: string
  action: OrderAction
  stepId?: string
}

/** Журнал действий водителя по заявкам — живёт в памяти dev-процесса. */
const eventLog: OrderEventLog[] = []

export async function GET() {
  return NextResponse.json(
    {
      source: 'demo-seed',
      note: 'В проде — прокси к HTTP-сервису 1С (get_driver_orders), статусы назначений.',
      orders: DEMO_ORDERS,
      eventLog,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(req: NextRequest) {
  let body: { orderId?: string; action?: OrderAction; stepId?: string; at?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 })
  }
  const { orderId, action, stepId } = body
  if (!orderId || !action || !['ACCEPT', 'PRETRIP_STEP', 'START_ROUTE'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'orderId и action обязательны' }, { status: 400 })
  }
  if (action === 'PRETRIP_STEP' && !stepId) {
    return NextResponse.json({ ok: false, error: 'PRETRIP_STEP требует stepId' }, { status: 400 })
  }
  const known = DEMO_ORDERS.some((o) => o.number === orderId)
  if (!known) {
    return NextResponse.json({ ok: false, error: `заявка ${orderId} не найдена в 1С` }, { status: 404 })
  }
  const entry: OrderEventLog = { at: body.at ?? new Date().toISOString(), orderId, action, stepId }
  eventLog.push(entry)
  return NextResponse.json({ ok: true, received: entry, logLength: eventLog.length })
}

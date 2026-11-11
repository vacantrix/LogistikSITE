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
 *   body: { orderId, action: 'ACCEPT' | 'PRETRIP_STEP' | 'START_ROUTE' | 'COMPLETE_TRIP', stepId?, at? }
 *   → обратный канал: водитель взял заявку / выполнил шаг фотофиксации /
 *     начал маршрут / завершил рейс. В проде пишется в 1С (статус заявки +
 *     печатная форма предрейсового осмотра). Демо: журнал в памяти процесса,
 *     GET по нему же помечает заявки выполненными (status: 'DONE').
 */

import { DEMO_ORDERS } from '@/lib/demo/orders-data'

type OrderAction = 'ACCEPT' | 'PRETRIP_STEP' | 'START_ROUTE' | 'COMPLETE_TRIP' | 'ASSIGN'

interface OrderEventLog {
  at: string
  orderId: string
  action: OrderAction
  stepId?: string
}

/** Журнал действий водителя по заявкам — живёт в памяти dev-процесса. */
const eventLog: OrderEventLog[] = []

export async function GET() {
  // статусы отыгрываем по журналу: назначена диспетчером / рейс завершён
  const done = new Set(eventLog.filter((e) => e.action === 'COMPLETE_TRIP').map((e) => e.orderId))
  const assigned = new Set(eventLog.filter((e) => e.action === 'ASSIGN').map((e) => e.orderId))
  const orders = DEMO_ORDERS.map((o) => {
    if (done.has(o.number)) return { ...o, status: 'DONE' as const }
    if (assigned.has(o.number)) return { ...o, status: 'ASSIGNED' as const, assignedBy: 'Диспетчер Е. Крылова' }
    return o
  })
  return NextResponse.json(
    {
      source: 'demo-seed',
      note: 'В проде — прокси к HTTP-сервису 1С (get_driver_orders), статусы назначений.',
      orders,
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
  if (!orderId || !action || !['ACCEPT', 'PRETRIP_STEP', 'START_ROUTE', 'COMPLETE_TRIP', 'ASSIGN'].includes(action)) {
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

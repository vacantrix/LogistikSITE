import { NextRequest, NextResponse } from 'next/server'

/**
 * Тонкий прокси к платформе «Контур 1С» (ТЗ, раздел 10.2 — единственная правка
 * на стороне приложения водителя). Контракты:
 *
 * GET  /api/1c/orders → список заявок водителя (HTTP-сервис «1С» get_driver_orders)
 * POST /api/1c/orders → обратный канал { orderId, action: ACCEPT|PRETRIP_STEP|START_ROUTE|COMPLETE_TRIP, stepId?, at? }
 *
 * Адрес платформы — env KONTUR_1C_URL (по умолчанию http://127.0.0.1:3001/kontur —
 * basePath обязателен: платформа смонтирована под /kontur).
 * При подключении реальной 1С меняется только этот URL: контракты идентичны.
 * Если платформа недоступна — 502; клиент офлайн-first остаётся на локальном сидe.
 */

const BASE = process.env.KONTUR_1C_URL ?? 'http://127.0.0.1:3001/kontur'

async function proxy(req: NextRequest, method: 'GET' | 'POST') {
  const headers: Record<string, string> = {}
  const driverId = req.headers.get('x-driver-id')
  if (driverId) headers['X-Driver-Id'] = driverId
  if (method === 'POST') headers['Content-Type'] = 'application/json'
  try {
    const r = await fetch(`${BASE}/api/1c/orders`, {
      method,
      headers,
      body: method === 'POST' ? await req.text() : undefined,
      cache: 'no-store',
    })
    return new NextResponse(r.body, {
      status: r.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: `Платформа «Контур 1С» недоступна (${BASE})` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export async function GET(req: NextRequest) {
  return proxy(req, 'GET')
}

export async function POST(req: NextRequest) {
  return proxy(req, 'POST')
}

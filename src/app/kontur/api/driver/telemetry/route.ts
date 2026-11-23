import { NextResponse } from 'next/server'
import { ingestTelemetry, type TelemetryInput } from '@/lib/kontur/monitor'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Контракт телеметрии приложения водителя (для будущего реального приложения).
//
// POST /api/driver/telemetry
// {
//   "driverId": "<uuid>",                  // обязательно
//   "deviceId": "DEV-001",                 // опционально
//   "tripId":  "<uuid>|null",              // опционально: без него берётся активный рейс
//   "status":  "en_route",                 // опционально: статус из приложения
//                                          //   (assigned, en_route_loading, at_loading, loaded,
//                                          //    en_route, at_unload, unloaded, trip_completed,
//                                          //    empty_return, waiting_backhaul, breakdown, rest, idle)
//   "geo": {                               // опционально: точка от GPS
//     "lat": 45.0355, "lng": 38.9753,
//     "speedKmh": 76, "headingDeg": 132, "accuracyM": 8, "at": "2026-11-19T09:00:00Z"
//   },
//   "appVersion": "3.0.0",
//   "appInstalled": true,                  // false — водитель удалил приложение (тест)
//   "comment": "текст при поломке/отдыхе",
//   "source": "app" | "test_sim"           // кто отправил: приложение или симулятор
// }
//
// Ответ: { ok: true, status: "<текущий производный статус>" }
// Приложение шлёт пакет периодически (гео) и по событию (смена статуса).
// Системные статусы (offline, not_installed, repair, near_unload) сервер
// выводит сам и от приложения не принимает.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  let body: TelemetryInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Некорректный JSON' } }, { status: 400 })
  }

  if (!body?.driverId || typeof body.driverId !== 'string') {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Не указан driverId' } }, { status: 400 })
  }
  if (body.geo && (typeof body.geo.lat !== 'number' || typeof body.geo.lng !== 'number')) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'geo требует числа lat/lng' } }, { status: 400 })
  }

  const result = await ingestTelemetry(body)
  if (!result.ok) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: result.error ?? 'Отклонено' } }, { status: 400 })
  }
  return NextResponse.json({ ok: true, status: result.status })
}

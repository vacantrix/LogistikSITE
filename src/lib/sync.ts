'use client'

/**
 * Движок синхронизации — аналог связки PushWorker + PullWorker + ConnectivityObserver.
 * Цикл каждые 4 с: outbox → POST /sync/push (батч, идемпотентно), затем
 * GET /sync/pull?cursor (канал 1 — личный журнал), затем GET /sync/marks
 * (канал 2 — снимок пометок по bbox маршрута). Индикатор связи — три состояния:
 * зелёный «На связи», оранжевый «Отправка: N», красный «Офлайн. В очереди: N».
 *
 * Заявки из 1С (GET /api/1c/orders) тянем тем же циклом раз в 5 с: назначение
 * диспетчера должно появляться «по ходу», без перезапуска приложения.
 * Запрос выполняется и в демо-офлайн-режиме: входящие заявки не зависят от
 * очереди исходящих операций, а при реальном отсутствии сети fetch просто
 * завершится ошибкой и повторится следующим циклом.
 */

import { useEffect, useRef } from 'react'
import { useAzmz } from './store'
import { DEVICE_ID, DRIVER_ID, pointAtFraction } from './demo/route-data'
import { pointOnRoute } from './demo/real-route'
import type {
  JournalEntry,
  MarksSnapshot,
  PullResponse,
  PushOpResult,
  PushResponse,
  TrafficSnapshot,
} from './protocol'
import type { Order1C } from './demo/orders-data'

const TICK_MS = 4000
const PULL_LIMIT = 500
/** Заявки — раз в 5 с (быстрее диспетчер не назначает, медленнее — заметно человеку). */
const ORDERS_INTERVAL_MS = 5000
/** Пробки обновляются раз в минуту — чаще тянуть незачем. */
const TRAFFIC_INTERVAL_MS = 12_000
/** Телеметрия для диспетчера: фикс позиции каждые 5 с во время рейса. */
const POSITION_INTERVAL_MS = 5000

function isOffline(): boolean {
  const s = useAzmz.getState()
  if (s.offlineMode) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return false
}

async function doPush(): Promise<void> {
  const s = useAzmz.getState()
  const pending = s.outbox.filter((op) => op.state === 'PENDING')
  if (pending.length === 0) return
  try {
    const res = await fetch('/api/driver/v1/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Driver-Id': DRIVER_ID },
      body: JSON.stringify({ deviceId: DEVICE_ID, operations: pending.map((op) => ({ opId: op.opId, type: op.type, payload: op.payload })) }),
    })
    if (!res.ok) throw new Error(`push ${res.status}`)
    const data = (await res.json()) as PushResponse
    useAzmz.getState().pushResults(data.results as PushOpResult[])
  } catch {
    // сеть недоступна между тиками — остаёмся в «Отправке», операции сохранены
  }
}

async function doPull(): Promise<void> {
  const s = useAzmz.getState()
  let cursor = s.cursor
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`/api/driver/v1/sync/pull?cursor=${cursor}&limit=${PULL_LIMIT}`, {
        headers: { 'X-Driver-Id': DRIVER_ID },
      })
      if (!res.ok) throw new Error(`pull ${res.status}`)
      const data = (await res.json()) as PullResponse
      if (data.entries.length > 0) {
        useAzmz.getState().applyJournal(data.entries as JournalEntry[], data.cursor)
      }
      cursor = data.cursor
      if (!data.hasMore) break
    } catch {
      break
    }
  }
}

async function doMarks(): Promise<void> {
  const s = useAzmz.getState()
  const t = s.trip
  if (!t) return
  const pad = 0.04
  const minLat = (t.routeMinLat ?? 44.5) - pad
  const maxLat = (t.routeMaxLat ?? 45.0) + pad
  const minLon = (t.routeMinLon ?? 37.5) - pad
  const maxLon = (t.routeMaxLon ?? 38.3) + pad
  try {
    const res = await fetch(
      `/api/driver/v1/sync/marks?minLat=${minLat}&minLon=${minLon}&maxLat=${maxLat}&maxLon=${maxLon}&since=${s.marksSince}`,
      { headers: { 'X-Driver-Id': DRIVER_ID } },
    )
    if (!res.ok) return
    const data = (await res.json()) as MarksSnapshot
    if (data.marks.length > 0 || s.marksSince === 0) {
      useAzmz.getState().applyMarksSnapshot(data)
    }
  } catch {
    // снимок придёт на следующем тике
  }
}

async function doTraffic(): Promise<void> {
  const s = useAzmz.getState()
  const t = s.trip
  if (!t) return
  const pad = 0.05
  const minLat = (t.routeMinLat ?? 44.5) - pad
  const maxLat = (t.routeMaxLat ?? 45.0) + pad
  const minLon = (t.routeMinLon ?? 37.5) - pad
  const maxLon = (t.routeMaxLon ?? 38.3) + pad
  try {
    const res = await fetch(
      `/api/driver/v1/traffic?minLat=${minLat}&minLon=${minLon}&maxLat=${maxLat}&maxLon=${maxLon}&since=${s.trafficSince}`,
      { headers: { 'X-Driver-Id': DRIVER_ID } },
    )
    if (!res.ok) return
    const data = (await res.json()) as TrafficSnapshot
    useAzmz.getState().applyTrafficSnapshot(data)
  } catch {
    // офлайн: остаёмся на прошлом снимке (он сохранён в сторе)
  }
}

let lastTrafficAt = 0
let lastOrdersAt = 0
let lastPositionAt = 0

/**
 * Телеметрия: позиция грузовика → сервер → мониторинг диспетчера.
 * Отправляем то, что видит водитель на своей карте: навигационный фикс по
 * геометрии маршрута (OSRM или демо-А-146). Вне рейса не отправляем —
 * диспетчеру важно видеть машину только в пути.
 */
async function doPosition(): Promise<void> {
  const s = useAzmz.getState()
  if (s.orderStage !== 'in_progress') return
  const rr = s.realRoute
  const f = Math.max(0, Math.min(1, s.simProgressF))
  const p = rr ? pointOnRoute(rr.coords, f, rr.lengthM) : pointAtFraction(f)
  const active = s.orders.find((o) => o.number === s.activeOrderNumber)
  try {
    await fetch('/api/driver/v1/position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Driver-Id': DRIVER_ID },
      body: JSON.stringify({
        lat: p.lat,
        lon: p.lng,
        speedKmh: Math.round(s.simSpeedKmh),
        heading: Math.round(p.bearing),
        tripCode: active?.number,
        stage: s.orderStage,
        ts: Date.now(),
      }),
    })
  } catch {
    // телеметрия не критична: следующий цикл пришлёт свежий фикс
  }
}

/** Заявки из «1С»: поллинг каждые 5 с, новые назначения — тост водителю. */
async function doOrders(): Promise<void> {
  try {
    const res = await fetch('/api/1c/orders', {
      cache: 'no-store',
      headers: { 'X-Driver-Id': DRIVER_ID },
    })
    if (!res.ok) return
    const d = (await res.json()) as { orders?: Order1C[] }
    if (!d.orders?.length) return
    const st = useAzmz.getState()
    const known = new Set(st.orders.map((o) => o.number))
    const fresh = d.orders.find((o) => o.status === 'ASSIGNED' && !known.has(o.number))
    st.setOrders(d.orders)
    if (fresh && !useAzmz.getState().activeOrderNumber) {
      useAzmz.getState().showToast(`Из 1С: назначена заявка ${fresh.number} — откройте «Главную»`)
    }
  } catch {
    // сеть недоступна — останемся на локальных данных, повторим следующим циклом
  }
}

async function tick(): Promise<void> {
  const s = useAzmz.getState()
  useAzmz.getState().setSyncActive(true)
  try {
    // заявки тянем до проверки офлайна: входящие не зависят от очереди операций
    const ordersNow = Date.now()
    if (ordersNow - lastOrdersAt >= ORDERS_INTERVAL_MS) {
      lastOrdersAt = ordersNow
      await doOrders()
    }
    if (isOffline()) {
      s.setConnection('offline')
      return
    }
    const pendingCount = s.outbox.length
    if (pendingCount > 0) s.setConnection('syncing')
    await doPush()
    await doPull()
    await doMarks()
    const posNow = Date.now()
    if (posNow - lastPositionAt >= POSITION_INTERVAL_MS) {
      lastPositionAt = posNow
      await doPosition()
    }
    const now = Date.now()
    if (now - lastTrafficAt >= TRAFFIC_INTERVAL_MS) {
      lastTrafficAt = now
      await doTraffic()
    }
    const after = useAzmz.getState()
    after.setConnection(after.outbox.length > 0 ? 'syncing' : 'online')
  } finally {
    useAzmz.getState().setSyncActive(false)
  }
}

/** Хук ставится один раз в корне приложения. */
export function useSyncEngine(): void {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true

    void tick()
    const timer = setInterval(() => void tick(), TICK_MS)
    const onOnline = () => void tick()
    const onOffline = () => useAzmz.getState().setConnection('offline')
    // Возврат на экран: мобильный браузер замораживает таймеры в фоне —
    // открываем цикл сразу, чтобы заявка/рейс появились «по ходу», без
    // перезапуска приложения и ожидания следующего тика.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onOnline)
    window.addEventListener('pageshow', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onOnline)
      window.removeEventListener('pageshow', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}

/** Тик движения для навигационной симуляции. */
export function useSimTicker(): void {
  useEffect(() => {
    const timer = setInterval(() => {
      const s = useAzmz.getState()
      if (s.simRunning && !s.offlineMode) s.advanceSim(1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])
}

/** Ручной тик синхронизации (кнопка «Синхронизировать сейчас»). */
export function syncNow(): Promise<void> {
  return tick()
}

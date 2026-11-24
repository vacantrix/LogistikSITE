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

/**
 * Резервный polling. Основной канал входящих — длинный запрос /sync/wait:
 * сервер отвечает сразу, как только в журнале появилась запись для водителя.
 * 15 секунд — страховка на случай, если long-poll недоступен (старый прокси,
 * сбой шлюза): приложение всё равно обновится само.
 */
const TICK_MS = 15000
const PULL_LIMIT = 500
/** Длинный запрос ждёт изменение до 25 с; таймаут клиента — с запасом. */
const WAIT_TIMEOUT_S = 25
const WAIT_RETRY_MS = 3000
/** Заявки — раз в 5 с (быстрее диспетчер не назначает, медленнее — заметно человеку). */
const ORDERS_INTERVAL_MS = 5000
/** Пробки обновляются раз в минуту — чаще тянуть незачем. */
const TRAFFIC_INTERVAL_MS = 12_000
/** Телеметрия для диспетчера: фикс позиции каждые 5 с во время рейса. */
const POSITION_INTERVAL_MS = 5000

/** Один цикл синхронизации в полёте: wait/push/tick не наслаиваются друг на друга. */
let tickInFlight: Promise<void> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Последний результат проверки: не дёргаем сеть на каждом 4-секундном тике. */
let lastProbeAt = 0
let lastProbeOk = false

/**
 * navigator.onLine в Android WebView/PWA иногда остаётся false, хотя
 * интернет работает. Поэтому «браузер говорит офлайн» — ещё не приговор:
 * проверяем реальную доступность нашего API лёгким запросом.
 */
async function probeReachable(): Promise<boolean> {
  const now = Date.now()
  if (now - lastProbeAt < 10_000) return lastProbeOk
  lastProbeAt = now
  try {
    const res = await fetch(`/api/driver/v1/sync/pull?cursor=0&limit=1`, {
      headers: { 'X-Driver-Id': DRIVER_ID },
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(3500)
        : undefined,
    })
    lastProbeOk = res.ok
  } catch {
    lastProbeOk = false
  }
  return lastProbeOk
}

async function isOffline(): Promise<boolean> {
  const s = useAzmz.getState()
  if (s.offlineMode) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return !(await probeReachable())
  }
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

async function tickOnce(): Promise<void> {
  const s = useAzmz.getState()
  useAzmz.getState().setSyncActive(true)
  try {
    // заявки тянем до проверки офлайна: входящие не зависят от очереди операций
    const ordersNow = Date.now()
    if (ordersNow - lastOrdersAt >= ORDERS_INTERVAL_MS) {
      lastOrdersAt = ordersNow
      await doOrders()
    }
    if (await isOffline()) {
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

/** Один цикл на всех: события outbox/online и long-poll не дублируют работу. */
function tick(): Promise<void> {
  if (!tickInFlight) {
    tickInFlight = tickOnce().finally(() => {
      tickInFlight = null
    })
  }
  return tickInFlight
}

/**
 * Мгновенный канал входящих: long-poll /sync/wait. Сервер держит запрос до
 * появления записи в личном журнале (назначение рейса, ответ офиса, пометка)
 * и отвечает сразу — приложение делает pull в ту же секунду.
 * При обрыве/недоступности канала — короткая пауза и повтор; обычный 15-секундный
 * polling остаётся страховкой, поэтому данные не теряются.
 */
function startWaitLoop(): () => void {
  let stopped = false
  let controller: AbortController | null = null

  const run = async () => {
    while (!stopped) {
      if (useAzmz.getState().offlineMode) {
        await sleep(WAIT_RETRY_MS)
        continue
      }
      const cursor = useAzmz.getState().cursor
      controller = new AbortController()
      const timer = setTimeout(() => controller?.abort(), (WAIT_TIMEOUT_S + 10) * 1000)
      try {
        const res = await fetch(`/api/driver/v1/sync/wait?cursor=${cursor}&timeout=${WAIT_TIMEOUT_S}`, {
          headers: { 'X-Driver-Id': DRIVER_ID },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (res.ok) {
          const data = (await res.json()) as { changed?: boolean }
          if (data.changed) await tick()
          // сразу открываем следующее ожидание — канал не должен «спать»
        } else {
          // эндпоинт недоступен (старый шлюз/деплой) — не долбим его каждую секунду
          await sleep(15000)
        }
      } catch {
        if (!stopped) await sleep(WAIT_RETRY_MS)
      } finally {
        clearTimeout(timer)
      }
    }
  }

  void run()
  return () => {
    stopped = true
    controller?.abort()
  }
}

/** Хук ставится один раз в корне приложения. */
export function useSyncEngine(): void {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true

    void tick()
    const stopWait = startWaitLoop()
    const timer = setInterval(() => void tick(), TICK_MS)
    const onOnline = () => void tick()
    const onOffline = () => useAzmz.getState().setConnection('offline')
    // действие водителя (событие/пометка/чат) — push сразу, без ожидания тика
    const onOutbox = () => void tick()
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
    window.addEventListener('azmz:outbox', onOutbox)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      stopWait()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onOnline)
      window.removeEventListener('pageshow', onOnline)
      window.removeEventListener('azmz:outbox', onOutbox)
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

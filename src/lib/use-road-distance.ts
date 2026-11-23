'use client'

/**
 * Дорожное расстояние между точками заявок (OSRM, /api/route-distance).
 *
 * Один общий батч на все хуки страницы: панели маршрута и таблица площадки
 * складывают пары в очередь, через 50 мс уходит один POST. Результат живёт
 * в памяти и localStorage 30 дней, поэтому повторные открытия карточек и
 * перезагрузка страницы не дёргают OSRM заново.
 *
 * Пока значение не пришло (или OSRM не нашёл маршрут), компоненты
 * показывают запасное расстояние по прямой из lib/geo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { pointCoords } from '@/lib/geo'

export interface RoadPair {
  from: string
  to: string
}

interface CacheEntry {
  km: number
  at: number
}

const STORAGE_KEY = 'aemz_road_km_v2'
const STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STORAGE_MAX = 800
const BATCH_MS = 50
const MAX_BATCH = 100

const cache = new Map<string, CacheEntry>()
const pending = new Map<string, RoadPair>()
const listeners = new Set<() => void>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

const roadPairKey = (from: string, to: string): string => `${from}\u0000${to}`

function notify(): void {
  for (const listener of listeners) listener()
}

function loadStorage(): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as Record<string, CacheEntry>
    const now = Date.now()
    for (const [key, entry] of Object.entries(data)) {
      if (!entry || typeof entry.km !== 'number' || !Number.isFinite(entry.km)) continue
      if (!entry.at || now - entry.at > STORAGE_TTL_MS) continue
      cache.set(key, { km: entry.km, at: entry.at })
    }
  } catch {
    /* приватный режим или битые данные — считаем заново */
  }
}

function saveStorage(): void {
  if (typeof window === 'undefined') return
  try {
    const data: Record<string, CacheEntry> = {}
    let count = 0
    for (const [key, entry] of cache) {
      data[key] = entry
      if (++count >= STORAGE_MAX) break
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* переполнение хранилища — не критично, кэш остаётся в памяти */
  }
}

async function flush(): Promise<void> {
  flushTimer = null
  const batch = [...pending.entries()].slice(0, MAX_BATCH)
  for (const [key] of batch) pending.delete(key)
  if (batch.length === 0) return

  try {
    const { distances } = await api.routeDistance(batch.map(([, pair]) => pair))
    batch.forEach(([key], i) => {
      const km = distances?.[i]
      if (typeof km === 'number' && Number.isFinite(km) && km > 0) {
        cache.set(key, { km: Math.round(km), at: Date.now() })
      }
    })
    saveStorage()
  } catch {
    /* сеть или OSRM недоступны — на экране остаётся расстояние по прямой */
  }

  notify()
  if (pending.size > 0 && flushTimer == null) flushTimer = setTimeout(() => void flush(), BATCH_MS)
}

function schedule(pairs: RoadPair[]): void {
  let added = false
  for (const pair of pairs) {
    if (!pair?.from || !pair?.to) continue
    const key = roadPairKey(pair.from, pair.to)
    if (cache.has(key) || pending.has(key)) continue
    // точки не из справочника сервер всё равно не посчитает — не тратим запрос
    if (!pointCoords(pair.from) || !pointCoords(pair.to)) continue
    pending.set(key, pair)
    added = true
  }
  if (!added) return
  if (flushTimer == null) flushTimer = setTimeout(() => void flush(), BATCH_MS)
}

// Кэш из localStorage нужен уже на первом рендере, чтобы не мигать «по прямой»
loadStorage()

/**
 * Подписка на общий кэш дорожных расстояний.
 * Возвращает функцию «пара точек → км по дорогам» (null — ещё не посчитано).
 */
export function useRoadKm(pairs: RoadPair[]): (from: string, to: string) => number | null {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    listeners.add(bump)
    return () => {
      listeners.delete(bump)
    }
  }, [])

  useEffect(() => {
    schedule(pairs)
  }, [pairs])

  return useCallback(
    (from: string, to: string) => {
      void version // кэш обновился — функция пересоздана, потребители перерисуются
      return cache.get(roadPairKey(from, to))?.km ?? null
    },
    [version],
  )
}

/** Дорожное расстояние одной пары: km — по дорогам (null, пока не посчитано), road — признак источника */
export function useRoadDistance(from: string, to: string): { km: number | null; road: boolean } {
  const pairs = useMemo(() => [{ from, to }], [from, to])
  const kmOf = useRoadKm(pairs)
  const km = kmOf(from, to)
  return { km, road: km != null }
}

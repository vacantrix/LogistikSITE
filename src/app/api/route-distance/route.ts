import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { pointCoords, type LatLng } from '@/lib/geo'

export const dynamic = 'force-dynamic'

/**
 * POST /api/route-distance — расстояние по автомобильным дорогам для пар
 * «погрузка → выгрузка» (столбец «Км» на площадке, панель маршрута).
 *
 * Считает OSRM (Open Source Routing Machine): точки берутся из справочника
 * lib/points.ts, наружу уходят только координаты. Несколько пар решаются
 * таблицей расстояний OSRM одним запросом; если таблица недоступна —
 * точечными маршрутами. Результат кэшируется в памяти на 7 дней.
 *
 * Ответ: { distances: (number | null)[] } — км по дорогам в том же порядке;
 * null — точки нет в справочнике или маршрут не найден (клиент показывает
 * запасное расстояние по прямой).
 */

const OSRM_URL = (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '')
const OSRM_TIMEOUT_MS = 9000
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Ошибку «маршрут не найден» не держим неделю — вдруг сервис был недоступен */
const CACHE_NULL_TTL_MS = 60 * 60 * 1000
const CACHE_MAX = 5000
/** Больше координат в одном table-запросе публичный OSRM не любит */
const TABLE_MAX_POINTS = 50
const MAX_PAIRS = 100

interface Pair {
  from: string
  to: string
}

interface CacheEntry {
  at: number
  km: number | null
}

const cache = new Map<string, CacheEntry>()

const coordKey = (p: LatLng): string => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
const pairKey = (a: LatLng, b: LatLng): string => `${coordKey(a)}|${coordKey(b)}`

function fromCache(key: string): CacheEntry | null {
  const hit = cache.get(key)
  if (!hit) return null
  const ttl = hit.km == null ? CACHE_NULL_TTL_MS : CACHE_TTL_MS
  if (Date.now() - hit.at > ttl) {
    cache.delete(key)
    return null
  }
  return hit
}

function remember(key: string, km: number | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), km })
}

async function osrmJson(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AEMZ-Logistika/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as unknown
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
}

/** Таблица расстояний OSRM (метры) для набора точек; null — сервис не ответил */
async function osrmTable(points: LatLng[]): Promise<(number | null)[][] | null> {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
  const body = await osrmJson(`${OSRM_URL}/table/v1/driving/${coords}?annotations=distance`)
  if (!body || body.code !== 'Ok' || !Array.isArray(body.distances)) return null
  return body.distances as (number | null)[][]
}

/** Один автомобильный маршрут OSRM (метры); null — маршрут не найден */
async function osrmRoute(a: LatLng, b: LatLng): Promise<number | null> {
  const body = await osrmJson(`${OSRM_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`)
  const routes = body?.routes
  if (!body || body.code !== 'Ok' || !Array.isArray(routes) || routes.length === 0) return null
  const distance = (routes[0] as { distance?: unknown }).distance
  return typeof distance === 'number' && Number.isFinite(distance) ? distance : null
}

const metersToKm = (m: number | null): number | null =>
  m == null || !Number.isFinite(m) || m <= 0 ? null : Math.round(m / 1000)

/** Параллельные запросы к OSRM с ограничением: публичный демо-сервер не любит шквал */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as { pairs?: unknown } | null
  const raw = Array.isArray(body?.pairs) ? body.pairs.slice(0, MAX_PAIRS) : []
  const pairs: Pair[] = raw.map((p) => {
    const v = (p ?? {}) as { from?: unknown; to?: unknown }
    return {
      from: typeof v.from === 'string' ? v.from.slice(0, 200) : '',
      to: typeof v.to === 'string' ? v.to.slice(0, 200) : '',
    }
  })
  if (pairs.length === 0) return NextResponse.json({ distances: [] })

  const distances: (number | null)[] = pairs.map(() => null)
  const resolved: { index: number; key: string; a: LatLng; b: LatLng }[] = []

  pairs.forEach((pair, i) => {
    const a = pointCoords(pair.from)
    const b = pointCoords(pair.to)
    if (!a || !b) return
    const key = pairKey(a, b)
    const hit = fromCache(key)
    if (hit) {
      distances[i] = hit.km
      return
    }
    resolved.push({ index: i, key, a, b })
  })

  if (resolved.length > 0) {
    const unique = new Map<string, LatLng>()
    for (const r of resolved) {
      unique.set(coordKey(r.a), r.a)
      unique.set(coordKey(r.b), r.b)
    }
    const points = [...unique.values()]
    const index = new Map(points.map((p, i) => [coordKey(p), i]))
    let tableOk = false

    // Один table-запрос на все уникальные точки: 10 заявок — не 20 запросов к OSRM
    if (points.length <= TABLE_MAX_POINTS) {
      const matrix = await osrmTable(points).catch(() => null)
      if (matrix) {
        tableOk = true
        for (const r of resolved) {
          const ia = index.get(coordKey(r.a))
          const ib = index.get(coordKey(r.b))
          const cell = ia == null || ib == null ? null : matrix[ia]?.[ib]
          const km = metersToKm(typeof cell === 'number' ? cell : null)
          distances[r.index] = km
          remember(r.key, km)
        }
      }
    }

    // Таблица недоступна (или точек слишком много) — точечные маршруты
    if (!tableOk) {
      const todo = [...new Map(resolved.map((r) => [r.key, r])).values()]
      const results = await mapLimit(todo, 4, (r) => osrmRoute(r.a, r.b).catch(() => null))
      todo.forEach((r, i) => remember(r.key, metersToKm(results[i])))
      for (const r of resolved) {
        const hit = cache.get(r.key)
        distances[r.index] = hit ? hit.km : null
      }
    }
  }

  return NextResponse.json({ distances }, { headers: { 'Cache-Control': 'private, max-age=3600' } })
}

import { NextRequest, NextResponse } from 'next/server'

/**
 * Серверный прокси к Routing API 2ГИС (POST https://routing.api.2gis.com/routing/7.0.0/global).
 *
 * Зачем прокси, а не прямые запросы из браузера:
 *  1. Ключ 2ГИС хранится на сервере (env) и не попадает в бандл клиента —
 *     MapGL-ключ всё равно публичный (ограничивается доменом в Platform Manager),
 *     а ключ навигационных API экономнее держать серверно: демо-ключ = 1000 запросов.
 *  2. Единая точка для кеша (30 с), лимитов и логирования расхода квоты.
 *  3. Прод-архитектура (каркас АЗМЗ): Spring Boot вызывает 2ГИС той же схемой —
 *     см. azmz-karkas README, раздел «Внешние поставщики дорожной обстановки».
 *
 * Формат тела — белый список полей Routing API 7.0.0:
 *   points: [[lon, lat], ...] | [{lon, lat}, ...]   (обязательно)
 *   transport: 'car' | 'truck' | 'taxi' | 'motorcycle' | 'bicycle' | 'driving' | 'walking'
 *   traffic_mode: 'jam' (реалтайм) | 'statistics' (прогноз)
 *   route_mode: 'fastest' | 'shortest'
 *   output: 'detailed' | 'summary'
 *   alternative: 0..3 — число альтернативных маршрутов
 *   truck_params: { mass, height, width, length, axle_load } — габариты грузового ТС
 *   need_payment_info, allow_locked_roads, utc (для statistics), point_type, send_start
 *
 * Ответ — сырой JSON 2ГИС + meta (latencyMs, cached, keyConfigured, status).
 */

const UPSTREAM = 'https://routing.api.2gis.com/routing/7.0.0/global'

/** Кеш ответов: экономит квоту демо-ключа при повторных проверках ETA. */
const cache = new Map<string, { body: unknown; exp: number }>()
const CACHE_TTL_MS = 30_000
const CACHE_MAX = 300

function apiKey(): string {
  return process.env['2GIS_API_KEY'] || process.env.NEXT_PUBLIC_2GIS_KEY || ''
}

function normalizePoints(raw: unknown): Array<{ type: string; lon: number; lat: number; start?: boolean }> | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 10) return null
  const pts: Array<{ type: string; lon: number; lat: number; start?: boolean }> = []
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]
    if (Array.isArray(p) && p.length >= 2) {
      const lon = Number(p[0])
      const lat = Number(p[1])
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
      pts.push({ type: 'stop', lon, lat, ...(i === 0 ? { start: true } : {}) })
    } else if (p && typeof p === 'object' && 'lon' in p && 'lat' in p) {
      const lon = Number((p as Record<string, unknown>)['lon'])
      const lat = Number((p as Record<string, unknown>)['lat'])
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
      pts.push({ type: 'stop', lon, lat, ...(i === 0 ? { start: true } : {}) })
    } else {
      return null
    }
  }
  return pts
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(min, Math.min(max, Math.round(n)))
}

export async function POST(req: NextRequest) {
  const key = apiKey()
  const t0 = Date.now()

  let bodyIn: Record<string, unknown>
  try {
    bodyIn = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!key) {
    return NextResponse.json(
      {
        error: 'no_key',
        hint: 'Ключ 2ГИС не задан. Добавьте 2GIS_API_KEY=... в .env и перезапустите dev-сервер.',
      },
      { status: 503 },
    )
  }

  const points = normalizePoints(bodyIn['points'])
  if (!points) {
    return NextResponse.json({ error: 'bad_points', hint: 'points: [[lon,lat],...], 2..10 точек' }, { status: 400 })
  }

  const transport = typeof bodyIn['transport'] === 'string' ? (bodyIn['transport'] as string) : 'car'
  const trafficMode = bodyIn['traffic_mode'] === 'statistics' ? 'statistics' : 'jam'
  const routeMode = bodyIn['route_mode'] === 'shortest' ? 'shortest' : 'fastest'
  const output = bodyIn['output'] === 'summary' ? 'summary' : 'detailed'
  const alternative = clampInt(bodyIn['alternative'], 0, 3, 1)
  const pointType = typeof bodyIn['point_type'] === 'string' ? (bodyIn['point_type'] as string) : 'stop'
  const sendStart = bodyIn['send_start'] !== false

  const upstreamBody: Record<string, unknown> = {
    locale: 'ru',
    transport,
    route_mode: routeMode,
    traffic_mode: trafficMode,
    output,
    alternative,
    points: points.map((p, i) => ({
      type: pointType,
      lon: p.lon,
      lat: p.lat,
      ...(sendStart && i === 0 ? { start: true } : {}),
    })),
  }

  // Габариты грузовика — передаём как есть (валидацию делает 2ГИС).
  if (bodyIn['truck_params'] && typeof bodyIn['truck_params'] === 'object') {
    upstreamBody['truck_params'] = bodyIn['truck_params']
  }
  if (bodyIn['need_payment_info'] === true) upstreamBody['need_payment_info'] = true
  if (bodyIn['allow_locked_roads'] === true) upstreamBody['allow_locked_roads'] = true
  if (Number.isFinite(Number(bodyIn['utc']))) upstreamBody['utc'] = Math.round(Number(bodyIn['utc']))

  // Кеш: одинаковый запрос в течение 30 с — из памяти (экономия квоты демо-ключа).
  const cacheKey = JSON.stringify(upstreamBody)
  const hit = cache.get(cacheKey)
  if (hit && hit.exp > Date.now()) {
    return NextResponse.json({
      ...(hit.body as object),
      meta: { latencyMs: Date.now() - t0, cached: true, keyConfigured: true },
    })
  }

  let upstreamResp: Response
  try {
    upstreamResp = await fetch(`${UPSTREAM}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: msg, meta: { latencyMs: Date.now() - t0 } },
      { status: 504 },
    )
  }

  let data: unknown
  try {
    data = await upstreamResp.json()
  } catch {
    return NextResponse.json(
      { error: 'upstream_bad_json', status: upstreamResp.status, meta: { latencyMs: Date.now() - t0 } },
      { status: 502 },
    )
  }

  // Ошибки ключа/лимитов у 2ГИС приходят с разными кодами — пробрасываем как есть.
  const payload = {
    ...(data as object),
    meta: { latencyMs: Date.now() - t0, cached: false, keyConfigured: true, upstreamStatus: upstreamResp.status },
  }

  if (upstreamResp.ok) {
    // FIFO-вытеснение, чтобы кеш не рос бесконечно.
    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
    cache.set(cacheKey, { body: data, exp: Date.now() + CACHE_TTL_MS })
  }

  return NextResponse.json(payload, {
    status: upstreamResp.ok ? 200 : upstreamResp.status === 401 || upstreamResp.status === 403 ? 401 : 502,
  })
}

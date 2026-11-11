import { NextRequest, NextResponse } from 'next/server'

/**
 * Прокси тайлов базовой карты (демо).
 *
 * Проблема: браузер водителя ходил напрямую на tiles.openfreemap.org — в
 * закрытых/мобильных сетях это часто отваливается, и карта «не отображается».
 * Решение: карта ходит ТОЛЬКО на наш origin. Стиль раздаёт /api/mapstyle,
 * а все ресурсы стиля (векторные тайлы, шрифты-глифы, спрайты, raster
 * Natural Earth, TileJSON) идут через этот catch-all прокси с кэшем в памяти.
 *
 * ВАЖНО: TileJSON переписывается с АБСОЛЮТНЫМ origin запроса — MapLibre
 * отвергает относительные URL. Кэш хранит сырой ответ, rewrite дешёвый.
 *
 * В проде (каркас) роль этого прокси играет nginx перед self-hosted
 * PMTiles + FontServer — принцип тот же: один origin, без внешних
 * зависимостей (и без Yandex API — ограничение лицензии).
 *
 * Маршруты (всё под /api/maptiles/):
 *   fonts/<fontstack>/<range>.pbf        → глифы (SDF-шрифты)
 *   sprites/<set>/<name>[.json|.png|@2x] → спрайты иконок
 *   esri/{z}/{x}/{y}.png                 → резервный raster (Esri Light Gray)
 *   natural_earth/ne2sr/{z}/{x}/{y}.png  → raster-подложка Natural Earth
 *   planet                               → TileJSON (tiles переписываются)
 *   planet/<version>/{z}/{x}/{y}.pbf     → векторные тайлы планеты
 */

const UPSTREAM = 'https://tiles.openfreemap.org'
/** Растровый fallback: светлый Esri World Light Gray (без ключа, z/y/x!). */
const UPSTREAM_ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile'

/** Кэш: тайлы/шрифты/спрайты — 6–11 ч (стабильные), TileJSON — 5 мин. */
const cache = new Map<string, { ct: string; body: ArrayBuffer; exp: number }>()
const MAX_ENTRIES = 1200

function cacheGet(key: string) {
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return hit
  if (hit) cache.delete(key)
  return null
}

function cachePut(key: string, value: { ct: string; body: ArrayBuffer; exp: number }) {
  if (cache.size >= MAX_ENTRIES) {
    // FIFO-вытеснение: удаляем самые старые вставки
    const drop = Math.ceil(MAX_ENTRIES / 20)
    let i = 0
    for (const k of cache.keys()) {
      cache.delete(k)
      if (++i >= drop) break
    }
  }
  cache.set(key, value)
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.pbf') || path.endsWith('.pbf2')) return 'application/x-protobuf'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

function cacheControlFor(path: string): string {
  // TileJSON и версии планеты меняются при обновлении — кэшуем короче
  if (path === 'planet' || /planet\/\d{8}_\d{6}_pt\//.test(path)) {
    return 'public, max-age=300'
  }
  return 'public, max-age=86400, immutable'
}

/** Origin как его видит браузер (учитываем проксирование Caddy). */
function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')
  const host = req.headers.get('host') ?? req.nextUrl.host
  return `${proto}://${host}`
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const sub = (path ?? []).join('/')
  if (!sub) return NextResponse.json({ error: 'bad path' }, { status: 400 })

  // esri/{z}/{x}/{y} → светлый растровый Esri (у него порядок z/y/x!),
  // остальное — OpenFreeMap
  const parts = sub.split('/')
  const isEsri = parts[0] === 'esri' && parts.length === 4
  const upstreamUrl = isEsri
    ? `${UPSTREAM_ESRI}/${parts[1]}/${parts[3]}/${parts[2]}`
    : `${UPSTREAM}/${sub}`
  const ttl = sub === 'planet' ? 5 * 60_000 : 6 * 3_600_000 + Math.floor(Math.random() * 5 * 3_600_000)

  const hit = cacheGet(upstreamUrl)
  if (hit) {
    // TileJSON: переписываем под текущий origin (кэш хранит сырой ответ)
    if (sub === 'planet' && hit.ct.includes('json')) {
      const tiles = rewriteTileJson(hit.body, requestOrigin(req))
      if (tiles) {
        return new NextResponse(tiles, {
          status: 200,
          headers: { 'Content-Type': hit.ct, 'Cache-Control': cacheControlFor(sub), 'X-Tile-Cache': 'hit' },
        })
      }
    }
    return new NextResponse(hit.body, {
      status: 200,
      headers: { 'Content-Type': hit.ct, 'Cache-Control': cacheControlFor(sub), 'X-Tile-Cache': 'hit' },
    })
  }

  try {
    const res = await fetch(upstreamUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: '*/*' },
      // Next кэширует fetch сам — нам нужен наш собственный слой кэша
      cache: 'no-store',
    })
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 })
    }
    const body = await res.arrayBuffer()
    const ct = res.headers.get('content-type') ?? contentTypeFor(sub)
    cachePut(upstreamUrl, { ct, body, exp: Date.now() + ttl })

    if (sub === 'planet' && ct.includes('json')) {
      const tiles = rewriteTileJson(body, requestOrigin(req))
      if (tiles) {
        return new NextResponse(tiles, {
          status: 200,
          headers: { 'Content-Type': ct, 'Cache-Control': cacheControlFor(sub), 'X-Tile-Cache': 'miss' },
        })
      }
    }

    return new NextResponse(body, {
      status: 200,
      headers: { 'Content-Type': ct, 'Cache-Control': cacheControlFor(sub), 'X-Tile-Cache': 'miss' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'tile fetch failed', detail: msg }, { status: 502 })
  }
}

/** TileJSON → те же tiles, но через наш прокси с абсолютным origin. */
function rewriteTileJson(body: ArrayBuffer, origin: string): ArrayBuffer | null {
  try {
    const json = JSON.parse(new TextDecoder().decode(body)) as { tiles?: string[] }
    if (!Array.isArray(json.tiles)) return null
    json.tiles = json.tiles.map((u) =>
      new URL(u.replace(`${UPSTREAM}/`, '/api/maptiles/'), `${origin}/`)
        .toString()
        .replace(/%7B/g, '{')
        .replace(/%7D/g, '}'),
    )
    return new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer
  } catch {
    return null
  }
}

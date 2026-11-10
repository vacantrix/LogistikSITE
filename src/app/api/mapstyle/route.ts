import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/mapstyle — стиль базовой карты (Positron, светлый OSM).
 *
 * Отдаёт стиль OpenFreeMap, переписывая ВСЕ URL на наш прокси
 * /api/maptiles/…, чтобы браузер водителя никуда не ходил напрямую:
 * тайлы, глифы шрифтов, спрайты иконок и raster-подложка идут через наш
 * origin (решает «карта не отображается» в закрытых сетях).
 *
 * ВАЖНО: MapLibre требует АБСОЛЮТНЫЕ URL спрайтов и глифов — поэтому
 * переписываем с учётом origin запроса (X-Forwarded-Proto/Host через
 * Caddy), а не отдаём относительные пути.
 *
 * Кэш: по origin, 5 минут. При недоступности апстрима — 502, клиент
 * покажет FALLBACK_STYLE (фон + маршрут).
 */

const UPSTREAM_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const UPSTREAM_ORIGIN = 'https://tiles.openfreemap.org/'

type MapStyle = {
  glyphs?: string
  sprite?: string | { id: string; url: string }[]
  sources?: Record<string, { tiles?: string[]; url?: string } & Record<string, unknown>>
  [key: string]: unknown
}

type StyleCache = { body: string; exp: number }

/** Кэш стилей по origin (URL абсолютные → зависят от origin). */
const styleCache = new Map<string, StyleCache>()

function rewriteUrls(style: MapStyle, base: string): MapStyle {
  // new URL() кодирует {z}/{x}/{y} как %7Bz%7D — MapLibre ищет литеральные
  // «{z}» в шаблоне, возвращаем скобки обратно.
  const toProxy = (u: string) =>
    new URL(u.replace(UPSTREAM_ORIGIN, '/api/maptiles/'), base)
      .toString()
      .replace(/%7B/g, '{')
      .replace(/%7D/g, '}')
  if (typeof style.glyphs === 'string') style.glyphs = toProxy(style.glyphs)
  if (typeof style.sprite === 'string') style.sprite = toProxy(style.sprite)
  if (Array.isArray(style.sprite)) {
    style.sprite = style.sprite.map((s) => ({ ...s, url: toProxy(s.url) }))
  }
  for (const src of Object.values(style.sources ?? {})) {
    if (Array.isArray(src.tiles)) src.tiles = src.tiles.map(toProxy)
    if (typeof src.url === 'string') src.url = toProxy(src.url)
  }
  return style
}

/** Origin как его видит браузер (учитываем проксирование Caddy). */
function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')
  const host = req.headers.get('host') ?? req.nextUrl.host
  return `${proto}://${host}`
}

export async function GET(req: NextRequest) {
  const origin = requestOrigin(req)
  const hit = styleCache.get(origin)
  if (hit && hit.exp > Date.now()) {
    return new NextResponse(hit.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', 'X-Style-Cache': 'hit' },
    })
  }

  try {
    const res = await fetch(UPSTREAM_STYLE, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 })
    const style = (await res.json()) as MapStyle
    const body = JSON.stringify(rewriteUrls(style, `${origin}/`))
    styleCache.set(origin, { body, exp: Date.now() + 5 * 60_000 })
    return new NextResponse(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', 'X-Style-Cache': 'miss' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'style fetch failed', detail: msg }, { status: 502 })
  }
}

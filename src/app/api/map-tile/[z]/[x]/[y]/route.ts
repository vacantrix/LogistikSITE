/**
 * Прокси тайлов OpenStreetMap для карты доставки.
 *
 * Браузер в песочнице предпросмотра не имеет прямого доступа к tile.openstreetmap.org —
 * карта остаётся серой. Тайлы отдаёт этот маршрут: сервер запрашивает их у OSM
 * (с корректным User-Agent по политике OSM) и кэширует в памяти процесса,
 * браузер же получает тайл по относительному пути со своего же origin.
 *
 * /api/map-tile/{z}/{x}/{y}  (расширение .png допускается и отбрасывается)
 */
import { NextRequest } from 'next/server'

const UPSTREAM = 'https://tile.openstreetmap.org'
const UA = 'AEMZ-Logistics-Demo/1.0 (internal logistics platform demo)'

/** Памятный кэш тайлов: ограничен по числу записей, TTL сутки */
const MAX_CACHE = 600
const TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { buf: ArrayBuffer; expires: number; type: string }>()

const PNG = 'image/png'

function parseParams(raw: { z: string; x: string; y: string }): { z: number; x: number; y: number } | null {
  const z = Number.parseInt(raw.z, 10)
  const x = Number.parseInt(raw.x, 10)
  const yRaw = raw.y.replace(/\.png$/i, '')
  const y = Number.parseInt(yRaw, 10)
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null
  if (z < 0 || z > 19) return null
  const n = 2 ** z
  if (x < 0 || x >= n || y < 0 || y >= n) return null
  return { z, x, y }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await ctx.params
  const ok = parseParams({ z, x, y })
  if (!ok) return new Response('Bad tile', { status: 400 })

  const key = `${ok.z}/${ok.x}/${ok.y}`

  // свежий тайл из кэша — без похода наружу
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) {
    // поднимаем запись в конец (LRU через переустановку в Map)
    cache.delete(key)
    cache.set(key, hit)
    return new Response(hit.buf, {
      headers: { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400' },
    })
  }
  if (hit) cache.delete(key)

  try {
    const res = await fetch(`${UPSTREAM}/${ok.z}/${ok.x}/${ok.y}.png`, {
      headers: { 'User-Agent': UA, Accept: 'image/png' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return new Response('Tile upstream error', { status: 502 })
    }
    const buf = await res.arrayBuffer()
    const type = res.headers.get('content-type')?.split(';')[0] ?? PNG
    cache.set(key, { buf, expires: Date.now() + TTL_MS, type })
    // чистим кэш, если разросся: выкидываем самые старые записи
    while (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return new Response(buf, {
      headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' },
    })
  } catch {
    return new Response('Tile fetch failed', { status: 502 })
  }
}

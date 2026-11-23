/**
 * Маршрут офиса из Яндекс.Карт.
 *
 * Офис строит маршрут в Яндекс.Картах, нажимает «Поделиться» → «Ссылка» и
 * вставляет ссылку в карточку рейса. В ссылке есть только точки маршрута
 * (`rtext=широта,долгота~…`), но не готовая линия. Поэтому платформа:
 *   1) разбирает точки и сохраняет их в порядке маршрута;
 *   2) строит дорожную линию через ВСЕ эти точки (OSRM, OpenStreetMap);
 *   3) отдаёт водителю ссылку, точки и готовую линию.
 *
 * Так порядок и состав точек полностью повторяют маршрут Яндекса. Точную
 * геометрию Яндекса без его платного Routing API воспроизвести нельзя —
 * для этого в карточке есть кнопка «Открыть в Яндекс.Картах» с исходной
 * ссылкой (навигатор Яндекса ведёт по своему маршруту).
 */

export type RouteWaypoint = { lat: number; lng: number }

export type ParsedYandexRoute =
  | { ok: true; link: string; waypoints: RouteWaypoint[]; rtt: string }
  | { ok: false; error: string }

const MAX_WAYPOINTS = 25

/** Сборка канонической ссылки Яндекс.Карт по точкам. */
export function buildYandexRouteUrl(points: RouteWaypoint[], rtt = 'auto'): string {
  const rtext = points.map((p) => `${p.lat},${p.lng}`).join('~')
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=${rtt}`
}

/** «1 точка», «2 точки», «5 точек» — для карточки рейса. */
export function pointsLabel(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} точка`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} точки`
  return `${n} точек`
}

/**
 * Разбор вставленной ссылки. rtext ищется регэкспом, поэтому текст вокруг
 * ссылки (например, «смотри маршрут: …») не мешает. Координаты Яндекса —
 * «широта,долгота»; если первая координата явно долгота (> 90), меняем местами.
 */
export function parseYandexRouteLink(input: string): ParsedYandexRoute {
  const text = input.trim()
  if (!text) return { ok: false, error: 'Вставьте ссылку на маршрут из Яндекс.Карт' }

  const m = text.match(/[?&]rtext=([^&\s"'<>]+)/) ?? text.match(/rtext=([^&\s"'<>]+)/)
  if (!m) {
    if (/[?&]um=/.test(text)) {
      return { ok: false, error: 'Это ссылка на место, а не на маршрут. В Яндекс.Картах постройте маршрут и нажмите «Поделиться» → «Ссылка»' }
    }
    return { ok: false, error: 'В ссылке нет маршрута (rtext). Скопируйте её в Яндекс.Картах: «Поделиться» → «Ссылка»' }
  }

  let raw: string
  try {
    raw = decodeURIComponent(m[1])
  } catch {
    return { ok: false, error: 'Ссылка повреждена: некорректное URL-кодирование' }
  }

  const waypoints: RouteWaypoint[] = []
  for (const part of raw.split('~')) {
    const clean = part.trim().replace(/^[*+]/, '')
    if (!clean) continue
    const pair = clean.split(',')
    let lat = Number.parseFloat(pair[0] ?? '')
    let lng = Number.parseFloat(pair[1] ?? '')
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: `Точка «${part}» не распознана — ожидается «широта,долгота»` }
    }
    // Яндекс иногда отдаёт ссылки с обратным порядком координат.
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
      const t = lat
      lat = lng
      lng = t
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { ok: false, error: `Точка (${lat}, ${lng}) вне диапазона координат` }
    }
    waypoints.push({ lat, lng })
  }

  if (waypoints.length < 2) {
    return { ok: false, error: 'В маршруте меньше двух точек — добавьте в Яндекс.Картах начальную и конечную точки' }
  }
  if (waypoints.length > MAX_WAYPOINTS) {
    return { ok: false, error: `В маршруте ${waypoints.length} точек — максимум ${MAX_WAYPOINTS}. Разделите рейс на плечи` }
  }

  const rtt = (text.match(/[?&]rtt=([a-z]+)/i)?.[1] ?? 'auto').toLowerCase()
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i)
  const link = urlMatch ? urlMatch[0].replace(/[),.;]+$/, '') : buildYandexRouteUrl(waypoints, rtt)
  return { ok: true, link, waypoints, rtt }
}

/** Сохранённый JSON [[lat,lng],…] → точки для API водителя. */
export function waypointsFromJson(json: string | null | undefined): RouteWaypoint[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return []
    return arr.flatMap((p) => {
      if (!Array.isArray(p) || p.length < 2) return []
      const lat = Number(p[0])
      const lng = Number(p[1])
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : []
    })
  } catch {
    return []
  }
}

/** GeoJSON LineString → [[lng,lat],…] для карты водителя. */
export function coordsFromGeoJson(geoJson: string | null | undefined): [number, number][] {
  if (!geoJson) return []
  try {
    const obj = JSON.parse(geoJson) as { type?: string; coordinates?: unknown }
    if (obj.type !== 'LineString' || !Array.isArray(obj.coordinates)) return []
    return obj.coordinates.flatMap((c) => {
      if (!Array.isArray(c) || c.length < 2) return []
      const lng = Number(c[0])
      const lat = Number(c[1])
      return Number.isFinite(lat) && Number.isFinite(lng) ? [[lng, lat] as [number, number]] : []
    })
  } catch {
    return []
  }
}

/** GeoJSON LineString из [[lng,lat],…]. */
export function geoJsonFromCoords(coords: [number, number][]): string {
  return JSON.stringify({ type: 'LineString', coordinates: coords })
}

export type RoadRoute = {
  coords: [number, number][]
  distanceM: number
  durationS: number
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number }
  /** Откуда взята линия: точная геометрия Яндекса или OSRM по точкам. */
  source: 'yandex' | 'osrm'
  /** Итоговый адрес после редиректов (короткая ссылка Яндекса → полная). */
  finalUrl?: string
}

/**
 * Точная геометрия маршрута Яндекса.
 *
 * Публичная страница Яндекс.Карт с параметром rtext содержит готовый ответ
 * маршрутизатора (`routerResponse.routes[0].coordinates`) — ту самую линию,
 * которую офис видит в Яндексе. Забираем её при сохранении ссылки: водитель
 * получает ровно офисный маршрут, без пересчёта по OSRM и без ключей API.
 * Если страница не отдала данные (короткая ссылка, защита, смена разметки),
 * честно возвращаем null — вызывающий код построит линию через точки OSRM.
 */
const YANDEX_TIMEOUT_MS = 15_000
const YANDEX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

type YandexRouterRoute = {
  type?: string
  coordinates?: unknown
  distance?: { value?: number } | number
  duration?: { value?: number } | number
  durationInTraffic?: { value?: number }
  flags?: { blocked?: boolean }
}

type YandexRouterResponse = { routes?: YandexRouterRoute[] }

/** Ссылка должна вести на Яндекс.Карты: не превращаем поле в SSRF-прокси. */
export function isYandexMapsLink(input: string): boolean {
  try {
    const u = new URL(input.trim())
    return (
      /(^|\.)yandex\.(ru|com|by|kz|uz)$/i.test(u.hostname) ||
      /(^|\.)maps\.yandex\.(ru|com|by|kz|uz)$/i.test(u.hostname)
    )
  } catch {
    return false
  }
}

/** URL страницы маршрута: оставляем rtext/rtt, убираем лишние параметры. */
function yandexRoutePageUrl(link: string): string {
  const u = new URL(link.trim())
  if (!u.searchParams.has('rtt')) u.searchParams.set('rtt', 'auto')
  u.hash = ''
  return u.toString()
}

/**
 * Достаёт JSON-объект, начинающийся после маркера, с учётом строк и
 * экранирования. HTML Яндекса — не валидный JSON целиком, но routerResponse
 * лежит в нём одним объектом.
 */
function extractJsonObject(html: string, marker: string): string | null {
  const mi = html.indexOf(marker)
  if (mi < 0) return null
  const start = html.indexOf('{', mi + marker.length)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return html.slice(start, i + 1)
    }
  }
  return null
}

function numberValue(v: { value?: number } | number | undefined): number | null {
  const n = typeof v === 'number' ? v : v?.value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function validCoords(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((c) => {
    if (!Array.isArray(c) || c.length < 2) return []
    const lng = Number(c[0])
    const lat = Number(c[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return []
    return [[lng, lat] as [number, number]]
  })
}

/** Разбор уже загруженной страницы (выделено для тестов и повторного использования). */
export function parseYandexRoutePage(html: string): RoadRoute | null {
  const raw = extractJsonObject(html, '"routerResponse":')
  if (!raw) return null
  let data: YandexRouterResponse
  try {
    data = JSON.parse(raw) as YandexRouterResponse
  } catch {
    return null
  }
  const routes = (data.routes ?? []).filter((r) => (!r.type || r.type === 'auto') && !r.flags?.blocked)
  // Первый маршрут в ответе — рекомендованный Яндексом (тот, что видит офис).
  const route = routes.find((r) => validCoords(r.coordinates).length >= 2)
  if (!route) return null
  const coords = validCoords(route.coordinates)
  if (coords.length < 2) return null

  const lats = coords.map((c) => c[1])
  const lons = coords.map((c) => c[0])
  const distanceM = Math.round(numberValue(route.distance) ?? 0)
  const durationS = Math.round(numberValue(route.durationInTraffic) ?? numberValue(route.duration) ?? 0)
  return {
    coords,
    distanceM,
    durationS,
    bbox: {
      minLat: Math.min(...lats),
      minLon: Math.min(...lons),
      maxLat: Math.max(...lats),
      maxLon: Math.max(...lons),
    },
    source: 'yandex',
  }
}

/** Точная линия из публичной страницы Яндекс.Карт; null — не получилось. */
export async function fetchYandexRoadRoute(link: string): Promise<RoadRoute | null> {
  if (!isYandexMapsLink(link)) return null
  try {
    const res = await fetch(yandexRoutePageUrl(link), {
      headers: {
        'User-Agent': YANDEX_UA,
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal:
        typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(YANDEX_TIMEOUT_MS)
          : undefined,
      cache: 'no-store',
    })
    if (!res.ok) return null
    const html = await res.text()
    const road = parseYandexRoutePage(html)
    return road ? { ...road, finalUrl: res.url } : null
  } catch {
    return null
  }
}

const OSRM_TIMEOUT_MS = 12_000

function osrmBases(): string[] {
  const custom = process.env.OSRM_BASE_URL?.trim().replace(/\/$/, '')
  return [
    ...(custom ? [custom] : []),
    'https://vacantrix.ru/osrm/route/v1/driving',
    'https://router.project-osrm.org/route/v1/driving',
  ]
}

/**
 * Дорожная линия через все точки по порядку. null — OSRM недоступен;
 * маршрут всё равно сохраняется (точки уйдут водителю, линию он построит сам).
 */
export async function fetchRoadRoute(waypoints: RouteWaypoint[]): Promise<RoadRoute | null> {
  if (waypoints.length < 2) return null
  const points = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const path = `${points}?overview=full&geometries=geojson&alternatives=false&steps=false`
  for (const base of osrmBases()) {
    try {
      const res = await fetch(`${base}/${path}`, {
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(OSRM_TIMEOUT_MS) : undefined,
        cache: 'no-store',
      })
      if (!res.ok) continue
      const data = (await res.json()) as {
        code?: string
        routes?: Array<{
          distance?: number
          duration?: number
          geometry?: { coordinates?: [number, number][] }
        }>
      }
      const route = data.code === 'Ok' ? data.routes?.[0] : undefined
      const coords = route?.geometry?.coordinates
      if (!coords || coords.length < 2) continue
      const lats = coords.map((c) => c[1])
      const lons = coords.map((c) => c[0])
      return {
        coords,
        distanceM: Math.round(route?.distance ?? 0),
        durationS: Math.round(route?.duration ?? 0),
        bbox: {
          minLat: Math.min(...lats),
          minLon: Math.min(...lons),
          maxLat: Math.max(...lats),
          maxLon: Math.max(...lons),
        },
        source: 'osrm',
      }
    } catch {
      // пробуем следующий адрес OSRM
    }
  }
  return null
}

/** Часы → «8 ч 15 мин», минуты → «45 мин». */
export function durationLabel(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const total = Math.round(seconds / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

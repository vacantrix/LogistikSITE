import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isStaff, requireUser } from '@/lib/auth'
import {
  formatAddress, formatPlace, issuerTemplates, placeAt, placeRank, regionFromText,
  type PhotonFeature, type SuggestKind, type Suggestion,
} from '@/lib/suggest'

export const dynamic = 'force-dynamic'

/** Геокодер Photon по данным OpenStreetMap; свой экземпляр — через GEOCODER_URL */
const PHOTON = (process.env.GEOCODER_URL || 'https://photon.komoot.io').replace(/\/$/, '')
const CACHE_TTL = 6 * 3600_000
const CACHE_MAX = 500
const cache = new Map<string, { at: number; items: Suggestion[] }>()

/** Россия (вкл. Калининград) — адрес регистрации ищется только здесь */
const RU_BBOX = '19.6,41.1,180,82'
/** Без явного региона выше в выдаче — юг России, где работает завод */
const BIAS = { lat: '45.04', lon: '38.98' }

async function photon(path: string, params: Record<string, string>): Promise<PhotonFeature[]> {
  const url = `${PHOTON}${path}?${new URLSearchParams(params)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AEMZ-Logistika/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`geocoder ${res.status}`)
  const body = (await res.json()) as { features?: PhotonFeature[] }
  return body.features ?? []
}

const uniq = (items: (Suggestion | null)[], limit: number): Suggestion[] => {
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const s of items) {
    if (!s || seen.has(s.label)) continue
    seen.add(s.label)
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

async function cached(key: string, load: () => Promise<Suggestion[]>): Promise<Suggestion[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items
  const items = await load()
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), items })
  return items
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * POST /api/suggest — подсказки для полей проформы водителя.
 * { kind: 'address' | 'place', q } — поиск по карте; { kind: 'reverse', lat, lon, level? } — адрес точки на карте;
 * { kind: 'issuer', q, region?, county?, address? } — «Кем выдан»: формулировки по региону адреса
 * и уже введённые в базе значения. Текст запроса — в теле, а не в адресной строке.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const kind = body?.kind as SuggestKind
  const q = str(body?.q)

  try {
    if (kind === 'address' || kind === 'place') {
      if (q.length < 3) return NextResponse.json({ items: [] })
      const items = await cached(`${kind}:${q.toLowerCase()}`, async () => {
        if (kind === 'address') {
          const features = await photon('/api/', { q, limit: '15', lang: 'default', bbox: RU_BBOX, ...BIAS })
          return uniq(features.filter((f) => f.properties.countrycode === 'RU').map(formatAddress), 8)
        }
        // место рождения может быть и за рубежом — без привязки к региону, города выше сёл
        const features = await photon('/api/', { q, limit: '15', lang: 'default', osm_tag: 'place' })
        const ranked = features.map((f, i) => ({ f, i })).sort((a, b) => placeRank(a.f.properties) - placeRank(b.f.properties) || a.i - b.i)
        return uniq(ranked.map(({ f }) => formatPlace(f)), 8)
      })
      return NextResponse.json({ items })
    }

    if (kind === 'reverse') {
      const lat = Number(body?.lat)
      const lon = Number(body?.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ items: [] })
      // level: 'place' — населённый пункт (место рождения), иначе адрес с улицей и домом
      const place = body?.level === 'place'
      const key = `reverse:${place ? 'place' : 'address'}:${lat.toFixed(5)},${lon.toFixed(5)}`
      const items = await cached(key, async () => {
        const at = { lat: String(lat), lon: String(lon), lang: 'default' }
        if (!place) {
          return uniq((await photon('/reverse', { ...at, limit: '1' })).map(formatAddress), 1).map((s) => ({ ...s, lat, lon }))
        }
        // ближайший населённый пункт в радиусе 15 км; в большом городе — город найденного дома
        const near = await photon('/reverse', { ...at, limit: '5', osm_tag: 'place', radius: '15' })
        const found = uniq(near.map(placeAt), 1)
        const items = found.length > 0 ? found : uniq((await photon('/reverse', { ...at, limit: '1' })).map(placeAt), 1)
        return items.map((s) => ({ ...s, lat, lon }))
      })
      return NextResponse.json({ items })
    }

    if (kind === 'issuer') {
      const fromText = regionFromText(str(body?.address, 400))
      const region = str(body?.region) || fromText.region
      const county = str(body?.county) || fromText.county
      // значения, уже введённые в базе: внутренний контур видит всех, перевозчик — только своих водителей
      const rows = await db.driver.findMany({
        where: isStaff(auth.role) ? {} : { carrierId: auth.carrierId ?? '' },
        select: { passportIssuedBy: true },
        take: 3000,
      })
      const used = [...new Set(rows.map((r) => r.passportIssuedBy.trim()).filter((v) => v && v !== '—'))]
      const needle = q.toLowerCase()
      const match = (v: string) => !needle || v.toLowerCase().includes(needle)
      const items = uniq(
        [...issuerTemplates(region, county), ...used].filter(match).map((label) => ({ label })),
        10,
      )
      return NextResponse.json({ items })
    }

    return NextResponse.json({ error: 'Неизвестный вид подсказки' }, { status: 400 })
  } catch {
    // карта недоступна — поле остаётся обычным полем ввода
    return NextResponse.json({ items: [], unavailable: true })
  }
}

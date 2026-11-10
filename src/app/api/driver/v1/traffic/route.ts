import { NextRequest, NextResponse } from 'next/server'
import { TRAFFIC_SEGMENTS, routeLengthM, sliceFraction, toGeoJSON } from '@/lib/demo/route-data'
import type { TrafficLevel, TrafficSegment, TrafficSnapshot } from '@/lib/protocol'

/**
 * GET /api/driver/v1/traffic — снимок пробок по bbox (канал 3).
 *
 * Зеркалит архитектуру пометок (канал 2): общие данные, НЕ в личном журнале,
 * клиент тянет снимок по коридору маршрута. В проде (каркас, V7) сегменты
 * агрегируются из телеметрии парка (position_ping → map-matching →
 * traffic_segment) и раздаются этим же контрактом.
 *
 * Демо-генерация детерминирована по минуте: все клиенты видят одинаковую
 * картину, «жизнь» обновляется раз в минуту без хранения состояния.
 */

const MINUTE = 60_000
/** Скорость по уровню, км/ч (нижняя + верхняя граница диапазона). */
const LEVEL_SPEED: [number, number][] = [
  [62, 78], // 0 свободно
  [38, 55], // 1 замедление
  [16, 30], // 2 пробка
  [4, 12], // 3 затор
]

/** Детерминированный PRNG: одинаковый seed → одинаковое число на всех инстансах. */
function hashRand(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10_000) / 10_000
}

/** «Жизнь» трафика: уровень сегмента дрожит вокруг базового ±1. */
function levelFor(segId: string, base: number, minute: number): TrafficLevel {
  const r = hashRand(`${segId}:${minute}`)
  let delta = 0
  if (r > 0.78) delta = 1
  else if (r < 0.18) delta = -1
  // минутная инерция: сглаживаем с предыдущей минутой, чтобы не мигало
  const rPrev = hashRand(`${segId}:${minute - 1}`)
  if (Math.abs(r - rPrev) < 0.12) delta = 0
  return Math.max(0, Math.min(3, base + delta)) as TrafficLevel
}

function buildSnapshot(now: number): TrafficSnapshot {
  const minute = Math.floor(now / MINUTE)
  const segments: TrafficSegment[] = TRAFFIC_SEGMENTS.map((seg) => {
    const level = levelFor(seg.id, seg.baseLevel, minute)
    const [lo, hi] = LEVEL_SPEED[level]
    const speed = Math.round(lo + hashRand(`sp:${seg.id}:${minute}`) * (hi - lo))
    const geometry = seg.fRange
      ? toGeoJSON(sliceFraction(seg.fRange[0], seg.fRange[1]))
      : toGeoJSON(seg.sideCoords as [number, number][])
    return {
      id: seg.id,
      title: seg.title,
      geometry,
      level,
      speedKmh: speed,
      onRoute: !!seg.fRange,
      updatedAt: minute * MINUTE,
    }
  })

  // балл 1–10: средневзвешенный по длине участка маршрута
  const totalM = routeLengthM()
  const routeSegs = TRAFFIC_SEGMENTS.filter((s) => s.fRange)
  let weighted = 0
  for (const seg of routeSegs) {
    const level = segments.find((s) => s.id === seg.id)!.level
    const lengthM = (seg.fRange![1] - seg.fRange![0]) * totalM
    weighted += level * lengthM
  }
  const avg = weighted / totalM // 0..3
  const score = Math.max(1, Math.min(10, Math.round(avg * 3.1)))

  // задержка на маршруте: Σ(длина/скорость_текущая − длина/скорость_свободной)
  let delaySec = 0
  for (const seg of routeSegs) {
    const s = segments.find((x) => x.id === seg.id)!
    const lengthM = (seg.fRange![1] - seg.fRange![0]) * totalM
    const freeSec = lengthM / (seg.freeFlowKmh / 3.6)
    const curSec = lengthM / (s.speedKmh / 3.6)
    delaySec += Math.max(0, curSec - freeSec)
  }
  const routeDelayMin = Math.round(delaySec / 60)

  return {
    snapshotAt: minute * MINUTE,
    score,
    routeDelayMin,
    segments,
    contributors: 43, // демо: телеметрия 43 машин парка
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const minLat = Number(sp.get('minLat'))
  const minLon = Number(sp.get('minLon'))
  const maxLat = Number(sp.get('maxLat'))
  const maxLon = Number(sp.get('maxLon'))
  const since = Number(sp.get('since') ?? '0') || 0

  const snap = buildSnapshot(Date.now())

  // инкрементальная оптимизация (как у пометок): не изменилось — пустой снимок
  if (since >= snap.snapshotAt) {
    return NextResponse.json({ ...snap, segments: [] } satisfies TrafficSnapshot)
  }

  // фильтр по bbox (пересечение ломанной сегмента с запрошенным окном)
  const hasBbox = [minLat, minLon, maxLat, maxLon].every((n) => Number.isFinite(n))
  const segments = hasBbox
    ? snap.segments.filter((s) => {
        const coords = (JSON.parse(s.geometry) as { coordinates: [number, number][] }).coordinates
        return coords.some(([lng, lat]) => lng >= minLon && lng <= maxLon && lat >= minLat && lat <= maxLat)
      })
    : snap.segments

  return NextResponse.json({ ...snap, segments } satisfies TrafficSnapshot)
}

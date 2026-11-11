// Демо-генератор пробок: правдоподобные сегменты на дорогах Краснодарского края.
import { randomUUID } from 'crypto'
import { db } from '../db'

const ROADS = [
  { title: 'А-146 · Гайдук — Крымск', points: [[37.78, 44.70], [37.85, 44.74], [37.92, 44.78], [38.00, 44.82]] },
  { title: 'А-146 · Абинск — Крымск', points: [[38.16, 44.87], [38.05, 44.84], [37.95, 44.80]] },
  { title: 'М-4 «Дон» · Северный обход Краснодара', points: [[38.90, 45.08], [38.97, 45.05], [39.05, 45.03]] },
  { title: 'А-160 · Новороссийск — Керчь', points: [[37.77, 44.69], [37.70, 44.72], [37.63, 44.75]] },
  { title: 'Р-217 «Кавказ» · Тимашевск', points: [[38.93, 45.61], [38.99, 45.58], [39.05, 45.55]] },
  { title: 'М-4 «Дон» · Ростов — Самара (Кущёвка)', points: [[39.60, 46.60], [39.68, 46.57], [39.75, 46.54]] },
  { title: 'А-290 · Новороссийск — Джубга', points: [[37.78, 44.66], [37.86, 44.61], [37.95, 44.55]] },
  { title: 'Краснодар · ул. Российская', points: [[38.96, 45.04], [38.98, 45.02], [39.00, 45.00]] },
]

export async function refreshTraffic() {
  const chosen = [...ROADS].sort(() => Math.random() - 0.5).slice(0, 5 + Math.floor(Math.random() * 4))
  const rows = chosen.map((r, i) => {
    const level = 1 + Math.floor(Math.random() * 10)
    return {
      id: `osm:way:${1000 + i}:${Math.floor(Math.random() * 9)}`,
      title: r.title,
      geometry: JSON.stringify({ type: 'LineString', coordinates: r.points.map(([lon, lat]) => [lon, lat]) }),
      level,
      speedKmh: Math.max(8, 90 - level * 8),
      onRoute: Math.random() > 0.4,
    }
  })
  await db.$transaction(async (tx) => {
    await tx.trafficSegment.deleteMany()
    await tx.trafficSegment.createMany({ data: rows })
  })
  return rows
}

export function segmentBbox(geometry: string): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  const g = JSON.parse(geometry) as { coordinates: [number, number][] }
  const lats = g.coordinates.map((c) => c[1])
  const lons = g.coordinates.map((c) => c[0])
  return { minLat: Math.min(...lats), minLon: Math.min(...lons), maxLat: Math.max(...lats), maxLon: Math.max(...lons) }
}

export function newMarkId(): string {
  return randomUUID()
}

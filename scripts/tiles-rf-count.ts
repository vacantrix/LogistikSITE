/**
 * Подсчёт тайлов офлайн-пака «Вся Россия» (bbox РФ с переходом через 180-й
 * меридиан) + коридор маршрута А-146 + «пузырь» вокруг водителя.
 * Запуск: bun /home/z/my-project/scripts/tiles-rf-count.ts
 */

const RF_LAT_MIN = 41.0
const RF_LAT_MAX = 82.0
const RF_LNG_MIN = 19.0
/** Восточная граница РФ за 180-м меридианом: 190° == -170°. */
const RF_LNG_EAST = 190.0

function lngToX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z
}
function latToY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}

/** Строки x для диапазона долгот (с заворотом через 180°). */
function xRanges(z: number): Array<[number, number]> {
  const n = 2 ** z
  const xWest = Math.floor(lngToX(RF_LNG_MIN, z))
  const xEastEdge = Math.floor(lngToX(RF_LNG_EAST, z)) // > n при переходе
  const ranges: Array<[number, number]> = []
  if (xEastEdge >= n) {
    // 19°..180° и -180°..-170° (последняя колонка заворачивается: x % n)
    ranges.push([xWest, n - 1])
    ranges.push([0, xEastEdge - n])
  } else {
    ranges.push([xWest, xEastEdge])
  }
  return ranges
}

function countryTiles(z: number): number {
  const yTop = Math.floor(latToY(RF_LAT_MAX, z))
  const yBot = Math.ceil(latToY(RF_LAT_MIN, z)) - 1
  const rows = Math.max(0, yBot - yTop + 1)
  let cols = 0
  for (const [a, b] of xRanges(z)) cols += b - a + 1
  return rows * cols
}

// --- коридор: грубая оценка по ломаной Абинск→Новороссийск (63 км) ---
const CORRIDOR: Array<[number, number]> = [
  [37.32, 44.87], [37.35, 44.84], [37.42, 44.81], [37.5, 44.78], [37.58, 44.76],
  [37.66, 44.75], [37.74, 44.74], [37.82, 44.75], [37.9, 44.77], [37.98, 44.8],
  [38.04, 44.84], [38.1, 44.88], [38.18, 44.92], [38.26, 44.95], [38.34, 44.97],
  [38.42, 44.98], [38.5, 44.96], [38.58, 44.93], [38.66, 44.9], [38.74, 44.87],
  [38.82, 44.85], [38.9, 44.83], [38.98, 44.81], [39.06, 44.8], [39.14, 44.79],
  [39.22, 44.78], [39.3, 44.77], [39.38, 44.76], [39.46, 44.75], [39.54, 44.74],
]

function corridorTiles(z: number, bufferM: number): number {
  const n = 2 ** z
  const tileM = (40075_000 / n) // ширина тайла на экваторе
  const rings = Math.ceil((bufferM + tileM * 1.5) / tileM)
  const set = new Set<string>()
  for (const [lng, lat] of CORRIDOR) {
    const cx = Math.floor(lngToX(lng, z))
    const cy = Math.floor(latToY(lat, z))
    for (let dx = -rings; dx <= rings; dx++) {
      for (let dy = -rings; dy <= rings; dy++) {
        if (dx * dx + dy * dy > (rings + 0.5) ** 2) continue
        set.add(`${cx + dx}:${cy + dy}`)
      }
    }
  }
  return set.size
}

const CORRIDOR_ZOOMS: Array<{ z: number; bufferM: number }> = [
  { z: 9, bufferM: 32_000 },
  { z: 10, bufferM: 16_000 },
  { z: 11, bufferM: 8_000 },
  { z: 12, bufferM: 4_000 },
  { z: 13, bufferM: 2_000 },
  { z: 14, bufferM: 1_000 },
  { z: 15, bufferM: 500 },
  { z: 16, bufferM: 250 },
]

const BUBBLE_RADII: Array<{ z: number; r: number }> = [
  { z: 10, r: 30_000 },
  { z: 11, r: 20_000 },
  { z: 12, r: 12_000 },
  { z: 13, r: 7_000 },
  { z: 14, r: 4_000 },
  { z: 15, r: 2_000 },
]

let country = 0
console.log('— Страна (bbox РФ):')
for (const z of [4, 5, 6, 7, 8]) {
  const c = countryTiles(z)
  country += c
  console.log(`  z${z}: ${c.toLocaleString('ru-RU')} плиток`)
}
console.log(`  итого z4–8: ${country.toLocaleString('ru-RU')} плиток`)

let corridor = 0
console.log('— Коридор маршрута (~63 км):')
for (const { z, bufferM } of CORRIDOR_ZOOMS) {
  const c = corridorTiles(z, bufferM)
  corridor += c
  console.log(`  z${z} (буфер ${bufferM} м): ${c.toLocaleString('ru-RU')}`)
}
console.log(`  итого: ${corridor.toLocaleString('ru-RU')}`)

let bubble = 0
for (const { z, r } of BUBBLE_RADII) {
  const n = 2 ** z
  const tileM = 40_075_000 / n
  const rings = Math.ceil((r + tileM) / tileM)
  bubble += (2 * rings + 1) ** 2
}
console.log(`— Пузырь вокруг водителя z10–15: ~${bubble.toLocaleString('ru-RU')} плиток`)

const total = country + corridor + bubble
console.log(`\nВСЕГО: ${total.toLocaleString('ru-RU')} плиток`)
console.log(`Оценка веса при ~7 КБ/плитку: ~${Math.round((total * 7) / 1024)} МБ`)
console.log(`Оценка веса при ~9 КБ/плитку: ~${Math.round((total * 9) / 1024)} МБ`)

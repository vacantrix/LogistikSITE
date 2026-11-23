/**
 * Занятость состава (водитель + тягач + прицеп): когда рейс освободится.
 * Чистая функция без обращения к БД — используется и на сервере (умный подбор
 * /api/match), и на клиенте (доска «Занятость», график «Планирования»), чтобы
 * момент освобождения считался везде одинаково и разделы не расходились
 * друг с другом.
 */
import { cityGeo, haversineKm } from '@/lib/kontur/geo'

export type FreesInfo = { at: Date; point: string; lastLegDesc: string }

const DAY_MS = 86400000
const UNLOAD_BUF_MIN = 45 // запас на выгрузку и документы после планового времени (B6.6)
const AVG_SPEED_KMH = 55 // средняя скорость тягача на трассе — та же, что в графике планирования
const DEFAULT_TRANSIT_H = 2 // км между городами не посчитать — грубая оценка хода

// Плечо в упрощённом виде: сервер приходит с Date из Prisma, клиент — со строками ISO
type LegLike = {
  seq: number
  status: string
  loadPoint: string
  unloadPoint: string
  loadDatePlan?: string | Date | null
  unloadDatePlan?: string | Date | null
}

/** км между пунктами по центрам городов; null — город не опознан */
function kmBetween(a?: string | null, b?: string | null): number | null {
  const ga = cityGeo(a)
  const gb = cityGeo(b)
  if (!ga || !gb) return null
  const km = haversineKm(ga, gb)
  return km < 1 ? 0 : Math.round(km)
}

const ts = (v: string | Date | null | undefined): number | null => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Момент и пункт освобождения состава по его плечам: берём последнее открытое
 * плечо и плановую дату выгрузки. Если водитель уже на выгрузке — «через
 * полчаса». Если плана выгрузки нет, но есть план погрузки — считаем от
 * погрузки: ход до выгрузки по километражу (55 км/ч, как в графике
 * «Планирования») + запас. Если планов нет вовсе — «в течение пары часов».
 */
export function tripFrees(legs: LegLike[], now: Date): FreesInfo | null {
  const sorted = [...legs].sort((a, b) => a.seq - b.seq)
  const open = sorted.filter((l) => l.status !== 'completed' && l.status !== 'cancelled')
  const last = open[open.length - 1] ?? sorted[sorted.length - 1]
  if (!last) return null
  const atUnloading = last.status === 'at_unloading' || last.status === 'unloaded'
  const unloadPlan = ts(last.unloadDatePlan)
  const loadPlan = ts(last.loadDatePlan)
  let at: Date
  if (atUnloading) {
    at = new Date(now.getTime() + 30 * 60000)
  } else if (unloadPlan != null) {
    const base = unloadPlan > now.getTime() - DAY_MS ? unloadPlan : now.getTime() // план в прошлом — считаем «вот-вот»
    at = new Date(Math.max(base, now.getTime()) + UNLOAD_BUF_MIN * 60000)
  } else if (loadPlan != null) {
    // плана выгрузки нет (грузы ATI.SU часто без него): погрузка + ход + запас
    const km = kmBetween(last.loadPoint, last.unloadPoint)
    const transitMs = (km != null ? Math.max(0.5, km / AVG_SPEED_KMH) : DEFAULT_TRANSIT_H) * 3600000
    at = new Date(Math.max(loadPlan, now.getTime()) + transitMs + UNLOAD_BUF_MIN * 60000)
  } else {
    at = new Date(now.getTime() + 2 * 3600000) // планов нет — грубая оценка «в течение пары часов»
  }
  return {
    at,
    point: last.unloadPoint || last.loadPoint,
    lastLegDesc: `${last.loadPoint} → ${last.unloadPoint}`,
  }
}

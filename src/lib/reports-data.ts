/**
 * Агрегация данных для раздела «Отчёты» (Task 100).
 * Считает всё на сервере один раз: глобальный KPI (для дашборда — совместимость),
 * проформу № 1 (экономия по заявкам) и проформу № 2 (обороты и привлечённый
 * транспорт) за произвольный период. Период задаётся датами from/to
 * (включительно, «YYYY-MM-DD»); legacy month=YYYY-MM и отсутствие параметров
 * дают текущий месяц. Экономия в проформах считается деньгами:
 * (стартовая ставка − итоговая ставка) × тоннаж, в отличие от старого KPI,
 * который суммировал разности ставок (₽/т) и сохранён для дашборда как был.
 *
 * Проекция на полный месяц считается только для идущего календарного месяца
 * (факт / прошедшие дни × дни месяца); для завершённого месяца и произвольного
 * диапазона показывается факт за период. Дни и месяцы — по МСК (report-period.ts).
 */
import { db } from '@/lib/db'
import { REQUEST_STATUS_META } from '@/lib/status'
import { monthLabel } from '@/lib/utils'
import { daysInMonth, isoDay, isoMonth, mskDay, resolvePeriod, ruDay, type ReportPeriod } from '@/lib/report-period'
import type {
  Proforma1Row, ReportPieSlice, ReportSummary,
} from '@/lib/types'

/** Заявка с нужными для отчётов связями (Prisma-включения) */
interface ReportRequest {
  id: string
  number: string
  fromPoint: string
  toPoint: string
  cargo: string
  tonnage: number
  startRate: number
  bestRate: number | null
  status: string
  etrnStatus: string
  createdAt: Date
  winnerId: string | null
  bids: { id: string }[]
  documents: { status: string }[]
  winner: { name: string } | null
}

/** подпись периода: месяц — «Май 2025», диапазон — «01.05.2025 – 15.05.2025» (один день — только дата) */
function periodLabelOf(p: ReportPeriod): string {
  if (p.kind !== 'range') return monthLabel(isoMonth(p.first))
  return isoDay(p.first) === isoDay(p.last) ? ruDay(p.first) : `${ruDay(p.first)} – ${ruDay(p.last)}`
}

/** разбить список на топ-N и «Прочие» (для круговых диаграмм) */
function topPlusOther(items: ReportPieSlice[], topN: number): ReportPieSlice[] {
  if (items.length <= topN) return items
  const head = items.slice(0, topN)
  const rest = items.slice(topN)
  const restSum = rest.reduce((s, x) => s + x.value, 0)
  const total = items.reduce((s, x) => s + x.value, 0)
  return [...head, { label: `Прочие (${rest.length})`, value: restSum, share: Math.round((restSum / total) * 1000) / 10 }]
}

/** накопить доли (share, %) в готовом списке долек */
function withShares(items: { label: string; value: number }[]): ReportPieSlice[] {
  const total = items.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return []
  return items.map((x) => ({ ...x, share: Math.round((x.value / total) * 1000) / 10 }))
}

export async function buildReport(periodParams: { from?: string; to?: string; month?: string } = {}): Promise<ReportSummary> {
  const now = new Date()
  const period = resolvePeriod(periodParams, now)
  const { from, to, kind: periodKind } = period
  const periodLabel = periodLabelOf(period)

  const requests = (await db.request.findMany({
    include: { bids: true, winner: true, documents: true },
    orderBy: { createdAt: 'asc' },
  })) as unknown as ReportRequest[]

  /* ——— Глобальный KPI (без изменений — используется дашбордом) ——— */

  const active = requests.filter((r) => !['CLOSED'].includes(r.status))
  const confirmedOrClosed = requests.filter((r) => ['CONFIRMED', 'CLOSED'].includes(r.status))

  const savingsMonth = confirmedOrClosed.reduce((s, r) => s + (r.bestRate != null && r.bestRate < r.startRate ? r.startRate - r.bestRate : 0), 0)

  const withBids = requests.filter((r) => r.bids.length > 0)
  const avgBidsAll = withBids.length ? withBids.reduce((s, r) => s + r.bids.length, 0) / withBids.length : 0

  const finalDocs = requests.flatMap((r) => r.documents).filter((d) => d.status !== 'PENDING')
  const docsAutoShare = finalDocs.length ? finalDocs.filter((d) => d.status === 'PASSED').length / finalDocs.length : 0
  const confirmedCount = confirmedOrClosed.length
  const etrnShare = confirmedCount ? confirmedOrClosed.filter((r) => r.etrnStatus !== 'NONE').length / confirmedCount : 0

  const dirMap = new Map<string, { count: number; sum: number; min: number }>()
  for (const r of [...active, ...confirmedOrClosed]) {
    const key = `${r.fromPoint} → ${r.toPoint}`
    const rate = r.bestRate ?? r.startRate
    const cur = dirMap.get(key) ?? { count: 0, sum: 0, min: Number.POSITIVE_INFINITY }
    cur.count++
    cur.sum += rate
    cur.min = Math.min(cur.min, rate)
    dirMap.set(key, cur)
  }

  const carMap = new Map<string, { taken: number; sum: number; n: number }>()
  for (const r of requests) {
    if (!r.winner) continue
    const cur = carMap.get(r.winner.name) ?? { taken: 0, sum: 0, n: 0 }
    cur.taken++
    if (r.bestRate) { cur.sum += r.bestRate; cur.n++ }
    carMap.set(r.winner.name, cur)
  }
  const allCarriers = await db.carrier.findMany({ include: { _count: { select: { wonRequests: true, bids: true } } } })
  for (const c of allCarriers) {
    if (!carMap.has(c.name)) carMap.set(c.name, { taken: c._count.wonRequests, sum: 0, n: 0 })
  }

  /* ——— Выбранный период ——— */

  const inPeriod = requests.filter((r) => r.createdAt >= from && r.createdAt < to && r.status !== 'DELETED')
  /** подтверждённые рейсы периода — выполнены привлечённым транспортом перевозчиков */
  const periodDone = inPeriod.filter((r) => (r.status === 'CONFIRMED' || r.status === 'CLOSED') && r.winnerId != null)

  /* ——— Проформа № 1: экономия по заявкам ——— */

  const rows: Proforma1Row[] = periodDone
    .map((r) => {
      const best = r.bestRate ?? r.startRate
      const rateSaving = Math.max(0, r.startRate - best)
      return {
        number: r.number,
        direction: `${r.fromPoint} → ${r.toPoint}`,
        cargo: `${r.cargo}, ${new Intl.NumberFormat('ru-RU').format(r.tonnage)} т`,
        tonnage: r.tonnage,
        startRate: r.startRate,
        bestRate: r.bestRate,
        savings: rateSaving * r.tonnage,
        pct: r.startRate > 0 ? (rateSaving / r.startRate) * 100 : 0,
        carrier: r.winner?.name ?? '—',
      }
    })
    // в отчёте экономии показываем только заявки, реально давшие экономию
    .filter((r) => r.savings > 0)
    .sort((a, b) => b.savings - a.savings)

  const savedTotal = rows.reduce((s, r) => s + r.savings, 0)
  const startTotal = periodDone.reduce((s, r) => s + r.startRate * r.tonnage, 0)
  const finalTotal = periodDone.reduce((s, r) => s + (r.bestRate ?? r.startRate) * r.tonnage, 0)
  const avgSaving = rows.length ? savedTotal / rows.length : 0
  const avgSavingPct = startTotal > 0 ? Math.max(0, ((startTotal - finalTotal) / startTotal) * 100) : 0

  // проекция: для идущего месяца — факт, растянутый на полный месяц по среднему
  // дневному темпу; для завершённого месяца и произвольного периода — факт
  const monthComplete = periodKind !== 'current-month'
  let projectionMonth = savedTotal
  let projectionLabel = periodKind === 'done-month' ? 'Факт за месяц' : 'Факт за период'
  if (!monthComplete) {
    const dim = daysInMonth(period.first.y, period.first.m)
    const dayNow = mskDay(now).d
    projectionMonth = Math.round((savedTotal / dayNow) * dim)
    projectionLabel = 'Проекция на месяц'
  }

  const byDirection = withShares(
    Object.entries(
      rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.direction] = (acc[r.direction] ?? 0) + r.savings
        return acc
      }, {}),
    )
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
  )

  const proforma1: ReportSummary['proforma1'] = {
    periodLabel,
    confirmedCount: periodDone.length,
    savingsCount: rows.length,
    startTotal,
    finalTotal,
    savedTotal,
    avgSaving,
    avgSavingPct,
    projectionMonth,
    projectionLabel,
    monthComplete,
    byDirection: topPlusOther(byDirection, 6),
    byRequest: topPlusOther(
      withShares(rows.map((r) => ({ label: `Заявка №${r.number}`, value: r.savings }))),
      7,
    ),
    rows,
  }

  /* ——— Проформа № 2: обороты и привлечённый транспорт ——— */

  const turnover = periodDone.reduce((s, r) => s + (r.bestRate ?? r.startRate) * r.tonnage, 0)
  const avgRate = periodDone.length ? periodDone.reduce((s, r) => s + (r.bestRate ?? r.startRate), 0) / periodDone.length : 0
  const tonnageTotal = inPeriod.reduce((s, r) => s + r.tonnage, 0)
  const bidsInPeriod = inPeriod.filter((r) => r.bids.length > 0)
  const avgBidsPeriod = bidsInPeriod.length ? bidsInPeriod.reduce((s, r) => s + r.bids.length, 0) / bidsInPeriod.length : 0
  const etrnCount = periodDone.filter((r) => r.etrnStatus !== 'NONE').length

  const carrierTurnover = new Map<string, { trips: number; turnover: number; rateSum: number }>()
  for (const r of periodDone) {
    const name = r.winner?.name ?? '—'
    const cur = carrierTurnover.get(name) ?? { trips: 0, turnover: 0, rateSum: 0 }
    cur.trips++
    cur.turnover += (r.bestRate ?? r.startRate) * r.tonnage
    cur.rateSum += r.bestRate ?? r.startRate
    carrierTurnover.set(name, cur)
  }
  const byCarrier = [...carrierTurnover.entries()]
    .map(([name, v]) => ({
      name,
      trips: v.trips,
      turnover: Math.round(v.turnover),
      avgRate: v.trips ? Math.round(v.rateSum / v.trips) : 0,
      share: turnover > 0 ? Math.round((v.turnover / turnover) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.turnover - a.turnover)

  const statusOrder = ['PUBLISHED', 'AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED', 'DRAFT'] as const
  const byStatus = withShares(
    statusOrder
      .map((st) => ({
        label: REQUEST_STATUS_META[st].short,
        value: inPeriod.filter((r) => r.status === st).length,
      }))
      .filter((x) => x.value > 0),
  )

  const proforma2: ReportSummary['proforma2'] = {
    periodLabel,
    requestsCount: inPeriod.length,
    confirmedCount: periodDone.length,
    turnover,
    avgRate,
    tonnageTotal,
    avgBids: Math.round(avgBidsPeriod * 10) / 10,
    etrnCount,
    byCarrier,
    byStatus,
  }

  return {
    kpi: {
      openRequests: active.filter((r) => r.status === 'PUBLISHED').length,
      atVerify: requests.filter((r) => r.status === 'DOCS_REVIEW').length,
      atLogist: requests.filter((r) => r.status === 'AT_LOGIST').length,
      confirmed: confirmedCount,
      savingsMonth,
      avgBids: Math.round(avgBidsAll * 10) / 10,
      docsAutoShare: Math.round(docsAutoShare * 100),
      etrnShare: Math.round(etrnShare * 100),
    },
    byDirection: [...dirMap.entries()]
      .map(([direction, v]) => ({ direction, count: v.count, avgRate: Math.round(v.sum / v.count), minRate: v.min }))
      .sort((a, b) => b.count - a.count),
    savingsByRequest: confirmedOrClosed
      .map((r) => ({ number: r.number, cargo: `${r.cargo}, ${r.tonnage} т`, startRate: r.startRate, bestRate: r.bestRate, savings: r.bestRate != null && r.bestRate < r.startRate ? r.startRate - r.bestRate : 0 }))
      .sort((a, b) => b.savings - a.savings),
    carriers: [...carMap.entries()]
      .map(([name, v]) => ({ name, taken: v.taken, avgRate: v.n ? Math.round(v.sum / v.n) : 0, refused: 0 }))
      .sort((a, b) => b.taken - a.taken),
    period: { from: isoDay(period.first), to: isoDay(period.last) },
    periodLabel,
    periodKind,
    proforma1,
    proforma2,
    generatedAt: now.toISOString(),
  }
}

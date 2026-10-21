import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import type { ReportSummary } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/reports — сводка: KPI, ставки по направлениям, экономия, история перевозчиков */
export async function GET() {
  // раздел в доработке (п. 23) — логика расчёта не менялась, добавлена только проверка входа
  const auth = await requireUser('logist')
  if (auth instanceof NextResponse) return auth

  const requests = await db.request.findMany({
    include: { bids: true, documents: true, winner: true },
    orderBy: { createdAt: 'desc' },
  })

  const active = requests.filter((r) => !['CLOSED'].includes(r.status))
  const confirmedOrClosed = requests.filter((r) => ['CONFIRMED', 'CLOSED'].includes(r.status))

  const savingsMonth = confirmedOrClosed.reduce((s, r) => s + (r.bestRate != null && r.bestRate < r.startRate ? r.startRate - r.bestRate : 0), 0)

  const withBids = requests.filter((r) => r.bids.length > 0)
  const avgBids = withBids.length ? withBids.reduce((s, r) => s + r.bids.length, 0) / withBids.length : 0

  const finalDocs = requests.flatMap((r) => r.documents).filter((d) => d.status !== 'PENDING')
  const docsAutoShare = finalDocs.length ? finalDocs.filter((d) => d.status === 'PASSED').length / finalDocs.length : 0
  const confirmedCount = confirmedOrClosed.length
  const etrnShare = confirmedCount ? confirmedOrClosed.filter((r) => r.etrnStatus !== 'NONE').length / confirmedCount : 0

  // ставки по направлениям
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

  // перевозчики
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

  const summary: ReportSummary = {
    kpi: {
      openRequests: active.filter((r) => r.status === 'PUBLISHED').length,
      atVerify: requests.filter((r) => r.status === 'DOCS_REVIEW').length,
      atLogist: requests.filter((r) => r.status === 'AT_LOGIST').length,
      confirmed: confirmedCount,
      savingsMonth,
      avgBids: Math.round(avgBids * 10) / 10,
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
  }

  return NextResponse.json(summary)
}

import { NextResponse } from 'next/server'
import { generateHistory, generateMarketPage, type MarketQuery } from '@/lib/kontur/atisu/market-stubs'

export const dynamic = 'force-dynamic'

// Витрина «Биржа ATI.SU» (демо-режим): GET /api/atisu/market?from=Москва&to=Краснодар...
// Реальные запросы к api.ati.su НЕ отправляются — данные генерирует market-stubs.ts.
// Форма ответа повторяет будущий реальный поток (free + платные API), чтобы после
// покупки подписок переключить источник без изменения UI.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  // Важно: searchParams.get() для отсутствующего параметра возвращает null,
  // а Number(null) === 0 — поэтому проверяем именно строку, иначе дефолты
  // (например take=9) превращаются в 0 и выдача биржи становится пустой.
  const num = (k: string, d: number) => {
    const v = searchParams.get(k)
    if (v == null || v === '') return d
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }

  const q: MarketQuery = {
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    weight: num('weight', 21),
    volume: num('volume', 83),
    dateFromToday: searchParams.get('dateFromToday') !== '0',
    bodies: (searchParams.get('bodies') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    payments: (searchParams.get('payments') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    minRate: searchParams.get('minRate') ? num('minRate', 0) : null,
    minRatePerKm: searchParams.get('minRatePerKm') === '1',
    hideRegulars: searchParams.get('hideRegulars') === '1',
    hideAtd: searchParams.get('hideAtd') === '1',
    showContests: searchParams.get('showContests') !== '0',
    showAds: searchParams.get('showAds') !== '0',
    sort: (['updated', 'rate_desc', 'rate_asc', 'km_asc'].includes(searchParams.get('sort') ?? '') ? searchParams.get('sort') : 'updated') as MarketQuery['sort'],
    take: Math.min(num('take', 9), 24),
    fixed: searchParams.get('fixed') !== '0',
    basePerKm: Math.min(Math.max(num('basePerKm', 42), 25), 70),
    guaranteedShare: Math.min(Math.max(num('guaranteedShare', 0.35), 0), 1),
    page: Math.max(num('page', 0), 0),
  }

  const page = generateMarketPage(q)
  return NextResponse.json({
    demo: true,
    mode: 'stub · витрина-заглушка, реальные запросы не отправляются',
    filters: q,
    total: page.total,
    loads: page.loads,
    history: generateHistory(),
  })
}

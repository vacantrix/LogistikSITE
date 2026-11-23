import { NextResponse } from 'next/server'
import { AtiError } from '@/lib/kontur/atisu/client'
import { enrichLoadsWithCities, searchLoadsByBoards } from '@/lib/kontur/atisu/free'

export const dynamic = 'force-dynamic'

// Грузы закрытых площадок ATI.SU (реальный вызов): GET /api/atisu/loads?take=50&boardIds=a,b
// Общая биржа в этот поиск не входит — ограничение ATI.SU.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const take = Math.min(Number(searchParams.get('take') || 30) || 30, 100)
  const skip = Math.max(Number(searchParams.get('skip') || 0) || 0, 0)
  const boardIdsRaw = searchParams.get('boardIds') ?? ''
  const boardIds = boardIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)

  try {
    const page = await searchLoadsByBoards({ take, skip, boardIds: boardIds.length ? boardIds : undefined })
    const loads = await enrichLoadsWithCities(page.cargos ?? [])
    const boards = [...new Set(loads.flatMap((l) => (l.boards ?? []).map((b) => b.id)))]
    return NextResponse.json({
      total: page.total ?? loads.length,
      boards,
      loads: loads.map((l) => ({
        cargo_id: l.cargo_id,
        cargo_number: l.cargo_number,
        added_at: l.added_at,
        ati_id: l.ati_id ?? null,
        from: l.loadingCity ?? `city_id ${l.route?.loading?.city_id}`,
        to: l.unloadingCity ?? `city_id ${l.route?.unloading?.city_id}`,
        cargo: l.route?.loading?.cargos?.map((c) => c.name).filter(Boolean).join(', ') || null,
        weight_t: l.route?.loading?.cargos?.reduce((m, c) => Math.max(m, c.weight?.type === 'kilos' ? (c.weight.quantity ?? 0) / 1000 : (c.weight?.quantity ?? 0)), 0) || null,
        volume_m3: l.route?.loading?.cargos?.reduce((m, c) => Math.max(m, c.volume?.quantity ?? 0), 0) || null,
        first_date: l.route?.loading?.dates?.first_date ?? null,
        last_date: l.route?.loading?.dates?.last_date ?? null,
        payment_type: l.payment?.type ?? null,
        rate: l.payment?.rate ?? l.payment?.rate_with_vat ?? l.payment?.rates_with_vat?.[0]?.rate_with_vat ?? null,
        distance_km: l.distance ?? null,
        offer_count: l.offer_count ?? null,
        note: l.note ?? null,
      })),
    })
  } catch (e) {
    const message = e instanceof AtiError ? `${e.status}: ${e.message}` : 'Сервис ATI.SU недоступен'
    return NextResponse.json({ error: { code: 'ATISU', message } }, { status: 502 })
  }
}

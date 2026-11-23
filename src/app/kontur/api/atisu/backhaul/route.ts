import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { AtiError } from '@/lib/kontur/atisu/client'
import { buildTruckPublishDraft, enrichLoadsWithCities, searchLoadsByBoards } from '@/lib/kontur/atisu/free'
import { stubAverageRates, stubDistance, stubNearestCities } from '@/lib/kontur/atisu/paid-stubs'

export const dynamic = 'force-dynamic'

/** Город из строки точки: «Абинск (АЭМЗ)» → «Абинск», «Краснодар, ул. X» → «Краснодар» */
function cityOf(point: string): string {
  return point.split(',')[0].replace(/\s*\(.*\)\s*$/, '').trim()
}

function cityMatches(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x.includes(y) || y.includes(x)
}

// Подбор обратки для рейса (демо-сценарий обратных рейсов, ATI.SU):
//   реальные: грузы закрытых площадок по направлению + гео-словарь;
//   заглушки: средние ставки, расстояние, ближайшие города (платные API);
//   dry-run:  тело публикации машины на биржу (отправка выключена).
// GET /api/atisu/backhaul?tripId=...
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const tripId = searchParams.get('tripId') ?? ''
  if (!tripId) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'tripId обязателен' } }, { status: 400 })
  }

  const trip = await db.trip.findUnique({ where: { id: tripId } })
  if (!trip) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Рейс не найден' } }, { status: 404 })
  }
  const legs = await db.leg.findMany({ where: { tripId }, orderBy: { seq: 'asc' } })
  const [vehicle, trailer, driver] = await Promise.all([
    db.vehicle.findUnique({ where: { id: trip.vehicleId } }),
    trip.trailerId ? db.trailer.findUnique({ where: { id: trip.trailerId } }) : null,
    db.driver.findUnique({ where: { id: trip.driverId } }),
  ])

  // Направление обратки: обратное плечо рейса, иначе «город выгрузки → база»
  const returnLeg = legs.find((l) => l.type === 'return' || l.type === 'empty_return')
  const mainLegs = legs.filter((l) => l.type === 'main')
  const from = returnLeg ? cityOf(returnLeg.loadPoint) : mainLegs.length ? cityOf(mainLegs[mainLegs.length - 1].unloadPoint) : ''
  const to = returnLeg ? cityOf(returnLeg.unloadPoint) : mainLegs.length ? cityOf(mainLegs[0].loadPoint) : ''

  // --- Реальная часть: грузы на закрытых площадках ATI.SU ---
  let real: {
    ok: boolean
    error?: string
    total: number
    boards: string[]
    matches: unknown[]
    latest: unknown[]
    citiesResolved: Record<string, number | undefined>
  } = { ok: false, total: 0, boards: [], matches: [], latest: [], citiesResolved: {} }

  try {
    const page = await searchLoadsByBoards({ take: 100 })
    const enriched = await enrichLoadsWithCities(page.cargos ?? [])
    const nameToId = new Map<string, number>()
    for (const l of enriched) {
      if (l.loadingCity && l.route?.loading?.city_id) nameToId.set(l.loadingCity, l.route.loading.city_id)
      if (l.unloadingCity && l.route?.unloading?.city_id) nameToId.set(l.unloadingCity, l.route.unloading.city_id)
    }
    const rows = enriched.map((l) => ({
      cargo_number: l.cargo_number,
      from: l.loadingCity ?? `city_id ${l.route?.loading?.city_id}`,
      to: l.unloadingCity ?? `city_id ${l.route?.unloading?.city_id}`,
      cargo: l.route?.loading?.cargos?.map((c) => c.name).filter(Boolean).join(', ') || null,
      weight_t: l.route?.loading?.cargos?.reduce((m, c) => Math.max(m, c.weight?.type === 'kilos' ? (c.weight.quantity ?? 0) / 1000 : (c.weight?.quantity ?? 0)), 0) || null,
      first_date: l.route?.loading?.dates?.first_date ?? null,
      rate: l.payment?.rate ?? l.payment?.rate_with_vat ?? l.payment?.rates_with_vat?.[0]?.rate_with_vat ?? null,
      distance_km: l.distance ?? null,
    }))
    const matches = rows.filter((r) => cityMatches(String(r.from), from) && cityMatches(String(r.to), to))
    const partialFrom = rows.filter((r) => cityMatches(String(r.from), from) && !matches.includes(r))
    real = {
      ok: true,
      total: page.total ?? rows.length,
      boards: [...new Set(enriched.flatMap((l) => (l.boards ?? []).map((b) => b.id)))],
      matches,
      latest: (matches.length ? matches.concat(partialFrom) : rows).slice(0, 8),
      citiesResolved: {
        [from]: nameToId.get(from),
        [to]: nameToId.get(to),
      },
    }
  } catch (e) {
    real = { ...real, ok: false, error: e instanceof AtiError ? `${e.status}: ${e.message}` : 'Сервис ATI.SU недоступен' }
  }

  // --- Заглушки платных сервисов (запросы не отправляются) ---
  const ratesStub = stubAverageRates({ from: from || '—', to: to || '—' })
  const distanceStub = stubDistance({ from: from || '—', to: to || '—' })
  const nearestStub = stubNearestCities({ city: from || '—', radiusKm: 150 })

  // --- Dry-run: заготовка публикации машины (отправка выключена) ---
  const draft = buildTruckPublishDraft({
    vehicleBrand: vehicle?.brand ?? 'ТС',
    plate: vehicle?.plate ?? '',
    capacityT: vehicle?.capacityT ?? null,
    volumeM3: vehicle?.volumeM3 ?? null,
    trailerVolumeM3: trailer?.volumeM3 ?? null,
    fromCityName: from || '—',
    toCityName: to || '—',
    fromCityId: real.citiesResolved[from],
    toCityId: real.citiesResolved[to],
    firstDate: returnLeg?.loadDatePlan ?? undefined,
    lastDate: returnLeg?.unloadDatePlan ?? undefined,
    rateSum: returnLeg?.rate ?? null,
    contactNote: `Водитель: ${driver?.fullName ?? '—'}. Машина ${vehicle?.brand ?? ''} (${vehicle?.plate ?? ''})${trailer ? `, прицеп ${trailer.plate}` : ''}. Обратная загрузка ${from} → ${to}.`,
  })

  return NextResponse.json({
    trip: {
      id: trip.id,
      status: trip.status,
      waitingReturn: trip.waitingReturn,
      driver: driver?.fullName ?? null,
      vehicle: vehicle ? `${vehicle.brand} (${vehicle.plate})` : null,
      trailer: trailer?.plate ?? null,
    },
    direction: { from, to },
    real,
    stubs: { rates: ratesStub, distance: distanceStub, nearestCities: nearestStub },
    truckDraft: draft,
  })
}

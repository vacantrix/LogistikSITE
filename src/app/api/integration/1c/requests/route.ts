import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ONEC_ETRN_RU, ONEC_STATUS_RU, onecAuthorized, onecMeta, onecUnauthorized } from '@/lib/onec'
import { finalizeExpired } from '@/lib/requests'
import type { RequestStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STATUSES = Object.keys(ONEC_STATUS_RU) as RequestStatus[]

/**
 * GET /api/integration/1c/requests?status=&since=&limit= — заявки/рейсы со статусами.
 * Реестр рейсов для 1С:ERP: маршрут, груз, ставки, перевозчик-победитель, экипаж, ЭТрН.
 */
export async function GET(req: NextRequest) {
  if (!onecAuthorized(req)) return onecUnauthorized()
  await finalizeExpired() // статусы торгов, у которых истёк срок, — уже с победителем

  const sp = req.nextUrl.searchParams

  const statusRaw = sp.get('status')
  if (statusRaw && !STATUSES.includes(statusRaw as RequestStatus)) {
    return NextResponse.json(
      { ok: false, error: `Некорректный status: ${statusRaw}. Допустимо: ${STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const sinceRaw = sp.get('since')
  let since: Date | null = null
  if (sinceRaw) {
    since = new Date(sinceRaw)
    if (Number.isNaN(since.getTime())) {
      return NextResponse.json({ ok: false, error: `Некорректный since: ${sinceRaw}` }, { status: 400 })
    }
  }

  const limitRaw = sp.get('limit')
  let limit = 100
  if (limitRaw) {
    limit = Number(limitRaw)
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      return NextResponse.json({ ok: false, error: 'limit должен быть числом 1…500' }, { status: 400 })
    }
  }

  const requests = await db.request.findMany({
    where: {
      ...(statusRaw ? { status: statusRaw } : {}),
      ...(since ? { updatedAt: { gt: since } } : {}),
    },
    include: { winner: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })

  // у Request связи экипажа хранятся как ID (driverId/truckId/trailerId) —
  // резолвим карточки вручную через справочники
  const [drivers, trucks, trailers] = await Promise.all([
    db.driver.findMany(),
    db.truck.findMany(),
    db.trailer.findMany(),
  ])
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const truckById = new Map(trucks.map((t) => [t.id, t]))
  const trailerById = new Map(trailers.map((t) => [t.id, t]))

  return NextResponse.json({
    ok: true,
    meta: onecMeta(requests.length, { since: since?.toISOString() ?? null, limit }),
    data: requests.map((r) => ({
      id: r.id,
      number: r.number,
      route: { from: r.fromPoint, to: r.toPoint },
      cargo: r.cargo,
      tonnage: r.tonnage,
      truckType: r.truckType,
      mode: r.mode,
      rates: { start: r.startRate, best: r.bestRate },
      status: r.status,
      statusRu: ONEC_STATUS_RU[r.status as RequestStatus] ?? r.status,
      loadDate: r.loadDate,
      loadWindow: r.loadWindow,
      winner: r.winner ? { id: r.winner.id, name: r.winner.name, inn: r.winner.inn } : null,
      crew: (() => {
        const d = r.driverId ? driverById.get(r.driverId) : undefined
        if (!d) return null
        const t = r.truckId ? truckById.get(r.truckId) : undefined
        const tr = r.trailerId ? trailerById.get(r.trailerId) : undefined
        return {
          driver: {
            fullName: d.fullName,
            phone: d.phone,
          },
          truck: t
            ? { brand: t.brand, plate: t.plate, vin: t.vin, sts: t.sts }
            : null,
          trailer: tr
            ? { type: tr.type, plate: tr.plate, sts: tr.sts }
            : null,
        }
      })(),
      passPackage: r.passPackage,
      etrn: { status: r.etrnStatus, statusRu: ONEC_ETRN_RU[r.etrnStatus] ?? r.etrnStatus },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  })
}

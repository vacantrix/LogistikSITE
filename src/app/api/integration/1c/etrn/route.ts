import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ONEC_ETRN_RU, ONEC_STATUS_RU, onecAuthorized, onecBadRequest, onecMeta, onecUnauthorized } from '@/lib/onec'
import { plog } from '@/lib/platform-log'
import type { RequestStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const ETRN_VALUES = ['NONE', 'SENT', 'SIGNED']

/**
 * GET  /api/integration/1c/etrn?number=&since= — данные ЭТрН для 1С:ERP
 *      (заявки с назначенным экипажем; number — конкретная накладная).
 * POST /api/integration/1c/etrn — подтверждение ЭТрН из 1С: { number, etrnStatus }.
 */
export async function GET(req: NextRequest) {
  if (!onecAuthorized(req)) return onecUnauthorized()

  const sp = req.nextUrl.searchParams
  const number = sp.get('number')?.trim() || null

  const sinceRaw = sp.get('since')
  let since: Date | null = null
  if (sinceRaw) {
    since = new Date(sinceRaw)
    if (Number.isNaN(since.getTime())) {
      return NextResponse.json({ ok: false, error: `Некорректный since: ${sinceRaw}` }, { status: 400 })
    }
  }

  const requests = await db.request.findMany({
    where: {
      // ЭТрН существует только у рейсов с закреплённым экипажем
      driverId: { not: null },
      ...(number ? { number } : {}),
      ...(since ? { updatedAt: { gt: since } } : {}),
    },
    include: { winner: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })

  // связи экипажа — по ID, резолвим через справочники
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
    meta: onecMeta(requests.length, { number, since: since?.toISOString() ?? null }),
    data: requests.map((r) => ({
      id: r.id,
      number: r.number,
      etrnStatus: r.etrnStatus,
      etrnStatusRu: ONEC_ETRN_RU[r.etrnStatus] ?? r.etrnStatus,
      tripStatus: r.status,
      tripStatusRu: ONEC_STATUS_RU[r.status as RequestStatus] ?? r.status,
      route: { from: r.fromPoint, to: r.toPoint },
      cargo: r.cargo,
      tonnage: r.tonnage,
      loadDate: r.loadDate,
      loadWindow: r.loadWindow,
      carrier: r.winner ? { name: r.winner.name, inn: r.winner.inn } : null,
      driver: (() => {
        const d = r.driverId ? driverById.get(r.driverId) : undefined
        return d ? { fullName: d.fullName, license: d.license, phone: d.phone } : null
      })(),
      vehicle: (() => {
        const t = r.truckId ? truckById.get(r.truckId) : undefined
        return t ? { brand: t.brand, plate: t.plate, vin: t.vin } : null
      })(),
      trailer: (() => {
        const tr = r.trailerId ? trailerById.get(r.trailerId) : undefined
        return tr ? { type: tr.type, plate: tr.plate } : null
      })(),
      updatedAt: r.updatedAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  if (!onecAuthorized(req)) return onecUnauthorized()

  const body = (await req.json().catch(() => null)) as { number?: string; etrnStatus?: string } | null
  const number = body?.number?.trim()
  const etrnStatus = body?.etrnStatus?.trim()?.toUpperCase()

  if (!number) return onecBadRequest('Укажите number (номер заявки/рейса)')
  if (!etrnStatus || !ETRN_VALUES.includes(etrnStatus)) {
    return onecBadRequest(`etrnStatus должен быть одним из: ${ETRN_VALUES.join(', ')}`)
  }

  const request = await db.request.findUnique({ where: { number } })
  if (!request) {
    return NextResponse.json({ ok: false, error: `Заявка «${number}» не найдена` }, { status: 404 })
  }

  const updated = await db.request.update({ where: { id: request.id }, data: { etrnStatus } })
  await db.event.create({
    data: {
      requestId: request.id,
      type: 'ETRN_1C',
      message: `ЭТрН из 1С:ERP — «${ONEC_ETRN_RU[etrnStatus] ?? etrnStatus}»`,
    },
  })
  // журнал событий платформы (Task 76): смена статуса ЭТрН из 1С
  const carrierName = request.winnerId
    ? (await db.carrier.findUnique({ where: { id: request.winnerId }, select: { name: true } }))?.name ?? null
    : null
  await plog({
    type: 'ETRN_1C', source: '1c/etrn', requestId: request.id, requestNumber: request.number, carrierName,
    message: `Статус ЭТрН обновлён из 1С:ERP — «${ONEC_ETRN_RU[etrnStatus] ?? etrnStatus}» (№${request.number})`,
  })

  return NextResponse.json({
    ok: true,
    data: {
      id: updated.id,
      number: updated.number,
      etrnStatus: updated.etrnStatus,
      etrnStatusRu: ONEC_ETRN_RU[updated.etrnStatus] ?? updated.etrnStatus,
      updatedAt: updated.updatedAt,
    },
  })
}

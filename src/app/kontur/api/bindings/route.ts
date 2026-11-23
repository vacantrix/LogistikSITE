import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { getSessionUser, shortName } from '@/lib/kontur/auth'
import { denyUnless } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// Закрепление состава: водитель ↔ тягач ↔ прицеп (сохраняется в БД).
// Водители АЭМЗ почти всегда работают на «своих» машине и прицепе, поэтому
// подбор и планирование предлагают закреплённый состав в первую очередь.
//
//   GET  /api/bindings                      → список закреплений (с именами)
//   POST /api/bindings { action:'pin', driverId, vehicleId, trailerId? }
//                                          → закрепить/перекрепить (upsert)
//   POST /api/bindings { action:'unpin', driverId } → открепить

async function listBindings() {
  const [rows, drivers, vehicles, trailers] = await Promise.all([
    db.vehicleBinding.findMany({ orderBy: { updatedAt: 'desc' } }),
    db.driver.findMany(),
    db.vehicle.findMany(),
    db.trailer.findMany(),
  ])
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const trailerById = new Map(trailers.map((t) => [t.id, t]))
  return rows.map((b) => {
    const v = vehicleById.get(b.vehicleId)
    const t = b.trailerId ? trailerById.get(b.trailerId) : null
    const d = driverById.get(b.driverId)
    return {
      id: b.id,
      driverId: b.driverId,
      vehicleId: b.vehicleId,
      trailerId: b.trailerId,
      pinnedAt: b.pinnedAt,
      updatedAt: b.updatedAt,
      driver: d ? { id: d.id, fullName: d.fullName, phone: d.phone } : null,
      vehicle: v ? { id: v.id, brand: v.brand, plate: v.plate } : null,
      trailer: t ? { id: t.id, brand: t.brand, plate: t.plate, type: t.type } : null,
    }
  })
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  return NextResponse.json({ bindings: await listBindings() })
}

export async function POST(req: Request) {
  const body = await req.json()
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  const denied = await denyUnless(user, 'own:assign')
  if (denied) return denied

  if (body.action === 'pin') {
    const { driverId, vehicleId, trailerId } = body as { driverId?: string; vehicleId?: string; trailerId?: string | null }
    if (!driverId || !vehicleId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите водителя и тягач' } }, { status: 400 })
    }
    const [driver, vehicle] = await Promise.all([
      db.driver.findUnique({ where: { id: driverId } }),
      db.vehicle.findUnique({ where: { id: vehicleId } }),
    ])
    if (!driver || !vehicle) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Водитель или тягач не найден' } }, { status: 404 })
    }
    const trailer = trailerId ? await db.trailer.findUnique({ where: { id: trailerId } }) : null
    if (trailerId && !trailer) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Прицеп не найден' } }, { status: 404 })
    }

    const binding = await db.vehicleBinding.upsert({
      where: { driverId },
      create: { driverId, vehicleId, trailerId: trailerId ?? null },
      update: { vehicleId, trailerId: trailerId ?? null },
    })
    await db.auditLog.create({
      data: {
        actorRole: 'logist',
        actorName: shortName(user.fullName),
        object: 'vehicle_binding',
        objectId: binding.id,
        field: 'pinned',
        became: `${driver.fullName}: ${vehicle.brand} (${vehicle.plate})${trailer ? ` + прицеп ${trailer.plate}` : ' (без прицепа)'}`,
        comment: 'Закрепление состава за водителем',
      },
    })
    return NextResponse.json({
      ok: true,
      binding,
      message: `${driver.fullName} закреплён за ${vehicle.brand} (${vehicle.plate})${trailer ? ` и прицепом ${trailer.plate}` : ''}`,
    })
  }

  if (body.action === 'unpin') {
    const { driverId } = body as { driverId?: string }
    if (!driverId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите водителя' } }, { status: 400 })
    }
    const existing = await db.vehicleBinding.findUnique({ where: { driverId } })
    if (!existing) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Закрепление не найдено' } }, { status: 404 })
    }
    const driver = await db.driver.findUnique({ where: { id: driverId } })
    await db.vehicleBinding.delete({ where: { driverId } })
    await db.auditLog.create({
      data: {
        actorRole: 'logist',
        actorName: shortName(user.fullName),
        object: 'vehicle_binding',
        objectId: existing.id,
        field: 'unpinned',
        comment: `Открепление состава${driver ? `: ${driver.fullName}` : ''}`,
      },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестное действие' } }, { status: 400 })
}

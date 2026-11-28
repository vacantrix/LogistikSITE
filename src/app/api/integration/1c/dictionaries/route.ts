import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { onecAuthorized, onecMeta, onecUnauthorized } from '@/lib/onec'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integration/1c/dictionaries?since=ISO — справочники для 1С:ERP.
 * Возвращает перевозчиков (с доступом), водителей, тягачи и прицепы.
 * Параметр since отдаёт записи, созданные или изменённые после момента (инкрементальная выгрузка):
 * раньше фильтр шёл по createdAt, и изменения (новый паспорт, продлённый техосмотр) в 1С не попадали.
 * Перевозчик, которому закрыли доступ, тоже попадает в выгрузку изменений — с access: false.
 */
export async function GET(req: NextRequest) {
  if (!onecAuthorized(req)) return onecUnauthorized()

  const sinceRaw = req.nextUrl.searchParams.get('since')
  let since: Date | null = null
  if (sinceRaw) {
    since = new Date(sinceRaw)
    if (Number.isNaN(since.getTime())) {
      return NextResponse.json({ ok: false, error: `Некорректный since: ${sinceRaw}` }, { status: 400 })
    }
  }

  const changedFilter = since ? { updatedAt: { gt: since } } : {}
  // собственный парк АЭМЗ (ownFleet) — не контрагент площадки: в выгрузку
  // справочников для 1С не попадает ни сам перевозчик, ни его водители/техника
  const ownFilter = { carrier: { ownFleet: false } }

  const [carriers, drivers, trucks, trailers] = await Promise.all([
    db.carrier.findMany({ where: since ? { ...changedFilter, ownFleet: false } : { access: true, ownFleet: false }, orderBy: { updatedAt: 'asc' } }),
    db.driver.findMany({ where: { ...changedFilter, ...ownFilter }, orderBy: { updatedAt: 'asc' } }),
    db.truck.findMany({ where: { ...changedFilter, ...ownFilter }, orderBy: { updatedAt: 'asc' } }),
    db.trailer.findMany({ where: { ...changedFilter, ...ownFilter }, orderBy: { updatedAt: 'asc' } }),
  ])
  // в инкрементальной выгрузке у водителя/ТС может не быть «своего» перевозчика среди изменённых — дочитываем
  const missing = [...new Set([...drivers, ...trucks, ...trailers].map((x) => x.carrierId))].filter((id) => !carriers.some((c) => c.id === id))
  const refCarriers = missing.length ? await db.carrier.findMany({ where: { id: { in: missing }, ownFleet: false } }) : []

  const carrierById = new Map([...carriers, ...refCarriers].map((c) => [c.id, c]))
  const carrierRef = (id: string) => {
    const c = carrierById.get(id)
    return c ? { id: c.id, name: c.name, inn: c.inn } : { id, name: '—', inn: '—' }
  }

  return NextResponse.json({
    ok: true,
    meta: onecMeta(drivers.length + trucks.length + trailers.length + carriers.length, {
      since: since?.toISOString() ?? null,
      increment: Boolean(since),
    }),
    data: {
      carriers: carriers.map((c) => ({
        id: c.id,
        name: c.name,
        inn: c.inn,
        contractNo: c.contractNo,
        contractDate: c.contractDate,
        access: c.access,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      drivers: drivers.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        birthDate: d.birthDate,
        birthPlace: d.birthPlace,
        address: d.address,
        citizenship: d.citizenship,
        passport: d.passport,
        passportIssuedBy: d.passportIssuedBy,
        passportIssuedDate: d.passportIssuedDate,
        phone: d.phone,
        position: d.position,
        carrier: carrierRef(d.carrierId),
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      trucks: trucks.map((t) => ({
        id: t.id,
        brand: t.brand,
        plate: t.plate,
        vin: t.vin,
        sts: t.sts,
        color: t.color,
        owner: t.owner,
        techTill: t.techTill,
        carrier: carrierRef(t.carrierId),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      trailers: trailers.map((t) => ({
        id: t.id,
        type: t.type,
        plate: t.plate,
        sts: t.sts,
        color: t.color,
        owner: t.owner,
        techTill: t.techTill,
        carrier: carrierRef(t.carrierId),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    },
  })
}

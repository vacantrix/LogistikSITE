import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { onecAuthorized, onecMeta, onecUnauthorized } from '@/lib/onec'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integration/1c/dictionaries?since=ISO — справочники для 1С:ERP.
 * Возвращает перевозчиков (с доступом), водителей, тягачи и прицепы.
 * Параметр since отдаёт только записи, созданные после момента (инкрементальная выгрузка).
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

  const createdFilter = since ? { createdAt: { gt: since } } : {}

  const [carriers, drivers, trucks, trailers] = await Promise.all([
    db.carrier.findMany({ where: { access: true, ...createdFilter }, orderBy: { createdAt: 'asc' } }),
    db.driver.findMany({ where: createdFilter, orderBy: { createdAt: 'asc' } }),
    db.truck.findMany({ where: createdFilter, orderBy: { createdAt: 'asc' } }),
    db.trailer.findMany({ where: createdFilter, orderBy: { createdAt: 'asc' } }),
  ])

  const carrierById = new Map(carriers.map((c) => [c.id, c]))
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
      })),
      drivers: drivers.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        birthDate: d.birthDate,
        birthPlace: d.birthPlace,
        citizenship: d.citizenship,
        passport: d.passport,
        passportIssuedBy: d.passportIssuedBy,
        passportIssuedDate: d.passportIssuedDate,
        phone: d.phone,
        position: d.position,
        license: d.license,
        licenseTill: d.licenseTill,
        categories: d.categories,
        carrier: carrierRef(d.carrierId),
        createdAt: d.createdAt,
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
      })),
    },
  })
}

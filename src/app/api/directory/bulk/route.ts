import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const norm = (s: string) => s.replace(/\s/g, '').toUpperCase()

/**
 * POST /api/directory/bulk — массовое пополнение базы аккаунта (импорт из Excel).
 * Тело: { carrierId?, drivers?: [...], trucks?: [...], trailers?: [...] }
 * Перевозчик пополняет только свою базу (carrierId берётся из сессии), логист указывает carrierId.
 * Идемпотентно: водитель сопоставляется по номеру ВУ, ТС и прицеп — по госномеру
 * (повторный импорт обновляет существующие карточки, дублей не создаёт).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const { drivers, trucks, trailers } = (body ?? {}) as {
    drivers?: Record<string, string>[]
    trucks?: Record<string, string>[]
    trailers?: Record<string, string>[]
  }
  const carrierId = auth.role === 'carrier' ? auth.carrierId! : (typeof body?.carrierId === 'string' ? body.carrierId : '')
  if (!carrierId) return NextResponse.json({ error: 'Нужен carrierId' }, { status: 400 })

  const carrier = await db.carrier.findUnique({ where: { id: carrierId } })
  if (!carrier) return NextResponse.json({ error: 'Перевозчик не найден' }, { status: 404 })

  const cap = (arr: unknown) => (Array.isArray(arr) ? arr.slice(0, 300) : [])
  const driverRows = cap(drivers)
  const truckRows = cap(trucks)
  const trailerRows = cap(trailers)

  try {
    const [existingDrivers, existingTrucks, existingTrailers] = await Promise.all([
      db.driver.findMany({ where: { carrierId } }),
      db.truck.findMany({ where: { carrierId } }),
      db.trailer.findMany({ where: { carrierId } }),
    ])

    let driversCreated = 0
    let driversUpdated = 0
    for (const d of driverRows) {
      if (!d.fullName) continue
      const license = d.license && d.license !== '—' ? d.license : ''
      const existing = license ? existingDrivers.find((x) => norm(x.license) === norm(license)) : undefined
      const payload = {
        fullName: d.fullName,
        birthDate: d.birthDate || '—',
        birthPlace: d.birthPlace || '—',
        address: d.address || '—',
        citizenship: d.citizenship || 'РФ',
        passport: d.passport || '—',
        passportIssuedBy: d.passportIssuedBy || '—',
        passportIssuedDate: d.passportIssuedDate || '—',
        phone: d.phone || '—',
        position: d.position || 'Водитель',
        license: d.license || '—',
        licenseTill: d.licenseTill || '—',
        categories: d.categories || '—',
      }
      if (existing) {
        await db.driver.update({ where: { id: existing.id }, data: payload })
        driversUpdated += 1
      } else {
        await db.driver.create({ data: { carrierId, ...payload } })
        driversCreated += 1
      }
    }

    let trucksCreated = 0
    let trucksUpdated = 0
    for (const t of truckRows) {
      if (!t.plate) continue
      const existing = existingTrucks.find((x) => norm(x.plate) === norm(t.plate))
      const payload = {
        brand: t.brand || '—', plate: t.plate, vin: t.vin || '—', sts: t.sts || '—',
        color: t.color || '—', techTill: t.techTill || '—', owner: t.owner || '—',
      }
      if (existing) {
        await db.truck.update({ where: { id: existing.id }, data: payload })
        trucksUpdated += 1
      } else {
        await db.truck.create({ data: { carrierId, ...payload } })
        trucksCreated += 1
      }
    }

    let trailersCreated = 0
    let trailersUpdated = 0
    for (const z of trailerRows) {
      if (!z.plate) continue
      const existing = existingTrailers.find((x) => norm(x.plate) === norm(z.plate))
      const payload = {
        plate: z.plate, sts: z.sts || '—', type: z.type || '—',
        color: z.color || '—', owner: z.owner || '—', techTill: z.techTill || '—',
      }
      if (existing) {
        await db.trailer.update({ where: { id: existing.id }, data: payload })
        trailersUpdated += 1
      } else {
        await db.trailer.create({ data: { carrierId, ...payload } })
        trailersCreated += 1
      }
    }

    return NextResponse.json({
      ok: true,
      drivers: { created: driversCreated, updated: driversUpdated },
      trucks: { created: trucksCreated, updated: trucksUpdated },
      trailers: { created: trailersCreated, updated: trailersUpdated },
    })
  } catch (e) {
    console.error('directory bulk error', e)
    return NextResponse.json({ error: 'Не удалось выполнить массовый импорт' }, { status: 500 })
  }
}

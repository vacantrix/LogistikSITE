import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toCarrierDTO } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

/** GET /api/directory — справочник: перевозчики с водителями, тягачами и прицепами */
export async function GET() {
  const carriers = await db.carrier.findMany({
    include: {
      drivers: { orderBy: { fullName: 'asc' } },
      trucks: { orderBy: { plate: 'asc' } },
      trailers: { orderBy: { plate: 'asc' } },
      _count: { select: { wonRequests: true, bids: true } },
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ carriers: carriers.map(toCarrierDTO) })
}

/** POST /api/directory — создать запись справочника { kind, data } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { kind, data } = (body ?? {}) as { kind?: string; data?: Record<string, string> }
  if (!kind || !data) return NextResponse.json({ error: 'Нужны kind и data' }, { status: 400 })

  try {
    switch (kind) {
      case 'carrier': {
        if (!data.name || !data.inn) return NextResponse.json({ error: 'Название и ИНН обязательны' }, { status: 400 })
        await db.carrier.create({
          data: {
            name: data.name, inn: data.inn,
            contractNo: data.contractNo || '—', contractDate: data.contractDate || '—',
            access: data.access !== 'false',
          },
        })
        break
      }
      case 'driver': {
        if (!data.carrierId || !data.fullName) return NextResponse.json({ error: 'Перевозчик и ФИО обязательны' }, { status: 400 })
        await db.driver.create({
          data: {
            carrierId: data.carrierId, fullName: data.fullName,
            birthDate: data.birthDate || '—', passport: data.passport || '—',
            license: data.license || '—', licenseTill: data.licenseTill || '—',
            categories: data.categories || '—',
          },
        })
        break
      }
      case 'truck': {
        if (!data.carrierId || !data.plate) return NextResponse.json({ error: 'Перевозчик и госномер обязательны' }, { status: 400 })
        await db.truck.create({
          data: {
            carrierId: data.carrierId, brand: data.brand || '—', plate: data.plate,
            vin: data.vin || '—', sts: data.sts || '—', owner: data.owner || '—',
          },
        })
        break
      }
      case 'trailer': {
        if (!data.carrierId || !data.plate) return NextResponse.json({ error: 'Перевозчик и госномер обязательны' }, { status: 400 })
        await db.trailer.create({ data: { carrierId: data.carrierId, plate: data.plate, sts: data.sts || '—', type: data.type || '—' } })
        break
      }
      default:
        return NextResponse.json({ error: 'Неизвестный kind' }, { status: 400 })
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    console.error('directory create error', e)
    return NextResponse.json({ error: 'Не удалось создать запись' }, { status: 500 })
  }
}

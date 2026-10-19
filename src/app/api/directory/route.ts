import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toCarrierDTO, toDriverDTO, toTrailerDTO, toTruckDTO } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

const norm = (s: string) => s.replace(/\s/g, '').toUpperCase()

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

/**
 * POST /api/directory — создать запись справочника { kind, data }.
 * Для водителя и тягача работает идемпотентно: повторное добавление с тем же
 * ВУ/госномером обновляет существующую запись и возвращает её — это нужно
 * мастеру «Добавить водителя с нейросетью».
 */
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
        const license = data.license && data.license !== '—' ? data.license : ''
        const existing = license
          ? (await db.driver.findMany({ where: { carrierId: data.carrierId } })).find((d) => norm(d.license) === norm(license))
          : null
        const payload = {
          fullName: data.fullName,
          birthDate: data.birthDate || '—', passport: data.passport || '—',
          license: data.license || '—', licenseTill: data.licenseTill || '—',
          medTill: data.medTill || '—', categories: data.categories || '—',
        }
        const driver = existing
          ? await db.driver.update({ where: { id: existing.id }, data: payload })
          : await db.driver.create({ data: { carrierId: data.carrierId, ...payload } })
        return NextResponse.json({ ok: true, driver: toDriverDTO(driver) }, { status: existing ? 200 : 201 })
      }
      case 'truck': {
        if (!data.carrierId || !data.plate) return NextResponse.json({ error: 'Перевозчик и госномер обязательны' }, { status: 400 })
        const existing = (await db.truck.findMany({ where: { carrierId: data.carrierId } })).find((t) => norm(t.plate) === norm(data.plate))
        const payload = { brand: data.brand || '—', plate: data.plate, vin: data.vin || '—', sts: data.sts || '—', techTill: data.techTill || '—', owner: data.owner || '—' }
        const truck = existing
          ? await db.truck.update({ where: { id: existing.id }, data: payload })
          : await db.truck.create({ data: { carrierId: data.carrierId, ...payload } })
        return NextResponse.json({ ok: true, truck: toTruckDTO(truck) }, { status: existing ? 200 : 201 })
      }
      case 'trailer': {
        if (!data.carrierId || !data.plate) return NextResponse.json({ error: 'Перевозчик и госномер обязательны' }, { status: 400 })
        await db.trailer.create({ data: { carrierId: data.carrierId, plate: data.plate, sts: data.sts || '—', type: data.type || '—', techTill: data.techTill || '—' } })
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

/**
 * PUT /api/directory — обновить запись базы аккаунта { kind, id, data }.
 * Агент поддерживает актуальность сроков документов (ВУ, медсправка, техосмотр)
 * и остальных полей карточки.
 */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { kind, id, data } = (body ?? {}) as { kind?: string; id?: string; data?: Record<string, string> }
  if (!kind || !id || !data) return NextResponse.json({ error: 'Нужны kind, id и data' }, { status: 400 })

  try {
    switch (kind) {
      case 'driver': {
        const driver = await db.driver.update({
          where: { id },
          data: {
            fullName: data.fullName, birthDate: data.birthDate || '—', passport: data.passport || '—',
            license: data.license || '—', licenseTill: data.licenseTill || '—',
            medTill: data.medTill || '—', categories: data.categories || '—',
          },
        })
        return NextResponse.json({ ok: true, driver: toDriverDTO(driver) })
      }
      case 'truck': {
        const truck = await db.truck.update({
          where: { id },
          data: {
            brand: data.brand || '—', plate: data.plate, vin: data.vin || '—', sts: data.sts || '—',
            techTill: data.techTill || '—', owner: data.owner || '—',
          },
        })
        return NextResponse.json({ ok: true, truck: toTruckDTO(truck) })
      }
      case 'trailer': {
        const trailer = await db.trailer.update({
          where: { id },
          data: {
            plate: data.plate, sts: data.sts || '—', type: data.type || '—',
            techTill: data.techTill || '—',
          },
        })
        return NextResponse.json({ ok: true, trailer: toTrailerDTO(trailer) })
      }
      case 'carrier': {
        const carrier = await db.carrier.update({
          where: { id },
          data: {
            name: data.name, inn: data.inn, contractNo: data.contractNo || '—',
            contractDate: data.contractDate || '—',
            ...(data.access !== undefined ? { access: data.access !== 'false' } : {}),
          },
        })
        return NextResponse.json({ ok: true, carrier: { id: carrier.id, name: carrier.name } })
      }
      default:
        return NextResponse.json({ error: 'Неизвестный kind' }, { status: 400 })
    }
  } catch (e) {
    console.error('directory update error', e)
    return NextResponse.json({ error: 'Не удалось обновить запись — проверьте данные' }, { status: 500 })
  }
}

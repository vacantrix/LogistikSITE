// CRUD справочников: /api/office/catalog/vehicles | trailers | drivers | contractors | locations
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { logEvent } from '@/lib/1c/journal'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Entity = 'vehicles' | 'trailers' | 'drivers' | 'contractors' | 'locations'

function isEntity(e: string): e is Entity {
  return ['vehicles', 'trailers', 'drivers', 'contractors', 'locations'].includes(e)
}

export async function GET(_req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params
  if (!isEntity(entity)) return jsonOffice({ ok: false, error: `Неизвестный справочник: ${entity}` }, 404)
  let rows: unknown
  switch (entity) {
    case 'vehicles': rows = await db.vehicle.findMany({ orderBy: { createdAt: 'asc' } }); break
    case 'trailers': rows = await db.trailer.findMany({ orderBy: { createdAt: 'asc' } }); break
    case 'drivers': rows = await db.driver.findMany({ orderBy: { createdAt: 'asc' } }); break
    case 'contractors': rows = await db.contractor.findMany({ orderBy: { createdAt: 'asc' } }); break
    case 'locations': rows = await db.location.findMany({ orderBy: { name: 'asc' } }); break
  }
  return jsonOffice({ rows })
}

export async function POST(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params
  if (!isEntity(entity)) return jsonOffice({ ok: false, error: `Неизвестный справочник: ${entity}` }, 404)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }

  try {
    let id = ''
    switch (entity) {
      case 'vehicles': {
        if (!body.plate || !body.model) return jsonOffice({ ok: false, error: 'Нужны plate и model' }, 400)
        const row = await db.vehicle.create({
          data: {
            plate: String(body.plate),
            model: String(body.model),
            kind: String(body.kind ?? 'tractor'),
            bodyType: String(body.bodyType ?? 'tarp'),
            capacityT: Number(body.capacityT ?? 20),
            volumeM3: body.volumeM3 !== undefined && body.volumeM3 !== null && body.volumeM3 !== '' ? Number(body.volumeM3) : null,
            readiness: String(body.readiness ?? 'ready'),
          },
        })
        id = row.id
        break
      }
      case 'trailers': {
        if (!body.plate || !body.model) return jsonOffice({ ok: false, error: 'Нужны plate и model' }, 400)
        const row = await db.trailer.create({ data: { plate: String(body.plate), model: String(body.model), type: String(body.type ?? 'tarp') } })
        id = row.id
        break
      }
      case 'drivers': {
        if (!body.fullName) return jsonOffice({ ok: false, error: 'Нужно fullName' }, 400)
        const row = await db.driver.create({
          data: {
            fullName: String(body.fullName),
            phone: body.phone ? String(body.phone) : null,
            licenseNo: body.licenseNo ? String(body.licenseNo) : null,
            appId: body.appId ? String(body.appId) : null,
          },
        })
        id = row.id
        break
      }
      case 'contractors': {
        if (!body.name) return jsonOffice({ ok: false, error: 'Нужно name' }, 400)
        const row = await db.contractor.create({ data: { name: String(body.name), inn: body.inn ? String(body.inn) : null, kind: String(body.kind ?? 'customer') } })
        id = row.id
        break
      }
      case 'locations': {
        if (!body.name || !body.address) return jsonOffice({ ok: false, error: 'Нужны name и address' }, 400)
        const row = await db.location.create({
          data: {
            name: String(body.name),
            address: String(body.address),
            lat: Number(body.lat ?? 0),
            lon: Number(body.lon ?? 0),
            geofenceRadiusM: Number(body.geofenceRadiusM ?? 300),
          },
        })
        id = row.id
        break
      }
    }
    await logEvent(db, { user: 'Админ', action: 'CATALOG_CREATE', entity, entityId: id })
    return jsonOffice({ ok: true })
  } catch (e) {
    const msg = e instanceof Prisma.PrismaClientKnownRequestError ? 'Запись с таким ключом уже существует' : e instanceof Error ? e.message : 'Ошибка создания записи'
    return jsonOffice({ ok: false, error: msg }, 400)
  }
}

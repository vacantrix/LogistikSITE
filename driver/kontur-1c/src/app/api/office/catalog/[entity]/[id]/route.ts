// Правка и мягкое удаление (пометка удаления, как в 1С) записей справочников
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { logEvent } from '@/lib/1c/journal'

export const dynamic = 'force-dynamic'

type Entity = 'vehicles' | 'trailers' | 'drivers' | 'contractors' | 'locations'

function isEntity(e: string): e is Entity {
  return ['vehicles', 'trailers', 'drivers', 'contractors', 'locations'].includes(e)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const { entity, id } = await params
  if (!isEntity(entity)) return jsonOffice({ ok: false, error: 'Неизвестный справочник' }, 404)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  try {
    switch (entity) {
      case 'vehicles':
        await db.vehicle.update({
          where: { id },
          data: {
            ...(body.model !== undefined ? { model: String(body.model) } : {}),
            ...(body.kind !== undefined ? { kind: String(body.kind) } : {}),
            ...(body.bodyType !== undefined ? { bodyType: String(body.bodyType) } : {}),
            ...(body.capacityT !== undefined && body.capacityT !== '' ? { capacityT: Number(body.capacityT) } : {}),
            ...(body.volumeM3 !== undefined ? { volumeM3: body.volumeM3 === '' || body.volumeM3 === null ? null : Number(body.volumeM3) } : {}),
            ...(body.readiness !== undefined ? { readiness: String(body.readiness) } : {}),
            ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          },
        })
        break
      case 'trailers':
        await db.trailer.update({
          where: { id },
          data: {
            ...(body.model !== undefined ? { model: String(body.model) } : {}),
            ...(body.type !== undefined ? { type: String(body.type) } : {}),
            ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          },
        })
        break
      case 'drivers':
        await db.driver.update({
          where: { id },
          data: {
            ...(body.fullName !== undefined ? { fullName: String(body.fullName) } : {}),
            ...(body.phone !== undefined ? { phone: String(body.phone) } : {}),
            ...(body.licenseNo !== undefined ? { licenseNo: String(body.licenseNo) } : {}),
            ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          },
        })
        break
      case 'contractors':
        await db.contractor.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: String(body.name) } : {}),
            ...(body.inn !== undefined ? { inn: String(body.inn) } : {}),
            ...(body.kind !== undefined ? { kind: String(body.kind) } : {}),
            ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          },
        })
        break
      case 'locations':
        await db.location.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: String(body.name) } : {}),
            ...(body.address !== undefined ? { address: String(body.address) } : {}),
            ...(body.lat !== undefined && body.lat !== '' ? { lat: Number(body.lat) } : {}),
            ...(body.lon !== undefined && body.lon !== '' ? { lon: Number(body.lon) } : {}),
            ...(body.geofenceRadiusM !== undefined && body.geofenceRadiusM !== '' ? { geofenceRadiusM: Number(body.geofenceRadiusM) } : {}),
          },
        })
        break
    }
    await logEvent(db, { user: 'Админ', action: 'CATALOG_UPDATE', entity, entityId: id })
    return jsonOffice({ ok: true })
  } catch (e) {
    return jsonOffice({ ok: false, error: e instanceof Error ? e.message : 'Ошибка правки' }, 400)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const { entity, id } = await params
  if (!isEntity(entity)) return jsonOffice({ ok: false, error: 'Неизвестный справочник' }, 404)
  try {
    switch (entity) {
      case 'vehicles': await db.vehicle.update({ where: { id }, data: { isActive: false } }); break
      case 'trailers': await db.trailer.update({ where: { id }, data: { isActive: false } }); break
      case 'drivers': await db.driver.update({ where: { id }, data: { isActive: false } }); break
      case 'contractors': await db.contractor.update({ where: { id }, data: { isActive: false } }); break
      case 'locations': await db.location.update({ where: { id }, data: { geofenceRadiusM: 0 } }); break
    }
    await logEvent(db, { user: 'Админ', action: 'CATALOG_DELETE', entity, entityId: id, level: 'warning' })
    return jsonOffice({ ok: true })
  } catch (e) {
    return jsonOffice({ ok: false, error: e instanceof Error ? e.message : 'Ошибка удаления' }, 400)
  }
}

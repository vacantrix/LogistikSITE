import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireUser, type SessionUser } from '@/lib/auth'
import { toCargoTypeDTO, toCarrierDTO, toDriverDTO, toTrailerDTO, toTruckDTO } from '@/lib/serialize'
import { notifyLive } from '@/lib/notify'
import { imageDataUriError } from '@/lib/settings'

export const dynamic = 'force-dynamic'

const norm = (s: string) => s.replace(/\s/g, '').toUpperCase()
/** Строковое поле из тела запроса: обрезка и ограничение длины */
const s = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
/** принадлежность записи (Task 62): OWNED | HIRED | LEASE */
const ownershipType = (v: unknown): string => (v === 'HIRED' || v === 'LEASE' || v === 'OWNED' ? v : 'OWNED')
const forbidden = () => NextResponse.json({ error: 'Недостаточно прав для этого действия' }, { status: 403 })

/**
 * Чей перевозчик: у перевозчика — всегда свой (из сессии), логист указывает carrierId явно.
 * Раньше carrierId брался из тела запроса — любой мог добавить водителя чужому перевозчику.
 */
async function targetCarrier(user: SessionUser, requested: unknown): Promise<string | NextResponse> {
  if (user.role === 'carrier') return user.carrierId!
  const id = s(requested, 64)
  if (!id) return NextResponse.json({ error: 'Укажите перевозчика' }, { status: 400 })
  const carrier = await db.carrier.findUnique({ where: { id }, select: { id: true } })
  return carrier ? carrier.id : NextResponse.json({ error: 'Перевозчик не найден' }, { status: 404 })
}

/** Запись справочника принадлежит пользователю (логисту — любая) */
async function ownsRecord(user: SessionUser, kind: string, id: string): Promise<boolean | null> {
  const rec = kind === 'driver'
    ? await db.driver.findUnique({ where: { id }, select: { carrierId: true } })
    : kind === 'truck'
      ? await db.truck.findUnique({ where: { id }, select: { carrierId: true } })
      : await db.trailer.findUnique({ where: { id }, select: { carrierId: true } })
  if (!rec) return null
  return user.role === 'logist' || rec.carrierId === user.carrierId
}

/**
 * GET /api/directory — справочник: перевозчики с водителями/тягачами/прицепами + справочник грузов.
 * Логист видит всех перевозчиков, перевозчик — только себя (паспорта чужих водителей не отдаются).
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const carriers = await db.carrier.findMany({
    where: auth.role === 'logist' ? {} : { id: auth.carrierId! },
    include: {
      drivers: { orderBy: { fullName: 'asc' } },
      trucks: { orderBy: { plate: 'asc' } },
      trailers: { orderBy: { plate: 'asc' } },
      _count: { select: { wonRequests: true, bids: true } },
    },
    orderBy: { name: 'asc' },
  })
  const cargoTypes = await db.cargoType.findMany({
    include: { _count: { select: { requests: true } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ carriers: carriers.map(toCarrierDTO), cargoTypes: cargoTypes.map(toCargoTypeDTO) })
}

/**
 * POST /api/directory — создать запись справочника { kind, data }.
 * Грузы и перевозчиков создаёт логист; водителей, тягачи и прицепы — перевозчик (себе) или логист.
 * Для водителя и тягача работает идемпотентно: повторное добавление с тем же
 * ВУ/госномером обновляет существующую запись и возвращает её.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const { kind, data } = (body ?? {}) as { kind?: string; data?: Record<string, unknown> }
  if (!kind || !data || typeof data !== 'object') return NextResponse.json({ error: 'Нужны kind и data' }, { status: 400 })
  if ((kind === 'cargo' || kind === 'carrier') && auth.role !== 'logist') return forbidden()

  /** фото/документы записи справочника (Task 54): только изображения, не больше 8 штук */
  const rawPhotos = Array.isArray(body?.photos) ? (body.photos as unknown[]).slice(0, 8) : []
  const photos: { label: string; fileName: string; dataUri: string }[] = []
  for (const p of rawPhotos) {
    if (!p || typeof p !== 'object') continue
    const uri = (p as { dataUri?: unknown }).dataUri
    const err = imageDataUriError(uri)
    if (err) return NextResponse.json({ error: `Фото: ${err}` }, { status: 400 })
    photos.push({
      label: s((p as { label?: unknown }).label, 120) || 'Фото документа',
      fileName: s((p as { fileName?: unknown }).fileName, 200) || 'photo.png',
      dataUri: uri as string,
    })
  }

  /** записать фото под видом kind для созданной/обновлённой записи (идемпотентно — замена комплекта) */
  const savePhotos = async (refId: string) => {
    if (photos.length === 0) return
    await db.$transaction([
      db.directoryPhoto.deleteMany({ where: { kind, refId } }),
      db.directoryPhoto.createMany({ data: photos.map((p) => ({ kind, refId, ...p })) }),
    ])
  }

  try {
    switch (kind) {
      case 'cargo': {
        // справочник грузов: имя обязательно и уникально — именно оно попадает в заявки
        const name = s(data.name, 200)
        if (!name) return NextResponse.json({ error: 'Название груза обязательно' }, { status: 400 })
        const dup = (await db.cargoType.findMany()).find((c) => norm(c.name) === norm(name))
        if (dup) return NextResponse.json({ error: `Груз «${dup.name}» уже есть в справочнике` }, { status: 409 })
        const cargoType = await db.cargoType.create({
          data: {
            name,
            category: s(data.category, 100) || 'Прочее',
            truckType: s(data.truckType, 40) || 'Тент',
            dangerous: data.dangerous === 'true' || data.dangerous === true,
          },
        })
        return NextResponse.json({ ok: true, cargoType: toCargoTypeDTO(cargoType) }, { status: 201 })
      }
      case 'carrier': {
        const name = s(data.name, 200)
        const inn = s(data.inn, 20)
        if (!name || !inn) return NextResponse.json({ error: 'Название и ИНН обязательны' }, { status: 400 })
        await db.carrier.create({
          data: {
            name, inn,
            // роль исполнителя: перевозчик (заказ-заявка) или экспедитор (поручение экспедитору)
            role: data.role === 'FORWARDER' ? 'FORWARDER' : 'CARRIER',
            contractNo: s(data.contractNo, 100) || '—', contractDate: s(data.contractDate, 20) || '—',
            access: data.access !== 'false' && data.access !== false,
          },
        })
        return NextResponse.json({ ok: true }, { status: 201 })
      }
      case 'driver': {
        const carrierId = await targetCarrier(auth, data.carrierId)
        if (carrierId instanceof NextResponse) return carrierId
        const fullName = s(data.fullName, 200)
        if (!fullName) return NextResponse.json({ error: 'ФИО обязательно' }, { status: 400 })
        const license = s(data.license, 40)
        const existing = license && license !== '—'
          ? (await db.driver.findMany({ where: { carrierId } })).find((d) => norm(d.license) === norm(license))
          : null
        const payload = {
          fullName,
          birthDate: s(data.birthDate, 20) || '—', passport: s(data.passport, 40) || '—',
          license: license || '—', licenseTill: s(data.licenseTill, 20) || '—',
          categories: s(data.categories, 60) || '—',
          // кадровые поля проформы (Task 29)
          phone: s(data.phone, 40) || '—', birthPlace: s(data.birthPlace) || '—', address: s(data.address) || '—',
          citizenship: s(data.citizenship, 60) || '—', position: s(data.position, 100) || '—',
          passportIssuedBy: s(data.passportIssuedBy) || '—', passportIssuedDate: s(data.passportIssuedDate, 20) || '—',
          // принадлежность (Task 62)
          ownershipType: ownershipType(data.ownershipType),
          ownerName: s(data.ownerName, 200) || '—', leaseContract: s(data.leaseContract, 200) || '—',
        }
        const driver = existing
          ? await db.driver.update({ where: { id: existing.id }, data: payload })
          : await db.driver.create({ data: { carrierId, ...payload } })
        await savePhotos(driver.id)
        notifyLive({ type: 'DIRECTORY_UPDATED' })
        return NextResponse.json({ ok: true, driver: toDriverDTO(driver) }, { status: existing ? 200 : 201 })
      }
      case 'truck': {
        const carrierId = await targetCarrier(auth, data.carrierId)
        if (carrierId instanceof NextResponse) return carrierId
        const plate = s(data.plate, 20)
        if (!plate) return NextResponse.json({ error: 'Госномер обязателен' }, { status: 400 })
        const existing = (await db.truck.findMany({ where: { carrierId } })).find((t) => norm(t.plate) === norm(plate))
        const payload = {
          brand: s(data.brand, 100) || '—', plate, vin: s(data.vin, 30) || '—', sts: s(data.sts, 40) || '—',
          techTill: s(data.techTill, 20) || '—', owner: s(data.owner, 200) || '—', color: s(data.color, 60) || '—',
          ownershipType: ownershipType(data.ownershipType), leaseContract: s(data.leaseContract, 200) || '—',
        }
        const truck = existing
          ? await db.truck.update({ where: { id: existing.id }, data: payload })
          : await db.truck.create({ data: { carrierId, ...payload } })
        await savePhotos(truck.id)
        notifyLive({ type: 'DIRECTORY_UPDATED' })
        return NextResponse.json({ ok: true, truck: toTruckDTO(truck) }, { status: existing ? 200 : 201 })
      }
      case 'trailer': {
        const carrierId = await targetCarrier(auth, data.carrierId)
        if (carrierId instanceof NextResponse) return carrierId
        const plate = s(data.plate, 20)
        if (!plate) return NextResponse.json({ error: 'Госномер обязателен' }, { status: 400 })
        // идемпотентно по госномеру + DTO в ответе (Task 29)
        const existingTrailer = (await db.trailer.findMany({ where: { carrierId } })).find((tr) => norm(tr.plate) === norm(plate))
        const trailerPayload = {
          type: s(data.type, 100) || '—', plate, sts: s(data.sts, 40) || '—',
          techTill: s(data.techTill, 20) || '—', color: s(data.color, 60) || '—', owner: s(data.owner, 200) || '—',
          ownershipType: ownershipType(data.ownershipType), leaseContract: s(data.leaseContract, 200) || '—',
        }
        const trailer = existingTrailer
          ? await db.trailer.update({ where: { id: existingTrailer.id }, data: trailerPayload })
          : await db.trailer.create({ data: { carrierId, ...trailerPayload } })
        await savePhotos(trailer.id)
        notifyLive({ type: 'DIRECTORY_UPDATED' })
        return NextResponse.json({ ok: true, trailer: toTrailerDTO(trailer) }, { status: existingTrailer ? 200 : 201 })
      }
      default:
        return NextResponse.json({ error: 'Неизвестный kind' }, { status: 400 })
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'Такая запись уже есть в справочнике' }, { status: 409 })
    }
    console.error('directory create error', e)
    return NextResponse.json({ error: 'Не удалось создать запись' }, { status: 500 })
  }
}

/**
 * PUT /api/directory — обновить запись { kind, id, data }.
 * Перевозчик обновляет только свои записи (сроки ВУ и техосмотра, поля карточки);
 * грузы, данные перевозчика и его доступ к площадке меняет только логист.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const { kind, id, data } = (body ?? {}) as { kind?: string; id?: string; data?: Record<string, unknown> }
  if (!kind || typeof id !== 'string' || !id || !data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Нужны kind, id и data' }, { status: 400 })
  }
  if ((kind === 'cargo' || kind === 'carrier') && auth.role !== 'logist') return forbidden()
  if (kind === 'driver' || kind === 'truck' || kind === 'trailer') {
    const own = await ownsRecord(auth, kind, id)
    if (own === null) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 })
    if (!own) return forbidden()
  }

  try {
    switch (kind) {
      case 'cargo': {
        const name = s(data.name, 200)
        if (!name) return NextResponse.json({ error: 'Название груза обязательно' }, { status: 400 })
        const dup = (await db.cargoType.findMany()).find((c) => c.id !== id && norm(c.name) === norm(name))
        if (dup) return NextResponse.json({ error: `Груз «${dup.name}» уже есть в справочнике` }, { status: 409 })
        const cargoType = await db.$transaction(async (tx) => {
          const updated = await tx.cargoType.update({
            where: { id },
            data: {
              name,
              category: s(data.category, 100) || 'Прочее',
              truckType: s(data.truckType, 40) || 'Тент',
              dangerous: data.dangerous === 'true' || data.dangerous === true,
            },
          })
          // имя груза изменилось — обновляем денормализованную копию в заявках, чтобы всё везде было одинаково
          await tx.request.updateMany({ where: { cargoTypeId: id, NOT: { cargo: name } }, data: { cargo: name } })
          return updated
        })
        return NextResponse.json({ ok: true, cargoType: toCargoTypeDTO(cargoType) })
      }
      case 'driver': {
        const fullName = s(data.fullName, 200)
        if (!fullName) return NextResponse.json({ error: 'ФИО обязательно' }, { status: 400 })
        const driver = await db.driver.update({
          where: { id },
          data: {
            fullName, birthDate: s(data.birthDate, 20) || '—', passport: s(data.passport, 40) || '—',
            license: s(data.license, 40) || '—', licenseTill: s(data.licenseTill, 20) || '—',
            categories: s(data.categories, 60) || '—',
            ownershipType: ownershipType(data.ownershipType),
            ownerName: s(data.ownerName, 200) || '—', leaseContract: s(data.leaseContract, 200) || '—',
          },
        })
        notifyLive({ type: 'DIRECTORY_UPDATED' })
        return NextResponse.json({ ok: true, driver: toDriverDTO(driver) })
      }
      case 'truck': {
        const plate = s(data.plate, 20)
        if (!plate) return NextResponse.json({ error: 'Госномер обязателен' }, { status: 400 })
        const truck = await db.truck.update({
          where: { id },
          data: {
            brand: s(data.brand, 100) || '—', plate, vin: s(data.vin, 30) || '—', sts: s(data.sts, 40) || '—',
            techTill: s(data.techTill, 20) || '—', owner: s(data.owner, 200) || '—',
            ownershipType: ownershipType(data.ownershipType), leaseContract: s(data.leaseContract, 200) || '—',
          },
        })
        notifyLive({ type: 'DIRECTORY_UPDATED' })
        return NextResponse.json({ ok: true, truck: toTruckDTO(truck) })
      }
      case 'trailer': {
        const plate = s(data.plate, 20)
        if (!plate) return NextResponse.json({ error: 'Госномер обязателен' }, { status: 400 })
        const trailer = await db.trailer.update({
          where: { id },
          data: {
            plate, sts: s(data.sts, 40) || '—', type: s(data.type, 100) || '—',
            techTill: s(data.techTill, 20) || '—', owner: s(data.owner, 200) || '—',
            ownershipType: ownershipType(data.ownershipType), leaseContract: s(data.leaseContract, 200) || '—',
          },
        })
        notifyLive({ type: 'DIRECTORY_UPDATED' })
        return NextResponse.json({ ok: true, trailer: toTrailerDTO(trailer) })
      }
      case 'carrier': {
        const name = s(data.name, 200)
        const inn = s(data.inn, 20)
        if (!name || !inn) return NextResponse.json({ error: 'Название и ИНН обязательны' }, { status: 400 })
        const carrier = await db.carrier.update({
          where: { id },
          data: {
            name, inn, contractNo: s(data.contractNo, 100) || '—',
            contractDate: s(data.contractDate, 20) || '—',
            ...(data.role === 'FORWARDER' || data.role === 'CARRIER' ? { role: data.role } : {}),
            ...(data.access !== undefined ? { access: data.access !== 'false' && data.access !== false } : {}),
          },
        })
        notifyLive({ type: 'DIRECTORY_UPDATED' })
        return NextResponse.json({ ok: true, carrier: { id: carrier.id, name: carrier.name } })
      }
      default:
        return NextResponse.json({ error: 'Неизвестный kind' }, { status: 400 })
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 })
    }
    console.error('directory update error', e)
    return NextResponse.json({ error: 'Не удалось обновить запись — проверьте данные' }, { status: 500 })
  }
}

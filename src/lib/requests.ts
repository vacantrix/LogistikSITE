/**
 * Серверная логика заявок, общая для маршрутов API:
 *  — какие заявки видит пользователь;
 *  — автоматическое подведение итогов торгов по сроку (п. 9: побеждает минимальная ставка);
 *  — проверка экипажа: принадлежность, сроки ВУ и техосмотра, занятость (п. 13–15).
 */
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { notifyLive } from '@/lib/notify'
import type { Viewer } from '@/lib/auth'
import { BUSY_STATUSES, busyReason } from '@/lib/busy'
import { REQUEST_INCLUDE, type RequestFull } from '@/lib/serialize'
import type { RequestDTO } from '@/lib/types'

export const money = (v: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽/т`

type Tx = Prisma.TransactionClient

/**
 * Какие заявки видит пользователь. Логист — все.
 * Перевозчик — открытые на площадке, свои выигранные и те, где он делал ставку.
 */
export function requestWhereFor(viewer: Viewer): Prisma.RequestWhereInput {
  if (viewer.role === 'logist') return {}
  const me = viewer.carrierId ?? '__none__'
  return {
    OR: [
      { status: 'PUBLISHED' },
      { winnerId: me },
      { bids: { some: { carrierId: me } } },
    ],
  }
}

/** Заявка целиком, если пользователь имеет право её видеть */
export async function loadRequestFor(id: string, viewer: Viewer): Promise<RequestFull | null> {
  return db.request.findFirst({ where: { AND: [{ id }, requestWhereFor(viewer)] }, include: REQUEST_INCLUDE })
}

/** Ошибка конкурентной записи SQLite/Prisma: транзакцию можно повторить */
function isWriteConflict(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P1008')) return true
  const msg = e instanceof Error ? e.message : ''
  return /database is locked|SQLITE_BUSY|write conflict|deadlock/i.test(msg)
}

/** Транзакция с повтором при одновременной записи (ставки двух перевозчиков в одну секунду) */
export async function inTx<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await db.$transaction(fn, { timeout: 15_000 })
    } catch (e) {
      if (i >= attempts || !isWriteConflict(e)) throw e
      await new Promise((r) => setTimeout(r, 50 * i))
    }
  }
}

/** Минимальная активная ставка (или null) — источник истины для bestRate */
export async function minActiveBid(tx: Tx, requestId: string): Promise<number | null> {
  const agg = await tx.bid.aggregate({ where: { requestId, withdrawn: false }, _min: { amount: true } })
  return agg._min.amount ?? null
}

/**
 * Подведение итогов по сроку (п. 9): если приём ставок закончился, заявка
 * автоматически уходит перевозчику с минимальной активной ставкой
 * (при равных суммах — тому, кто поставил раньше). Логист ничего не утверждает.
 * Без ставок заявка остаётся на площадке: логист продлевает срок или поднимает ставку.
 *
 * Вызывается «лениво» — перед чтением и действиями с заявками, поэтому отдельный
 * планировщик не нужен. Повторный вызов безопасен: смена статуса идёт через
 * условие status = PUBLISHED.
 */
export async function finalizeExpired(now = new Date()): Promise<void> {
  const due = await db.request.findMany({
    where: { status: 'PUBLISHED', deadline: { lte: now }, bids: { some: { withdrawn: false } } },
    select: { id: true },
  })
  for (const { id } of due) {
    try {
      const awarded = await inTx(async (tx) => {
        const best = await tx.bid.findFirst({
          where: { requestId: id, withdrawn: false, carrier: { access: true } },
          orderBy: [{ amount: 'asc' }, { createdAt: 'asc' }],
          include: { carrier: { select: { name: true } } },
        })
        if (!best) return false
        const moved = await tx.request.updateMany({
          where: { id, status: 'PUBLISHED', deadline: { lte: now } },
          data: { status: 'AWARDED', winnerId: best.carrierId, bestRate: best.amount },
        })
        if (moved.count === 0) return false // уже подвёл итоги другой запрос
        await tx.bid.updateMany({ where: { requestId: id }, data: { isWinner: false } })
        await tx.bid.update({ where: { id: best.id }, data: { isWinner: true } })
        await tx.event.create({
          data: {
            requestId: id, carrierId: best.carrierId, type: 'WINNER_AWARDED',
            message: `Приём ставок завершён — ваша ставка минимальная: ${best.carrier.name}, ${money(best.amount)}`,
          },
        })
        await tx.event.create({
          data: { requestId: id, type: 'AUCTION_FINISHED', message: 'Приём ставок завершён, победитель определён по минимальной ставке' },
        })
        return true
      })
      if (awarded) notifyLive({ type: 'WINNER_AWARDED', requestId: id })
    } catch (e) {
      console.error('finalizeExpired error', id, e)
    }
  }
}

// ———————————————— экипаж ————————————————

/** ДД.ММ.ГГГГ → Date (начало дня) или null */
export function parseRuDate(s: string | null | undefined): Date | null {
  const m = (s ?? '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Дата, на которую экипаж должен быть «в сроке»: день погрузки, а если он не указан — сегодня */
function checkDate(loadDate: string): Date {
  const load = parseRuDate(loadDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return load && load > today ? load : today
}

/** Документ действует на дату (срок «до ДД.ММ.ГГГГ» включает весь этот день) */
function validOn(till: string, on: Date): 'ok' | 'expired' | 'unknown' {
  const d = parseRuDate(till)
  if (!d) return 'unknown'
  return d >= on ? 'ok' : 'expired'
}

export interface CrewInput {
  driverId?: unknown
  truckId?: unknown
  trailerId?: unknown
}

export interface CrewOk {
  driver: { id: string; fullName: string }
  truck: { id: string; brand: string; plate: string }
  trailer: { id: string; plate: string; type: string }
}

/**
 * Полная проверка экипажа на сервере (раньше — только в интерфейсе):
 *  — водитель, тягач и прицеп обязательны и принадлежат перевозчику-победителю;
 *  — ВУ водителя и техосмотр тягача и прицепа действуют на день погрузки;
 *  — никто из экипажа не закреплён за другой заявкой в работе (правило занятости).
 * Возвращает найденные записи или текст ошибки.
 */
export async function validateCrew(
  tx: Tx,
  request: { id: string; winnerId: string | null; loadDate: string },
  input: CrewInput,
  /** экипаж, уже выбранный в этой же пачке (массовое назначение из Excel) */
  takenInBatch?: { drivers: Map<string, string>; trucks: Map<string, string>; trailers: Map<string, string> },
): Promise<CrewOk | string> {
  const driverId = typeof input.driverId === 'string' ? input.driverId : ''
  const truckId = typeof input.truckId === 'string' ? input.truckId : ''
  const trailerId = typeof input.trailerId === 'string' ? input.trailerId : ''
  if (!driverId || !truckId || !trailerId) return 'Выберите водителя, тягач и прицеп — все три обязательны'
  if (!request.winnerId) return 'У заявки нет перевозчика-победителя'

  const [driver, truck, trailer] = await Promise.all([
    tx.driver.findUnique({ where: { id: driverId } }),
    tx.truck.findUnique({ where: { id: truckId } }),
    tx.trailer.findUnique({ where: { id: trailerId } }),
  ])
  if (!driver || driver.carrierId !== request.winnerId) return 'Водитель не найден в базе перевозчика-победителя'
  if (!truck || truck.carrierId !== request.winnerId) return 'Тягач не найден в базе перевозчика-победителя'
  if (!trailer || trailer.carrierId !== request.winnerId) return 'Прицеп не найден в базе перевозчика-победителя'

  // сроки документов — на день погрузки
  const on = checkDate(request.loadDate)
  const onText = on.toLocaleDateString('ru-RU')
  const lic = validOn(driver.licenseTill, on)
  if (lic === 'expired') return `ВУ водителя ${driver.fullName} действует до ${driver.licenseTill} — на ${onText} уже недействительно`
  if (lic === 'unknown') return `У водителя ${driver.fullName} не указан срок действия ВУ — заполните его в «Справочниках»`
  const tt = validOn(truck.techTill, on)
  if (tt === 'expired') return `Техосмотр тягача ${truck.plate} действует до ${truck.techTill} — на ${onText} уже просрочен`
  if (tt === 'unknown') return `У тягача ${truck.plate} не указан срок техосмотра — заполните его в «Справочниках»`
  const zt = validOn(trailer.techTill, on)
  if (zt === 'expired') return `Техосмотр прицепа ${trailer.plate} действует до ${trailer.techTill} — на ${onText} уже просрочен`
  if (zt === 'unknown') return `У прицепа ${trailer.plate} не указан срок техосмотра — заполните его в «Справочниках»`

  // занятость в этой же загрузке
  if (takenInBatch) {
    const dn = takenInBatch.drivers.get(driverId)
    if (dn) return `Водитель ${driver.fullName} уже назначен в этой загрузке на заявку ${dn}`
    const tn = takenInBatch.trucks.get(truckId)
    if (tn) return `Тягач ${truck.plate} уже назначен в этой загрузке на заявку ${tn}`
    const zn = takenInBatch.trailers.get(trailerId)
    if (zn) return `Прицеп ${trailer.plate} уже назначен в этой загрузке на заявку ${zn}`
  }

  // занятость другими заявками в работе
  const hit = await tx.request.findFirst({
    where: {
      status: { in: BUSY_STATUSES },
      id: { not: request.id },
      OR: [{ driverId }, { truckId }, { trailerId }],
    },
    select: { number: true, status: true, driverId: true, truckId: true, trailerId: true },
  })
  if (hit) {
    const place = `— ${busyReason(hit.status as RequestDTO['status'])} по заявке ${hit.number}`
    if (hit.driverId === driverId) return `Водитель ${driver.fullName} занят ${place}`
    if (hit.truckId === truckId) return `Тягач ${truck.brand} (${truck.plate}) занят ${place}`
    return `Прицеп ${trailer.plate} занят ${place}`
  }

  return {
    driver: { id: driver.id, fullName: driver.fullName },
    truck: { id: truck.id, brand: truck.brand, plate: truck.plate },
    trailer: { id: trailer.id, plate: trailer.plate, type: trailer.type },
  }
}

/**
 * Записать экипаж в заявку. Если состав изменился, уже проверенные документы
 * снова ставятся в очередь проверки — их нужно сверить с новым экипажем.
 */
export async function applyCrew(tx: Tx, request: { id: string; driverId: string | null; truckId: string | null; trailerId: string | null }, crew: CrewOk): Promise<void> {
  const changed = request.driverId !== crew.driver.id || request.truckId !== crew.truck.id || request.trailerId !== crew.trailer.id
  await tx.request.update({
    where: { id: request.id },
    data: { driverId: crew.driver.id, truckId: crew.truck.id, trailerId: crew.trailer.id },
  })
  if (changed && (request.driverId || request.truckId)) {
    await tx.document.updateMany({
      where: { requestId: request.id, status: { not: 'PENDING' } },
      data: { status: 'PENDING', message: 'Экипаж изменён — документ будет сверен с новым составом' },
    })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toRequestDTO } from '@/lib/serialize'
import { notifyLive } from '@/lib/notify'

export const dynamic = 'force-dynamic'

const money = (v: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽/т`

/** Статусы, в которых экипаж считается «в рейсе» — занят под другую заявку (Task 50) */
const BUSY_STATUSES = ['AT_LOGIST', 'CONFIRMED']

/**
 * Правило занятости (Task 50): если водитель, ТС или прицеп уже закреплены за
 * рейсом «в работе» (у логиста на сверке или данные в 1С — водитель в рейсе),
 * назначить их на новую заявку нельзя. Возвращает текст ошибки
 * «<Кто> занят — уже в рейсе по заявке Z-XXXX» или null, если всё свободно.
 */
async function busyConflict(
  requestId: string,
  driverId: string,
  truckId: string,
  trailerId?: string,
): Promise<string | null> {
  const active = await db.request.findMany({
    where: {
      status: { in: BUSY_STATUSES },
      id: { not: requestId },
      OR: [
        { driverId },
        { truckId },
        ...(trailerId ? [{ trailerId }] : []),
      ],
    },
    select: { id: true, number: true, status: true, driverId: true, truckId: true, trailerId: true },
  })
  if (active.length === 0) return null
  const hit = active[0]
  const place = `— уже ${hit.status === 'CONFIRMED' ? 'в рейсе' : 'готовится к рейсу'} по заявке ${hit.number}`
  if (hit.driverId === driverId) {
    const d = await db.driver.findUnique({ where: { id: driverId }, select: { fullName: true } })
    return `Водитель ${d?.fullName ?? ''} занят ${place}`
  }
  if (hit.truckId === truckId) {
    const t = await db.truck.findUnique({ where: { id: truckId }, select: { brand: true, plate: true } })
    return `ТС ${t ? `${t.brand} (${t.plate})` : ''} занято ${place}`
  }
  const z = trailerId ? await db.trailer.findUnique({ where: { id: trailerId }, select: { plate: true } }) : null
  return `Прицеп ${z?.plate ?? ''} занят ${place}`
}

/**
 * POST /api/requests/[id]/action — действия рабочего процесса.
 * action: bid | award | extend | direct-offer | raise-rate |
 *         assign | confirm | return | close
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body.action as string

  const include = { bids: { include: { carrier: true } }, documents: true, events: true, winner: true, cargoType: true } as const

  const request = await db.request.findUnique({ where: { id }, include })
  if (!request) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })

  const ev = (type: string, message: string) => {
    // real-time: событие мгновенно расходится по открытым сессиям (Task 49)
    notifyLive({ type, message, requestId: id })
    return db.event.create({ data: { requestId: id, type, message } })
  }

  try {
    switch (action) {
      // ------- агент -------
      case 'bid': {
        const { carrierId, amount } = body as { carrierId: string; amount: number }
        if (request.status !== 'PUBLISHED') return NextResponse.json({ error: 'Заявка недоступна для ставок' }, { status: 400 })
        const carrier = await db.carrier.findUnique({ where: { id: carrierId } })
        if (!carrier || !carrier.access) return NextResponse.json({ error: 'Перевозчик без доступа к площадке' }, { status: 400 })
        const amt = Math.round(Number(amount))
        if (!amt || amt <= 0) return NextResponse.json({ error: 'Укажите ставку' }, { status: 400 })
        if (request.mode === 'AUCTION') {
          const floor = request.bestRate ?? request.startRate
          if (amt >= floor) return NextResponse.json({ error: `Ставка должна быть ниже текущей лучшей (${money(floor)})` }, { status: 400 })
        }
        await db.bid.create({ data: { requestId: id, carrierId, amount: amt } })
        if (request.bestRate == null || amt < request.bestRate) {
          await db.request.update({ where: { id }, data: { bestRate: amt } })
        }
        await ev('BID_PLACED', request.mode === 'CLOSED'
          ? `${carrier.name}: подана закрытая ставка`
          : `${carrier.name}: ставка ${money(amt)}`)
        break
      }

      // ------- логист: торги -------
      case 'award': {
        // Правило платформы (Task 50): заявку нельзя забрать у победителя —
        // согласовать можно только пока торги открыты
        if (request.status !== 'PUBLISHED') {
          return NextResponse.json({ error: 'Победитель уже согласован — заявку нельзя забрать у победителя' }, { status: 400 })
        }
        const { bidId } = body as { bidId: string }
        const bid = await db.bid.findUnique({ where: { id: bidId }, include: { carrier: true } })
        if (!bid || bid.requestId !== id) return NextResponse.json({ error: 'Ставка не найдена' }, { status: 404 })
        await db.bid.updateMany({ where: { requestId: id }, data: { isWinner: false } })
        await db.bid.update({ where: { id: bidId }, data: { isWinner: true } })
        await db.request.update({ where: { id }, data: { status: 'AWARDED', winnerId: bid.carrierId, bestRate: bid.amount } })
        await ev('WINNER_AWARDED', `Логист согласовал победителя: ${bid.carrier.name} — ${money(bid.amount)}`)
        break
      }

      case 'extend': {
        if (request.status !== 'PUBLISHED') return NextResponse.json({ error: 'Торги уже завершены' }, { status: 400 })
        const base = request.deadline && request.deadline > new Date() ? request.deadline : new Date()
        const newDeadline = new Date(base.getTime() + 2 * 3600_000)
        await db.request.update({ where: { id }, data: { deadline: newDeadline } })
        await ev('DEADLINE_EXTENDED', 'Логист продлил торги на 2 часа')
        break
      }

      case 'direct-offer': {
        // Правило платформы (Task 50): заявку нельзя забрать у победителя —
        // прямое предложение возможно только пока торги открыты
        if (request.status !== 'PUBLISHED') {
          return NextResponse.json({ error: 'Победитель уже согласован — заявку нельзя забрать у победителя' }, { status: 400 })
        }
        const { carrierId } = body as { carrierId: string }
        const carrier = await db.carrier.findUnique({ where: { id: carrierId } })
        if (!carrier) return NextResponse.json({ error: 'Перевозчик не найден' }, { status: 404 })
        const rate = request.bestRate ?? request.startRate
        await db.request.update({ where: { id }, data: { status: 'AWARDED', winnerId: carrierId, bestRate: rate } })
        await ev('DIRECT_OFFER', `Заявка предложена напрямую: ${carrier.name} — ${money(rate)}`)
        break
      }

      case 'raise-rate': {
        const { amount } = body as { amount: number }
        const amt = Math.round(Number(amount))
        if (!amt || amt <= request.startRate) return NextResponse.json({ error: `Новая ставка должна быть выше ${money(request.startRate)}` }, { status: 400 })
        await db.request.update({ where: { id }, data: { startRate: amt } })
        await ev('RATE_RAISED', `Стартовая ставка повышена до ${money(amt)}`)
        break
      }

      // ------- агент: данные водителя и ТС -------
      case 'assign': {
        const { driverId, truckId, trailerId } = body as { driverId: string; truckId: string; trailerId?: string }
        const driver = await db.driver.findUnique({ where: { id: driverId } })
        const truck = await db.truck.findUnique({ where: { id: truckId } })
        if (!driver || !truck) return NextResponse.json({ error: 'Выберите водителя и автомобиль из справочника' }, { status: 400 })
        if (driver.carrierId !== request.winnerId || truck.carrierId !== request.winnerId) {
          return NextResponse.json({ error: 'Водитель и ТС должны принадлежать перевозчику-победителю' }, { status: 400 })
        }
        const busy = await busyConflict(id, driverId, truckId, trailerId)
        if (busy) return NextResponse.json({ error: busy }, { status: 400 })
        await db.request.update({ where: { id }, data: { driverId, truckId, trailerId: trailerId || null } })
        const trailer = trailerId ? await db.trailer.findUnique({ where: { id: trailerId } }) : null
        await ev('DRIVER_ASSIGNED', `Указаны водитель и ТС: ${driver.fullName}, ${truck.brand} (${truck.plate})${trailer ? ` + ${trailer.plate}` : ''}`)
        break
      }

      // ------- агент: утвердить экипаж (вкладка «Назначение экипажей») -------
      case 'approve-crew': {
        const { driverId, truckId, trailerId } = body as { driverId: string; truckId: string; trailerId?: string }
        const driver = await db.driver.findUnique({ where: { id: driverId } })
        const truck = await db.truck.findUnique({ where: { id: truckId } })
        if (!driver || !truck) return NextResponse.json({ error: 'Выберите водителя и автомобиль из справочника' }, { status: 400 })
        if (driver.carrierId !== request.winnerId || truck.carrierId !== request.winnerId) {
          return NextResponse.json({ error: 'Водитель и ТС должны принадлежать перевозчику-победителю' }, { status: 400 })
        }
        const busy = await busyConflict(id, driverId, truckId, trailerId)
        if (busy) return NextResponse.json({ error: busy }, { status: 400 })
        await db.request.update({ where: { id }, data: { driverId, truckId, trailerId: trailerId || null } })
        const trailer = trailerId ? await db.trailer.findUnique({ where: { id: trailerId } }) : null
        await ev('CREW_APPROVED', `Экипаж утверждён агентом: ${driver.fullName}, ${truck.brand} (${truck.plate})${trailer ? ` + ${trailer.plate}` : ''} — состав передан логисту`)
        break
      }

      // ------- логист: сверка -------
      case 'confirm': {
        if (request.status !== 'AT_LOGIST') return NextResponse.json({ error: 'Подтвердить можно заявку в статусе «У логиста»' }, { status: 400 })
        await db.request.update({ where: { id }, data: { status: 'CONFIRMED', passPackage: true, etrnStatus: 'SENT' } })
        await ev('CONFIRMED_1C', 'Данные подтверждены и переданы в 1C:ERP — справочник и реестр')
        await ev('PASS_SENT', 'Пакет на пропуск сформирован из заявки — логист загружает на платформу порта')
        await ev('ETRN_SENT', 'ЭТрН сформирована модулем «Логистика.Про», подпись — КЭП сотрудника и МЧД')
        break
      }

      case 'return': {
        const { reason } = body as { reason: string }
        if (!reason?.trim()) return NextResponse.json({ error: 'Укажите причину возврата' }, { status: 400 })
        await db.request.update({ where: { id }, data: { status: 'AWARDED' } })
        await ev('RETURNED_TO_AGENT', `Возвращено агенту: ${reason.trim()}`)
        break
      }

      case 'close': {
        if (request.status !== 'CONFIRMED') return NextResponse.json({ error: 'Закрыть можно подтверждённый рейс' }, { status: 400 })
        await db.request.update({ where: { id }, data: { status: 'CLOSED', etrnStatus: 'SIGNED' } })
        await ev('TRIP_CLOSED', 'Рейс закрыт: данные в реестре, отчёты сходятся с бухгалтерией')
        break
      }

      default:
        return NextResponse.json({ error: `Неизвестное действие: ${action}` }, { status: 400 })
    }

    const fresh = await db.request.findUnique({ where: { id }, include })
    return NextResponse.json({ request: toRequestDTO(fresh!) })
  } catch (e) {
    console.error('action error', e)
    return NextResponse.json({ error: 'Внутренняя ошибка действия' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, viewerOf, type Role } from '@/lib/auth'
import { toRequestDTO } from '@/lib/serialize'
import { notifyLive } from '@/lib/notify'
import { notifyCarrier, notifyLogists, type NotifyPayload } from '@/lib/notify-users'
import {
  applyCrew, finalizeExpired, inTx, loadRequestFor, minActiveBid, money, parseRuDate, validateCrew,
} from '@/lib/requests'

export const dynamic = 'force-dynamic'

/** Кто может выполнять действие. Перевозчик действует только от своего имени — carrierId берётся из сессии.
 *  RBAC (Task 65): действие delete — это разрешение delete_current_orders роли «Логист»:
 *  удалять можно только текущие заявки (не завершённые рейсы — они в реестре и бухгалтерии). */
const ACTION_ROLE: Record<string, Role> = {
  bid: 'carrier',
  withdraw: 'carrier',
  assign: 'carrier',
  'approve-crew': 'carrier',
  extend: 'logist',
  'direct-offer': 'logist',
  'raise-rate': 'logist',
  confirm: 'logist',
  return: 'logist',
  close: 'logist',
  delete: 'logist',
  edit: 'logist',
}

class ActionError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
const fail = (message: string, status = 400): never => { throw new ActionError(message, status) }

const MAX_RATE = 10_000_000

/**
 * Экспресс-сличение (Task 62): массив ответов да/нет из тела запроса.
 * Формат [{ key, label, ok }]; мусор отбрасываем, ограничиваем 12 пунктами и длину подписи.
 */
function saveChecks(body: Record<string, unknown>): { key: string; label: string; ok: boolean }[] | null {
  const raw = body.checks
  if (!Array.isArray(raw)) return null
  const checks = (raw as unknown[])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .slice(0, 12)
    .map((c) => ({
      key: typeof c.key === 'string' ? c.key.trim().slice(0, 40) : '',
      label: typeof c.label === 'string' ? c.label.trim().slice(0, 200) : '',
      ok: c.ok === true,
    }))
    .filter((c) => c.key && c.label)
  return checks.length > 0 ? checks : null
}

/**
 * POST /api/requests/[id]/action — действия рабочего процесса.
 * Перевозчик: bid | withdraw | assign | approve-crew.
 * Логист: extend | direct-offer | raise-rate | confirm | return | close | delete | edit.
 * Победителя торгов никто не выбирает вручную: по окончании срока заявка
 * автоматически уходит минимальной ставке (src/lib/requests.ts → finalizeExpired).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const viewer = viewerOf(auth)
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'award') {
    return NextResponse.json({
      error: 'Победитель определяется автоматически: по окончании приёма ставок заявка уходит перевозчику с минимальной ставкой',
    }, { status: 400 })
  }
  const role = ACTION_ROLE[action]
  if (!role) return NextResponse.json({ error: `Неизвестное действие: ${action || '—'}` }, { status: 400 })
  if (auth.role !== role) return NextResponse.json({ error: 'Недостаточно прав для этого действия' }, { status: 403 })

  // итоги торгов по сроку подводятся до любого действия — ставка после срока не пройдёт
  await finalizeExpired()
  const visible = await loadRequestFor(id, viewer)
  if (!visible) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })

  const me = auth.carrierId
  let liveType = action
  /** отложенные персональные уведомления (Task 69): создаются после успешной транзакции */
  let notes: { carrierId?: string | null; payload: NotifyPayload }[] = []

  try {
    await inTx(async (tx) => {
      notes = [] // при повторе транзакции не дублируем
      const r = await tx.request.findUnique({ where: { id } })
      if (!r) return fail('Заявка не найдена', 404)
      const now = new Date()
      const event = (type: string, message: string, carrierId: string | null = null) =>
        tx.event.create({ data: { requestId: id, type, message, carrierId } })

      switch (action) {
        // ------- перевозчик: ставка -------
        case 'bid': {
          const amt = Math.round(Number(body.amount))
          if (!Number.isFinite(amt) || amt <= 0 || amt > MAX_RATE) fail('Укажите ставку за тонну')
          if (r.status !== 'PUBLISHED') fail('Заявка недоступна для ставок')
          if (!r.deadline) fail('У заявки не задан срок приёма ставок — обратитесь к логисту')
          if (r.deadline! <= now) fail('Приём ставок по заявке завершён')
          const min = await minActiveBid(tx, id)
          if (r.mode === 'AUCTION') {
            const floor = min ?? r.startRate
            if (amt >= floor) fail(`Ставка должна быть ниже текущей лучшей (${money(floor)})`)
          }
          // чью лучшую ставку перебили (для уведомления BID_OUTBID, Task 69)
          const prevBest = await tx.bid.findFirst({
            where: { requestId: id, withdrawn: false },
            orderBy: [{ amount: 'asc' }, { createdAt: 'asc' }],
            select: { carrierId: true },
          })
          const carrier = await tx.carrier.findUnique({ where: { id: me! }, select: { name: true } })
          await tx.bid.create({ data: { requestId: id, carrierId: me!, amount: amt } })
          // лучшая ставка — минимум активных ставок; считаем внутри транзакции, чтобы не «откатиться» вверх
          await tx.request.update({ where: { id }, data: { bestRate: min == null ? amt : Math.min(min, amt) } })
          await event('BID_PLACED', r.mode === 'CLOSED'
            ? `${carrier?.name ?? 'Перевозчик'}: подана закрытая ставка`
            : `${carrier?.name ?? 'Перевозчик'}: ставка ${money(amt)}`, me)
          notes.push({
            payload: {
              type: 'BID_PLACED',
              title: `Новая ставка · №${r.number}`,
              body: r.mode === 'CLOSED'
                ? `${carrier?.name ?? 'Перевозчик'}: подана закрытая ставка — ${r.fromPoint} → ${r.toPoint}`
                : `${carrier?.name ?? 'Перевозчик'}: ${money(amt)} — ${r.fromPoint} → ${r.toPoint}`,
              requestId: id,
            },
          })
          if (r.mode === 'AUCTION' && prevBest && prevBest.carrierId !== me) {
            notes.push({
              carrierId: prevBest.carrierId,
              payload: {
                type: 'BID_OUTBID',
                title: `Ставку перебили · №${r.number}`,
                body: `Новая лучшая ставка ${money(amt)} — ${r.fromPoint} → ${r.toPoint}. Можно предложить ниже, пока идёт приём ставок`,
                requestId: id,
              },
            })
          }
          break
        }

        // ------- перевозчик: добровольный выход из заявки (Task 52) -------
        case 'withdraw': {
          // согласованную заявку у победителя не забираем (правило платформы, Task 50)
          if (r.status !== 'PUBLISHED') fail('Выйти из заявки можно только пока идёт тендер — победитель уже определён')
          const active = await tx.bid.count({ where: { requestId: id, carrierId: me!, withdrawn: false } })
          if (!active) fail('Активной ставки на эту заявку нет — выходить не из чего')
          await tx.bid.updateMany({ where: { requestId: id, carrierId: me! }, data: { withdrawn: true } })
          await tx.request.update({ where: { id }, data: { bestRate: await minActiveBid(tx, id) } })
          const carrier = await tx.carrier.findUnique({ where: { id: me! }, select: { name: true } })
          await event('BID_WITHDRAWN', `${carrier?.name ?? 'Перевозчик'}: отозвал ставку и снялся с заявки`, me)
          break
        }

        // ------- логист: торги -------
        case 'extend': {
          if (r.status !== 'PUBLISHED') fail('Торги уже завершены')
          const base = r.deadline && r.deadline > now ? r.deadline : now
          await tx.request.update({ where: { id }, data: { deadline: new Date(base.getTime() + 2 * 3600_000) } })
          await event('DEADLINE_EXTENDED', 'Логист продлил приём ставок на 2 часа')
          break
        }

        case 'direct-offer': {
          if (r.status !== 'PUBLISHED') fail('Победитель уже определён — заявку нельзя забрать у победителя')
          const carrierId = typeof body.carrierId === 'string' ? body.carrierId : ''
          const carrier = carrierId ? await tx.carrier.findUnique({ where: { id: carrierId } }) : null
          if (!carrier) fail('Перевозчик не найден', 404)
          if (!carrier!.access) fail('У перевозчика закрыт доступ к площадке')
          const rate = (await minActiveBid(tx, id)) ?? r.startRate
          const moved = await tx.request.updateMany({
            where: { id, status: 'PUBLISHED' },
            data: { status: 'AWARDED', winnerId: carrierId, bestRate: rate },
          })
          if (moved.count === 0) fail('Заявка уже передана перевозчику')
          await tx.bid.updateMany({ where: { requestId: id }, data: { isWinner: false } })
          await event('DIRECT_OFFER', `Заявка предложена напрямую: ${carrier!.name} — ${money(rate)}`, carrierId)
          await event('AUCTION_FINISHED', 'Приём ставок завершён — заявка передана перевозчику напрямую')
          notes.push({
            carrierId,
            payload: {
              type: 'WINNER_AWARDED',
              title: `Вам назначена заявка · №${r.number}`,
              body: `Ставка ${money(rate)} — ${r.fromPoint} → ${r.toPoint}. Укажите экипаж и подайте документы`,
              requestId: id,
            },
          })
          notes.push({
            payload: {
              type: 'AUCTION_FINISHED',
              title: `Итоги торгов · №${r.number}`,
              body: `Приём ставок завершён — заявка передана напрямую: ${carrier!.name}, ${money(rate)}`,
              requestId: id,
            },
          })
          liveType = 'WINNER_AWARDED'
          break
        }

        case 'raise-rate': {
          if (r.status !== 'PUBLISHED') fail('Поднять стартовую ставку можно только пока идёт приём ставок')
          const amt = Math.round(Number(body.amount))
          if (!Number.isFinite(amt) || amt <= r.startRate || amt > MAX_RATE) fail(`Новая ставка должна быть выше ${money(r.startRate)}`)
          await tx.request.update({ where: { id }, data: { startRate: amt } })
          await event('RATE_RAISED', `Стартовая ставка повышена до ${money(amt)}`)
          break
        }

        // ------- перевозчик-победитель: экипаж -------
        case 'assign':
        case 'approve-crew': {
          if (r.winnerId !== me) fail('Рейс закреплён за другим перевозчиком', 403)
          if (r.status !== 'AWARDED' && r.status !== 'DOCS_REVIEW') {
            fail('Экипаж можно менять, пока заявка у перевозчика — после передачи логисту состав зафиксирован')
          }
          const crew = await validateCrew(tx, r, { driverId: body.driverId, truckId: body.truckId, trailerId: body.trailerId })
          if (typeof crew === 'string') return fail(crew)
          await applyCrew(tx, r, crew)
          const who = `${crew.driver.fullName}, ${crew.truck.brand} (${crew.truck.plate}) + ${crew.trailer.plate}`
          if (action === 'assign') await event('DRIVER_ASSIGNED', `Указаны водитель и ТС: ${who}`, me)
          else await event('CREW_APPROVED', `Экипаж утверждён агентом: ${who} — состав передан логисту`, me)
          notes.push({
            payload: {
              type: 'CREW_ASSIGNED',
              title: `Экипаж ${action === 'assign' ? 'указан' : 'утверждён'} · №${r.number}`,
              body: `${who} — документы можно подавать на сверку`,
              requestId: id,
            },
          })
          break
        }

        // ------- логист: сверка -------
        case 'confirm': {
          if (r.status !== 'AT_LOGIST') fail('Подтвердить можно заявку в статусе «У логиста»')
          // экспресс-сличение (Task 62): ответы да/нет + комментарий сохраняются вместе с вердиктом
          const checks = saveChecks(body)
          await tx.request.update({
            where: { id },
            data: {
              status: 'CONFIRMED', passPackage: true, etrnStatus: 'SENT',
              ...(checks ? { verifyChecks: JSON.stringify(checks) } : {}),
              ...(typeof body.comment === 'string' && body.comment.trim() ? { verifyComment: body.comment.trim().slice(0, 500) } : { verifyComment: null }),
            },
          })
          await event('CONFIRMED_1C', 'Документы сверены и подтверждены — данные переданы в 1C:ERP (справочник и реестр)')
          await event('PASS_SENT', 'Пакет на пропуск сформирован из заявки — логист загружает на платформу порта')
          await event('ETRN_SENT', 'ЭТрН сформирована модулем «Логистика.Про», подпись — КЭП сотрудника и МЧД')
          notes.push({
            carrierId: r.winnerId,
            payload: {
              type: 'DOCS_CONFIRMED',
              title: `Документы подтверждены · №${r.number}`,
              body: 'Логист сверил пакет — данные переданы в 1С, рейс готовится (пропуск и ЭТрН)',
              requestId: id,
            },
          })
          break
        }

        case 'return': {
          if (r.status !== 'AT_LOGIST') fail('Вернуть агенту можно только заявку на сверке у логиста')
          const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
          if (!reason) fail('Укажите причину возврата')
          const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : ''
          const checks = saveChecks(body)
          await tx.request.update({
            where: { id },
            data: {
              status: 'AWARDED',
              ...(checks ? { verifyChecks: JSON.stringify(checks) } : {}),
              verifyComment: [reason, comment].filter(Boolean).join('. ') || null,
            },
          })
          await event('RETURNED_TO_AGENT', `Возвращено агенту: ${[reason, comment].filter(Boolean).join('. ')}`)
          notes.push({
            carrierId: r.winnerId,
            payload: {
              type: 'DOCS_RETURNED',
              title: `Документы возвращены · №${r.number}`,
              body: `Причина: ${reason}. Исправьте пакет и подайте заново — та же заявка`,
              requestId: id,
            },
          })
          break
        }

        case 'close': {
          if (r.status !== 'CONFIRMED') fail('Закрыть можно подтверждённый рейс')
          await tx.request.update({ where: { id }, data: { status: 'CLOSED', etrnStatus: 'SIGNED' } })
          await event('TRIP_CLOSED', 'Рейс закрыт: данные в реестре, отчёты сходятся с бухгалтерией')
          notes.push({
            carrierId: r.winnerId,
            payload: {
              type: 'TRIP_CLOSED',
              title: `Рейс закрыт · №${r.number}`,
              body: `${r.fromPoint} → ${r.toPoint} — рейс выполнен и закрыт, заявка завершена`,
              requestId: id,
            },
          })
          break
        }

        // ------- логист: удаление текущей заявки (Task 65, RBAC: delete_current_orders) -------
        case 'delete': {
          if (r.status === 'CONFIRMED' || r.status === 'CLOSED') {
            fail('Завершённые рейсы удалять нельзя — они уже в реестре рейсов и отчётах для бухгалтерии')
          }
          if (r.status === 'DELETED') fail('Заявка уже удалена')
          // уведомим всех, кто участвовал: победитель и активные ставки (Task 69)
          const participants = await tx.bid.findMany({
            where: { requestId: id, withdrawn: false },
            select: { carrierId: true },
          })
          const notifiedCarriers = new Set<string>(participants.map((p) => p.carrierId))
          if (r.winnerId) notifiedCarriers.add(r.winnerId)
          await tx.request.update({ where: { id }, data: { status: 'DELETED' } })
          await event('REQUEST_DELETED', `Заявка удалена логистом ${auth.name} — с площадки снята, ставки остановлены`)
          for (const carrierId of notifiedCarriers) {
            notes.push({
              carrierId,
              payload: {
                type: 'REQUEST_DELETED',
                title: `Заявка удалена · №${r.number}`,
                body: `Логист снял заявку ${r.fromPoint} → ${r.toPoint} с площадки — участие в ней больше не требуется`,
                requestId: id,
              },
            })
          }
          liveType = 'REQUEST_DELETED'
          break
        }

        // ------- логист: редактирование черновых параметров заявки (реестр заявок, Task 66) -------
        case 'edit': {
          if (r.status !== 'PUBLISHED') fail('Редактировать можно только заявки, ещё не ушедшие в работу')
          const patch: Record<string, unknown> = {}
          if (typeof body.cargo === 'string' && body.cargo.trim()) patch.cargo = body.cargo.trim().slice(0, 200)
          if (typeof body.fromPoint === 'string' && body.fromPoint.trim()) patch.fromPoint = body.fromPoint.trim().slice(0, 300)
          if (typeof body.toPoint === 'string' && body.toPoint.trim()) patch.toPoint = body.toPoint.trim().slice(0, 300)
          if (typeof body.loadDate === 'string' && body.loadDate.trim()) {
            const d = parseRuDate(body.loadDate.trim())
            if (!d) fail('Дата погрузки — в формате ДД.ММ.ГГГГ')
            patch.loadDate = body.loadDate.trim()
          }
          if (typeof body.loadWindow === 'string' && body.loadWindow.trim()) patch.loadWindow = body.loadWindow.trim().slice(0, 40)
          if (typeof body.comment === 'string') patch.comment = body.comment.trim().slice(0, 1000)
          if (body.tonnage != null && body.tonnage !== '') {
            const t = Number(body.tonnage)
            if (!Number.isFinite(t) || t <= 0 || t > 200) fail('Тоннаж — число от 0 до 200 т')
            patch.tonnage = t
          }
          if (typeof body.truckType === 'string' && body.truckType.trim()) patch.truckType = body.truckType.trim().slice(0, 40)
          if (body.startRate != null && body.startRate !== '') {
            const s = Number(body.startRate)
            if (!Number.isFinite(s) || s <= 0 || s > MAX_RATE) fail('Стартовая ставка — положительное число, ₽/т')
            patch.startRate = Math.round(s)
          }
          if (Object.keys(patch).length === 0) fail('Нет изменений для сохранения')
          await tx.request.update({ where: { id }, data: patch })
          await event('REQUEST_UPDATED', `Заявка отредактирована логистом ${auth.name}: ${Object.keys(patch).join(', ')}`)
          break
        }
      }
    })
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('action error', action, e)
    return NextResponse.json({ error: 'Внутренняя ошибка действия — повторите' }, { status: 500 })
  }

  // персональные уведомления (Task 69) — после успешной транзакции, вне её
  for (const n of notes) {
    try {
      if (n.carrierId) await notifyCarrier(n.carrierId, n.payload)
      else await notifyLogists(n.payload)
    } catch (err) {
      console.error('notification error', n.payload.type, err)
    }
  }

  notifyLive({ type: liveType, requestId: id })
  const fresh = await loadRequestFor(id, viewer)
  if (!fresh) return NextResponse.json({ ok: true })
  return NextResponse.json({ request: toRequestDTO(fresh, viewer) })
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { getSessionUser, shortName } from '@/lib/kontur/auth'
import { denyUnless, konturAllowedAny } from '@/lib/kontur/access'
import { parseDealDate } from '@/lib/kontur/planner'

export const dynamic = 'force-dynamic'

// Заявки на грузы ATI.SU, по которым АЭМЗ договорилась с грузовладельцем.
// Отдельный раздел, сужающий общий подбор витрины до согласованных грузов.
// Две стадии согласования:
//   preliminary — предварительная договорённость (обычно по телефону):
//                 ставка и условия согласованы, документы ещё не обменяны;
//   full        — полное согласование: документы обменяны, заявка вступила
//                 в силу (docsAt — момент обмена документами).
//
//   GET  /api/atisu/deals                        → список заявок
//   POST /api/atisu/deals { action:'create', load, comment? }
//                                                → предварительное согласование
//   POST /api/atisu/deals { action:'docs', dealId }
//                                                → документы обменяны → в силу
//   POST /api/atisu/deals { action:'plan', dealId, mode:'new'|'append',
//                           driverId, vehicleId, trailerId?, tripId? }
//                                                → груз в плане: рейс (черновик) или
//                                                   плечо к текущему рейсу — видно
//                                                   в «Заявках», «Занятости», «Планировании»
//   POST /api/atisu/deals { action:'unplan', dealId }
//                                                → снять груз с состава (плечо отменяется)
//   POST /api/atisu/deals { action:'cancel', dealId, reason? }
//                                                → договорённость не состоялась
//                                                   (назначенное плечо отменяется каскадом)
//   POST /api/atisu/deals { action:'restore', dealId }
//                                                → вернуть отменённую к предварительной
//   POST /api/atisu/deals { action:'note', dealId, comment }
//                                                → обновить условия договорённости

type LoadSnapshot = {
  id?: string
  ati_id?: number
  from?: string
  from_region?: string
  to?: string
  to_region?: string
  km?: number
  bodies?: string[]
  cargo?: string
  weight_t?: number
  volume_m3?: number
  date_from?: string
  date_to?: string
  rate?: number
  per_km?: number
  payment?: string
  nds_pct?: number
  contact_name?: string
  contact_phone?: string
  carrier?: { firm?: string; rating?: number }
}

async function listDeals() {
  const rows = await db.atiDeal.findMany()
  const stageOf = (d: (typeof rows)[number]) => (d.status === 'cancelled' ? 2 : d.stage === 'full' ? 1 : 0)
  return rows
    .slice()
    .sort((a, b) => stageOf(a) - stageOf(b) || b.updatedAt.getTime() - a.updatedAt.getTime())
}

// Отмена назначенных плеч сделки (каскад при отмене/снятии с плана):
// открытые плечи с dealId закрываются, черновой рейс без открытых плеч — тоже.
// Так «Занятость» и «Планирование» не показывают работу по несостоявшейся сделке.
async function cancelPlannedLegs(dealId: string, comment: string) {
  const legs = await db.leg.findMany({
    where: { dealId, status: { notIn: ['completed', 'cancelled'] } },
  })
  const cancelledTrips: string[] = []
  for (const leg of legs) {
    await db.leg.update({
      where: { id: leg.id },
      data: { status: 'cancelled', version: { increment: 1 } },
    })
    await db.statusEvent.create({
      data: { legId: leg.id, status: 'cancelled', actorRole: 'system', comment, result: 'applied' },
    })
    // черновой рейс без открытых плеч — отменяется целиком
    const siblings = await db.leg.findMany({ where: { tripId: leg.tripId } })
    const anyOpen = siblings.some((l) => l.status !== 'completed' && l.status !== 'cancelled')
    const trip = await db.trip.findUnique({ where: { id: leg.tripId } })
    if (!anyOpen && trip && trip.status === 'draft') {
      await db.trip.update({ where: { id: trip.id }, data: { status: 'cancelled', endedAt: new Date() } })
      await db.tripEvent.create({
        data: { tripId: trip.id, type: 'cancelled', payload: JSON.stringify({ reason: comment }) },
      })
      cancelledTrips.push(trip.id)
    }
  }
  return { legs: legs.map((l) => l.id), cancelledTrips }
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  if (!(await konturAllowedAny(user, ['section:ownAtisu', 'section:ownPlanning', 'section:ownOccupancy']))) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Нет доступа к сделкам ATI.SU. Его выдаёт администрация в «Профилях и доступах»' } },
      { status: 403 },
    )
  }
  return NextResponse.json({ deals: await listDeals() })
}

export async function POST(req: Request) {
  const body = await req.json()
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  const denied = await denyUnless(user, 'own:atisu')
  if (denied) return denied
  const actor = shortName(user.fullName)

  // --- предварительное согласование: снимок груза уходит в заявку ---
  if (body.action === 'create') {
    const load = (body.load ?? {}) as LoadSnapshot
    if (!load.id || !load.from || !load.to || !load.cargo || !load.carrier?.firm) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неполные данные груза' } }, { status: 400 })
    }

    const existing = await db.atiDeal.findUnique({ where: { loadId: load.id } })
    if (existing && existing.status === 'active') {
      return NextResponse.json({
        error: { code: 'CONFLICT', message: `Груз уже в заявках (${existing.stage === 'full' ? 'в силе' : 'предварительное'})` },
      }, { status: 409 })
    }

    const data = {
      loadId: load.id,
      atiId: load.ati_id ?? null,
      from: load.from,
      fromRegion: load.from_region ?? null,
      to: load.to,
      toRegion: load.to_region ?? null,
      km: load.km ?? null,
      bodies: Array.isArray(load.bodies) ? load.bodies.join(' / ') : null,
      cargo: load.cargo,
      weightT: load.weight_t ?? null,
      volumeM3: load.volume_m3 ?? null,
      loadDateFrom: load.date_from ?? null,
      loadDateTo: load.date_to ?? null,
      rate: load.rate ?? null,
      perKm: load.per_km ?? null,
      payment: load.payment ?? null,
      ndsPct: load.nds_pct ?? null,
      carrierFirm: load.carrier.firm,
      carrierRating: load.carrier.rating ?? null,
      contactName: load.contact_name ?? null,
      contactPhone: load.contact_phone ?? null,
      stage: 'preliminary',
      status: 'active',
      comment: typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null,
      cancelReason: null,
      docsAt: null,
      agreedAt: new Date(),
      createdById: user.id,
      createdByName: actor,
    }

    // раньше уже отменяли этот груз? — заводим заявку заново поверх (loadId уникален)
    const deal = existing
      ? await db.atiDeal.update({ where: { loadId: load.id }, data })
      : await db.atiDeal.create({ data })

    await db.auditLog.create({
      data: {
        actorRole: 'logist',
        actorName: actor,
        object: 'ati_deal',
        objectId: deal.id,
        field: 'preliminary',
        became: `${load.from} → ${load.to} · ${load.carrier.firm}`,
        comment: 'Предварительное согласование груза с биржи ATI.SU',
      },
    })
    return NextResponse.json({
      ok: true,
      deal,
      message: `Предварительное согласование: ${load.from} → ${load.to} (${load.carrier.firm}). Документы ещё не обменяны.`,
    })
  }

  // --- документы обменяны: заявка вступает в силу ---
  if (body.action === 'docs') {
    const { dealId } = body as { dealId?: string }
    if (!dealId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите заявку' } }, { status: 400 })
    }
    const deal = await db.atiDeal.findUnique({ where: { id: dealId } })
    if (!deal) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
    }
    if (deal.status !== 'active') {
      return NextResponse.json({ error: { code: 'CONFLICT', message: 'Заявка отменена — сначала верните её в работу' } }, { status: 409 })
    }
    if (deal.stage === 'full') {
      return NextResponse.json({ error: { code: 'CONFLICT', message: 'Документы уже обменяны — заявка в силе' } }, { status: 409 })
    }
    const updated = await db.atiDeal.update({ where: { id: dealId }, data: { stage: 'full', docsAt: new Date() } })
    await db.auditLog.create({
      data: {
        actorRole: 'logist',
        actorName: actor,
        object: 'ati_deal',
        objectId: deal.id,
        field: 'full',
        was: 'preliminary',
        became: 'full',
        comment: `Документы обменяны — заявка вступила в силу: ${deal.from} → ${deal.to}`,
      },
    })
    return NextResponse.json({
      ok: true,
      deal: updated,
      message: `Заявка вступила в силу: ${deal.from} → ${deal.to}. Документы обменяны.`,
    })
  }

  // --- груз в плане: назначаем состав (черновой рейс) или добавляем плечо к рейсу ---
  if (body.action === 'plan') {
    const { dealId, mode = 'new', driverId, vehicleId, trailerId, tripId } = body as {
      dealId?: string; mode?: 'new' | 'append'; driverId?: string; vehicleId?: string; trailerId?: string; tripId?: string
    }
    if (!dealId || !driverId || !vehicleId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите сделку, водителя и тягач' } }, { status: 400 })
    }
    const deal = await db.atiDeal.findUnique({ where: { id: dealId } })
    if (!deal) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
    }
    if (deal.status !== 'active') {
      return NextResponse.json({ error: { code: 'CONFLICT', message: 'Заявка отменена — сначала верните её в работу' } }, { status: 409 })
    }
    if (deal.stage !== 'full') {
      return NextResponse.json({ error: { code: 'CONFLICT', message: 'Сначала обменяйтесь документами — заявка должна вступить в силу' } }, { status: 409 })
    }
    const alreadyPlanned = await db.leg.findFirst({
      where: { dealId: deal.id, status: { notIn: ['completed', 'cancelled'] } },
    })
    if (alreadyPlanned) {
      return NextResponse.json({ error: { code: 'CONFLICT', message: 'Груз уже в плане — сначала снимите его с состава' } }, { status: 409 })
    }

    const driver = await db.driver.findUnique({ where: { id: driverId } })
    if (!driver || driver.status !== 'active') {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Водитель должен быть в строю' } }, { status: 400 })
    }
    const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle || vehicle.ownership !== 'own' || vehicle.isRepair) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Тягач должен быть из собственного парка и не в ремонте' } }, { status: 400 })
    }
    if (deal.weightT != null && vehicle.capacityT != null && vehicle.capacityT < deal.weightT) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: `Ёмкость ${Math.round(vehicle.capacityT)} т меньше веса груза ${deal.weightT} т` } }, { status: 400 })
    }

    const legData = {
      cargoSource: 'ati' as const,
      dealId: deal.id,
      loadPoint: deal.from,
      unloadPoint: deal.to,
      loadDatePlan: parseDealDate(deal.loadDateFrom),
      cargoDesc: deal.cargo,
      weightT: deal.weightT,
      rate: deal.rate,
      kmPlan: deal.km,
      status: 'assigned' as const,
      statusSource: 'driver' as const,
    }

    if (mode === 'append') {
      // груз встаёт следующим плечом к текущему рейсу (обратка без порожняка)
      if (!tripId) {
        return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите рейс для добавления плеча' } }, { status: 400 })
      }
      const trip = await db.trip.findUnique({ where: { id: tripId } })
      if (!trip || (trip.status !== 'active' && trip.status !== 'draft')) {
        return NextResponse.json({ error: { code: 'CONFLICT', message: 'Рейс не найден или уже завершён' } }, { status: 409 })
      }
      if (trip.driverId !== driverId || trip.vehicleId !== vehicleId) {
        return NextResponse.json({ error: { code: 'CONFLICT', message: 'Состав рейса изменился — обновите подбор' } }, { status: 409 })
      }
      const maxSeq = await db.leg.findFirst({ where: { tripId: trip.id }, orderBy: { seq: 'desc' } })
      const leg = await db.leg.create({
        data: { ...legData, tripId: trip.id, seq: (maxSeq?.seq ?? 0) + 1, type: 'return' },
      })
      await db.statusEvent.create({ data: { legId: leg.id, status: 'assigned', actorRole: 'system', result: 'applied' } })
      await db.tripEvent.create({
        data: { tripId: trip.id, type: 'leg_appended', actorId: actor, payload: JSON.stringify({ dealId: deal.id, legId: leg.id, source: 'ati' }) },
      })
      await db.outbox1c.create({
        data: { eventType: 'trip.leg_appended', payload: JSON.stringify({ tripId: trip.id, legId: leg.id, dealId: deal.id, source: 'ati' }) },
      })
      await db.auditLog.create({
        data: {
          actorRole: 'logist', actorName: actor, object: 'ati_deal', objectId: deal.id,
          field: 'planned', became: `плечо ${leg.seq} к рейсу ${trip.id.slice(0, 8)} · ${driver.fullName}`,
          comment: `Груз ATI.SU ${deal.from} → ${deal.to} добавлен плечом к рейсу`,
        },
      })
      return NextResponse.json({ ok: true, tripId: trip.id, legId: leg.id, message: `Груз ${deal.from} → ${deal.to} — плечо к рейсу ${driver.fullName}. Видно в «Занятости» и «Планировании».` })
    }

    // mode=new: новый рейс-черновик под груз (назначен, выезд по плану)
    const trailer = trailerId ? await db.trailer.findUnique({ where: { id: trailerId } }) : null
    if (trailerId && (!trailer || trailer.ownership !== 'own')) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Прицеп должен принадлежать собственному парку' } }, { status: 400 })
    }
    const busy = await db.trip.findFirst({
      where: {
        status: { in: ['active', 'draft'] },
        OR: [
          { vehicleId: vehicle.id },
          { driverId: driver.id },
          ...(trailer ? [{ trailerId: trailer.id }] : []),
        ],
      },
    })
    if (busy) {
      return NextResponse.json({ error: { code: 'STATE', message: 'Состав уже занят (рейс в работе или назначен) — выберите другого' } }, { status: 409 })
    }
    const trip = await db.trip.create({
      data: { vehicleId: vehicle.id, trailerId: trailer?.id ?? null, driverId: driver.id, status: 'draft', ackStatus: 'pending' },
    })
    const leg = await db.leg.create({ data: { ...legData, tripId: trip.id, seq: 1, type: 'main' } })
    await db.statusEvent.create({ data: { legId: leg.id, status: 'assigned', actorRole: 'system', result: 'applied' } })
    await db.tripEvent.create({
      data: { tripId: trip.id, type: 'assigned', actorId: actor, payload: JSON.stringify({ dealId: deal.id, source: 'ati' }) },
    })
    await db.outbox1c.create({
      data: { eventType: 'trip.assigned', payload: JSON.stringify({ tripId: trip.id, driverId: driver.id, vehicleId: vehicle.id, dealId: deal.id, source: 'ati' }) },
    })
    await db.auditLog.create({
      data: {
        actorRole: 'logist', actorName: actor, object: 'ati_deal', objectId: deal.id,
        field: 'planned', became: `новый рейс ${trip.id.slice(0, 8)} · ${driver.fullName} · ${vehicle.brand} (${vehicle.plate})`,
        comment: `Груз ATI.SU ${deal.from} → ${deal.to} назначен свободному составу`,
      },
    })
    return NextResponse.json({
      ok: true, tripId: trip.id, legId: leg.id,
      message: `Груз ${deal.from} → ${deal.to} в плане: ${driver.fullName} на ${vehicle.plate}. Рейс назначен — выезд по плану.`,
    })
  }

  // --- снять груз с состава (плечо отменяется, рейс-черновик закрывается) ---
  if (body.action === 'unplan') {
    const { dealId } = body as { dealId?: string }
    if (!dealId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите заявку' } }, { status: 400 })
    }
    const deal = await db.atiDeal.findUnique({ where: { id: dealId } })
    if (!deal) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
    }
    const res = await cancelPlannedLegs(deal.id, 'Груз ATI.SU снят с состава')
    await db.auditLog.create({
      data: {
        actorRole: 'logist', actorName: actor, object: 'ati_deal', objectId: deal.id,
        field: 'unplanned', was: 'planned', became: 'снят с состава',
        comment: `Груз ${deal.from} → ${deal.to} снят с плана (плеч отменено: ${res.legs.length})`,
      },
    })
    return NextResponse.json({ ok: true, ...res, message: `Груз снят с плана (плеч отменено: ${res.legs.length})` })
  }

  // --- договорённость не состоялась ---
  if (body.action === 'cancel') {
    const { dealId, reason } = body as { dealId?: string; reason?: string }
    if (!dealId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите заявку' } }, { status: 400 })
    }
    const deal = await db.atiDeal.findUnique({ where: { id: dealId } })
    if (!deal) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
    }
    if (deal.status === 'cancelled') {
      return NextResponse.json({ error: { code: 'CONFLICT', message: 'Заявка уже отменена' } }, { status: 409 })
    }
    const updated = await db.atiDeal.update({
      where: { id: dealId },
      data: { status: 'cancelled', cancelReason: typeof reason === 'string' && reason.trim() ? reason.trim() : null },
    })
    // каскад: назначенное по сделке плечо отменяется — занятость и график обновляются
    const cascade = await cancelPlannedLegs(deal.id, 'Сделка ATI.SU отменена')
    await db.auditLog.create({
      data: {
        actorRole: 'logist',
        actorName: actor,
        object: 'ati_deal',
        objectId: deal.id,
        field: 'cancelled',
        was: deal.stage,
        became: 'cancelled',
        comment: `Отмена заявки: ${deal.from} → ${deal.to}${typeof reason === 'string' && reason.trim() ? ` — ${reason.trim()}` : ''}`,
      },
    })
    return NextResponse.json({
      ok: true,
      deal: updated,
      message: `Заявка отменена: ${deal.from} → ${deal.to}${cascade.legs.length ? ` · назначенное плечо снято с плана` : ''}`,
    })
  }

  // --- вернуть отменённую заявку к предварительной ---
  if (body.action === 'restore') {
    const { dealId } = body as { dealId?: string }
    if (!dealId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите заявку' } }, { status: 400 })
    }
    const deal = await db.atiDeal.findUnique({ where: { id: dealId } })
    if (!deal) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
    }
    if (deal.status !== 'cancelled') {
      return NextResponse.json({ error: { code: 'CONFLICT', message: 'Заявка не отменена' } }, { status: 409 })
    }
    const updated = await db.atiDeal.update({
      where: { id: dealId },
      data: { status: 'active', stage: 'preliminary', cancelReason: null, docsAt: null, agreedAt: new Date() },
    })
    await db.auditLog.create({
      data: {
        actorRole: 'logist',
        actorName: actor,
        object: 'ati_deal',
        objectId: deal.id,
        field: 'restored',
        was: 'cancelled',
        became: 'preliminary',
        comment: `Заявка возвращена в работу: ${deal.from} → ${deal.to}`,
      },
    })
    return NextResponse.json({ ok: true, deal: updated, message: `Заявка возвращена к предварительному согласованию: ${deal.from} → ${deal.to}` })
  }

  // --- условия договорённости ---
  if (body.action === 'note') {
    const { dealId, comment } = body as { dealId?: string; comment?: string }
    if (!dealId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите заявку' } }, { status: 400 })
    }
    const deal = await db.atiDeal.findUnique({ where: { id: dealId } })
    if (!deal) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
    }
    const updated = await db.atiDeal.update({
      where: { id: dealId },
      data: { comment: typeof comment === 'string' && comment.trim() ? comment.trim() : null },
    })
    return NextResponse.json({ ok: true, deal: updated, message: 'Условия договорённости обновлены' })
  }

  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестное действие' } }, { status: 400 })
}

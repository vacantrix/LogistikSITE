import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { notifyLive } from '@/lib/notify'
import { notifyCarrier, notifyLogists } from '@/lib/notify-users'
import { plog } from '@/lib/platform-log'
import {
  AEMZ_ORG, EDO_KIND_META, EDO_PARTY_ROLE, edoDocNumber, ensureEdoDocuments,
  buildEdoPayload, type EdoKind,
} from '@/lib/edo'

export const dynamic = 'force-dynamic'

const isEdoKind = (v: string): v is EdoKind => v === 'POA' || v === 'ORDER' || v === 'ETRN' || v === 'ACT'

/**
 * GET /api/edo — пакеты документов ЭДО по рейсам (Task 76).
 * Логист видит все рейсы в работе и закрытые; перевозчик — только свои.
 * Базовые документы (ЭТрН, акт) добираются автоматически; комплект экспедитора
 * создаёт логист отдельно — это обязанность АЭМЗ.
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const me = auth.carrierId

  const trips = await db.request.findMany({
    where: {
      status: { in: ['CONFIRMED', 'CLOSED'] },
      ...(auth.role === 'carrier' ? { winnerId: me ?? '__none__' } : {}),
    },
    include: {
      winner: { select: { name: true } },
      edoDocuments: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { number: 'desc' },
  })

  // добор базовых документов (идемпотентно) — без него пакеты неполные
  await ensureEdoDocuments(trips)

  const driverIds = trips.map((t) => t.driverId).filter((v): v is string => Boolean(v))
  const truckIds = trips.map((t) => t.truckId).filter((v): v is string => Boolean(v))
  const driverList = driverIds.length ? await db.driver.findMany({ where: { id: { in: driverIds } } }) : []
  const truckList = truckIds.length ? await db.truck.findMany({ where: { id: { in: truckIds } } }) : []
  const trailerList = truckIds.length ? await db.trailer.findMany() : []
  // перечитываем документы после добора
  const fresh = await db.edoDocument.findMany({
    where: { request: { status: { in: ['CONFIRMED', 'CLOSED'] }, ...(auth.role === 'carrier' ? { winnerId: me ?? '__none__' } : {}) } },
    orderBy: { createdAt: 'asc' },
  })
  const driverById = new Map(driverList.map((d) => [d.id, d]))
  const truckById = new Map(truckList.map((t) => [t.id, t]))
  const trailerById = new Map(trailerList.map((z) => [z.id, z]))
  const docsByRequest = new Map<string, typeof fresh>()
  for (const d of fresh) {
    const list = docsByRequest.get(d.requestId) ?? []
    list.push(d)
    docsByRequest.set(d.requestId, list)
  }

  const packages = trips.map((t) => {
    const driver = t.driverId ? driverById.get(t.driverId) : undefined
    const truck = t.truckId ? truckById.get(t.truckId) : undefined
    const trailer = t.trailerId ? trailerById.get(t.trailerId) : undefined
    return {
      request: {
        id: t.id,
        number: t.number,
        route: `${t.fromPoint} → ${t.toPoint}`,
        cargo: t.cargo,
        tonnage: t.tonnage,
        loadDate: t.loadDate,
        status: t.status,
        winnerName: t.winner?.name ?? null,
        driverName: driver?.fullName ?? null,
        truckLabel: truck ? `${truck.brand} · ${truck.plate}${trailer ? ` + ${trailer.plate}` : ''}` : null,
      },
      docs: (docsByRequest.get(t.id) ?? []).map((d) => ({
        id: d.id,
        kind: d.kind,
        party: d.party,
        title: isEdoKind(d.kind) ? EDO_KIND_META[d.kind].title : d.kind,
        partyRole: EDO_PARTY_ROLE[(d.party as 'EXPEDITOR' | 'CARRIER') ?? 'CARRIER'] ?? d.party,
        number: d.number,
        aemzSigned: d.aemzSigned,
        aemzSignedAt: d.aemzSignedAt?.toISOString() ?? null,
        aemzSigner: d.aemzSigner,
        partySigned: d.partySigned,
        partySignedAt: d.partySignedAt?.toISOString() ?? null,
        partySigner: d.partySigner,
        payload: safePayload(d.payload),
        createdAt: d.createdAt.toISOString(),
      })),
    }
  })

  return NextResponse.json({ packages })
}

function safePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * POST /api/edo — действия ЭДО.
 *  create-expeditor-pack (логист): сформировать комплект экспедитору —
 *    Доверенность + Поручение (обязанность АЭМЗ перед экспедитором).
 *  sign (обе роли): подписать документ своей КЭП — логист за АЭМЗ,
 *    перевозчик-победитель за экспедитора/перевозчика.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => ({}))) as { requestId?: string; docId?: string; action?: string }
  const requestId = typeof body.requestId === 'string' ? body.requestId : ''
  const docId = typeof body.docId === 'string' ? body.docId : ''
  const action = typeof body.action === 'string' ? body.action : ''

  const trip = await db.request.findUnique({
    where: { id: requestId },
    include: { winner: { select: { name: true } } },
  })
  if (!trip) return NextResponse.json({ error: 'Рейс не найден' }, { status: 404 })
  if (auth.role === 'carrier' && trip.winnerId !== auth.carrierId) {
    return NextResponse.json({ error: 'Документы этого рейса закреплены за другим перевозчиком' }, { status: 403 })
  }
  // у Request экипаж хранится по ID — карточки добираем из справочников
  const [crewDriver, crewTruck, crewTrailer] = await Promise.all([
    trip.driverId ? db.driver.findUnique({ where: { id: trip.driverId }, select: { fullName: true } }) : Promise.resolve(null),
    trip.truckId ? db.truck.findUnique({ where: { id: trip.truckId }, select: { brand: true, plate: true } }) : Promise.resolve(null),
    trip.trailerId ? db.trailer.findUnique({ where: { id: trip.trailerId }, select: { plate: true } }) : Promise.resolve(null),
  ])
  const truckLabel = crewTruck ? `${crewTruck.brand} · ${crewTruck.plate}${crewTrailer ? ` + ${crewTrailer.plate}` : ''}` : '—'
  const driverName = crewDriver?.fullName ?? '—'
  const carrierName = trip.winner?.name ?? '—'
  const seq = trip.number.replace(/^Z-/, '')

  // ——— формирование комплекта экспедитору (обязанность АЭМЗ) ———
  if (action === 'create-expeditor-pack') {
    if (auth.role !== 'logist') return NextResponse.json({ error: 'Комплект экспедитору формирует логист АЭМЗ' }, { status: 403 })
    if (trip.status !== 'CONFIRMED') {
      return NextResponse.json({ error: 'Комплект формируется по рейсу в работе — закрытый рейс уже в архиве' }, { status: 400 })
    }
    const existing = await db.edoDocument.findMany({ where: { requestId, kind: { in: ['POA', 'ORDER'] } }, select: { kind: true } })
    if (existing.length >= 2) {
      return NextResponse.json({ error: 'Комплект экспедитора уже сформирован' }, { status: 400 })
    }
    const now = new Date()
    const payload = buildEdoPayload(
      'POA',
      trip,
      { carrierName, driverName, truckLabel },
      now,
    )
    const created: string[] = []
    if (!existing.some((e) => e.kind === 'POA')) {
      await db.edoDocument.create({
        data: { requestId, kind: 'POA', party: 'EXPEDITOR', number: edoDocNumber('POA', trip.number), payload: JSON.stringify(payload) },
      })
      created.push('Доверенность')
    }
    if (!existing.some((e) => e.kind === 'ORDER')) {
      await db.edoDocument.create({
        data: { requestId, kind: 'ORDER', party: 'EXPEDITOR', number: edoDocNumber('ORDER', trip.number), payload: JSON.stringify({ ...payload, title: EDO_KIND_META.ORDER.title, accent: EDO_KIND_META.ORDER.accent }) },
      })
      created.push('Поручение экспедитору')
    }
    await db.event.create({
      data: { requestId, type: 'EDO_PACK_CREATED', message: `Комплект экспедитору сформирован: доверенность ДОВ-${seq} и поручение ПОР-${seq} — ожидают подписания сторон` },
    })
    await plog({
      type: 'EDO_PACK_CREATED', source: 'api/edo',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      requestId, requestNumber: trip.number, carrierName: trip.winner?.name ?? null,
      message: `Сформирован комплект экспедитору — №${trip.number} (${created.join(' + ')})`,
    })
    await notifyCarrier(trip.winnerId, {
      type: 'EDO_READY',
      title: `Комплект ЭДО сформирован · №${trip.number}`,
      body: 'Доверенность и поручение экспедитору доступны к подписанию в разделе «Подписать ЭДО»',
      requestId,
    })
    notifyLive({ type: 'EDO_PACK_CREATED', requestId })
    return NextResponse.json({ ok: true })
  }

  // ——— подписание документа своей стороной ———
  if (action === 'sign') {
    const doc = await db.edoDocument.findFirst({ where: { id: docId, requestId } })
    if (!doc) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 })
    if (!isEdoKind(doc.kind)) return NextResponse.json({ error: 'Неизвестный вид документа' }, { status: 400 })
    if (doc.aemzSigned && doc.partySigned) return NextResponse.json({ error: 'Документ уже подписан обеими сторонами' }, { status: 400 })

    const now = new Date()
    const kindMeta = EDO_KIND_META[doc.kind]
    if (auth.role === 'logist') {
      if (doc.aemzSigned) return NextResponse.json({ error: 'Со стороны АЭМЗ документ уже подписан' }, { status: 400 })
      await db.edoDocument.update({
        where: { id: doc.id },
        data: { aemzSigned: true, aemzSignedAt: now, aemzSigner: `${auth.name} · КЭП АЭМЗ` },
      })
      await db.event.create({
        data: { requestId, type: 'EDO_SIGNED_AEMZ', message: `${kindMeta.title} №${doc.number}: подписано со стороны АЭМЗ (${auth.name}, КЭП)` },
      })
      await plog({
        type: 'EDO_SIGNED', source: 'api/edo',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        requestId, requestNumber: trip.number, carrierName: trip.winner?.name ?? null,
        message: `${kindMeta.title} №${doc.number} подписано АЭМЗ — №${trip.number}`,
      })
      await notifyCarrier(trip.winnerId, {
        type: 'EDO_SIGNED',
        title: `Документ подписан АЭМЗ · №${trip.number}`,
        body: `${kindMeta.title} (${EDO_PARTY_ROLE[kindMeta.party]}) ждёт вашей подписи в разделе «Подписать ЭДО»`,
        requestId,
      })
    } else {
      if (doc.partySigned) return NextResponse.json({ error: 'Со стороны контрагента документ уже подписан' }, { status: 400 })
      // экспедиторские документы подписывает представитель (водитель-экспедитор),
      // транспортные — перевозчик (КЭП компании)
      const partySigner = kindMeta.party === 'EXPEDITOR'
        ? `${driverName} · водитель-экспедитор`
        : `${carrierName} · КЭП перевозчика`
      await db.edoDocument.update({
        where: { id: doc.id },
        data: { partySigned: true, partySignedAt: now, partySigner },
      })
      await db.event.create({
        data: { requestId, type: 'EDO_SIGNED_PARTY', message: `${kindMeta.title} №${doc.number}: подписано контрагентом (${partySigner})` },
      })
      await plog({
        type: 'EDO_SIGNED', source: 'api/edo',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        requestId, requestNumber: trip.number, carrierName: trip.winner?.name ?? null,
        message: `${kindMeta.title} №${doc.number} подписано контрагентом (${EDO_PARTY_ROLE[kindMeta.party]}) — №${trip.number}`,
      })
      await notifyLogists({
        type: 'EDO_SIGNED',
        title: `Документ подписан · №${trip.number}`,
        body: `${kindMeta.title} — подпись ${EDO_PARTY_ROLE[kindMeta.party].toLowerCase()} получена через ЭДО`,
        requestId,
      })
    }
    notifyLive({ type: 'EDO_SIGNED', requestId })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `Неизвестное действие: ${action || '—'}` }, { status: 400 })
}

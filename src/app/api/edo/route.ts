import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { notifyLive } from '@/lib/notify'
import { notifyCarrier, notifyLogists } from '@/lib/notify-users'
import { plog, plogError } from '@/lib/platform-log'
import {
  EDO_KIND_META, EDO_PARTY_ROLE, edoTitle, ensureEdoDocuments, type EdoKind,
} from '@/lib/edo'
import { DiadocError } from '@/lib/diadoc/client'
import { diadocEnabled } from '@/lib/diadoc/config'
import { diadocInfo, etrnDraft, sendEtrnT1, syncDiadoc } from '@/lib/diadoc/etrn'
import type { EtrnT1Input } from '@/lib/diadoc/waybill'
import { allowedFor, permDenied, type PermKey } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const isEdoKind = (v: string): v is EdoKind => v === 'POA' || v === 'ORDER' || v === 'ETRN' || v === 'ACT'
/** документы раздела: доверенность от АЭМЗ (POA) больше не используется — старые записи скрыты */
const VISIBLE_KINDS = ['ORDER', 'ETRN', 'ACT']

/**
 * GET /api/edo — пакеты документов ЭДО по рейсам (Task 76).
 * Логист видит все рейсы в работе и закрытые; перевозчик — только свои.
 * Документы добираются автоматически: заказ-заявка или поручение экспедитору
 * (по роли исполнителя), ЭТрН и акт.
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
      winner: { select: { name: true, role: true } },
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
    where: {
      kind: { in: VISIBLE_KINDS },
      request: { status: { in: ['CONFIRMED', 'CLOSED'] }, ...(auth.role === 'carrier' ? { winnerId: me ?? '__none__' } : {}) },
    },
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
        // исполнитель по заявке: явный выбор перевозчика; иначе роль компании (Task 109)
        executorRole: (t.executorRole ?? t.winner?.role) === 'FORWARDER' ? 'FORWARDER' : 'CARRIER',
        driverName: driver?.fullName ?? null,
        truckLabel: truck ? `${truck.brand} · ${truck.plate}${trailer ? ` + ${trailer.plate}` : ''}` : null,
      },
      docs: (docsByRequest.get(t.id) ?? []).map((d) => ({
        id: d.id,
        kind: d.kind,
        party: d.party,
        title: isEdoKind(d.kind) ? edoTitle(d.kind, d.party) : d.kind,
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
        // ЭТрН, отправленная через Диадок: этап перевозки, УИД ГИС ЭПД, ошибки
        diadoc: d.diadocMessageId ? {
          messageId: d.diadocMessageId,
          stage: d.diadocStage,
          uid: d.etrnUid,
          gisStatus: d.gisStatus,
          gisError: d.gisError,
          sentAt: d.diadocSentAt?.toISOString() ?? null,
          syncedAt: d.diadocSyncedAt?.toISOString() ?? null,
        } : null,
      })),
    }
  })

  return NextResponse.json({ packages, diadoc: await diadocInfo() })
}

/** Ошибка Диадока — понятный ответ интерфейсу и запись в журнал платформы */
async function diadocFailure(
  e: unknown,
  source: string,
  auth: { login: string; name: string; role: string },
  ctx: { requestId?: string; requestNumber?: string; carrierName?: string } = {},
): Promise<NextResponse> {
  const isDiadoc = e instanceof DiadocError
  const message = e instanceof Error ? e.message : 'Ошибка Диадока'
  // ошибки ввода (400) — подсказка логисту, остальное — сбой интеграции в журнал
  if (!isDiadoc || e.status !== 400) {
    await plogError(source, e, {
      type: 'DIADOC_ERROR', source,
      actor: { login: auth.login, name: auth.name, role: auth.role },
      requestId: ctx.requestId ?? null, requestNumber: ctx.requestNumber ?? null, carrierName: ctx.carrierName ?? null,
      message: `Диадок: ${message}`,
      meta: isDiadoc ? { status: e.status, details: e.details ?? null } : null,
    })
  }
  const status = isDiadoc && e.status >= 400 && e.status < 500 ? (e.status === 401 || e.status === 402 ? 502 : e.status) : 502
  return NextResponse.json({ error: message }, { status })
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
 *  sign (обе роли): подписать документ своей КЭП — логист за АЭМЗ,
 *    исполнитель рейса — за перевозчика или экспедитора.
 *  etrn-draft / etrn-send (логист): ЭТрН через Диадок; diadoc-sync — сверка статусов.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => ({}))) as { requestId?: string; docId?: string; action?: string; input?: unknown }
  const requestId = typeof body.requestId === 'string' ? body.requestId : ''
  const docId = typeof body.docId === 'string' ? body.docId : ''
  const action = typeof body.action === 'string' ? body.action : ''

  // права (Task 111): синхронизация — edo:sync, отправка ЭТрН — edo:send, подпись — edo:sign
  const EDO_ACTION_PERM: Partial<Record<string, PermKey>> = {
    'diadoc-sync': 'edo:sync',
    'etrn-draft': 'edo:send',
    'etrn-send': 'edo:send',
    sign: 'edo:sign',
  }
  const edoPerm = EDO_ACTION_PERM[action]
  if (edoPerm && !(await allowedFor(auth, edoPerm))) {
    return NextResponse.json({ error: permDenied(edoPerm) }, { status: 403 })
  }

  // ——— Диадок: сверка статусов ЭТрН (обе роли — «Обновить статусы») ———
  if (action === 'diadoc-sync') {
    if (!diadocEnabled()) return NextResponse.json({ error: 'Интеграция с Диадоком не настроена' }, { status: 400 })
    try {
      return NextResponse.json({ ok: true, ...(await syncDiadoc()) })
    } catch (e) {
      return diadocFailure(e, 'diadoc/sync', auth)
    }
  }

  const trip = await db.request.findUnique({
    where: { id: requestId },
    include: { winner: { select: { name: true, role: true } } },
  })
  if (!trip) return NextResponse.json({ error: 'Рейс не найден' }, { status: 404 })
  if (auth.role === 'carrier' && trip.winnerId !== auth.carrierId) {
    return NextResponse.json({ error: 'Документы этого рейса закреплены за другим перевозчиком' }, { status: 403 })
  }
  const carrierName = trip.winner?.name ?? '—'

  // ——— Диадок: черновик и отправка ЭТрН (титул Т1 за АЭМЗ) ———
  if (action === 'etrn-draft' || action === 'etrn-send') {
    if (!diadocEnabled()) return NextResponse.json({ error: 'Интеграция с Диадоком не настроена' }, { status: 400 })
    if (auth.role !== 'logist') return NextResponse.json({ error: 'ЭТрН отправляет логист АЭМЗ — грузоотправитель' }, { status: 403 })
    const doc = await db.edoDocument.findFirst({ where: { id: docId, requestId, kind: 'ETRN' }, select: { id: true } })
    if (!doc) return NextResponse.json({ error: 'Транспортная накладная не найдена' }, { status: 404 })
    try {
      if (action === 'etrn-draft') return NextResponse.json({ draft: await etrnDraft(doc.id) })
      if (!body.input || typeof body.input !== 'object') return NextResponse.json({ error: 'Нет данных ЭТрН' }, { status: 400 })
      const message = await sendEtrnT1(doc.id, body.input as EtrnT1Input, { login: auth.login, name: auth.name, role: auth.role })
      return NextResponse.json({ ok: true, message })
    } catch (e) {
      return diadocFailure(e, 'diadoc/etrn', auth, { requestId, requestNumber: trip.number, carrierName })
    }
  }

  // ——— подписание документа своей стороной ———
  if (action === 'sign') {
    const doc = await db.edoDocument.findFirst({ where: { id: docId, requestId } })
    if (!doc) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 })
    if (!isEdoKind(doc.kind)) return NextResponse.json({ error: 'Неизвестный вид документа' }, { status: 400 })
    // при подключённом Диадоке ЭТрН подписывается у оператора ЭДО, а не отметкой в платформе
    if (doc.kind === 'ETRN' && diadocEnabled()) {
      return NextResponse.json({
        error: auth.role === 'logist'
          ? 'ЭТрН подписывается через Диадок: нажмите «Отправить ЭТрН в Диадок»'
          : 'Подпишите титул перевозчика Т2 в своём Диадоке — платформа увидит подпись автоматически',
      }, { status: 400 })
    }
    if (doc.aemzSigned && doc.partySigned) return NextResponse.json({ error: 'Документ уже подписан обеими сторонами' }, { status: 400 })

    const now = new Date()
    const kindMeta = { ...EDO_KIND_META[doc.kind], title: edoTitle(doc.kind, doc.party) }
    const party = doc.party === 'EXPEDITOR' ? 'EXPEDITOR' : 'CARRIER'
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
        body: `${kindMeta.title} (${EDO_PARTY_ROLE[party]}) ждёт вашей подписи в разделе «Подписать ЭДО»`,
        requestId,
      })
    } else {
      if (doc.partySigned) return NextResponse.json({ error: 'Со стороны контрагента документ уже подписан' }, { status: 400 })
      // исполнитель подписывает КЭП своей компании — перевозчик или экспедитор
      const partySigner = `${carrierName} · КЭП ${party === 'EXPEDITOR' ? 'экспедитора' : 'перевозчика'}`
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
        message: `${kindMeta.title} №${doc.number} подписано контрагентом (${EDO_PARTY_ROLE[party]}) — №${trip.number}`,
      })
      await notifyLogists({
        type: 'EDO_SIGNED',
        title: `Документ подписан · №${trip.number}`,
        body: `${kindMeta.title} — подпись ${party === 'EXPEDITOR' ? 'экспедитора' : 'перевозчика'} получена через ЭДО`,
        requestId,
      })
    }
    notifyLive({ type: 'EDO_SIGNED', requestId })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `Неизвестное действие: ${action || '—'}` }, { status: 400 })
}

/**
 * ЭТрН рейса через Диадок: черновик из данных платформы, отправка титула Т1
 * и сверка статусов перевозки (Т2 перевозчика, УИД ГИС ЭПД, Т3/Т4, ошибки).
 *
 * Роли: АЭМЗ — грузоотправитель и лицо, осуществляющее погрузку (подписывает Т1),
 * перевозчик подписывает Т2 и Т4 в своём ЭДО, грузополучатель — Т3. Платформа
 * подписывает только за АЭМЗ, подписи контрагентов видит по ленте событий.
 *
 * Подпись Т1:
 *  — test  — тестовая подпись Диадока (тестовые ящики, сертификат не нужен);
 *  — delay — отложенное подписание: Т1 создаётся в исходящих ящика АЭМЗ, логист
 *            подписывает его своей КЭП в веб-интерфейсе Диадока, платформа видит подпись.
 */
import { db } from '@/lib/db'
import { notifyLive } from '@/lib/notify'
import { notifyCarrier, notifyLogists } from '@/lib/notify-users'
import { plog } from '@/lib/platform-log'
import { pointInfo } from '@/lib/points'
import { diadocConfig, diadocEnabled, diadocStandLabel, shipperSettings } from '@/lib/diadoc/config'
import {
  DiadocError, findBoxByInn, generateTitleXml, getMessage, getMyOrganizations, getNewEvents, myBox, postMessage,
  type DdEntity,
} from '@/lib/diadoc/client'
import { etrnStageFinal, etrnStageLabel } from '@/lib/diadoc/stages'
import {
  ETRN_TYPE, OWNERSHIP_CODE, buildT1UserXml, mskDateTime, parseRuAddress, ruDate, splitFio, splitLicense,
  statedArrival, validateT1Input, type EtrnT1Input, type EtrnVehicle,
} from '@/lib/diadoc/waybill'

export type SignMode = 'test' | 'delay'
export const signMode = (): SignMode => (diadocConfig().testSignature ? 'test' : 'delay')

const dash = (v: string | null | undefined): string => (v && v.trim() !== '—' ? v.trim() : '')
/** «ЭТрН 1066» — номер документа уже содержит вид, не дублируем «ЭТрН №ЭТрН» */
export const etrnLabel = (number: string): string => (/^ЭТрН/i.test(number) ? number : `ЭТрН №${number}`)

async function loadEtrnDoc(docId: string) {
  const doc = await db.edoDocument.findUnique({
    where: { id: docId },
    include: { request: { include: { winner: true } } },
  })
  if (!doc || doc.kind !== 'ETRN') throw new DiadocError('Транспортная накладная не найдена', 404)
  return doc
}

/** Черновик данных ЭТрН: сохранённый ввод логиста или собранное из заявки, экипажа и справочников */
export async function etrnDraft(docId: string): Promise<EtrnT1Input> {
  const doc = await loadEtrnDoc(docId)
  if (doc.etrnInput) {
    try { return JSON.parse(doc.etrnInput) as EtrnT1Input } catch { /* соберём заново */ }
  }
  const trip = doc.request
  const [driver, truck, trailer] = await Promise.all([
    trip.driverId ? db.driver.findUnique({ where: { id: trip.driverId } }) : null,
    trip.truckId ? db.truck.findUnique({ where: { id: trip.truckId } }) : null,
    trip.trailerId ? db.trailer.findUnique({ where: { id: trip.trailerId } }) : null,
  ])
  const fio = splitFio(dash(driver?.fullName))
  const lic = splitLicense(dash(driver?.license))
  const stated = statedArrival(trip.loadDate, trip.loadWindow)
  const vehicle = (v: { plate: string; sts: string; ownershipType: string } | null, type: string, model: string, vin: string): EtrnVehicle | null =>
    v ? {
      number: dash(v.plate).replace(/\s+/g, '').toUpperCase(),
      ownership: OWNERSHIP_CODE[v.ownershipType] ?? '1',
      type, model, maxWeight: '', capacity: '', sts: dash(v.sts), vin,
    } : null
  return {
    number: doc.number,
    date: ruDate(new Date()),
    orderNumber: trip.number,
    orderDate: ruDate(trip.createdAt),
    consignee: { inn: '', kpp: '', name: '', phone: '' },
    delivery: parseRuAddress(pointInfo(trip.toPoint).address),
    cargo: {
      name: trip.cargo,
      condition: 'Без повреждений',
      packageMethod: 'Пачки',
      containerType: '00',
      places: '1',
      grossWeightKg: String(Math.round(trip.tonnage * 1000)),
      marks: '',
    },
    carrierPhone: dash(trip.winner?.phone),
    driver: { ...fio, licenseSeries: lic.series, licenseNumber: lic.number, phone: dash(driver?.phone) },
    vehicle: vehicle(truck, 'Тягач седельный', dash(truck?.brand), dash(truck?.vin)) ?? {
      number: '', ownership: '1', type: 'Тягач седельный', model: '', maxWeight: '', capacity: '', sts: '', vin: '',
    },
    trailer: vehicle(trailer, dash(trailer?.type) || 'Полуприцеп', '', ''),
    loading: {
      statedArrival: stated,
      actualArrival: stated,
      actualDeparture: mskDateTime(new Date()),
      weighingMethod: '01',
    },
  }
}

/** Отправка титула Т1 перевозчику. Возвращает текст для уведомления логиста */
export async function sendEtrnT1(docId: string, input: EtrnT1Input, actor: { login: string; name: string; role: string }): Promise<string> {
  const doc = await loadEtrnDoc(docId)
  const trip = doc.request
  if (trip.status !== 'CONFIRMED') throw new DiadocError('ЭТрН отправляется по рейсу в работе', 400)
  if (doc.diadocMessageId) throw new DiadocError('Титул Т1 уже отправлен в Диадок — следите за статусом', 409)
  const carrier = trip.winner
  if (!carrier) throw new DiadocError('У рейса нет перевозчика', 400)

  const sh = shipperSettings()
  const errors = validateT1Input(input, { loader: sh.loader, signer: sh.signer, shipperPhone: sh.phone })
  if (errors.length) throw new DiadocError(`Проверьте данные ЭТрН: ${errors.join('; ')}`, 400)

  // ящики: свой — из настроек, перевозчика и грузополучателя — по ИНН (КПП)
  const box = await myBox()
  const orgs = await getMyOrganizations()
  const myOrg = orgs.find((o) => o.Boxes?.some((b) => (b.BoxIdGuid ?? '').toLowerCase() === box.boxId.toLowerCase())) ?? orgs[0]
  if (!myOrg?.Inn) throw new DiadocError('Не удалось получить ИНН организации АЭМЗ из Диадока', 502)

  let carrierBoxId = carrier.diadocBoxId
  if (!carrierBoxId) {
    const found = await findBoxByInn(carrier.inn, carrier.kpp)
    if (!found) {
      throw new DiadocError(`Перевозчик «${carrier.name}» (ИНН ${carrier.inn}) не найден в Диадоке — ЭТрН ему не отправить. Нужен ящик в Диадоке или роуминг с его оператором ЭДО`, 400)
    }
    carrierBoxId = found.boxId
    await db.carrier.update({ where: { id: carrier.id }, data: { diadocBoxId: carrierBoxId } })
  }
  const consignee = await findBoxByInn(input.consignee.inn, input.consignee.kpp)
  if (!consignee) throw new DiadocError(`Грузополучатель с ИНН ${input.consignee.inn} не найден в Диадоке`, 400)

  const userXml = buildT1UserXml(input, {
    shipperBoxId: box.boxId,
    shipperInn: myOrg.Inn,
    shipperPhone: sh.phone,
    consigneeBoxId: consignee.boxId,
    carrierBoxId,
    loadingAddress: sh.loading,
    loader: sh.loader,
    signer: sh.signer,
  })
  const generated = await generateTitleXml({ boxId: box.boxId, ...ETRN_TYPE, userXml })

  const mode = signMode()
  const message = await postMessage(box.boxId, carrierBoxId, {
    typeNamedId: ETRN_TYPE.typeNamedId,
    func: ETRN_TYPE.func,
    version: ETRN_TYPE.version,
    content: generated.content,
    testSignature: mode === 'test',
    delaySend: mode === 'delay',
    customDocumentId: `${trip.number}/${doc.number}`,
  }, `etrn-t1-${doc.id}`)
  const t1 = (message.Entities ?? []).find((e) => e.EntityType === 'Attachment' && !e.ParentEntityId)

  const now = new Date()
  const stage = mode === 'test' ? 'platform-sent' : 'platform-delay-send'
  await db.edoDocument.update({
    where: { id: doc.id },
    data: {
      diadocBoxId: box.boxId,
      diadocMessageId: message.MessageId,
      diadocEntityId: t1?.EntityId ?? null,
      diadocStage: stage,
      diadocSentAt: now,
      diadocSyncedAt: now,
      gisError: null,
      etrnInput: JSON.stringify(input),
      // тестовая подпись ставится сразу; при отложенной — когда логист подпишет в Диадоке
      ...(mode === 'test' ? { aemzSigned: true, aemzSignedAt: now, aemzSigner: `${actor.name} · тестовая подпись Диадока` } : {}),
    },
  })
  await db.request.update({ where: { id: trip.id }, data: { etrnStatus: 'SENT' } })
  await db.event.create({
    data: { requestId: trip.id, type: 'EDO_SIGNED_AEMZ', message: `${etrnLabel(doc.number)}: титул Т1 ${mode === 'test' ? 'подписан и отправлен перевозчику' : 'создан в Диадоке — ждёт подписи АЭМЗ'} (${diadocStandLabel()})` },
  })
  await plog({
    type: 'DIADOC_SENT', source: 'diadoc/etrn',
    actor, requestId: trip.id, requestNumber: trip.number, carrierName: carrier.name,
    message: `${etrnLabel(doc.number)}: титул Т1 ${mode === 'test' ? 'отправлен перевозчику (тестовая подпись)' : 'создан для подписи в Диадоке'} — №${trip.number}`,
    meta: { messageId: message.MessageId, entityId: t1?.EntityId ?? null, fileName: generated.fileName },
  })
  if (mode === 'test') {
    await notifyCarrier(carrier.id, {
      type: 'EDO_SIGNED',
      title: `${etrnLabel(doc.number)} ждёт подписи · №${trip.number}`,
      body: 'Подпишите титул перевозчика Т2 в своём Диадоке — платформа увидит подпись автоматически',
      requestId: trip.id,
    })
  }
  notifyLive({ type: 'EDO_SIGNED', requestId: trip.id })
  return mode === 'test'
    ? `Т1 подписан тестовой подписью и отправлен перевозчику «${carrier.name}»`
    : 'Т1 создан в исходящих Диадока — подпишите его своей КЭП в веб-интерфейсе Диадока'
}

// ——— сверка статусов ———

type EtrnDocRow = Awaited<ReturnType<typeof db.edoDocument.findMany>>[number]

interface Patch {
  diadocStage?: string
  etrnUid?: string
  gisStatus?: string
  gisError?: string | null
  aemzSigned?: boolean
  partySigned?: boolean
}

const customValue = (e: DdEntity, key: string): string | undefined =>
  e.DocumentInfo?.CustomData?.find((c) => c.Key === key)?.Value || undefined

/** Что нового в сущностях сообщения Т1/Т2 для документа платформы */
function readEntities(doc: EtrnDocRow, entities: DdEntity[]): Patch {
  const p: Patch = {}
  for (const e of entities) {
    const stage = customValue(e, 'kl-status')
    if (stage) p.diadocStage = stage
    const uid = customValue(e, 'mt-id')
    if (uid) p.etrnUid = uid
    // статус обработки в ГИС ЭПД
    const od = e.OuterDocflow
    if (e.AttachmentType === 'OuterDocflow' && od?.DocflowNamedId === 'KlMt' && od.Status) {
      const fromDetails = od.Status.Details?.find((d) => d.Code === 'mt-id')?.Text
      if (fromDetails) p.etrnUid = fromDetails
      const text = od.Status.FriendlyName || od.Status.Description || od.Status.NamedId || ''
      if (od.Status.Type === 'Error') {
        const details = (od.Status.Details ?? []).filter((d) => d.Code !== 'mt-id').map((d) => [d.Code, d.Text].filter(Boolean).join(': '))
        p.gisError = [text, ...details].filter(Boolean).join(' · ') || 'ГИС ЭПД отклонила документ'
      } else if (text) {
        p.gisStatus = text
        p.gisError = null
      }
    }
    // подпись АЭМЗ под Т1 (при отложенной отправке появляется после подписи в Диадоке)
    if (e.EntityType === 'Signature' && doc.diadocEntityId && e.ParentEntityId === doc.diadocEntityId) p.aemzSigned = true
    // отказ перевозчика подписать Т2
    if (/Rejection/i.test(e.AttachmentType ?? '') && e.ParentEntityId === doc.diadocEntityId) p.diadocStage = 'r-rejected'
  }
  // титул Т2 перевозчика и его подпись
  const t2 = entities.find((e) => e.AttachmentType === 'Title' && /_t2_/i.test(e.ContentTypeId ?? ''))
  if (t2?.EntityId && entities.some((e) => e.EntityType === 'Signature' && e.ParentEntityId === t2.EntityId)) p.partySigned = true
  return p
}

/** Применить изменения к документу: запись в базу, события рейса и уведомления */
async function applyPatch(doc: EtrnDocRow & { request: { id: string; number: string; winnerId: string | null } }, p: Patch): Promise<boolean> {
  const now = new Date()
  const data: Record<string, unknown> = { diadocSyncedAt: now }
  const notes: string[] = []
  if (p.diadocStage && p.diadocStage !== doc.diadocStage) {
    data.diadocStage = p.diadocStage
    notes.push(etrnStageLabel(p.diadocStage))
  }
  if (p.etrnUid && p.etrnUid !== doc.etrnUid) {
    data.etrnUid = p.etrnUid
    notes.push(`ГИС ЭПД присвоила УИД ТрН ${p.etrnUid}`)
  }
  if (p.gisStatus && p.gisStatus !== doc.gisStatus) data.gisStatus = p.gisStatus
  if (p.gisError !== undefined && p.gisError !== doc.gisError) {
    data.gisError = p.gisError
    if (p.gisError) notes.push(`Ошибка ГИС ЭПД: ${p.gisError}`)
  }
  if (p.aemzSigned && !doc.aemzSigned) {
    Object.assign(data, { aemzSigned: true, aemzSignedAt: now, aemzSigner: 'КЭП АЭМЗ · подписано в Диадоке' })
    notes.push('АЭМЗ подписало титул Т1 в Диадоке')
  }
  if (p.partySigned && !doc.partySigned) {
    Object.assign(data, { partySigned: true, partySignedAt: now, partySigner: 'КЭП перевозчика · титул Т2 в Диадоке' })
    notes.push('Перевозчик подписал титул Т2 — груз принят к перевозке')
  }
  const changed = notes.length > 0 || Object.keys(data).some((k) => k !== 'diadocSyncedAt')
  await db.edoDocument.update({ where: { id: doc.id }, data })
  // в одной сверке документ обновляется дважды (сообщение Т1 и лента) — держим строку актуальной
  Object.assign(doc as Record<string, unknown>, data)
  if (!changed) return false

  const stage = (data.diadocStage as string | undefined) ?? doc.diadocStage
  if (stage === 'completed') await db.request.update({ where: { id: doc.request.id }, data: { etrnStatus: 'SIGNED' } })
  for (const n of notes) {
    await db.event.create({ data: { requestId: doc.request.id, type: 'EDO_SIGNED_PARTY', message: `${etrnLabel(doc.number)}: ${n}` } })
  }
  await plog({
    level: data.gisError ? 'ERROR' : 'INFO',
    type: data.gisError ? 'DIADOC_ERROR' : 'DIADOC_STATUS',
    source: 'diadoc/sync',
    requestId: doc.request.id, requestNumber: doc.request.number,
    message: `${etrnLabel(doc.number)} (№${doc.request.number}): ${notes.join('; ') || 'статус обновлён'}`,
  })
  if (p.partySigned && !doc.partySigned) {
    await notifyLogists({ type: 'EDO_SIGNED', title: `Перевозчик подписал ЭТрН · №${doc.request.number}`, body: 'Титул Т2 подписан в Диадоке — груз принят к перевозке', requestId: doc.request.id })
  }
  if (data.gisError) {
    await notifyLogists({ type: 'EDO_SIGNED', title: `Ошибка ЭТрН в ГИС ЭПД · №${doc.request.number}`, body: String(data.gisError).slice(0, 300), requestId: doc.request.id })
  }
  notifyLive({ type: 'EDO_SIGNED', requestId: doc.request.id })
  return true
}

let syncRunning: Promise<{ checked: number; changed: number }> | null = null

/** Сверка всех отправленных ЭТрН с Диадоком. Параллельные вызовы ждут одной сверки */
export function syncDiadoc(): Promise<{ checked: number; changed: number }> {
  if (!diadocEnabled()) return Promise.resolve({ checked: 0, changed: 0 })
  syncRunning ??= runSync().finally(() => { syncRunning = null })
  return syncRunning
}

async function runSync(): Promise<{ checked: number; changed: number }> {
  let checked = 0
  let changed = 0
  try {
    const docs = await db.edoDocument.findMany({
      where: { kind: 'ETRN', diadocMessageId: { not: null } },
      include: { request: { select: { id: true, number: true, winnerId: true } } },
    })
    const open = docs.filter((d) => !etrnStageFinal(d.diadocStage))
    // 1. сообщение Т1/Т2: подписи, теги kl-status/mt-id, статусы ГИС ЭПД
    for (const doc of open) {
      checked += 1
      const msg = await getMessage(doc.diadocBoxId!, doc.diadocMessageId!)
      if (await applyPatch(doc, readEntities(doc, msg.Entities ?? []))) changed += 1
    }
    // 2. лента событий ящика АЭМЗ: пересланные титулы Т3/Т4 приходят отдельным сообщением с тем же УИД
    if (open.length > 0) {
      const box = await myBox()
      const state = await db.diadocState.findUnique({ where: { id: 'main' } })
      let key = state?.eventsIndexKey ?? null
      const byUid = new Map(open.filter((d) => d.etrnUid).map((d) => [d.etrnUid!, d]))
      for (let page = 0; page < 10; page++) {
        const { events } = await getNewEvents(box.boxId, key, ETRN_TYPE.typeNamedId)
        for (const ev of events) {
          const entities = ev.Message?.Entities ?? ev.Patch?.Entities ?? []
          for (const e of entities) {
            const uid = customValue(e, 'mt-id')
            const doc = uid ? byUid.get(uid) : undefined
            if (!doc || customValue(e, 'kl-func') !== 'delivery') continue
            const stage = customValue(e, 'kl-status') ?? 'platform-delivery'
            if (await applyPatch(doc, { diadocStage: stage })) changed += 1
            doc.diadocStage = stage
          }
          if (ev.IndexKey) key = ev.IndexKey
        }
        if (events.length < 500) break
      }
      await db.diadocState.upsert({
        where: { id: 'main' },
        create: { id: 'main', eventsIndexKey: key, lastSyncAt: new Date(), lastError: null },
        update: { eventsIndexKey: key, lastSyncAt: new Date(), lastError: null },
      })
    } else {
      await db.diadocState.upsert({
        where: { id: 'main' },
        create: { id: 'main', lastSyncAt: new Date(), lastError: null },
        update: { lastSyncAt: new Date(), lastError: null },
      })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.diadocState.upsert({
      where: { id: 'main' },
      create: { id: 'main', lastSyncAt: new Date(), lastError: message.slice(0, 1000) },
      update: { lastSyncAt: new Date(), lastError: message.slice(0, 1000) },
    })
    throw e
  }
  return { checked, changed }
}

/** Состояние интеграции для интерфейса */
export async function diadocInfo(): Promise<{ enabled: boolean; stand: string; signMode: SignMode; lastSyncAt: string | null; lastError: string | null }> {
  if (!diadocEnabled()) return { enabled: false, stand: '', signMode: 'test', lastSyncAt: null, lastError: null }
  const state = await db.diadocState.findUnique({ where: { id: 'main' } })
  return {
    enabled: true,
    stand: diadocStandLabel(),
    signMode: signMode(),
    lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
  }
}

/**
 * ЭДО рейса (Task 76, раздел «Подписать ЭДО») — серверная сторона.
 *
 * Документы зависят от того, кто исполняет рейс (роль компании в справочнике):
 *  — перевозчик (перевозит сам): «Заказ (заявка) на перевозку груза» — договорной
 *    документ АЭМЗ и перевозчика;
 *  — экспедитор (организует перевозку): «Поручение экспедитору» по договору
 *    транспортной экспедиции. Перевозчика экспедитор нанимает сам; доверенность
 *    на водителя выдаёт экспедитор или перевозчик — не АЭМЗ, поэтому платформа
 *    доверенность не формирует.
 * Дальше у обоих одинаково: транспортная накладная (ЭТрН — при подтверждении
 * рейса, через Диадок, если он подключён) и акт оказанных услуг (после закрытия).
 * Все документы добираются автоматически — логист только подписывает.
 *
 * Подписание: aemz* — КЭП АЭМЗ, party* — КЭП исполнителя (перевозчика или
 * экспедитора) через оператора ЭДО. Реквизиты для рендера скана — в payload (JSON).
 */
import { db } from '@/lib/db'

/** POA — доверенность от АЭМЗ: больше не формируется, старые записи скрыты из раздела */
export type EdoKind = 'POA' | 'ORDER' | 'ETRN' | 'ACT'
export type EdoParty = 'EXPEDITOR' | 'CARRIER'

/** Сторона договорного документа по роли исполнителя рейса */
export const partyOfRole = (role: string | null | undefined): EdoParty => (role === 'FORWARDER' ? 'EXPEDITOR' : 'CARRIER')

export interface EdoDocPayload {
  title: string
  dateRu: string
  org: string
  lines: string[]
  validTill?: string
  driverName: string
  carrierName: string
  accent: string
}

export const EDO_KIND_META: Record<EdoKind, { title: string; party: EdoParty; accent: string }> = {
  POA: { title: 'Доверенность экспедитору', party: 'EXPEDITOR', accent: '#3f6212' },
  ORDER: { title: 'Заказ (заявка) на перевозку груза', party: 'CARRIER', accent: '#0e7490' },
  ETRN: { title: 'Транспортная накладная (ЭТрН)', party: 'CARRIER', accent: '#9a3412' },
  ACT: { title: 'Акт оказанных услуг', party: 'CARRIER', accent: '#4c1d95' },
}

export const EDO_PARTY_ROLE: Record<EdoParty, string> = {
  EXPEDITOR: 'Экспедитор',
  CARRIER: 'Перевозчик',
}

/** Название документа: договорной документ зависит от стороны — заказ-заявка или поручение */
export function edoTitle(kind: EdoKind, party: string): string {
  if (kind === 'ORDER' && party === 'EXPEDITOR') return 'Поручение экспедитору'
  return EDO_KIND_META[kind].title
}

export const AEMZ_ORG = 'ООО «АЭМЗ» (грузоотправитель)'

const ruDate = (d: Date): string =>
  d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Порядковый номер заявки без префикса Z- — база номеров документов ЭДО */
export const edoSeqOf = (requestNumber: string): string => requestNumber.replace(/^Z-/, '')

/** Номер документа ЭДО: договорной — ЗАК (заказ-заявка) или ПОР (поручение экспедитору) */
export function edoDocNumber(kind: EdoKind, requestNumber: string, party: EdoParty = EDO_KIND_META[kind].party): string {
  const seq = edoSeqOf(requestNumber)
  switch (kind) {
    case 'POA': return `ДОВ-${seq}`
    case 'ORDER': return party === 'EXPEDITOR' ? `ПОР-${seq}` : `ЗАК-${seq}`
    case 'ETRN': return `ЭТрН ${seq}`
    case 'ACT': return `АКТ-${seq}`
  }
}

/** Реквизиты документа для рендера скана (клиент рисует по ним SVG) */
export function buildEdoPayload(
  kind: EdoKind,
  request: {
    number: string
    fromPoint: string
    toPoint: string
    cargo: string
    tonnage: number
    loadDate: string
    startRate: number
    bestRate: number | null
  },
  party: { carrierName: string; driverName: string; truckLabel: string; role?: EdoParty },
  issuedAt: Date,
): EdoDocPayload {
  const meta = EDO_KIND_META[kind]
  const fmtRate = (v: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽/т`
  const rate = request.bestRate ?? request.startRate
  const common = [
    `Груз: ${request.cargo}, ${new Intl.NumberFormat('ru-RU').format(request.tonnage)} т`,
    `Маршрут: ${request.fromPoint} → ${request.toPoint}`,
    `Дата погрузки: ${request.loadDate}`,
  ]
  switch (kind) {
    case 'POA':
      return {
        title: meta.title,
        dateRu: ruDate(issuedAt),
        org: AEMZ_ORG,
        lines: [
          `Выдано: ${party.carrierName} (экспедитор)`,
          `Представитель: ${party.driverName}, водитель-экспедитор`,
          ...common,
          'Полномочия: приём груза на складе АЭМЗ, оформление ТН, передача груза перевозчику',
        ],
        validTill: ruDate(new Date(issuedAt.getTime() + 15 * 24 * 3600_000)),
        driverName: party.driverName,
        carrierName: party.carrierName,
        accent: meta.accent,
      }
    case 'ORDER':
      return party.role === 'EXPEDITOR'
        ? {
          title: edoTitle('ORDER', 'EXPEDITOR'),
          dateRu: ruDate(issuedAt),
          org: AEMZ_ORG,
          lines: [
            `Экспедитору: ${party.carrierName}`,
            `По заявке №${request.number} — организация перевозки груза`,
            ...common,
            'Услуги: подбор перевозчика, приём и доставка груза, оформление перевозочных документов',
            `Вознаграждение: по договору транспортной экспедиции (ставка ${fmtRate(rate)})`,
          ],
          driverName: party.driverName,
          carrierName: party.carrierName,
          accent: meta.accent,
        }
        : {
          title: edoTitle('ORDER', 'CARRIER'),
          dateRu: ruDate(issuedAt),
          org: AEMZ_ORG,
          lines: [
            `Перевозчику: ${party.carrierName}`,
            `По заявке №${request.number} — перевозка груза`,
            ...common,
            `Водитель: ${party.driverName}`,
            `ТС: ${party.truckLabel}`,
            `Ставка: ${fmtRate(rate)} — по договору перевозки`,
          ],
          driverName: party.driverName,
          carrierName: party.carrierName,
          accent: meta.accent,
        }
    case 'ETRN':
      return {
        title: meta.title,
        dateRu: ruDate(issuedAt),
        org: AEMZ_ORG,
        lines: [
          `Перевозчик: ${party.carrierName}`,
          `Водитель: ${party.driverName}`,
          `ТС: ${party.truckLabel}`,
          ...common,
          'ЭТП: ГИС ЭПД · оператор ЭДО · подписи КЭП сторон',
        ],
        driverName: party.driverName,
        carrierName: party.carrierName,
        accent: meta.accent,
      }
    case 'ACT':
      return {
        title: meta.title,
        dateRu: ruDate(issuedAt),
        org: AEMZ_ORG,
        lines: [
          `По заявке №${request.number}`,
          `Перевозчик: ${party.carrierName}`,
          ...common,
          `Ставка: ${fmtRate(rate)}`,
          'Услуги выполнены в полном объёме, стороны претензий не имеют',
        ],
        driverName: party.driverName,
        carrierName: party.carrierName,
        accent: meta.accent,
      }
  }
}

interface TripWithRels {
  id: string
  number: string
  status: string
  fromPoint: string
  toPoint: string
  cargo: string
  tonnage: number
  loadDate: string
  startRate: number
  bestRate: number | null
  winnerId: string | null
  winner: { name: string; role: string } | null
  driverId: string | null
  truckId: string | null
  edoDocuments: {
    id: string
    kind: string
    party: string
    number: string
    payload: string
    aemzSigned: boolean
    aemzSignedAt: Date | null
    aemzSigner: string | null
    partySigned: boolean
    partySignedAt: Date | null
    partySigner: string | null
  }[]
}

/**
 * Добор недостающих документов ЭДО (идемпотентно, при чтении):
 *  — договорной документ по роли исполнителя: заказ-заявка перевозчику или
 *    поручение экспедитору (у закрытого рейса — подписан обеими сторонами);
 *  — ЭТрН у каждого рейса в работе/закрытого (у закрытого — подписана обеими сторонами);
 *  — акт оказанных услуг у закрытого рейса.
 */
export function ensureEdoDocuments(trips: TripWithRels[]): Promise<void> {
  // добор идёт строго по очереди: две одновременные загрузки раздела иначе обе
  // увидят «документа нет» и создадут его дважды
  const run = ensureQueue.then(() => ensureEdoDocumentsNow(trips))
  ensureQueue = run.catch(() => undefined)
  return run
}

let ensureQueue: Promise<void> = Promise.resolve()

async function ensureEdoDocumentsNow(trips: TripWithRels[]): Promise<void> {
  // список документов мог устареть, пока запрос ждал очереди — перечитываем
  const fresh = await db.edoDocument.findMany({
    where: { requestId: { in: trips.map((t) => t.id) } },
    orderBy: { createdAt: 'asc' },
  })
  trips = trips.map((t) => ({ ...t, edoDocuments: fresh.filter((d) => d.requestId === t.id) }))
  const driverIds = trips.map((t) => t.driverId).filter((v): v is string => Boolean(v))
  const truckIds = trips.map((t) => t.truckId).filter((v): v is string => Boolean(v))
  const drivers = driverIds.length ? await db.driver.findMany({ where: { id: { in: driverIds } } }) : []
  const trucks = truckIds.length ? await db.truck.findMany({ where: { id: { in: truckIds } } }) : []
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const truckById = new Map(trucks.map((t) => [t.id, t]))

  const now = new Date()
  for (const trip of trips) {
    const role = partyOfRole(trip.winner?.role)
    // роль исполнителя сменили в справочнике, а договорной документ ещё не подписан —
    // переоформляем его под новую роль (заказ-заявка ↔ поручение экспедитору)
    const staleOrder = trip.edoDocuments.find((d) => d.kind === 'ORDER' && d.party !== role && !d.aemzSigned && !d.partySigned)
    if (staleOrder) {
      const driver = trip.driverId ? driverById.get(trip.driverId) : undefined
      const truck = trip.truckId ? truckById.get(trip.truckId) : undefined
      const payload = buildEdoPayload('ORDER', trip, {
        carrierName: trip.winner?.name ?? '—', driverName: driver?.fullName ?? '—',
        truckLabel: truck ? `${truck.brand} · ${truck.plate}` : '—', role,
      }, now)
      await db.edoDocument.update({
        where: { id: staleOrder.id },
        data: { party: role, number: edoDocNumber('ORDER', trip.number, role), payload: JSON.stringify(payload) },
      })
    }
    const have = new Set(trip.edoDocuments.map((d) => d.kind))
    const missing: { kind: EdoKind; bothSigned?: boolean }[] = []
    if (!have.has('ORDER')) missing.push({ kind: 'ORDER', bothSigned: trip.status === 'CLOSED' })
    if (!have.has('ETRN')) missing.push({ kind: 'ETRN', bothSigned: trip.status === 'CLOSED' })
    if (trip.status === 'CLOSED' && !have.has('ACT')) missing.push({ kind: 'ACT' })
    if (missing.length === 0) continue

    const driver = trip.driverId ? driverById.get(trip.driverId) : undefined
    const truck = trip.truckId ? truckById.get(trip.truckId) : undefined
    const carrierName = trip.winner?.name ?? '—'
    const driverName = driver?.fullName ?? '—'
    const truckLabel = truck ? `${truck.brand} · ${truck.plate}` : '—'

    for (const m of missing) {
      const party = m.kind === 'ORDER' ? role : EDO_KIND_META[m.kind].party
      const payload = buildEdoPayload(m.kind, trip, { carrierName, driverName, truckLabel, role }, now)
      await db.edoDocument.create({
        data: {
          requestId: trip.id,
          kind: m.kind,
          party,
          number: edoDocNumber(m.kind, trip.number, party),
          payload: JSON.stringify(payload),
          aemzSigned: m.bothSigned ?? false,
          partySigned: m.bothSigned ?? false,
          ...(m.bothSigned
            ? { aemzSignedAt: now, partySignedAt: now, aemzSigner: 'КЭП АЭМЗ', partySigner: party === 'EXPEDITOR' ? 'КЭП экспедитора' : 'КЭП перевозчика' }
            : {}),
        },
      })
    }
  }
}

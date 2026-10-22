/**
 * ЭДО рейса (Task 76, раздел «Подписать ЭДО») — серверная сторона.
 *
 * Наш случай — цепочка АЭМЗ (грузоотправитель) → экспедитор → перевозчик.
 * Экспедитором выступает компания-победитель в роли организатора доставки,
 * её представитель (водитель-экспедитор) подписывает экспедиторские документы.
 *
 * Комплекты документов каждого рейса:
 *  — «Комплект экспедитора» — Доверенность (POA) + Поручение экспедитору (ORDER).
 *    По правилам транспортно-экспедиционной деятельности эти документы создаёт
 *    грузоотправитель (АЭМЗ) — в платформе это кнопка логиста «Сформировать».
 *  — «Комплект перевозчика» — Транспортная накладная / ЭТрН (ETRN, создаётся
 *    автоматически при подтверждении рейса) + Акт оказанных услуг (ACT,
 *    создаётся после закрытия рейса).
 *
 * Подписание: aemz* — КЭП логиста АЭМЗ, party* — подпись контрагента
 * (экспедитора или перевозчика) через ЭДО-оператора. Реквизиты для рендера
 * скана хранятся в payload (JSON), сам скан рисует клиент.
 */
import { db } from '@/lib/db'

export type EdoKind = 'POA' | 'ORDER' | 'ETRN' | 'ACT'
export type EdoParty = 'EXPEDITOR' | 'CARRIER'

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
  ORDER: { title: 'Поручение экспедитору', party: 'EXPEDITOR', accent: '#0e7490' },
  ETRN: { title: 'Транспортная накладная (ЭТрН)', party: 'CARRIER', accent: '#9a3412' },
  ACT: { title: 'Акт оказанных услуг', party: 'CARRIER', accent: '#4c1d95' },
}

export const EDO_PARTY_ROLE: Record<EdoParty, string> = {
  EXPEDITOR: 'Экспедитор',
  CARRIER: 'Перевозчик',
}

export const AEMZ_ORG = 'АО «АЭМЗ» (грузоотправитель)'

const ruDate = (d: Date): string =>
  d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Порядковый номер заявки без префикса Z- — база номеров документов ЭДО */
export const edoSeqOf = (requestNumber: string): string => requestNumber.replace(/^Z-/, '')

export function edoDocNumber(kind: EdoKind, requestNumber: string): string {
  const seq = edoSeqOf(requestNumber)
  switch (kind) {
    case 'POA': return `ДОВ-${seq}`
    case 'ORDER': return `ПОР-${seq}`
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
  party: { carrierName: string; driverName: string; truckLabel: string },
  issuedAt: Date,
): EdoDocPayload {
  const meta = EDO_KIND_META[kind]
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
      return {
        title: meta.title,
        dateRu: ruDate(issuedAt),
        org: AEMZ_ORG,
        lines: [
          `Экспедитору: ${party.carrierName}`,
          `По заявке №${request.number} — организация доставки`,
          ...common,
          'Услуги: приём груза, передача перевозчику, оформление транспортных документов',
          `Вознаграждение: по договору транспортной экспедиции (ставка ${new Intl.NumberFormat('ru-RU').format(Math.round(rate))} ₽/т)`,
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
          `Ставка: ${new Intl.NumberFormat('ru-RU').format(Math.round(rate))} ₽/т`,
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
  winner: { name: string } | null
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
 * Добор недостающих базовых документов ЭДО (идемпотентно, при чтении):
 *  — ЭТрН у каждого рейса в работе/закрытого (у закрытого — подписана обеими сторонами);
 *  — Акт оказанных услуг у закрытого рейса.
 * Комплект экспедитора (POA/ORDER) НЕ создаётся автоматически: его формирует
 * логист — это обязанность АЭМЗ перед экспедитором.
 */
export async function ensureEdoDocuments(trips: TripWithRels[]): Promise<void> {
  const driverIds = trips.map((t) => t.driverId).filter((v): v is string => Boolean(v))
  const truckIds = trips.map((t) => t.truckId).filter((v): v is string => Boolean(v))
  const drivers = driverIds.length ? await db.driver.findMany({ where: { id: { in: driverIds } } }) : []
  const trucks = truckIds.length ? await db.truck.findMany({ where: { id: { in: truckIds } } }) : []
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const truckById = new Map(trucks.map((t) => [t.id, t]))

  const now = new Date()
  for (const trip of trips) {
    const have = new Set(trip.edoDocuments.map((d) => d.kind))
    const missing: { kind: EdoKind; bothSigned?: boolean }[] = []
    if (!have.has('ETRN')) missing.push({ kind: 'ETRN', bothSigned: trip.status === 'CLOSED' })
    if (trip.status === 'CLOSED' && !have.has('ACT')) missing.push({ kind: 'ACT' })
    if (missing.length === 0) continue

    const driver = trip.driverId ? driverById.get(trip.driverId) : undefined
    const truck = trip.truckId ? truckById.get(trip.truckId) : undefined
    const carrierName = trip.winner?.name ?? '—'
    const driverName = driver?.fullName ?? '—'
    const truckLabel = truck ? `${truck.brand} · ${truck.plate}` : '—'

    for (const m of missing) {
      const payload = buildEdoPayload(m.kind, trip, { carrierName, driverName, truckLabel }, now)
      await db.edoDocument.create({
        data: {
          requestId: trip.id,
          kind: m.kind,
          party: EDO_KIND_META[m.kind].party,
          number: edoDocNumber(m.kind, trip.number),
          payload: JSON.stringify(payload),
          aemzSigned: m.bothSigned ?? false,
          partySigned: m.bothSigned ?? false,
          ...(m.bothSigned
            ? { aemzSignedAt: now, partySignedAt: now, aemzSigner: 'КЭП АЭМЗ', partySigner: 'КЭП перевозчика' }
            : {}),
        },
      })
    }
  }
}

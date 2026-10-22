/**
 * Сериализация Prisma-моделей в DTO для клиента.
 *
 * Что видит перевозчик, решает сервер, а не интерфейс (раньше API отдавал всё,
 * а скрывал только экран):
 *  — ставки: только свои; в закрытых торгах лучшая ставка и число ставок скрыты до итогов;
 *  — имя победителя: только если победил он сам;
 *  — документы и экипаж: только по своим выигранным рейсам;
 *  — журнал: свои события и общие (публикация, продление, повышение ставки).
 * Сами файлы документов в списки не попадают — только ссылка /api/files/... с проверкой прав.
 */
import type {
  Carrier, CargoType, Driver, Event, Prisma, Trailer, Truck,
} from '@prisma/client'
import type { Viewer } from '@/lib/auth'
import type {
  CargoTypeDTO, CarrierDTO, DocumentDTO, DriverDTO, RequestDTO, TrailerDTO, TruckDTO,
} from '@/lib/types'

/** Поля документа без самого файла (dataUri тяжёлый — читается только в /api/files) */
export const DOC_SELECT = {
  id: true, requestId: true, type: true, fileName: true, status: true, quality: true, engine: true,
  fields: true, confidence: true, issues: true, message: true, createdAt: true, updatedAt: true,
} satisfies Prisma.DocumentSelect

/** Единый include заявки для всех маршрутов, которые отдают RequestDTO */
export const REQUEST_INCLUDE = {
  bids: { include: { carrier: { select: { id: true, name: true } } } },
  documents: { select: DOC_SELECT },
  events: true,
  winner: { select: { id: true, name: true } },
  cargoType: true,
} satisfies Prisma.RequestInclude

export type RequestFull = Prisma.RequestGetPayload<{ include: typeof REQUEST_INCLUDE }>
type DocumentLite = Prisma.DocumentGetPayload<{ select: typeof DOC_SELECT }>

/** События, которые видят все перевозчики площадки */
const PUBLIC_EVENT_TYPES = new Set(['REQUEST_PUBLISHED', 'DEADLINE_EXTENDED', 'RATE_RAISED', 'AUCTION_FINISHED'])
/** События торгов: перевозчику — только собственные */
const BID_EVENT_TYPES = new Set(['BID_PLACED', 'BID_WITHDRAWN'])

/** Видит ли перевозчик событие (логист видит все) */
export function eventVisibleTo(
  e: Pick<Event, 'type' | 'carrierId'>,
  viewer: Viewer,
  winnerId: string | null,
): boolean {
  if (viewer.role === 'logist') return true
  const me = viewer.carrierId
  if (!me) return false
  if (e.carrierId) return e.carrierId === me
  if (PUBLIC_EVENT_TYPES.has(e.type)) return true
  if (BID_EVENT_TYPES.has(e.type)) return false // старые записи без carrierId — не раскрываем
  return winnerId === me // процесс по рейсу (документы, сверка, 1С) — только победителю
}

export function toCargoTypeDTO(c: CargoType & { _count?: { requests: number } }): CargoTypeDTO {
  return {
    id: c.id, name: c.name, category: c.category, truckType: c.truckType, dangerous: c.dangerous,
    usageCount: c._count?.requests ?? 0, createdAt: c.createdAt.toISOString(),
  }
}

export function toRequestDTO(r: RequestFull, viewer: Viewer): RequestDTO {
  const isLogist = viewer.role === 'logist'
  const me = viewer.carrierId
  const isWinner = !!me && r.winnerId === me
  // закрытые ставки: до итогов перевозчик не видит ни лучшую цену, ни число участников
  const sealed = !isLogist && r.mode === 'CLOSED' && r.status === 'PUBLISHED'
  const activeBids = r.bids.filter((b) => !b.withdrawn)
  const bestRate = sealed ? null : r.bestRate
  const savings = bestRate != null && bestRate < r.startRate ? r.startRate - bestRate : null
  const seesTrip = isLogist || isWinner

  return {
    id: r.id,
    number: r.number,
    fromPoint: r.fromPoint,
    toPoint: r.toPoint,
    cargo: r.cargo,
    cargoTypeId: r.cargoTypeId,
    cargoCategory: r.cargoType?.category ?? null,
    comment: r.comment,
    createdBy: r.createdBy,
    tonnage: r.tonnage,
    truckType: r.truckType,
    mode: r.mode as RequestDTO['mode'],
    startRate: r.startRate,
    bestRate,
    bidsCount: sealed ? null : activeBids.length,
    status: r.status as RequestDTO['status'],
    loadDate: r.loadDate,
    loadWindow: r.loadWindow,
    deadline: r.deadline ? r.deadline.toISOString() : null,
    winnerId: r.winnerId,
    winnerName: seesTrip ? r.winner?.name ?? null : null,
    driverId: seesTrip ? r.driverId : null,
    truckId: seesTrip ? r.truckId : null,
    trailerId: seesTrip ? r.trailerId : null,
    passPackage: r.passPackage,
    etrnStatus: r.etrnStatus,
    verifyComment: r.verifyComment,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    savings,
    bids: r.bids
      .filter((b) => isLogist || b.carrierId === me)
      .sort((a, b) => a.amount - b.amount || a.createdAt.getTime() - b.createdAt.getTime())
      .map((b) => ({ id: b.id, carrierId: b.carrierId, carrierName: b.carrier.name, amount: b.amount, isWinner: b.isWinner, withdrawn: b.withdrawn, createdAt: b.createdAt.toISOString() })),
    documents: seesTrip
      ? r.documents
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(toDocumentDTO)
      : [],
    events: r.events
      .filter((e) => eventVisibleTo(e, viewer, r.winnerId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
  }
}

const parseJson = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

export function toDocumentDTO(d: DocumentLite): DocumentDTO {
  return {
    id: d.id,
    type: d.type as DocumentDTO['type'],
    fileName: d.fileName,
    url: `/api/files/document/${d.id}`,
    status: d.status as DocumentDTO['status'],
    quality: d.quality,
    engine: d.engine,
    fields: parseJson(d.fields, null),
    confidence: parseJson(d.confidence, null),
    issues: parseJson(d.issues, []),
    message: d.message,
    createdAt: d.createdAt.toISOString(),
  }
}

const OWNERSHIP = new Set(['OWNED', 'HIRED', 'LEASE'])
/** принадлежность записи: незнакомое значение трактуем как собственный парк */
const ownership = (v: string) => (OWNERSHIP.has(v) ? (v as 'OWNED' | 'HIRED' | 'LEASE') : 'OWNED')

export function toDriverDTO(d: Driver): DriverDTO {
  return {
    id: d.id, carrierId: d.carrierId, fullName: d.fullName, birthDate: d.birthDate, passport: d.passport,
    license: d.license, licenseTill: d.licenseTill, categories: d.categories,
    phone: d.phone, birthPlace: d.birthPlace, citizenship: d.citizenship,
    passportIssuedBy: d.passportIssuedBy, passportIssuedDate: d.passportIssuedDate, position: d.position,
    ownershipType: ownership(d.ownershipType), ownerName: d.ownerName, leaseContract: d.leaseContract,
    createdAt: d.createdAt.toISOString(),
  }
}
export function toTruckDTO(t: Truck): TruckDTO {
  return {
    id: t.id, carrierId: t.carrierId, brand: t.brand, plate: t.plate, vin: t.vin, sts: t.sts,
    techTill: t.techTill, owner: t.owner, color: t.color,
    ownershipType: ownership(t.ownershipType), leaseContract: t.leaseContract,
    createdAt: t.createdAt.toISOString(),
  }
}
export function toTrailerDTO(t: Trailer): TrailerDTO {
  return {
    id: t.id, carrierId: t.carrierId, plate: t.plate, sts: t.sts, type: t.type,
    techTill: t.techTill, color: t.color, owner: t.owner,
    ownershipType: ownership(t.ownershipType), leaseContract: t.leaseContract,
    createdAt: t.createdAt.toISOString(),
  }
}
export function toCarrierDTO(
  c: Carrier & { drivers: Driver[]; trucks: Truck[]; trailers: Trailer[]; _count?: { wonRequests: number; bids: number } },
): CarrierDTO {
  return {
    id: c.id, name: c.name, inn: c.inn, contractNo: c.contractNo, contractDate: c.contractDate, access: c.access,
    drivers: c.drivers.map(toDriverDTO),
    trucks: c.trucks.map(toTruckDTO),
    trailers: c.trailers.map(toTrailerDTO),
    takenCount: c._count?.wonRequests ?? 0,
    bidsCount: c._count?.bids ?? 0,
  }
}

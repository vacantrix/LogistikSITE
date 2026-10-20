/** Сериализация Prisma-моделей в DTO для клиента */
import type {
  Carrier, Bid, CargoType, Document as PrismaDoc, Driver, Event, Request as PrismaRequest, Trailer, Truck,
} from '@prisma/client'
import type {
  BidDTO, CargoTypeDTO, CarrierDTO, DocumentDTO, DriverDTO, EventDTO, RequestDTO, TrailerDTO, TruckDTO,
} from '@/lib/types'

type RequestFull = PrismaRequest & {
  bids: (Bid & { carrier: Carrier })[]
  documents: PrismaDoc[]
  events: Event[]
  winner: Carrier | null
  cargoType: CargoType | null
}

export function toCargoTypeDTO(c: CargoType & { _count?: { requests: number } }): CargoTypeDTO {
  return {
    id: c.id, name: c.name, category: c.category, truckType: c.truckType, dangerous: c.dangerous,
    usageCount: c._count?.requests ?? 0, createdAt: c.createdAt.toISOString(),
  }
}

export function toRequestDTO(r: RequestFull): RequestDTO {
  const savings = r.bestRate != null && r.bestRate < r.startRate ? r.startRate - r.bestRate : null
  return {
    id: r.id,
    number: r.number,
    fromPoint: r.fromPoint,
    toPoint: r.toPoint,
    cargo: r.cargo,
    cargoTypeId: r.cargoTypeId,
    cargoCategory: r.cargoType?.category ?? null,
    tonnage: r.tonnage,
    truckType: r.truckType,
    mode: r.mode as RequestDTO['mode'],
    startRate: r.startRate,
    bestRate: r.bestRate,
    status: r.status as RequestDTO['status'],
    loadDate: r.loadDate,
    loadWindow: r.loadWindow,
    deadline: r.deadline ? r.deadline.toISOString() : null,
    winnerId: r.winnerId,
    winnerName: r.winner?.name ?? null,
    driverId: r.driverId,
    truckId: r.truckId,
    trailerId: r.trailerId,
    passPackage: r.passPackage,
    etrnStatus: r.etrnStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    savings,
    bids: r.bids
      .slice()
      .sort((a, b) => a.amount - b.amount)
      .map((b) => ({ id: b.id, carrierId: b.carrierId, carrierName: b.carrier.name, amount: b.amount, isWinner: b.isWinner, createdAt: b.createdAt.toISOString() })),
    documents: r.documents
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(toDocumentDTO),
    events: r.events
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
  }
}

export function toDocumentDTO(d: PrismaDoc): DocumentDTO {
  return {
    id: d.id,
    type: d.type as DocumentDTO['type'],
    fileName: d.fileName,
    dataUri: d.dataUri,
    status: d.status as DocumentDTO['status'],
    quality: d.quality,
    engine: d.engine,
    fields: d.fields ? JSON.parse(d.fields) : null,
    confidence: d.confidence ? JSON.parse(d.confidence) : null,
    issues: d.issues ? JSON.parse(d.issues) : [],
    message: d.message,
    createdAt: d.createdAt.toISOString(),
  }
}

export function toDriverDTO(d: Driver): DriverDTO {
  return {
    id: d.id, carrierId: d.carrierId, fullName: d.fullName, birthDate: d.birthDate, passport: d.passport,
    license: d.license, licenseTill: d.licenseTill, medTill: d.medTill, categories: d.categories,
    createdAt: d.createdAt.toISOString(),
  }
}
export function toTruckDTO(t: Truck): TruckDTO {
  return {
    id: t.id, carrierId: t.carrierId, brand: t.brand, plate: t.plate, vin: t.vin, sts: t.sts,
    techTill: t.techTill, owner: t.owner, createdAt: t.createdAt.toISOString(),
  }
}
export function toTrailerDTO(t: Trailer): TrailerDTO {
  return {
    id: t.id, carrierId: t.carrierId, plate: t.plate, sts: t.sts, type: t.type,
    techTill: t.techTill, createdAt: t.createdAt.toISOString(),
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

// Сериализация данных для UI рабочих мест
import type { TransportRequest, Contractor, Location, Vehicle, Trailer, Driver, Trip, TripPoint, TripEvent, PreTripInspection, PreTripStep } from '@prisma/client'
import { PRETRIP_STEP_IDS } from '@/lib/1c/statuses'

export type RequestRow = {
  id: string
  number: string
  externalId: string
  createdAt: string
  status: string
  statusLabel: string
  contractor: { id: string; name: string }
  cargo: string
  weightT: number
  from: { id: string; name: string; address: string; lat: number; lon: number }
  to: { id: string; name: string; address: string; lat: number; lon: number }
  loadingAt: string
  unloadingWindow: string
  docs: string[]
  vehicle: { id: string; model: string; plate: string } | null
  trailer: { id: string; model: string; plate: string } | null
  driver: { id: string; fullName: string } | null
  assignedBy: string | null
  assignedAt: string | null
  closeReason: string | null
  routeLink: string | null
  routeWaypoints: Array<{ lat: number; lng: number }> | null
  trip: {
    id: string
    status: string
    lastEventType: string | null
    lastEventAt: string | null
    routeDistanceM: number | null
    routeDurationS: number | null
    points: { id: string; seqNo: number; kind: string; name: string | null; lat: number; lon: number }[]
    events: { id: string; type: string; occurredAt: string; source: string; intervalClosedAt: string | null }[]
  } | null
  pretrip: { done: number; total: number; steps: { stepId: string; at: string; photoUrl: string | null }[] } | null
}

export function requestRow(
  r: TransportRequest & {
    contractor: Contractor
    fromLocation: Location
    toLocation: Location
    vehicle?: Vehicle | null
    trailer?: Trailer | null
    driver?: Driver | null
    trip?: (Trip & { points: TripPoint[]; events: TripEvent[] }) | null
  },
  pretrip?: (PreTripInspection & { steps: PreTripStep[] }) | null,
): RequestRow {
  return {
    id: r.id,
    number: r.number,
    externalId: r.externalId,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    statusLabel: r.status,
    contractor: { id: r.contractor.id, name: r.contractor.name },
    cargo: r.cargo,
    weightT: r.weightT,
    from: { id: r.fromLocation.id, name: r.fromLocation.name, address: r.fromLocation.address, lat: r.fromLocation.lat, lon: r.fromLocation.lon },
    to: { id: r.toLocation.id, name: r.toLocation.name, address: r.toLocation.address, lat: r.toLocation.lat, lon: r.toLocation.lon },
    loadingAt: r.loadingAt.toISOString(),
    unloadingWindow: r.unloadingWindow,
    docs: JSON.parse(r.docs) as string[],
    vehicle: r.vehicle ? { id: r.vehicle.id, model: r.vehicle.model, plate: r.vehicle.plate } : null,
    trailer: r.trailer ? { id: r.trailer.id, model: r.trailer.model, plate: r.trailer.plate } : null,
    driver: r.driver ? { id: r.driver.id, fullName: r.driver.fullName } : null,
    assignedBy: r.assignedBy,
    assignedAt: r.assignedAt?.toISOString() ?? null,
    closeReason: r.closeReason,
    routeLink: r.routeLink ?? null,
    routeWaypoints: r.routeWaypoints ? (JSON.parse(r.routeWaypoints) as Array<{ lat: number; lng: number }>) : null,
    trip: r.trip
      ? {
          id: r.trip.id,
          status: r.trip.status,
          lastEventType: r.trip.lastEventType,
          lastEventAt: r.trip.lastEventAt?.toISOString() ?? null,
          routeDistanceM: r.trip.routeDistanceM,
          routeDurationS: r.trip.routeDurationS,
          points: r.trip.points
            .sort((a, b) => a.seqNo - b.seqNo)
            .map((p) => ({ id: p.id, seqNo: p.seqNo, kind: p.kind, name: p.name, lat: p.lat, lon: p.lon })),
          events: r.trip.events
            .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
            .map((e) => ({ id: e.id, type: e.type, occurredAt: e.occurredAt.toISOString(), source: e.source, intervalClosedAt: e.intervalClosedAt?.toISOString() ?? null })),
        }
      : null,
    pretrip: pretrip
      ? {
          done: pretrip.steps.length,
          total: PRETRIP_STEP_IDS.length,
          steps: pretrip.steps
            .sort((a, b) => a.at.getTime() - b.at.getTime())
            .map((s) => ({ stepId: s.stepId, at: s.at.toISOString(), photoUrl: s.photoUrl })),
        }
      : { done: 0, total: PRETRIP_STEP_IDS.length, steps: [] },
  }
}

/**
 * Снимки строк журнала — зеркало Snapshots.kt / SyncDtos.kt:
 * camelCase, epoch millis, id — строки UUID. Совпадают с Room-сущностями
 * клиента, поэтому upsert по id идемпотентен.
 */

import type {
  ChatMessageSnapshot,
  SystemNoteSnapshot,
  TripEventSnapshot,
  TripPointSnapshot,
  TripSnapshot,
} from '@/lib/protocol'

type DbTrip = {
  id: string
  tripCode: string
  status: string
  driverId: string | null
  vehicleId: string | null
  plannedStartAt: Date | null
  plannedFinishAt: Date | null
  routeGeoJson: string | null
  routeStepsJson: string | null
  routeDistanceM: number | null
  routeDurationS: number | null
  routeMinLat: number | null
  routeMinLon: number | null
  routeMaxLat: number | null
  routeMaxLon: number | null
  lastEventType: string | null
  lastEventAt: Date | null
}

type DbTripPoint = {
  id: string
  tripId: string
  seqNo: number
  kind: string
  name: string | null
  address: string | null
  lat: number
  lon: number
  geofenceRadiusM: number
  plannedArrivalAt: Date | null
  plannedDepartureAt: Date | null
}

type DbTripEvent = {
  id: string
  tripId: string
  tripPointId: string | null
  driverId: string
  vehicleId: string
  deviceId: string | null
  type: string
  occurredAt: Date
  source: string
  lat: number | null
  lon: number | null
  note: string | null
  intervalClosedAt: Date | null
  intervalClosedBy: string | null
  intervalAutoClosed: boolean | null
  correctionOf: string | null
  editedAt: Date | null
  createdAt: Date
}

type DbChat = {
  id: string
  driverId: string
  tripId: string | null
  sender: string
  body: string
  createdAt: Date
}

type DbNote = {
  id: string
  driverId: string
  kind: string
  body: string
  ref: string | null
  createdAt: Date
  readAt: Date | null
}

const ms = (d: Date | null | undefined): number | undefined => (d ? d.getTime() : undefined)

export function buildTripSnapshot(t: DbTrip): TripSnapshot {
  return {
    id: t.id,
    tripCode: t.tripCode,
    status: t.status,
    driverId: t.driverId ?? undefined,
    vehicleId: t.vehicleId ?? undefined,
    plannedStartAt: ms(t.plannedStartAt),
    plannedFinishAt: ms(t.plannedFinishAt),
    routeGeoJson: t.routeGeoJson ?? undefined,
    routeStepsJson: t.routeStepsJson ?? undefined,
    routeDistanceM: t.routeDistanceM ?? undefined,
    routeDurationS: t.routeDurationS ?? undefined,
    routeMinLat: t.routeMinLat ?? undefined,
    routeMinLon: t.routeMinLon ?? undefined,
    routeMaxLat: t.routeMaxLat ?? undefined,
    routeMaxLon: t.routeMaxLon ?? undefined,
    lastEventType: t.lastEventType ?? undefined,
    lastEventAt: ms(t.lastEventAt),
  }
}

export function buildTripPointSnapshot(p: DbTripPoint): TripPointSnapshot {
  return {
    id: p.id,
    tripId: p.tripId,
    seqNo: p.seqNo,
    kind: p.kind as TripPointSnapshot['kind'],
    name: p.name ?? undefined,
    address: p.address ?? undefined,
    lat: p.lat,
    lon: p.lon,
    geofenceRadiusM: p.geofenceRadiusM,
    plannedArrivalAt: ms(p.plannedArrivalAt),
    plannedDepartureAt: ms(p.plannedDepartureAt),
  }
}

export function buildTripEventSnapshot(e: DbTripEvent): TripEventSnapshot {
  return {
    id: e.id,
    tripId: e.tripId,
    tripPointId: e.tripPointId ?? undefined,
    driverId: e.driverId,
    vehicleId: e.vehicleId,
    deviceId: e.deviceId ?? undefined,
    type: e.type,
    occurredAt: e.occurredAt.getTime(),
    source: e.source,
    lat: e.lat ?? undefined,
    lon: e.lon ?? undefined,
    note: e.note ?? undefined,
    intervalClosedAt: ms(e.intervalClosedAt),
    intervalClosedBy: e.intervalClosedBy ?? undefined,
    intervalAutoClosed: e.intervalAutoClosed ?? undefined,
    correctionOf: e.correctionOf ?? undefined,
    editedAt: ms(e.editedAt),
    createdAt: e.createdAt.getTime(),
  }
}

export function buildChatSnapshot(m: DbChat): ChatMessageSnapshot {
  return {
    id: m.id,
    driverId: m.driverId,
    tripId: m.tripId ?? undefined,
    sender: m.sender as ChatMessageSnapshot['sender'],
    body: m.body,
    createdAt: m.createdAt.getTime(),
  }
}

export function buildNoteSnapshot(n: DbNote): SystemNoteSnapshot {
  return {
    id: n.id,
    driverId: n.driverId,
    kind: n.kind,
    body: n.body,
    ref: n.ref ?? undefined,
    createdAt: n.createdAt.getTime(),
    readAt: ms(n.readAt),
  }
}

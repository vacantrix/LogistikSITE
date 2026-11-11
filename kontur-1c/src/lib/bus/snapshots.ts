// Снимки сущностей для SyncJournal (план обмена) — формы полей 1:1 с SyncDtos каркаса
// приложения водителя: camelCase, время — epoch millis.
import { toMillis } from '../epoch'

export function tripSnapshot(t: {
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
}) {
  return {
    id: t.id,
    tripCode: t.tripCode,
    status: t.status,
    driverId: t.driverId,
    vehicleId: t.vehicleId,
    plannedStartAt: toMillis(t.plannedStartAt),
    plannedFinishAt: toMillis(t.plannedFinishAt),
    routeGeoJson: t.routeGeoJson,
    routeStepsJson: t.routeStepsJson,
    routeDistanceM: t.routeDistanceM,
    routeDurationS: t.routeDurationS,
    routeMinLat: t.routeMinLat,
    routeMinLon: t.routeMinLon,
    routeMaxLat: t.routeMaxLat,
    routeMaxLon: t.routeMaxLon,
    lastEventType: t.lastEventType,
    lastEventAt: toMillis(t.lastEventAt),
  }
}

export function tripPointSnapshot(p: {
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
}) {
  return {
    id: p.id,
    tripId: p.tripId,
    seqNo: p.seqNo,
    kind: p.kind,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lon: p.lon,
    geofenceRadiusM: p.geofenceRadiusM,
    plannedArrivalAt: toMillis(p.plannedArrivalAt),
    plannedDepartureAt: toMillis(p.plannedDepartureAt),
  }
}

export function tripEventSnapshot(e: {
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
}) {
  return {
    id: e.id,
    tripId: e.tripId,
    tripPointId: e.tripPointId,
    driverId: e.driverId,
    vehicleId: e.vehicleId,
    deviceId: e.deviceId,
    type: e.type,
    occurredAt: e.occurredAt.getTime(),
    source: e.source,
    lat: e.lat,
    lon: e.lon,
    note: e.note,
    intervalClosedAt: toMillis(e.intervalClosedAt),
    intervalClosedBy: e.intervalClosedBy,
    intervalAutoClosed: e.intervalAutoClosed,
    correctionOf: e.correctionOf,
    editedAt: toMillis(e.editedAt),
    createdAt: e.createdAt.getTime(),
  }
}

export function chatMessageSnapshot(m: {
  id: string
  driverId: string
  tripId: string | null
  sender: string
  body: string
  createdAt: Date
}) {
  return {
    id: m.id,
    driverId: m.driverId,
    tripId: m.tripId,
    sender: m.sender,
    body: m.body,
    createdAt: m.createdAt.getTime(),
  }
}

export function systemNoteSnapshot(n: {
  id: string
  driverId: string
  kind: string
  body: string
  ref: string | null
  createdAt: Date
  readAt: Date | null
}) {
  return {
    id: n.id,
    driverId: n.driverId,
    kind: n.kind,
    body: n.body,
    ref: n.ref,
    createdAt: n.createdAt.getTime(),
    readAt: toMillis(n.readAt),
  }
}

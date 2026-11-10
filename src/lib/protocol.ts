/**
 * Контракты синхронизации — зеркало SyncDtos.kt каркаса.
 * Время — epoch millis, идентификаторы — строки UUID:
 * сериализация совпадает поле-в-поле с Room-моделью Android-приложения.
 */

// --- push (outbox водителя) ------------------------------------------------

export interface PushOp {
  opId: string
  type:
    | 'TRIP_EVENT_CREATE'
    | 'MARK_PUBLISH'
    | 'MARK_VOTE'
    | 'CHAT_SEND'
    | 'NOTE_READ'
  payload: unknown
}

export interface PushRequest {
  deviceId?: string
  operations: PushOp[]
}

export type OpStatus = 'APPLIED' | 'DUPLICATE' | 'REJECTED'

export interface PushOpResult {
  opId: string
  status: OpStatus
  rejectReason?: string
}

export interface PushResponse {
  results: PushOpResult[]
}

/** Полезные нагрузки операций outbox (типы проверяются applier-ами). */
export interface TripEventOpPayload {
  id: string
  tripId: string
  tripPointId?: string
  vehicleId: string
  deviceId?: string
  type: string
  occurredAt: number
  source: 'GEOFENCE' | 'MANUAL' | 'MANUAL_BACKDATED'
  lat?: number
  lon?: number
  note?: string
}

export interface MarkPublishOpPayload {
  id: string
  category: 'POTHOLE' | 'ROADWORKS' | 'POLICE' | 'ACCIDENT' | 'CLOSED'
  geometry: string // GeoJSON LineString
  comment?: string
  ttlHours: 6 | 12 | 720
  clientCreatedAt: number
}

export interface MarkVoteOpPayload {
  markId: string
  vote: 1 | -1
}

export interface ChatSendOpPayload {
  id: string
  tripId?: string
  body: string
  createdAt: number
}

export interface NoteReadOpPayload {
  noteId: string
}

// --- pull (канал 1: личный журнал по курсору) ------------------------------

export type JournalEntity =
  | 'TRIP'
  | 'TRIP_POINT'
  | 'TRIP_EVENT'
  | 'CHAT_MESSAGE'
  | 'SYSTEM_NOTE'

export interface JournalEntry {
  seq: number
  entity: JournalEntity
  op: 'UPSERT' | 'DELETE'
  payload: unknown
}

export interface PullResponse {
  entries: JournalEntry[]
  cursor: number
  hasMore: boolean
}

// --- marks (канал 2: снимок активных пометок по bbox) ----------------------

export type MarkCategory =
  | 'POTHOLE'
  | 'ROADWORKS'
  | 'POLICE'
  | 'ACCIDENT'
  | 'CLOSED'

export interface MarkDto {
  id: string
  category: MarkCategory
  geometry: string // GeoJSON LineString
  comment?: string
  ttlHours: number
  confirmCount: number
  outdatedCount: number
  createdAt: number
  expiresAt: number
}

export interface MarksSnapshot {
  snapshotAt: number
  marks: MarkDto[]
}

// --- снимки строк журнала (совпадают с Room-сущностями клиента) ------------

export interface TripSnapshot {
  id: string
  tripCode: string
  status: string
  driverId?: string
  vehicleId?: string
  plannedStartAt?: number
  plannedFinishAt?: number
  routeGeoJson?: string
  routeStepsJson?: string
  routeDistanceM?: number
  routeDurationS?: number
  routeMinLat?: number
  routeMinLon?: number
  routeMaxLat?: number
  routeMaxLon?: number
  lastEventType?: string
  lastEventAt?: number
}

export interface TripPointSnapshot {
  id: string
  tripId: string
  seqNo: number
  kind: 'loading' | 'unloading' | 'waypoint'
  name?: string
  address?: string
  lat: number
  lon: number
  geofenceRadiusM: number
  plannedArrivalAt?: number
  plannedDepartureAt?: number
}

export interface TripEventSnapshot {
  id: string
  tripId: string
  tripPointId?: string
  driverId: string
  vehicleId: string
  deviceId?: string
  type: string
  occurredAt: number
  source: string
  lat?: number
  lon?: number
  note?: string
  intervalClosedAt?: number
  intervalClosedBy?: string
  intervalAutoClosed?: boolean
  correctionOf?: string
  editedAt?: number
  createdAt: number
}

export interface ChatMessageSnapshot {
  id: string
  driverId: string
  tripId?: string
  sender: 'DRIVER' | 'DISPATCHER'
  body: string
  createdAt: number
}

export interface SystemNoteSnapshot {
  id: string
  driverId: string
  kind: string
  body: string
  ref?: string
  createdAt: number
  readAt?: number
}

/** Улица для офлайн-поиска (демо-данные устройства). */
export interface DemoStreet {
  name: string
  lat: number
  lon: number
}

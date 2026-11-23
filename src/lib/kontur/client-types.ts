// Типы на клиенте (ответы /api/*)
export type Driver = {
  id: string; fullName: string; phone: string; status: string; statusComment?: string | null
  birthDate?: string | null; passport?: string | null; licenseUntil?: string | null
  createdAt?: string | null
}
export type Vehicle = {
  id: string; brand: string; plate: string; capacityT?: number | null; volumeM3?: number | null
  ownership?: string; isRepair: boolean
  vin?: string | null; sts?: string | null; techTill?: string | null
  createdAt?: string | null
}
export type Trailer = {
  id: string; brand: string; plate: string; type: string; volumeM3?: number | null
  beltsCount?: number | null; workingBoards: boolean; ownership?: string
  sts?: string | null; techTill?: string | null; isRepair?: boolean
  createdAt?: string | null
}
export type ProfileUser = {
  id: string; login: string; fullName: string; position: string
  role: 'logist' | 'admin'; phone: string | null; email: string | null
}
export type AccountBrief = {
  id: string; login: string; fullName: string; position: string; role: 'logist' | 'admin'
}
export type Order = {
  id: string; externalId: string; number: string; customer: string; product: string
  loadPoint: string; unloadPoint: string; tariff?: number | null; kp?: string | null
  source: string; status: string; quarantineReason?: string | null; createdAt: string
  loadDatePlan?: string | null; unloadDatePlan?: string | null
  extra?: string | null; updatedAt?: string | null
}
export type Leg = {
  id: string; tripId: string; seq: number; type: string; loadPoint: string; unloadPoint: string
  status: string; statusSource: string; statusSetAt: string; docsPending: boolean; docsLost: boolean
  cargoDesc?: string | null; kmPlan?: number | null; rate?: number | null; orderId?: string | null
  loadDatePlan?: string | null; unloadDatePlan?: string | null
  odometerStart?: number | null; odometerEnd?: number | null; kmFact?: number | null
  // источник груза и связка со сделкой ATI.SU (для сквозной синхронизации разделов)
  cargoSource?: string | null; dealId?: string | null; weightT?: number | null
  loadDateFact?: string | null; unloadDateFact?: string | null
}
export type Trip = {
  id: string; driverId: string; vehicleId: string; trailerId?: string | null
  status: string; ackStatus: string; ackAt?: string | null; createdAt: string
  waitingReturn: boolean; incidentOpen: boolean; version: number
  driver: Driver | null; vehicle: Vehicle | null; trailer: Trailer | null; legs: Leg[]
}
export type Device = {
  id: string; driverId?: string | null; appVersion: string; isLegacy: boolean
  lastSeenAt?: string | null; clockSkewCount24h: number; systematicSkew: boolean
  fcmAvailable: boolean; driver: Driver | null
}
// Закрепление состава за водителем (водитель ↔ тягач ↔ прицеп)
export type Binding = {
  id: string; driverId: string; vehicleId: string; trailerId?: string | null
  pinnedAt: string; updatedAt?: string | null
  driver?: Driver | null
  vehicle?: Vehicle | null
  trailer?: Trailer | null
}
export type StatusEventDto = {
  id: string; legId: string; status: string; type: string; actorRole: string
  actorId?: string | null; clientId?: string | null; deviceId?: string | null
  seqNo?: number | null; clientTs?: string | null; serverTs: string
  receivedOffline: boolean; clockSkew: boolean; superseded: boolean; lateArrival: boolean
  needsReview: boolean; legacy: boolean; appliedByReview: boolean; skippedConflict: boolean
  parentCorrectionId?: string | null; comment?: string | null; requiredFiles?: string | null
  reviewState?: string | null; result?: string | null; rejectReason?: string | null
  leg?: Leg | null
}
export type TripEventDto = {
  id: string; tripId: string; type: string; actorId?: string | null; payload?: string | null; at: string
}
export type FileDto = {
  id: string; ownerId: string; kind: string; clientId: string; state: string
  eventClientId?: string | null; lateArrival: boolean; sizeBytes: number; createdAt: string
}
export type AuditDto = {
  id: string; actorRole: string; actorName?: string | null; object: string; objectId: string
  field?: string | null; was?: string | null; became?: string | null; comment?: string | null; at: string
}
export type NeedsReviewEvent = StatusEventDto
export type OutboxItem = {
  id: number; eventType: string; payload: string; state: string
  firstSeenAt: string; attempts: number; ackedAt?: string | null; lastAttemptAt?: string | null
}
// Структурированный алерт B8.2: текст для показа + машина навигации,
// чтобы лицевая панель рисовала кнопку-ссылку «к проблеме», а не сырой текст.
export type AlertKind =
  | 'trip_ack' // рейс: назначение не подтверждено (эскалация)
  | 'leg_docs' // плечо: документы не доставлены (фото ожидается)
  | 'leg_docs_lost' // плечо: документ утрачен
  | 'outbox_stale' // 1С не забирает события из очереди
  | 'outbox_failed' // события не доставлены в 1С
  | 'device_skew' // устройство: систематический сдвиг часов
  | 'device_legacy' // устройство: legacy-приложение
  | 'new_orders' // новые заявки (инфо)

export type Alert = {
  level: 'red' | 'amber' | 'info'
  /** Короткий текст кнопки (полное описание — в подсказке при наведении) */
  text: string
  kind: AlertKind
  /** Для trip_ack / leg_docs — рейс, куда ведёт ссылка */
  tripId?: string
  /** Для leg_docs — конкретное плечо */
  legId?: string
  /** Для device_* — устройство */
  deviceId?: string
}
// Ручной план логиста — запись календаря «Планирования» на любую дату
export type PlanEntryDto = {
  id: string; driverId: string; vehicleId?: string | null
  date: string; time?: string | null; kind: string
  point?: string | null; note?: string | null
  createdByName?: string | null
  closedAt?: string | null // событие закрыто (выполнено) — серый стиль, не пульсирует
  closedByName?: string | null
  createdAt?: string
}

export type StateResponse = {
  trips: Trip[]; orders: Order[]; devices: Device[]; drivers: Driver[]
  vehicles: Vehicle[]; trailers: Trailer[]; bindings: Binding[]
  deals: AtiDealDto[]
  planEntries: PlanEntryDto[]
  needsReview: NeedsReviewEvent[]; outbox: OutboxItem[]
  outboxStats: { pending: number; stale: number; failed: number; acked: number }
  alerts: Alert[]
}
export type TripDetail = {
  trip: Trip; legs: Leg[]; statusEvents: StatusEventDto[]; tripEvents: TripEventDto[]
  files: FileDto[]; audit: AuditDto[]; driver: Driver | null; vehicle: Vehicle | null; trailer: Trailer | null
}

// —— Умный подбор под заявку (ответ /api/match?orderId=…) ——

export type MatchReason = { kind: 'plus' | 'warn'; text: string }
export type MatchCandidate = {
  kind: 'trip' | 'composition'
  score: number // 0..100
  grade: 'ideal' | 'good' | 'risky'
  tripId?: string // для kind=trip
  driver: { id: string; fullName: string; phone: string }
  vehicle: { id: string; brand: string; plate: string; capacityT: number | null }
  trailer: { id: string; brand: string; plate: string; type: string } | null
  pinned: boolean // состав закреплён за водителем (кнопка «Закрепить»)
  usual: { vehicleBrand: string; vehiclePlate: string; trailerPlate: string | null } | null // закрепление водителя, если отличается от предложенного
  freesAt: string | null // ISO: когда состав освобождается (null = свободен сейчас)
  freesAtPoint: string | null
  deadheadKm: number | null // порожний пробег до пункта погрузки заявки
  nowRoute: string | null // текущее плечо (для занятых)
  nowStatus: string | null // статус онлайн-мониторинга
  reasons: MatchReason[]
}
export type MatchResponse = {
  order: {
    id: string; number: string; weightT: number; weightSource: 'lines' | 'estimate'
    loadAt: string; loadPoint: string; unloadPoint: string
  }
  trips: MatchCandidate[]
  compositions: MatchCandidate[]
  meta: {
    generatedAt: string; activeTrips: number; freeDrivers: number; freeVehicles: number; notes: string[]
  }
}

// —— Заявка на груз ATI.SU, по которому договорились (ответ /api/atisu/deals) ——
// stage=preliminary — предварительное согласование (документы не обменяны);
// stage=full        — полное: документы обменяны, заявка вступила в силу.
export type AtiDealDto = {
  id: string
  loadId: string
  atiId: number | null
  from: string
  fromRegion: string | null
  to: string
  toRegion: string | null
  km: number | null
  bodies: string | null
  cargo: string
  weightT: number | null
  volumeM3: number | null
  loadDateFrom: string | null
  loadDateTo: string | null
  rate: number | null
  perKm: number | null
  payment: string | null
  ndsPct: number | null
  carrierFirm: string
  carrierRating: number | null
  contactName: string | null
  contactPhone: string | null
  stage: 'preliminary' | 'full'
  status: 'active' | 'cancelled'
  comment: string | null
  cancelReason: string | null
  agreedAt: string
  docsAt: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ' ' +
    d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU')
}

// —— сроки документов справочника (стиль LogistikSITE / lib/expiry) ——
export type ExpiryState = 'none' | 'ok' | 'soon' | 'warn' | 'expired'
export type ExpiryInfo = { state: ExpiryState; date: string; days: number | null; label: string }

/** Разбор даты «ДД.ММ.ГГГГ» с классификацией срока (дни до истечения) */
export function expiryInfo(date?: string | null): ExpiryInfo {
  if (!date || !/^\d{2}\.\d{2}\.\d{4}$/.test(date)) return { state: 'none', date: date ?? '—', days: null, label: date || '—' }
  const [d, m, y] = date.split('.').map(Number)
  const target = new Date(y, m - 1, d)
  if (Number.isNaN(target.getTime())) return { state: 'none', date, days: null, label: date }
  const days = Math.round((target.getTime() - Date.now()) / 86400000)
  if (days < 0) return { state: 'expired', date, days, label: `истёк ${Math.abs(days)} дн.` }
  if (days <= 30) return { state: 'warn', date, days, label: `истекает · ${days} дн.` }
  if (days <= 90) return { state: 'soon', date, days, label: `скоро · ${days} дн.` }
  return { state: 'ok', date, days, label: date }
}

/** Худшее из нескольких состояний срока */
export function worseState(a: ExpiryState, b: ExpiryState): ExpiryState {
  const order: ExpiryState[] = ['none', 'ok', 'soon', 'warn', 'expired']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

/** Тон строки таблицы с плохим сроком: красный — истёк, янтарный — истекает */
export function rowTint(states: ExpiryState[]): string {
  const worst = states.reduce<ExpiryState>((acc, s) => worseState(acc, s), 'none')
  if (worst === 'expired') return 'bg-red-50/60'
  if (worst === 'warn') return 'bg-amber-50/50'
  return ''
}

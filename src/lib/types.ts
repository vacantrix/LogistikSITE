/** Общие DTO платформы (клиент + сервер) */

/** Статусы заявки. DELETED (Task 65) — мягкое удаление: запись остаётся в реестре
 *  заявок со статусом «Удалена», но исчезает с площадки и из кабинетов перевозчиков */
export type RequestStatus = 'DRAFT' | 'PUBLISHED' | 'AWARDED' | 'DOCS_REVIEW' | 'AT_LOGIST' | 'CONFIRMED' | 'CLOSED' | 'DELETED'
export type RequestMode = 'AUCTION' | 'CLOSED'
export type DocStatus = 'PENDING' | 'PASSED' | 'REUPLOAD' | 'REJECTED' | 'MANUAL'
export type DocType = 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'STS' | 'REQUEST_DOC' | 'POA' | 'ATTACHMENT'

/** Принадлежность записи справочника (Task 62): собственный парк / наёмный (ИП, ООО) / аренда-лизинг */
export type OwnershipType = 'OWNED' | 'HIRED' | 'LEASE'

/** Статус прикреплённого документа записи справочника (Task 62) */
export type DirectoryDocStatus = 'LOADED' | 'NEEDS_REVIEW' | 'EXPIRING' | 'MISSING'

export interface DriverDTO {
  id: string
  carrierId: string
  fullName: string
  birthDate: string
  passport: string
  phone: string
  birthPlace: string
  /** адрес регистрации (место жительства) — колонка формы «Авто в порт» */
  address: string
  citizenship: string
  passportIssuedBy: string
  passportIssuedDate: string
  position: string
  ownershipType: OwnershipType
  /** собственник / контрагент (ИП / ООО «Название») */
  ownerName: string
  /** договор-основание (для аренды/лизинга) */
  leaseContract: string
  createdAt: string
}

export interface TruckDTO {
  id: string
  carrierId: string
  brand: string
  plate: string
  vin: string
  sts: string
  techTill: string
  owner: string
  color: string
  ownershipType: OwnershipType
  leaseContract: string
  createdAt: string
}

export interface TrailerDTO {
  id: string
  carrierId: string
  plate: string
  sts: string
  type: string
  techTill: string
  color: string
  owner: string
  ownershipType: OwnershipType
  leaseContract: string
  createdAt: string
}

/** Фото/документ записи справочника (Task 54) — модальное окно предосмотра в «Справочниках».
 *  url — защищённая ссылка на файл (/api/files/...): отдаётся только логисту и владельцу записи.
 *  status (Task 62): LOADED — загружен, NEEDS_REVIEW — требует проверки */
export interface DirectoryPhotoDTO {
  id: string
  label: string
  fileName: string
  url: string
  status: 'LOADED' | 'NEEDS_REVIEW'
}

/** Роль исполнителя рейса: перевозчик (заказ-заявка) или экспедитор (поручение экспедитору) */
export type ExecutorRole = 'CARRIER' | 'FORWARDER'

export interface CarrierDTO {
  id: string
  name: string
  inn: string
  role: ExecutorRole
  contractNo: string
  contractDate: string
  access: boolean
  drivers: DriverDTO[]
  trucks: TruckDTO[]
  trailers: TrailerDTO[]
  takenCount: number
  bidsCount: number
}

/** Запись справочника грузов — единый источник названий груза для заявок */
export interface CargoTypeDTO {
  id: string
  name: string
  category: string
  truckType: string
  dangerous: boolean
  usageCount: number
  createdAt: string
}

export interface BidDTO {
  id: string
  carrierId: string
  carrierName: string
  amount: number
  isWinner: boolean
  /** ставка отозвана — агент добровольно снялся с заявки (Task 52) */
  withdrawn: boolean
  createdAt: string
}

export interface DocumentDTO {
  id: string
  type: DocType
  fileName: string
  /** защищённая ссылка на файл (/api/files/document/<id>) — сам файл в списках не передаётся */
  url: string
  /** файл — PDF (доверенность, скан): показывается просмотрщиком PDF, а не картинкой */
  isPdf: boolean
  status: DocStatus
  quality: number | null
  engine: string | null
  fields: Record<string, string> | null
  confidence: Record<string, number> | null
  issues: string[]
  message: string | null
  createdAt: string
}

export interface EventDTO {
  id: string
  type: string
  message: string
  createdAt: string
}

export interface RequestDTO {
  id: string
  number: string
  fromPoint: string
  toPoint: string
  cargo: string
  /** ссылка на запись справочника грузов (cargoTypeId) */
  cargoTypeId: string | null
  /** группа груза из справочника (Металлопрокат, Оборудование…) */
  cargoCategory: string | null
  /** комментарий для исполнителя (Task 64) */
  comment: string
  /** логист, создавший заявку (Task 66 — реестр заявок) */
  createdBy: string
  tonnage: number
  truckType: string
  mode: RequestMode
  startRate: number
  /** лучшая ставка; перевозчику в закрытых торгах не передаётся до итогов (null) */
  bestRate: number | null
  /** число активных ставок; перевозчику в закрытых торгах не передаётся до итогов (null) */
  bidsCount: number | null
  status: RequestStatus
  loadDate: string
  loadWindow: string
  deadline: string | null
  winnerId: string | null
  /** имя победителя: логисту — всегда, перевозчику — только если победил он сам */
  winnerName: string | null
  driverId: string | null
  truckId: string | null
  trailerId: string | null
  passPackage: boolean
  etrnStatus: string
  /** комментарий логиста к сверки/отклонению (Task 62) */
  verifyComment: string | null
  createdAt: string
  updatedAt: string
  savings: number | null
  /** логисту — все ставки, перевозчику — только свои */
  bids: BidDTO[]
  documents: DocumentDTO[]
  events: EventDTO[]
}

export interface SettingsDTO {
  confReupload: number
  /** порог отказа при расхождении с заявкой (отдельно от confReupload) */
  confReject: number
  confAuto: number
  minQuality: number
  rules: Record<string, string>
}

export interface ReportSummary {
  kpi: {
    openRequests: number
    atVerify: number
    atLogist: number
    confirmed: number
    savingsMonth: number
    avgBids: number
    docsAutoShare: number
    etrnShare: number
  }
  byDirection: { direction: string; count: number; avgRate: number; minRate: number }[]
  savingsByRequest: { number: string; cargo: string; startRate: number; bestRate: number | null; savings: number }[]
  carriers: { name: string; taken: number; avgRate: number; refused: number }[]
}

export interface EventFeedItem {
  id: string
  type: string
  message: string
  requestNumber?: string | null
  createdAt: string
}

/** Пользователь текущей сессии (GET /api/auth/me) */
export interface SessionUserDTO {
  id: string
  login: string
  name: string
  role: 'logist' | 'carrier'
  carrierId: string | null
}

// ——— Журнал событий платформы (Task 76) ———

export type PlatformLogLevel = 'INFO' | 'WARN' | 'ERROR'

/** Запись журнала платформы (GET /api/platform-log, только логист) */
export interface PlatformLogEntryDTO {
  id: string
  level: PlatformLogLevel
  type: string
  source: string
  actorName: string | null
  actorLogin: string | null
  actorRole: string | null
  requestNumber: string | null
  carrierName: string | null
  message: string
  meta: Record<string, unknown> | null
  createdAt: string
}

/** Ответ GET /api/platform-log — лента + статистика за 24 часа */
export interface PlatformLogDTO {
  entries: PlatformLogEntryDTO[]
  stats: {
    counts24h: Record<PlatformLogLevel, number>
    lastErrorAt: string | null
    lastErrorMessage: string | null
  }
}

// ——— ЭДО: подписание документов рейса (Task 76) ———

/** Реквизиты документа ЭДО для рендера скана (рисует клиент) */
export interface EdoDocPayloadDTO {
  title: string
  dateRu: string
  org: string
  lines: string[]
  validTill?: string
  driverName: string
  carrierName: string
  accent: string
}

export type EdoKind = 'POA' | 'ORDER' | 'ETRN' | 'ACT'
export type EdoParty = 'EXPEDITOR' | 'CARRIER'

/** Документ ЭДО рейса со статусами подписания сторон */
export interface EdoDocDTO {
  id: string
  kind: EdoKind
  party: EdoParty
  title: string
  partyRole: string
  number: string
  aemzSigned: boolean
  aemzSignedAt: string | null
  aemzSigner: string | null
  partySigned: boolean
  partySignedAt: string | null
  partySigner: string | null
  payload: EdoDocPayloadDTO
  createdAt: string
  /** ЭТрН, отправленная через Диадок (null — не отправлялась) */
  diadoc: EdoDiadocDTO | null
}

/** Документооборот ЭТрН в Диадоке: этап перевозки (kl-status), УИД ГИС ЭПД, ошибки */
export interface EdoDiadocDTO {
  messageId: string
  stage: string | null
  uid: string | null
  gisStatus: string | null
  gisError: string | null
  sentAt: string | null
  syncedAt: string | null
}

/** Состояние интеграции с Диадоком для раздела «Подписать ЭДО» */
export interface DiadocInfoDTO {
  enabled: boolean
  /** «тестовая площадка Диадока» / «Диадок» */
  stand: string
  /** test — тестовая подпись; delay — Т1 подписывают своей КЭП в веб-интерфейсе Диадока */
  signMode: 'test' | 'delay'
  lastSyncAt: string | null
  lastError: string | null
}

/** Пакет ЭДО рейса: карточка рейса + комплекты документов */
export interface EdoPackageDTO {
  request: {
    id: string
    number: string
    route: string
    cargo: string
    tonnage: number
    loadDate: string
    status: RequestStatus
    winnerName: string | null
    /** кто исполняет рейс: перевозчик (заказ-заявка) или экспедитор (поручение) */
    executorRole: ExecutorRole
    driverName: string | null
    truckLabel: string | null
  }
  docs: EdoDocDTO[]
}

/** Персональное уведомление колокольчика (Task 69) */
export interface NotificationDTO {
  id: string
  type: string
  title: string
  body: string
  requestId: string | null
  requestNumber: string | null
  read: boolean
  createdAt: string
}

// ——— Добавление водителя с нейросетью (intake) ———

/** Вердикт нейросети по одному загруженному документу */
export interface IntakeDocVerdict {
  type: DocType
  status: DocStatus
  quality: number
  engine: string
  fields: Record<string, string>
  confidence: Record<string, number>
  issues: string[]
  message: string
  /** какой вид документа фактически распознан (при несоответствии — не совпадает с type) */
  detectedType?: DocType | 'UNKNOWN' | null
  /** файл был загружен в слот movedFrom, а на нём документ type — платформа переложила его */
  movedFrom?: DocType | null
}

export interface IntakeCrossCheck {
  label: string
  ok: boolean
  detail: string
}

/** Черновик карточки водителя, заполненный нейросетью */
export interface IntakeDriverDraft {
  fullName: string
  birthDate: string
  passport: string
  /** дата выдачи паспорта — со страницы с фото */
  passportIssuedDate: string
  /** «Кем выдан» — напечатанная строка со страницы с фото (рукописная не подставляется) */
  passportIssuedBy: string
  /** «РФ», если распознана страница с фото внутреннего паспорта РФ */
  citizenship: string
  /** место рождения — со страницы паспорта с фото */
  birthPlace: string
  /** адрес регистрации — со страницы регистрации */
  address: string
  confidence: Record<string, number>
}

/** Черновик карточки тягача (из СТС), заполненный нейросетью */
export interface IntakeTruckDraft {
  brand: string
  plate: string
  vin: string
  sts: string
  owner: string
  confidence: Record<string, number>
}

/** Ответ POST /api/drivers/intake */
export interface IntakeResult {
  driver: IntakeDriverDraft
  truck: IntakeTruckDraft | null
  crossChecks: IntakeCrossCheck[]
  documents: IntakeDocVerdict[]
}

/** Результат распознавания СТС для карточек «Добавить ТС»/«Добавить прицеп» (Task 83) */
export interface VehicleIntakeResult {
  /** статус вердикта документа — как в IntakeDocVerdict */
  status: 'PASSED' | 'REUPLOAD' | 'REJECTED' | 'MANUAL' | 'PENDING'
  quality: number
  engine: string
  /** какая нейросеть читала: fast (лёгкая) / accurate (точная) */
  engineMode?: 'fast' | 'accurate'
  message: string
  fields: { brand: string; plate: string; sts: string; owner: string }
  confidence: Partial<Record<'brand' | 'plate' | 'sts' | 'owner', number>>
  /** проблемы: вердикт движка + форматные правила «Авто в порт» */
  issues: string[]
}

/** Итог сохранения нового водителя */
export interface DriverIntakeSaved {
  driverId: string
  truckId?: string
  driverName: string
  existed?: boolean
  request?: RequestDTO
}

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

/** Роль пользователя на платформе (система прав, Task 109): администрация / логист АЭМЗ / перевозчик-экспедитор */
export type SessionRole = 'admin' | 'logist' | 'carrier'

/** Роль исполнителя рейса: перевозчик (заказ-заявка) или экспедитор (поручение экспедитору) */
export type ExecutorRole = 'CARRIER' | 'FORWARDER'

/** Принадлежность транспорта по заявке (Task 109): в собственности / наёмный / аренда-лизинг */
export type TransportOwnership = 'OWNED' | 'HIRED' | 'LEASE'

/** Метки и подсказки принадлежности транспорта по заявке */
export const TRANSPORT_OWNERSHIP_META: Record<TransportOwnership, { label: string }> = {
  OWNED: { label: 'Транспорт в собственности' },
  HIRED: { label: 'Наёмный транспорт' },
  LEASE: { label: 'Аренда / лизинг' },
}

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

/** Вид документа в обмене между перевозчиком и логистом по заявке (без почты, Task 109) */
export type RequestFileKind = 'POA' | 'REQUEST_DOC' | 'FOR_CARRIER'

/** Метки видов файлов обмена */
export const REQUEST_FILE_META: Record<RequestFileKind, { label: string; hint: string }> = {
  POA: { label: 'Доверенность', hint: 'Перевозчик передаёт логисту доверенность по заявке' },
  REQUEST_DOC: { label: 'Заявка', hint: 'Перевозчик передаёт логисту заявку (подтверждение исполнения)' },
  FOR_CARRIER: { label: 'Документ от логиста', hint: 'Документ, выложенный логистом для перевозчика (скачивается из кабинета)' },
}

/** Файл обмена по заявке: кто загрузил и что это — скачивается по защищённой ссылке */
export interface RequestFileDTO {
  id: string
  kind: RequestFileKind
  fileName: string
  /** защищённая ссылка (/api/files/request-file/<id>) */
  url: string
  isPdf: boolean
  isImage: boolean
  sizeBytes: number
  /** carrier | logist — кто загрузил файл */
  uploadedBy: 'carrier' | 'logist'
  uploadedByName: string
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
  /** исполнитель по данной заявке: перевозчик или экспедитор (выбор перевозчика, Task 109); null — по роли компании */
  executorRole: ExecutorRole | null
  /** транспорт по заявке: в собственности (по умолчанию) / наёмный / аренда-лизинг */
  transportOwnership: TransportOwnership
  /** файлы обмена перевозчик ↔ логист по заявке (доверенность, заявка, документы от АЭМЗ) */
  files: RequestFileDTO[]
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

  /* ——— Проформы (Task 100): произвольный период + две бумажные формы с круговыми диаграммами ——— */

  /** выбранный период: даты включительно, «YYYY-MM-DD» */
  period: { from: string; to: string }
  /** подпись периода: «Май 2025» для календарного месяца, иначе «01.05.2025 – 15.05.2025» */
  periodLabel: string
  /** current-month — идущий месяц (считается проекция), done-month — полный завершённый месяц, range — произвольный диапазон */
  periodKind: 'current-month' | 'done-month' | 'range'
  /** момент формирования отчёта (ISO) */
  generatedAt: string

  /** Проформа № 1 — экономия по заявкам за выбранный период */
  proforma1: {
    periodLabel: string
    /** подтверждённых рейсов за период */
    confirmedCount: number
    /** из них с ненулевой экономией */
    savingsCount: number
    /** стартовый оборот по подтверждённым рейсам, ₽ */
    startTotal: number
    /** итоговый оборот, ₽ */
    finalTotal: number
    /** сэкономлено всего, ₽ */
    savedTotal: number
    /** средняя экономия на заявку, ₽ */
    avgSaving: number
    /** средний процент снижения ставки, % */
    avgSavingPct: number
    /** проекция на полный месяц (идущий месяц) либо факт за период, ₽ */
    projectionMonth: number
    /** подпись показателя: «Проекция на месяц» / «Факт за месяц» / «Факт за период» */
    projectionLabel: string
    /** период завершён — проекция равна факту */
    monthComplete: boolean
    /** круговая: структура экономии по направлениям */
    byDirection: ReportPieSlice[]
    /** круговая: доли заявок в общей экономии (топ + «Прочие») */
    byRequest: ReportPieSlice[]
    /** расшифровка: экономия каждой заявки */
    rows: Proforma1Row[]
  }

  /** Проформа № 2 — обороты и привлечённый транспорт за выбранный период */
  proforma2: {
    periodLabel: string
    /** заявок за период (без удалённых) */
    requestsCount: number
    /** подтверждено рейсов (привлечённый транспорт) */
    confirmedCount: number
    /** оборот — итоговые ставки подтверждённых рейсов × тоннаж, ₽ */
    turnover: number
    /** средняя ставка подтверждённых рейсов, ₽/т */
    avgRate: number
    /** общий тоннаж заявок периода, т */
    tonnageTotal: number
    /** среднее количество ставок на заявку */
    avgBids: number
    /** рейсов с ЭТрН */
    etrnCount: number
    /** привлечённый транспорт по перевозчикам */
    byCarrier: Proforma2CarrierRow[]
    /** круговая: заявки периода по статусам */
    byStatus: ReportPieSlice[]
  }
}

/** Долька круговой диаграммы проформы */
export interface ReportPieSlice {
  label: string
  value: number
  /** доля от суммы, % */
  share: number
}

/** Строка расшифровки экономии в проформе № 1 */
export interface Proforma1Row {
  number: string
  direction: string
  cargo: string
  tonnage: number
  startRate: number
  bestRate: number | null
  /** экономия деньгами: (старт − итог) × тоннаж, ₽ */
  savings: number
  /** снижение ставки, % */
  pct: number
  /** перевозчик (привлечённый транспорт) */
  carrier: string
}

/** Строка перевозчика в проформе № 2 */
export interface Proforma2CarrierRow {
  name: string
  trips: number
  turnover: number
  avgRate: number
  /** доля оборота, % */
  share: number
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
  role: SessionRole
  carrierId: string | null
}

// ——— Профиль / проформа учётной записи (Task 109) ———

/** Проформа пользователя: персональные данные + реквизиты кабинета перевозчика */
export interface ProfileDTO {
  userId: string
  fullName: string
  position: string
  phone: string
  email: string
  companyName: string
  inn: string
  kpp: string
  address: string
  director: string
  contactName: string
  note: string
  updatedAt: string
}

/** Учётная запись для раздела «Профили и доступы» (администрация) */
export interface AdminUserDTO {
  id: string
  login: string
  name: string
  role: SessionRole
  carrierId: string | null
  carrierName: string | null
  /** персональное разрешение «Редактирование своего профиля» (Task 112): null — как у роли */
  profileEditOwn: 'allow' | 'deny' | null
  createdAt: string
  profile: ProfileDTO | null
}

// ——— Права доступа (Task 111) ———

/** Строка матрицы прав: роль и список её прав (ключ → включено) */
export interface PermMatrixRow {
  role: SessionRole
  label: string
  items: { key: string; allowed: boolean }[]
}


// ——— Редактор базы данных (администрация, Task 109) ———

/** Таблица базы данных, доступная администрации */
export interface AdminDbTableDTO {
  key: string
  label: string
  count: number
}

/** Строка таблицы: значения — примитивы/строки (даты — ISO, большие поля обрезаются) */
export interface AdminDbRow {
  id: string
  values: Record<string, string | number | boolean | null>
}

/** Ответ GET /api/admin/db?table=… — строки таблицы + список её полей */
export interface AdminDbTableData {
  table: AdminDbTableDTO
  columns: { key: string; kind: 'string' | 'number' | 'boolean' | 'datetime' }[]
  rows: AdminDbRow[]
  truncated: boolean
}

// ——— Обращения в поддержку (чат, Task 109) ———

/** Категория обращения */
export type TicketCategory = 'docs' | 'auction' | 'payment' | 'edo' | 'tech' | 'other'

/** Метки категорий обращений */
export const TICKET_CATEGORY_META: Record<TicketCategory, string> = {
  docs: 'Документы по заявке',
  auction: 'Торги и заявки',
  payment: 'Оплата и закрывающие документы',
  edo: 'ЭДО и подписи',
  tech: 'Проблемы с платформой',
  other: 'Другое',
}

export type TicketStatus = 'OPEN' | 'ANSWERED' | 'CLOSED'

/** Метки статусов обращения («точка и слово») */
export const TICKET_STATUS_META: Record<TicketStatus, { label: string; dot: string; tone?: 'warning' | 'danger' }> = {
  OPEN: { label: 'Открыто', dot: 'bg-amber-500', tone: 'warning' },
  ANSWERED: { label: 'Есть ответ', dot: 'bg-blue-500' },
  CLOSED: { label: 'Закрыто', dot: 'bg-slate-400' },
}

/** Вложение сообщения обращения */
export interface TicketAttachmentDTO {
  id: string
  fileName: string
  mime: string
  isImage: boolean
  sizeBytes: number
  url: string
}

/** Сообщение обращения */
export interface TicketMessageDTO {
  id: string
  authorName: string
  authorRole: SessionRole
  staff: boolean
  body: string
  createdAt: string
  attachments: TicketAttachmentDTO[]
}

/** Обращение в списке */
export interface TicketDTO {
  id: string
  number: number
  subject: string
  category: TicketCategory
  status: TicketStatus
  authorName: string
  carrierName: string | null
  sizeTotal: number
  /** число сообщений в ветке */
  messagesCount: number
  /** последнее сообщение (превью) — null, если сообщений ещё нет */
  lastMessage: { authorName: string; staff: boolean; body: string; createdAt: string } | null
  lastMessageAt: string
  createdAt: string
}

/** Ветка обращения: обращение + сообщения с вложениями */
export interface TicketThreadDTO {
  ticket: TicketDTO
  messages: TicketMessageDTO[]
  /** сколько ещё вложений можно приложить к обращению, байт (лимит 10 МБ на обращение) */
  sizeLeft: number
  /** может ли текущий пользователь писать в ветку */
  canReply: boolean
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
  color: string
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
  fields: { brand: string; plate: string; vin: string; sts: string; color: string; owner: string }
  confidence: Partial<Record<'brand' | 'plate' | 'vin' | 'sts' | 'color' | 'owner', number>>
  /** проблемы: вердикт движка + форматные правила «Авто в порт» */
  issues: string[]
  /** лицевая сторона и оборот были загружены не в свои слоты — фото нужно поменять местами */
  swapped?: boolean
  /** сверка номера СТС между сторонами (null — одна сторона или номер не прочитан) */
  crossCheck?: { ok: boolean; detail: string } | null
}

/** Итог сохранения нового водителя */
export interface DriverIntakeSaved {
  driverId: string
  truckId?: string
  driverName: string
  existed?: boolean
  request?: RequestDTO
}

/** Общие DTO платформы (клиент + сервер) */

export type RequestStatus = 'PUBLISHED' | 'AWARDED' | 'DOCS_REVIEW' | 'AT_LOGIST' | 'CONFIRMED' | 'CLOSED'
export type RequestMode = 'AUCTION' | 'CLOSED'
export type DocStatus = 'PENDING' | 'PASSED' | 'REUPLOAD' | 'REJECTED' | 'MANUAL'
export type DocType = 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'LICENSE' | 'STS' | 'REQUEST_DOC' | 'POA'

export interface DriverDTO {
  id: string
  carrierId: string
  fullName: string
  birthDate: string
  passport: string
  license: string
  licenseTill: string
  medTill: string
  categories: string
  phone: string
  birthPlace: string
  citizenship: string
  passportIssuedBy: string
  passportIssuedDate: string
  position: string
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
  createdAt: string
}

export interface CarrierDTO {
  id: string
  name: string
  inn: string
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
  dataUri: string
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
  tonnage: number
  truckType: string
  mode: RequestMode
  startRate: number
  bestRate: number | null
  status: RequestStatus
  loadDate: string
  loadWindow: string
  deadline: string | null
  winnerId: string | null
  winnerName: string | null
  driverId: string | null
  truckId: string | null
  trailerId: string | null
  passPackage: boolean
  etrnStatus: string
  createdAt: string
  updatedAt: string
  savings: number | null
  bids: BidDTO[]
  documents: DocumentDTO[]
  events: EventDTO[]
}

export interface SettingsDTO {
  confReupload: number
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
  license: string
  licenseTill: string
  categories: string
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

/** Итог сохранения нового водителя */
export interface DriverIntakeSaved {
  driverId: string
  truckId?: string
  driverName: string
  existed?: boolean
  request?: RequestDTO
}

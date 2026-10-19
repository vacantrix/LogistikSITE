/** Общие DTO платформы (клиент + сервер) */

export type RequestStatus = 'PUBLISHED' | 'AWARDED' | 'DOCS_REVIEW' | 'AT_LOGIST' | 'CONFIRMED' | 'CLOSED'
export type RequestMode = 'FIXED' | 'AUCTION' | 'CLOSED'
export type DocStatus = 'PENDING' | 'PASSED' | 'REUPLOAD' | 'REJECTED' | 'MANUAL'
export type DocType = 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'LICENSE' | 'STS'

export interface DriverDTO {
  id: string
  carrierId: string
  fullName: string
  birthDate: string
  passport: string
  license: string
  licenseTill: string
  categories: string
}

export interface TruckDTO {
  id: string
  carrierId: string
  brand: string
  plate: string
  vin: string
  sts: string
  owner: string
}

export interface TrailerDTO {
  id: string
  carrierId: string
  plate: string
  sts: string
  type: string
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

export interface BidDTO {
  id: string
  carrierId: string
  carrierName: string
  amount: number
  isWinner: boolean
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

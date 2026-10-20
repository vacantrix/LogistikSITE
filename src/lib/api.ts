/** Клиентский слой запросов к API платформы */
import type {
  CargoTypeDTO, CarrierDTO, DriverDTO, DriverIntakeSaved, EventFeedItem, IntakeDocVerdict, IntakeResult, RequestDTO, ReportSummary, SettingsDTO, TruckDTO,
} from '@/lib/types'

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Ошибка запроса (${res.status})`)
  return data as T
}

export const api = {
  listRequests: (params?: { status?: string; mode?: string; q?: string }) => {
    const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][])
    return fetch(`/api/requests${qs.toString() ? `?${qs}` : ''}`, { cache: 'no-store' }).then(json<{ requests: RequestDTO[] }>)
  },
  getRequest: (id: string) => fetch(`/api/requests/${id}`, { cache: 'no-store' }).then(json<{ request: RequestDTO }>),
  createRequest: (body: Partial<RequestDTO>) =>
    fetch('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json<{ request: RequestDTO }>),
  action: (id: string, action: string, payload: Record<string, unknown> = {}) =>
    fetch(`/api/requests/${id}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) }).then(json<{ request: RequestDTO }>),
  uploadDocument: (id: string, body: { type: string; fileName: string; dataUri: string }) =>
    fetch(`/api/requests/${id}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json<{ document: RequestDTO['documents'][number]; request: RequestDTO }>),
  verifyDocuments: (id: string) =>
    fetch(`/api/requests/${id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(json<{ request: RequestDTO }>),

  /** Нейросеть распознаёт документы нового водителя и возвращает черновик карточки */
  intakeDriver: (docs: Partial<Record<string, { fileName: string; dataUri: string }>>) =>
    fetch('/api/drivers/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs }) }).then(json<IntakeResult>),

  /** Мгновенная нейропроверка одного документа при загрузке (соответствие вида + качество + поля) */
  checkDocument: (body: { type: string; fileName: string; dataUri: string }) =>
    fetch('/api/documents/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json<{ verdict: IntakeDocVerdict }>),

  /** Массовая подача заявок из Excel: назначение водителя/ТС на список выигранных рейсов */
  bulkAssign: (body: { carrierId: string; rows: { requestId: string; driverId: string; truckId: string; trailerId?: string }[] }) =>
    fetch('/api/requests/bulk-assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json<{ assigned: number; total: number; results: { requestId: string; number: string; ok: boolean; error?: string }[] }>),

  directory: () => fetch('/api/directory', { cache: 'no-store' }).then(json<{ carriers: CarrierDTO[]; cargoTypes: CargoTypeDTO[] }>),
  createDirectory: (kind: 'carrier' | 'driver' | 'truck' | 'trailer' | 'cargo', data: Record<string, unknown>) =>
    fetch('/api/directory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, data }) }).then(json<{ ok: boolean; driver?: DriverDTO; truck?: TruckDTO; cargoType?: CargoTypeDTO }>),
  /** Обновить запись базы аккаунта (в т.ч. сроки действия документов и справочник грузов) */
  updateDirectory: (kind: 'carrier' | 'driver' | 'truck' | 'trailer' | 'cargo', id: string, data: Record<string, unknown>) =>
    fetch('/api/directory', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, data }) }).then(json<{ ok: boolean; cargoType?: CargoTypeDTO }>),

  reports: () => fetch('/api/reports', { cache: 'no-store' }).then(json<ReportSummary>),
  events: (limit = 30) => fetch(`/api/events?limit=${limit}`, { cache: 'no-store' }).then(json<{ events: EventFeedItem[] }>),
  settings: () => fetch('/api/settings', { cache: 'no-store' }).then(json<SettingsDTO>),
  saveSettings: (data: Partial<SettingsDTO>) =>
    fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json<SettingsDTO>),
}

export type { DriverIntakeSaved }

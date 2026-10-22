/** Клиентский слой запросов к API платформы */
import type {
  CargoTypeDTO, CarrierDTO, DirectoryPhotoDTO, DriverDTO, DriverIntakeSaved, EventFeedItem, IntakeDocVerdict, IntakeResult, NotificationDTO, RequestDTO, ReportSummary, SessionUserDTO, SettingsDTO, TrailerDTO, TruckDTO,
} from '@/lib/types'

/** Событие окна: сервер ответил 401 — сессия истекла, страница показывает экран входа */
export const UNAUTHORIZED_EVENT = 'aemz:unauthorized'

// ——— токен сессии (фолбэк для окна предпросмотра, где браузер блокирует сторонние куки) ———
// Кука остаётся основным способом; если она не работает (iframe на чужом домене),
// тот же подписанный токен хранится в localStorage и уходит заголовком Authorization: Bearer.
const TOKEN_KEY = 'aemz_session_token'

export function saveSessionToken(token: string | null | undefined): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* приватный режим — работаем на куке */ }
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function clearSessionToken(): void {
  saveSessionToken(null)
}

/** init для fetch(): добавляет Authorization: Bearer из сохранённого токена (если есть) */
function withAuth(init: RequestInit = {}): RequestInit {
  const token = getSessionToken()
  if (!token) return init
  return { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }
}

/**
 * Ссылка на файл (/api/files/...) для <img src> и download-ссылок: картинка не может
 * послать заголовок Authorization, поэтому токен добавляется query-параметром t
 * (маршрут /api/files принимает его через requireUserViaRequest).
 */
export function secureFileUrl(url: string): string {
  const token = getSessionToken()
  if (!token) return url
  return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && typeof window !== 'undefined') {
    clearSessionToken()
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  if (!res.ok) throw new Error((data as { error?: string }).error || `Ошибка запроса (${res.status})`)
  return data as T
}

export const api = {
  me: () => fetch('/api/auth/me', withAuth({ cache: 'no-store' })).then(json<{ user: SessionUserDTO }>),
  logout: () => {
    clearSessionToken()
    return fetch('/api/auth/logout', { method: 'POST' }).then(json<{ ok: boolean }>)
  },

  listRequests: (params?: { status?: string; mode?: string; q?: string; includeDeleted?: boolean }) => {
    const entries: [string, string][] = Object.entries(params ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
      .map(([k, v]) => [k, v === true ? '1' : String(v)])
    const qs = new URLSearchParams(entries)
    return fetch(`/api/requests${qs.toString() ? `?${qs}` : ''}`, withAuth({ cache: 'no-store' })).then(json<{ requests: RequestDTO[] }>)
  },
  getRequest: (id: string) => fetch(`/api/requests/${id}`, withAuth({ cache: 'no-store' })).then(json<{ request: RequestDTO }>),
  createRequest: (body: Partial<RequestDTO> & { deadlineHours?: number }) =>
    fetch('/api/requests', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ request: RequestDTO }>),
  action: (id: string, action: string, payload: Record<string, unknown> = {}) =>
    fetch(`/api/requests/${id}/action`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })).then(json<{ request: RequestDTO }>),
  uploadDocument: (id: string, body: { type: string; fileName: string; dataUri: string }) =>
    fetch(`/api/requests/${id}/documents`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ document: RequestDTO['documents'][number]; request: RequestDTO }>),
  verifyDocuments: (id: string) =>
    fetch(`/api/requests/${id}/verify`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).then(json<{ request: RequestDTO }>),

  /** Нейросеть распознаёт документы нового водителя и возвращает черновик карточки */
  intakeDriver: (docs: Partial<Record<string, { fileName: string; dataUri: string }>>) =>
    fetch('/api/drivers/intake', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs }) })).then(json<IntakeResult>),

  /** Мгновенная нейропроверка одного документа при загрузке (соответствие вида + качество + поля) */
  checkDocument: (body: { type: string; fileName: string; dataUri: string }) =>
    fetch('/api/documents/check', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ verdict: IntakeDocVerdict }>),

  /** Массовая подача заявок из Excel: назначение водителя/ТС на список выигранных рейсов */
  bulkAssign: (body: { rows: { requestId: string; driverId: string; truckId: string; trailerId?: string }[] }) =>
    fetch('/api/requests/bulk-assign', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ assigned: number; total: number; results: { requestId: string; number: string; ok: boolean; error?: string }[] }>),

  directory: () => fetch('/api/directory', withAuth({ cache: 'no-store' })).then(json<{ carriers: CarrierDTO[]; cargoTypes: CargoTypeDTO[] }>),
  createDirectory: (kind: 'carrier' | 'driver' | 'truck' | 'trailer' | 'cargo', data: Record<string, unknown>, photos?: { label: string; fileName: string; dataUri: string }[]) =>
    fetch('/api/directory', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, data, photos }) })).then(json<{ ok: boolean; driver?: DriverDTO; truck?: TruckDTO; trailer?: TrailerDTO; cargoType?: CargoTypeDTO }>),
  /** Фото/документы записи справочника — для модального окна предосмотра (Task 54) */
  directoryPhotos: (kind: 'driver' | 'truck' | 'trailer', id: string) =>
    fetch(`/api/directory/photos?kind=${kind}&id=${id}`, withAuth({ cache: 'no-store' })).then(json<{ photos: DirectoryPhotoDTO[] }>),
  /** Обновить запись базы аккаунта (в т.ч. сроки действия документов и справочник грузов) */
  updateDirectory: (kind: 'carrier' | 'driver' | 'truck' | 'trailer' | 'cargo', id: string, data: Record<string, unknown>) =>
    fetch('/api/directory', withAuth({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, data }) })).then(json<{ ok: boolean; cargoType?: CargoTypeDTO }>),

  reports: () => fetch('/api/reports', withAuth({ cache: 'no-store' })).then(json<ReportSummary>),
  events: (limit = 30) => fetch(`/api/events?limit=${limit}`, withAuth({ cache: 'no-store' })).then(json<{ events: EventFeedItem[] }>),

  /** Уведомления колокольчика (Task 69): список + число непрочитанных */
  listNotifications: () =>
    fetch('/api/notifications', withAuth({ cache: 'no-store' })).then(json<{ notifications: NotificationDTO[]; unread: number }>),
  /** Отметить прочитанными: конкретные id или все сразу ({ all: true }) */
  markNotifications: (body: { ids?: string[]; all?: boolean }) =>
    fetch('/api/notifications', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ ok: boolean; unread: number }>),
  settings: () => fetch('/api/settings', withAuth({ cache: 'no-store' })).then(json<SettingsDTO>),
  saveSettings: (data: Partial<SettingsDTO>) =>
    fetch('/api/settings', withAuth({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).then(json<SettingsDTO>),
}

export type { DriverIntakeSaved }

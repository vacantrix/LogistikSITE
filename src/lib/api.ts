/** Клиентский слой запросов к API платформы */
import type {
  CargoTypeDTO, CarrierDTO, DiadocInfoDTO, DirectoryPhotoDTO, DriverDTO, DriverIntakeSaved, EdoPackageDTO, EventFeedItem, IntakeDocVerdict, IntakeResult, NotificationDTO, PlatformLogDTO, RequestDTO, ReportSummary, SessionUserDTO, SettingsDTO, TrailerDTO, TruckDTO, VehicleIntakeResult,
} from '@/lib/types'
import type { EtrnT1Input } from '@/lib/diadoc/waybill'
import type { SuggestKind, Suggestion } from '@/lib/suggest'
import {
  ACTIVE_TOKEN_KEY, accountById, getLastAccountId,
  listAccounts, migrateLegacyToken, removeAccountByToken, upsertAccount,
} from '@/lib/accounts'

/** Переключение аккаунта / «добавить аккаунт» / список сохранённых — для UI шапки и экрана входа */
export { activateAccount, beginAddAccount, listAccounts } from '@/lib/accounts'

/** Событие окна: сервер ответил 401 — сессия этой вкладки недействительна, страница показывает экран входа */
export const UNAUTHORIZED_EVENT = 'aemz:unauthorized'

// ——— токен сессии (мультиаккаунт, Task 74) ———
// Активный токен хранится в sessionStorage — СВОЙ для каждой вкладки, поэтому две
// вкладки могут работать под разными учётками. Реестр всех аккаунтов браузера —
// в localStorage (см. lib/accounts.ts): новая вкладка продолжает с последнего
// активного аккаунта, меню аккаунта позволяет переключиться. Кука остаётся фолбэком
// для контекстов без заголовка; сервер при наличии Authorization читает только его.

/**
 * Сохранить токен активной сессии этой вкладки. С user — аккаунт дополнительно
 * попадает в реестр браузера (для переключения и новых вкладок).
 */
export function saveSessionToken(token: string | null | undefined, user?: SessionUserDTO): void {
  try {
    if (token) {
      sessionStorage.setItem(ACTIVE_TOKEN_KEY, token)
      if (user) upsertAccount(user, token)
    } else {
      sessionStorage.removeItem(ACTIVE_TOKEN_KEY)
    }
  } catch { /* приватный режим — работаем на куке */ }
}

export function getSessionToken(): string | null {
  try {
    const active = sessionStorage.getItem(ACTIVE_TOKEN_KEY)
    if (active) return active
  } catch {
    return null
  }
  // Новая вкладка: продолжаем с последнего активного аккаунта реестра браузера
  try {
    migrateLegacyToken()
    const last = getLastAccountId()
    const acc = (last ? accountById(last) : null) ?? listAccounts()[0] ?? null
    if (!acc) return null
    sessionStorage.setItem(ACTIVE_TOKEN_KEY, acc.token)
    return acc.token
  } catch {
    return null
  }
}

/** init для fetch(): добавляет Authorization: Bearer из токена ЭТОЙ вкладки (если есть) */
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
    // Сессия этой вкладки недействительна: убираем из реестра только её аккаунт,
    // сохранённые аккаунты других вкладок не трогаем (мультиаккаунт, Task 74)
    try {
      const token = sessionStorage.getItem(ACTIVE_TOKEN_KEY)
      if (token) removeAccountByToken(token)
      sessionStorage.removeItem(ACTIVE_TOKEN_KEY)
    } catch { /* приватный режим */ }
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  // Журнал платформы (Task 76): серверная ошибка — отчёт из браузера (fire-and-forget),
  // чтобы в «Журнале событий» были видны и те сбои, что сервер не поймал сам.
  // Сам репорт не репортим (иначе цикл) — raw fetch с проглатыванием ошибок.
  if (res.status >= 500 && typeof window !== 'undefined' && !res.url.includes('/api/platform-log/client')) {
    void fetch('/api/platform-log/client', withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'api5xx', message: `API ${res.status}: ${res.url}`, url: res.url }),
    })).catch(() => { /* журнал недоступен — не критично */ })
  }
  if (!res.ok) throw new Error((data as { error?: string }).error || `Ошибка запроса (${res.status})`)
  return data as T
}

export const api = {
  me: () => fetch('/api/auth/me', withAuth({ cache: 'no-store' })).then(json<{ user: SessionUserDTO }>),
  logout: () => {
    // Токен уходит заголовком: сервер сбросит общую куку только если она принадлежит
    // выходящему аккаунту — сессии других вкладок/аккаунтов не затрагиваются (Task 74)
    return fetch('/api/auth/logout', withAuth({ method: 'POST' }))
      .then(json<{ ok: boolean }>)
      .finally(() => {
        try {
          const token = sessionStorage.getItem(ACTIVE_TOKEN_KEY)
          if (token) removeAccountByToken(token)
          sessionStorage.removeItem(ACTIVE_TOKEN_KEY)
        } catch { /* приватный режим */ }
      })
  },

  listRequests: (params?: { status?: string; mode?: string; q?: string; includeDeleted?: boolean }) => {
    const entries: [string, string][] = Object.entries(params ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
      .map(([k, v]) => [k, v === true ? '1' : String(v)])
    const qs = new URLSearchParams(entries)
    return fetch(`/api/requests${qs.toString() ? `?${qs}` : ''}`, withAuth({ cache: 'no-store' })).then(json<{ requests: RequestDTO[] }>)
  },
  getRequest: (id: string) => fetch(`/api/requests/${id}`, withAuth({ cache: 'no-store' })).then(json<{ request: RequestDTO }>),
  createRequest: (body: Partial<RequestDTO> & { deadlineHours?: number; draft?: boolean }) =>
    fetch('/api/requests', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ request: RequestDTO }>),
  action: (id: string, action: string, payload: Record<string, unknown> = {}) =>
    fetch(`/api/requests/${id}/action`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })).then(json<{ request: RequestDTO }>),
  uploadDocument: (id: string, body: { type: string; fileName: string; dataUri: string }) =>
    fetch(`/api/requests/${id}/documents`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ document: RequestDTO['documents'][number]; request: RequestDTO }>),
  verifyDocuments: (id: string) =>
    fetch(`/api/requests/${id}/verify`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).then(json<{ request: RequestDTO }>),

  /** Нейросеть распознаёт документы нового водителя и возвращает черновик карточки */
  intakeDriver: (docs: Partial<Record<string, { fileName: string; dataUri: string }>>, mode?: 'fast' | 'accurate') =>
    fetch('/api/drivers/intake', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs, mode }) })).then(json<IntakeResult>),

  /** Распознавание СТС для карточек «Добавить ТС»/«Добавить прицеп» (Task 83):
   * mode "fast" — лёгкая нейросеть («Автозаполнение»), "accurate" — точная («Проверить») */
  intakeVehicle: (body: { kind: 'truck' | 'trailer'; sts?: { fileName: string; dataUri: string }; stsBack?: { fileName: string; dataUri: string }; mode?: 'fast' | 'accurate' }) =>
    fetch('/api/vehicles/intake', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<VehicleIntakeResult>),

  /** Подсказки проформы водителя: адрес и место рождения — из карты, «Кем выдан» — по региону и базе */
  suggest: (body: { kind: SuggestKind; q?: string; region?: string; county?: string; address?: string; lat?: number; lon?: number; level?: 'place' }) =>
    fetch('/api/suggest', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ items: Suggestion[]; unavailable?: boolean }>),

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

  reports: (month?: string) =>
    fetch(`/api/reports${month ? `?month=${encodeURIComponent(month)}` : ''}`, withAuth({ cache: 'no-store' })).then(json<ReportSummary>),
  /** ссылка на скачивание бумажной проформы (1 — экономия, 2 — обороты); кука сессии — автоматически */
  reportDocxUrl: (type: 1 | 2, month?: string) =>
    `/api/reports/docx?type=${type}${month ? `&month=${encodeURIComponent(month)}` : ''}`,
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

  /** Журнал событий платформы (Task 76, только логист): лента + статистика за 24 ч */
  platformLog: (params?: { level?: string; q?: string; limit?: number }) => {
    const sp = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== '') as [string, string][])
    return fetch(`/api/platform-log${sp.toString() ? `?${sp}` : ''}`, withAuth({ cache: 'no-store' })).then(json<PlatformLogDTO>)
  },

  /** ЭДО (Task 76): пакеты документов рейсов + действия (формирование/подписание) */
  edoList: () => fetch('/api/edo', withAuth({ cache: 'no-store' })).then(json<{ packages: EdoPackageDTO[]; diadoc: DiadocInfoDTO }>),
  edoAction: (body: { requestId: string; action: 'sign'; docId?: string }) =>
    fetch('/api/edo', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ ok: boolean }>),
  /** Диадок: черновик ЭТрН из данных рейса и отправка титула Т1 */
  etrnDraft: (requestId: string, docId: string) =>
    fetch('/api/edo', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, docId, action: 'etrn-draft' }) })).then(json<{ draft: EtrnT1Input }>),
  etrnSend: (requestId: string, docId: string, input: EtrnT1Input) =>
    fetch('/api/edo', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, docId, action: 'etrn-send', input }) })).then(json<{ ok: boolean; message: string }>),
  /** Диадок: сверить статусы ЭТрН сейчас */
  diadocSync: () =>
    fetch('/api/edo', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'diadoc-sync' }) })).then(json<{ ok: boolean; checked: number; changed: number }>),
}

export type { DriverIntakeSaved }

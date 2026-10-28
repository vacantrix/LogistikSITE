/** Клиентский слой запросов к API платформы */
import type {
  AdminDbTableDTO, AdminDbTableData, AdminUserDTO, CargoTypeDTO, CarrierDTO, DiadocInfoDTO, DirectoryPhotoDTO, DriverDTO, DriverIntakeSaved, EdoPackageDTO, EventFeedItem, IntakeDocVerdict, IntakeResult, NotificationDTO, PermMatrixRow, PlatformLogDTO, ProfileDTO, RequestDTO, ReportSummary, SessionUserDTO, SettingsDTO, TicketDTO, TicketThreadDTO, TrailerDTO, TruckDTO, VehicleIntakeResult,
} from '@/lib/types'
import type { ReportId, ReportPreview, ReportSettings } from '@/lib/reports/catalog'
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

  reports: (params?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][])
    return fetch(`/api/reports${qs.toString() ? `?${qs}` : ''}`, withAuth({ cache: 'no-store' })).then(json<ReportSummary>)
  },
  /** Сводка отчёта из каталога по настройкам — сколько строк и на какую сумму попадёт в документ */
  reportPreview: (report: ReportId, settings: ReportSettings) =>
    fetch('/api/reports/export', withAuth({
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report, settings, preview: true }),
    })).then(json<{ preview: ReportPreview }>),
  /**
   * Сформировать отчёт и получить DOCX blob'ом: токен сессии уходит заголовком Authorization,
   * имя файла берётся из Content-Disposition (filename* UTF-8 — кириллица и пробелы сохраняются).
   */
  reportExport: async (report: ReportId, settings: ReportSettings): Promise<{ blob: Blob; fileName: string }> => {
    const res = await fetch('/api/reports/export', withAuth({
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report, settings }), cache: 'no-store',
    }))
    if (res.status === 401 && typeof window !== 'undefined') {
      // сессия недействительна — как в json(): убираем аккаунт этой вкладки и показываем экран входа
      try {
        const token = sessionStorage.getItem(ACTIVE_TOKEN_KEY)
        if (token) removeAccountByToken(token)
        sessionStorage.removeItem(ACTIVE_TOKEN_KEY)
      } catch { /* приватный режим */ }
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
      throw new Error('Требуется вход в систему')
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error || `Ошибка запроса (${res.status})`)
    }
    const cd = res.headers.get('Content-Disposition') ?? ''
    let fileName = `aemz-${report}.docx`
    const utf8 = /filename\*=UTF-8''([^;\s]+)/i.exec(cd)
    if (utf8?.[1]) {
      fileName = decodeURIComponent(utf8[1].replace(/^["']|["']$/g, ''))
    } else {
      const ascii = /filename="?([^";]+)"?/i.exec(cd)
      if (ascii?.[1]) fileName = ascii[1]
    }
    return { blob: await res.blob(), fileName }
  },
  events: (limit = 30) => fetch(`/api/events?limit=${limit}`, withAuth({ cache: 'no-store' })).then(json<{ events: EventFeedItem[] }>),

  /** Уведомления колокольчика (Task 69): список + число непрочитанных */
  listNotifications: () =>
    fetch('/api/notifications', withAuth({ cache: 'no-store' })).then(json<{ notifications: NotificationDTO[]; unread: number }>),
  /** Отметить прочитанными: конкретные id или все сразу ({ all: true }) */
  markNotifications: (body: { ids?: string[]; all?: boolean }) =>
    fetch('/api/notifications', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ ok: boolean; unread: number }>),
  /** Рассылка перевозчикам о сроках документов техники (кнопка «Уведомить агента») */
  notifyDocExpiry: () =>
    fetch('/api/notifications/doc-expiry', withAuth({ method: 'POST' })).then(json<{ notified: string[]; skipped: string[] }>),

  /** Проформа учётной записи (Task 109): прочитать / сохранить свои данные */
  getProfile: () =>
    fetch('/api/profile', withAuth({ cache: 'no-store' })).then(json<{ profile: ProfileDTO; role: string; carrierRole: 'CARRIER' | 'FORWARDER' | null }>),
  saveProfile: (data: Partial<ProfileDTO>) =>
    fetch('/api/profile', withAuth({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).then(json<{ profile: ProfileDTO }>),

  /** Права доступа (Task 111): матрица «роль × право» и её правка администрацией */
  permissions: () =>
    fetch('/api/permissions', withAuth({ cache: 'no-store' })).then(json<{ perms: PermMatrixRow[]; mine: string[] }>),
  permissionsUpdate: (updates: { role: string; key: string; allowed: boolean }[]) =>
    fetch('/api/permissions', withAuth({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }) })).then(json<{ ok: boolean; perms: PermMatrixRow[] }>),

  /** Профили и доступы (администрация, Task 109) */
  adminUsers: () =>
    fetch('/api/admin/users', withAuth({ cache: 'no-store' })).then(json<{ users: AdminUserDTO[] }>),
  adminUserCreate: (data: { login: string; name: string; password: string; role: string; carrierId?: string | null; profile?: Partial<ProfileDTO>; profileEditOwn?: 'allow' | 'deny' | null; permOverrides?: Record<string, 'allow' | 'deny'> | null }) =>
    fetch('/api/admin/users', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).then(json<{ user: AdminUserDTO }>),
  adminUserUpdate: (data: { id: string; name?: string; role?: string; carrierId?: string | null; password?: string; profile?: Partial<ProfileDTO>; profileEditOwn?: 'allow' | 'deny' | null; permOverrides?: Record<string, 'allow' | 'deny'> | null }) =>
    fetch('/api/admin/users', withAuth({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).then(json<{ user: AdminUserDTO }>),
  adminUserDelete: (id: string) =>
    fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' })).then(json<{ ok: boolean }>),

  /** Редактор базы данных (администрация, Task 109) */
  adminDbTables: () =>
    fetch('/api/admin/db', withAuth({ cache: 'no-store' })).then(json<{ tables: AdminDbTableDTO[] }>),
  adminDbTable: (table: string, params?: { q?: string; limit?: number; id?: string }) => {
    const sp = new URLSearchParams({ table })
    if (params?.q) sp.set('q', params.q)
    if (params?.limit) sp.set('limit', String(params.limit))
    if (params?.id) sp.set('id', params.id)
    return fetch(`/api/admin/db?${sp}`, withAuth({ cache: 'no-store' })).then(json<{ data?: AdminDbTableData; row?: AdminDbTableData['rows'][number] }>)
  },
  adminDbMutate: (body: { table: string; op: 'create' | 'update' | 'delete'; id?: string; data?: Record<string, string | number | boolean | null> }) =>
    fetch('/api/admin/db', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ ok: boolean; id?: string }>),

  /** Обмен документами по заявке (Task 109): доверенность/заявка от перевозчика, документы от логиста */
  uploadRequestFile: (id: string, body: { kind: string; fileName: string; dataUri: string }) =>
    fetch(`/api/requests/${id}/files`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ request: RequestDTO }>),
  deleteRequestFile: (id: string, fileId: string) =>
    fetch(`/api/requests/${id}/files?fileId=${encodeURIComponent(fileId)}`, withAuth({ method: 'DELETE' })).then(json<{ ok: boolean }>),

  /** Обращения в поддержку (Task 109) */
  tickets: (params?: { status?: string; q?: string }) => {
    const sp = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][])
    return fetch(`/api/support/tickets${sp.toString() ? `?${sp}` : ''}`, withAuth({ cache: 'no-store' })).then(json<{ tickets: TicketDTO[] }>)
  },
  createTicket: (body: { subject: string; category: string; body: string; attachments?: { fileName: string; dataUri: string }[] }) =>
    fetch('/api/support/tickets', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ ticket: TicketDTO }>),
  ticketThread: (id: string) =>
    fetch(`/api/support/tickets/${id}`, withAuth({ cache: 'no-store' })).then(json<TicketThreadDTO>),
  ticketMessage: (id: string, body: { body: string; attachments?: { fileName: string; dataUri: string }[] }) =>
    fetch(`/api/support/tickets/${id}`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(json<{ ok?: boolean }>),
  ticketStatus: (id: string, action: 'close' | 'reopen') =>
    fetch(`/api/support/tickets/${id}`, withAuth({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })).then(json<{ ok: boolean; status: string }>),
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

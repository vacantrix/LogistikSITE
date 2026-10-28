'use client'

/**
 * Платформа «Автоматизация работы с привлечённым транспортом» — единый маршрут.
 * Два вида платформы по роли: внутренний контур АЭМЗ (логисты) и кабинет перевозчика.
 * Роль и перевозчик берутся из сессии входа (/api/auth/me), а не выбираются в шапке:
 * раньше роль хранилась в браузере, и любой мог стать логистом или другим перевозчиком.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { Loader2, RefreshCw } from 'lucide-react'
import { Shell, firstTabFor, navFor, sectionAllowed, type RoleSelection } from '@/components/platform/shell'
import { RoleNotice, type TabKey } from '@/components/platform/common'
import { LoginScreen } from '@/components/platform/login-screen'
import { api, beginAddAccount, getSessionToken, UNAUTHORIZED_EVENT } from '@/lib/api'
import type { SessionUserDTO } from '@/lib/types'

import BoardTab from '@/components/platform/board'
import DraftsTab from '@/components/platform/drafts'
import ApplyTab from '@/components/platform/apply'
import MyRequestsTab from '@/components/platform/my-requests'
import CrewTab from '@/components/platform/crew'
import VerifyTab from '@/components/platform/verification'
import RegistryTab from '@/components/platform/registry'
import RequestsRegistryTab from '@/components/platform/requests-registry'
import DirectoryTab from '@/components/platform/directories'
import ReportsTab from '@/components/platform/reports'
import JournalTab from '@/components/platform/journal'
import EdoTab from '@/components/platform/edo'
import SupportTab from '@/components/platform/support'
import AdminUsersTab from '@/components/platform/admin-users'
import AdminDbTab from '@/components/platform/admin-db'
import { PermProvider, useCan } from '@/components/platform/perms'

/** Роль интерфейса из пользователя сессии */
function roleOf(user: SessionUserDTO): RoleSelection {
  if (user.role === 'admin') return { kind: 'admin' }
  return user.role === 'logist'
    ? { kind: 'logist', logistName: user.name }
    : { kind: 'carrier', carrierId: user.carrierId }
}

export default function Page() {
  // undefined — проверяем сессию, null — не вошёл
  const [user, setUser] = useState<SessionUserDTO | null | undefined>(undefined)
  const [tab, setTab] = useState<TabKey>('board')
  // real-time (Task 49): счётчик изменений с сервера
  const [liveTick, setLiveTick] = useState(0)
  // права пользователя перечитываются, когда администрация меняет должности или исключения
  const [permTick, setPermTick] = useState(0)
  // обработка потери соединения (Task 52): оверлей «Восстанавливаем соединение»
  // показывается только когда связь БЫЛА установлена и оборвалась — при первом
  // отсутствии сервиса интерфейс продолжает работать на автообновлении
  const [connLost, setConnLost] = useState(false)
  const wasConnectedRef = useRef(false)

  const loadSession = useCallback(async () => {
    try {
      const { user: u } = await api.me()
      setUser(u)
      setTab((cur) => (navFor(roleOf(u).kind).some((n) => n.key === cur) ? cur : firstTabFor(roleOf(u).kind)))
    } catch {
      setUser(null)
    }
  }, [])

  // микротаск: проверка сессии после монтирования (как раньше восстанавливалась роль)
  useEffect(() => { void Promise.resolve().then(loadSession) }, [loadSession])

  // любой ответ 401 (сессия истекла, доступ перевозчика закрыт) возвращает на экран входа
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  // журнал платформы (Task 76): неперехваченные ошибки интерфейса уходят в
  // «Журнал событий» (троттлинг — не чаще раза в 5 секунд, без спама)
  useEffect(() => {
    let lastSent = 0
    const report = (kind: string, message: string, stack?: string) => {
      const now = Date.now()
      if (now - lastSent < 5000) return
      lastSent = now
      void fetch('/api/platform-log/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message: message.slice(0, 1000), stack: stack?.slice(0, 3000), url: window.location.href }),
      }).catch(() => { /* журнал недоступен — не критично */ })
    }
    const onError = (e: ErrorEvent) => {
      if (e.message?.includes('ResizeObserver')) return // шум браузера, не ошибка платформы
      report('window.error', e.message ?? 'Неизвестная ошибка', e.error?.stack)
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? `${e.reason.message}` : String(e.reason ?? 'reject')
      report('unhandledrejection', `Обещание отклонено: ${reason}`, e.reason instanceof Error ? e.reason.stack : undefined)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  // подключение к real-time шине ws-service (Task 49) — только после входа: шина проверяет
  // ту же сессию. На стенде — через шлюз Caddy (относительный путь и порт в query XTransformPort);
  // локально без шлюза — напрямую по NEXT_PUBLIC_WS_URL (например, http://localhost:3003).
  const userId = user?.id ?? null
  useEffect(() => {
    if (!userId) return
    // Авторизация шины: кука сессии (основной способ) или токен в query — для окна
    // предпросмотра, где браузер не отдает сторонние куки (см. ws-service allowRequest).
    const token = getSessionToken()
    const direct = process.env.NEXT_PUBLIC_WS_URL
    const url = direct
      ? `${direct.replace(/\/$/, '')}/${token ? `?token=${encodeURIComponent(token)}` : ''}`
      : `/?XTransformPort=3003${token ? `&token=${encodeURIComponent(token)}` : ''}`
    const socket: Socket = io(url, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 3000,
      timeout: 10000,
    })
    socket.on('connect', () => {
      wasConnectedRef.current = true
      setConnLost(false)
    })
    const onLost = () => {
      if (wasConnectedRef.current) setConnLost(true)
    }
    socket.on('disconnect', onLost)
    socket.on('connect_error', onLost)
    socket.on('platform:update', (ev?: { type?: string }) => {
      if (ev?.type === 'PERMS_CHANGED') setPermTick((t) => t + 1)
      else setLiveTick((t) => t + 1)
    })
    return () => {
      socket.disconnect()
      wasConnectedRef.current = false
      setConnLost(false)
    }
  }, [userId])

  const logout = useCallback(async () => {
    // api.logout() снимает сессию только аккаунта этой вкладки (Task 74):
    // другие вкладки и сохранённые аккаунты продолжают работать
    await api.logout().catch(() => {})
    setUser(null)
    setTab('board')
  }, [])

  // «Добавить аккаунт» (Task 74): на экран входа, не выбрасывая сохранённые аккаунты —
  // вернуться можно одним кликом через «Продолжить как» на экране входа
  const addAccount = useCallback(() => {
    beginAddAccount()
    setUser(null)
    setTab('board')
  }, [])

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" aria-hidden />
        <span className="sr-only">Проверяем вход…</span>
      </div>
    )
  }
  if (user === null) return <LoginScreen onAuthed={() => void loadSession()} />

  // права платформы (Task 111): контекст вокруг всего интерфейса — разделы и функции
  // внутри проверяют себя через useCan(); пока права не загружены, разделы показываются
  // (сервер всё равно проверит), после загрузки лишние скрываются
  return (
    <PermProvider refreshKey={permTick}>
      <PlatformView
        user={user}
        tab={tab}
        setTab={setTab}
        liveTick={liveTick}
        connLost={connLost}
        onLogout={() => void logout()}
        onAddAccount={addAccount}
      />
    </PermProvider>
  )
}

/** Интерфейс платформы для вошедшего пользователя (внутри PermProvider — здесь доступны права) */
function PlatformView({ user, tab, setTab, liveTick, connLost, onLogout, onAddAccount }: {
  user: SessionUserDTO
  tab: TabKey
  setTab: (t: TabKey) => void
  liveTick: number
  connLost: boolean
  onLogout: () => void
  onAddAccount: () => void
}) {
  const can = useCan()
  const role = roleOf(user)
  const activeCarrierId = role.kind === 'carrier' ? role.carrierId ?? null : null
  const tabProps = { activeCarrierId, role: role.kind, onNavigate: setTab, liveTick }
  // защита: раздел недоступен текущей роли — показываем пояснение вместо содержимого;
  // часть разделов дополнительно закрыта правом (sectionAllowed — общее правило с меню)
  const allowed = navFor(role.kind).some((n) => n.key === tab) && sectionAllowed(tab, can)

  return (
    <Shell tab={tab} onNavigate={setTab} role={role} user={user} onLogout={onLogout} onAddAccount={onAddAccount} liveTick={liveTick}>
      {!allowed ? (
        <RoleNotice role={role.kind} />
      ) : (
        <>
          {tab === 'board' && <BoardTab {...tabProps} />}
          {tab === 'drafts' && <DraftsTab {...tabProps} />}
          {tab === 'apply' && <ApplyTab {...tabProps} />}
          {tab === 'my' && <MyRequestsTab {...tabProps} />}
          {tab === 'crew' && <CrewTab {...tabProps} />}
          {tab === 'verify' && <VerifyTab {...tabProps} />}
          {tab === 'requests' && <RequestsRegistryTab {...tabProps} />}
          {tab === 'registry' && <RegistryTab {...tabProps} />}
          {tab === 'edo' && <EdoTab {...tabProps} />}
          {tab === 'directory' && <DirectoryTab {...tabProps} />}
          {tab === 'reports' && <ReportsTab {...tabProps} />}
          {tab === 'journal' && <JournalTab {...tabProps} />}
          {tab === 'support' && <SupportTab {...tabProps} />}
          {tab === 'admin-users' && <AdminUsersTab {...tabProps} />}
          {tab === 'admin-db' && <AdminDbTab {...tabProps} />}
        </>
      )}

      {/* оверлей потери соединения (Task 52): спиннер + «Восстанавливаем соединение».
          Показывается при обрыве после установленной связи, исчезает при reconnect */}
      {connLost && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-white/80 backdrop-blur-sm"
          role="alert"
          aria-live="assertive"
          aria-label="Соединение потеряно, идёт восстановление"
        >
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-8 py-7 shadow-xl">
            <RefreshCw className="h-8 w-8 animate-spin text-slate-700" aria-hidden />
            <div className="text-sm font-semibold text-slate-900">Восстанавливаем соединение</div>
            <div className="text-xs text-slate-500">Связь с платформой прервалась — данные обновятся автоматически</div>
          </div>
        </div>
      )}
    </Shell>
  )
}

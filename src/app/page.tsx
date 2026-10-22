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
import { Shell, firstTabFor, navFor, type RoleSelection } from '@/components/platform/shell'
import { RoleNotice, type TabKey } from '@/components/platform/common'
import { LoginScreen } from '@/components/platform/login-screen'
import { api, getSessionToken, UNAUTHORIZED_EVENT } from '@/lib/api'
import type { SessionUserDTO } from '@/lib/types'

import BoardTab from '@/components/platform/board'
import ApplyTab from '@/components/platform/apply'
import MyRequestsTab from '@/components/platform/my-requests'
import CrewTab from '@/components/platform/crew'
import VerifyTab from '@/components/platform/verification'
import RegistryTab from '@/components/platform/registry'
import DirectoryTab from '@/components/platform/directories'
import ReportsTab from '@/components/platform/reports'

/** Роль интерфейса из пользователя сессии */
function roleOf(user: SessionUserDTO): RoleSelection {
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

  // подключение к real-time шине ws-service через шлюз (Task 49) — только после входа:
  // шина проверяет ту же куку сессии. Правила гейта: относительный путь и порт в query XTransformPort.
  const userId = user?.id ?? null
  useEffect(() => {
    if (!userId) return
    // Авторизация шины: кука сессии (основной способ) или токен в query — для окна
    // предпросмотра, где браузер не отдает сторонние куки (см. ws-service allowRequest).
    const token = getSessionToken()
    const socket: Socket = io(`/?XTransformPort=3003${token ? `&token=${encodeURIComponent(token)}` : ''}`, {
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
    socket.on('platform:update', () => setLiveTick((t) => t + 1))
    return () => {
      socket.disconnect()
      wasConnectedRef.current = false
      setConnLost(false)
    }
  }, [userId])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
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

  const role = roleOf(user)
  const activeCarrierId = role.kind === 'carrier' ? role.carrierId ?? null : null
  const tabProps = { activeCarrierId, role: role.kind, onNavigate: setTab, liveTick }
  // защита: раздел недоступен текущей роли — показываем пояснение вместо содержимого
  const allowed = navFor(role.kind).some((n) => n.key === tab)

  return (
    <Shell tab={tab} onNavigate={setTab} role={role} userName={user.name} onLogout={() => void logout()}>
      {!allowed ? (
        <RoleNotice role={role.kind} />
      ) : (
        <>
          {tab === 'board' && <BoardTab {...tabProps} />}
          {tab === 'apply' && <ApplyTab {...tabProps} />}
          {tab === 'my' && <MyRequestsTab {...tabProps} />}
          {tab === 'crew' && <CrewTab {...tabProps} />}
          {tab === 'verify' && <VerifyTab {...tabProps} />}
          {tab === 'registry' && <RegistryTab {...tabProps} />}
          {tab === 'directory' && <DirectoryTab {...tabProps} />}
          {tab === 'reports' && <ReportsTab {...tabProps} />}
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

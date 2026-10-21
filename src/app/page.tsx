'use client'

/**
 * Платформа «Автоматизация работы с привлечённым транспортом» — единый маршрут.
 * Два вида платформы по роли: внутренний контур АЭМЗ (Логист 1 / Логист 2) и
 * кабинет перевозчика. Разделы переключаются табами в рамках доступных роли.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { RefreshCw } from 'lucide-react'
import { Shell, firstTabFor, navFor, type RoleSelection } from '@/components/platform/shell'
import { RoleNotice, type TabKey } from '@/components/platform/common'
import { api } from '@/lib/api'
import type { CarrierDTO } from '@/lib/types'

import BoardTab from '@/components/platform/board'
import ApplyTab from '@/components/platform/apply'
import MyRequestsTab from '@/components/platform/my-requests'
import CrewTab from '@/components/platform/crew'
import VerifyTab from '@/components/platform/verification'
import RegistryTab from '@/components/platform/registry'
import DirectoryTab from '@/components/platform/directories'
import ReportsTab from '@/components/platform/reports'

const ROLE_STORAGE_KEY = 'aemz-platform-role'

function loadStoredRole(): RoleSelection {
  try {
    const raw = localStorage.getItem(ROLE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as RoleSelection
      if (parsed.kind === 'logist' || parsed.kind === 'carrier') return parsed
    }
  } catch { /* ignore */ }
  return { kind: 'logist', logistName: 'Логист 1' }
}

export default function Page() {
  const [tab, setTab] = useState<TabKey>('board')
  const [carriers, setCarriers] = useState<CarrierDTO[]>([])
  const [role, setRole] = useState<RoleSelection>({ kind: 'logist', logistName: 'Логист 1' })
  // real-time (Task 49): счётчик изменений с сервера
  const [liveTick, setLiveTick] = useState(0)
  // обработка потери соединения (Task 52): оверлей «Восстанавливаем соединение»
  // показывается только когда связь БЫЛА установлена и оборвалась — при первом
  // отсутствии сервиса интерфейс продолжает работать на автообновлении
  const [connLost, setConnLost] = useState(false)
  const wasConnectedRef = useRef(false)
  // роль восстанавливается из хранилища сразу после монтирования;
  // до этого момента ничего не сохраняем — чтобы не затереть выбранную ранее роль
  const restoredRef = useRef(false)

  // подключение к real-time шине ws-service через шлюз (Task 49).
  // Правила гейта: только относительный путь и порт в query XTransformPort.
  useEffect(() => {
    const socket: Socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
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
  }, [])

  useEffect(() => {
    let cancelled = false
    // микротаск: восстановление роли, затем справочник перевозчиков
    void Promise.resolve().then(() => {
      if (cancelled) return
      const stored = loadStoredRole()
      restoredRef.current = true
      setRole(stored)
      return api.directory()
        .then((d) => {
          if (cancelled) return
          setCarriers(d.carriers)
          // если сохранённый перевозчик исчез из справочника — берём первого доступного
          setRole((cur) => (
            cur.kind === 'carrier' && !d.carriers.some((c) => c.id === cur.carrierId)
              ? { ...cur, carrierId: d.carriers[0]?.id ?? null }
              : cur
          ))
        })
        .catch(() => {})
    })
    return () => { cancelled = true }
  }, [])

  // сохраняем выбранную роль между визитами
  useEffect(() => {
    if (!restoredRef.current) return
    try { localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(role)) } catch { /* ignore */ }
  }, [role])

  // при смене роли — если текущий раздел недоступен, переходим на первый доступный
  const changeRole = useCallback((r: RoleSelection) => {
    restoredRef.current = true
    setRole(r)
    setTab((cur) => (navFor(r.kind).some((n) => n.key === cur) ? cur : firstTabFor(r.kind)))
  }, [])

  const activeCarrierId = role.kind === 'carrier' ? role.carrierId ?? null : null

  const tabProps = { activeCarrierId, role: role.kind, onNavigate: setTab, liveTick }
  // защита: раздел недоступен текущей роли — показываем пояснение вместо содержимого
  const allowed = navFor(role.kind).some((n) => n.key === tab)

  return (
    <Shell
      tab={tab}
      onNavigate={setTab}
      carriers={carriers.map((c) => ({ id: c.id, name: c.name }))}
      role={role}
      onRoleChange={changeRole}
    >
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

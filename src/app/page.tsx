'use client'

/**
 * Платформа «Автоматизация работы с привлечённым транспортом» — единый маршрут.
 * Два вида платформы по роли: внутренний контур АЭМЗ (Логист 1 / Логист 2) и
 * кабинет перевозчика. Разделы переключаются табами в рамках доступных роли.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Shell, firstTabFor, navFor, type RoleSelection } from '@/components/platform/shell'
import { RoleNotice, type TabKey } from '@/components/platform/common'
import { api } from '@/lib/api'
import type { CarrierDTO } from '@/lib/types'

import DashboardTab from '@/components/platform/dashboard'
import BoardTab from '@/components/platform/board'
import ApplyTab from '@/components/platform/apply'
import MyRequestsTab from '@/components/platform/my-requests'
import AuctionsTab from '@/components/platform/auctions'
import VerifyTab from '@/components/platform/verification'
import RegistryTab from '@/components/platform/registry'
import DirectoryTab from '@/components/platform/directories'
import ReportsTab from '@/components/platform/reports'
import SettingsTab from '@/components/platform/settings'

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
  const [tab, setTab] = useState<TabKey>('dashboard')
  const [carriers, setCarriers] = useState<CarrierDTO[]>([])
  const [role, setRole] = useState<RoleSelection>({ kind: 'logist', logistName: 'Логист 1' })
  // роль восстанавливается из хранилища сразу после монтирования;
  // до этого момента ничего не сохраняем — чтобы не затереть выбранную ранее роль
  const restoredRef = useRef(false)

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

  const tabProps = { activeCarrierId, role: role.kind, onNavigate: setTab }
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
          {tab === 'dashboard' && <DashboardTab {...tabProps} />}
          {tab === 'board' && <BoardTab {...tabProps} />}
          {tab === 'apply' && <ApplyTab {...tabProps} />}
          {tab === 'my' && <MyRequestsTab {...tabProps} />}
          {tab === 'auctions' && <AuctionsTab {...tabProps} />}
          {tab === 'verify' && <VerifyTab {...tabProps} />}
          {tab === 'registry' && <RegistryTab {...tabProps} />}
          {tab === 'directory' && <DirectoryTab {...tabProps} />}
          {tab === 'reports' && <ReportsTab {...tabProps} />}
          {tab === 'settings' && <SettingsTab {...tabProps} />}
        </>
      )}
    </Shell>
  )
}

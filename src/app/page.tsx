'use client'

/**
 * Платформа «Автоматизация работы с привлечённым транспортом» — единый маршрут.
 * Разделы переключаются табами: сводка, площадка заявок, мои заявки,
 * торги, сверка документов, реестр, справочники, отчёты, настройки.
 */
import { useCallback, useEffect, useState } from 'react'
import { Shell } from '@/components/platform/shell'
import type { TabKey, TabProps } from '@/components/platform/common'
import { api } from '@/lib/api'
import type { CarrierDTO } from '@/lib/types'

import DashboardTab from '@/components/platform/dashboard'
import BoardTab from '@/components/platform/board'
import MyRequestsTab from '@/components/platform/my-requests'
import AuctionsTab from '@/components/platform/auctions'
import VerifyTab from '@/components/platform/verification'
import RegistryTab from '@/components/platform/registry'
import DirectoryTab from '@/components/platform/directories'
import ReportsTab from '@/components/platform/reports'
import SettingsTab from '@/components/platform/settings'

export default function Page() {
  const [tab, setTab] = useState<TabKey>('dashboard')
  const [carriers, setCarriers] = useState<CarrierDTO[]>([])
  const [activeCarrierId, setActiveCarrierId] = useState<string | null>(null)

  const loadCarriers = useCallback(() => {
    api.directory()
      .then((d) => {
        setCarriers(d.carriers)
        setActiveCarrierId((cur) => cur ?? d.carriers[0]?.id ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(loadCarriers, [loadCarriers])

  const props: TabProps = { activeCarrierId, onNavigate: setTab }

  return (
    <Shell
      tab={tab}
      onNavigate={setTab}
      carriers={carriers.map((c) => ({ id: c.id, name: c.name }))}
      activeCarrierId={activeCarrierId}
      onCarrierChange={setActiveCarrierId}
    >
      {tab === 'dashboard' && <DashboardTab {...props} />}
      {tab === 'board' && <BoardTab {...props} />}
      {tab === 'my' && <MyRequestsTab {...props} />}
      {tab === 'auctions' && <AuctionsTab {...props} />}
      {tab === 'verify' && <VerifyTab {...props} />}
      {tab === 'registry' && <RegistryTab {...props} />}
      {tab === 'directory' && <DirectoryTab {...props} />}
      {tab === 'reports' && <ReportsTab {...props} />}
      {tab === 'settings' && <SettingsTab {...props} />}
    </Shell>
  )
}

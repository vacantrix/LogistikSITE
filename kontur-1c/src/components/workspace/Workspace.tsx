'use client'

import { useSyncExternalStore, useState } from 'react'
import { OneCShell, type OneCSection, type OneCWindow } from '@/components/1c/OneCShell'
import { DashboardScreen } from './DashboardScreen'
import { RequestsScreen } from './RequestsScreen'
import { DispatchScreen } from './DispatchScreen'
import { TripsScreen } from './TripsScreen'
import { MonitoringScreen } from './MonitoringScreen'
import { ChatScreen } from './ChatScreen'
import { CatalogsScreen } from './CatalogsScreen'
import { JournalScreen } from './JournalScreen'
import { DemoScreen } from './DemoScreen'
import { House, ShoppingCart, Package, Truck, MessagesSquare, Settings } from 'lucide-react'

type ScreenId = 'home' | 'orders' | 'route-sheets' | 'trips' | 'monitoring' | 'chat' | 'catalogs' | 'journal' | 'demo'

// Рабочие места: окна открываются из панели разделов, как формы в 1С
const SCREENS: Record<ScreenId, { title: string; roles: string[] }> = {
  home: { title: 'Главная страница', roles: ['Логист', 'Диспетчер', 'Админ'] },
  orders: { title: 'Заказы грузоотправителей', roles: ['Логист'] },
  'route-sheets': { title: 'Маршрутные листы', roles: ['Диспетчер'] },
  trips: { title: 'Рейсы', roles: ['Диспетчер'] },
  monitoring: { title: 'Мониторинг (GPS)', roles: ['Диспетчер'] },
  chat: { title: 'Обсуждение', roles: ['Диспетчер'] },
  catalogs: { title: 'Справочники (НСИ)', roles: ['Админ'] },
  journal: { title: 'Журнал регистрации', roles: ['Админ'] },
  demo: { title: 'Демо-панель', roles: ['Логист', 'Диспетчер', 'Админ'] },
}

const ROLES = ['Логист', 'Диспетчер', 'Админ']

// Рабочее место запоминается между сеансами, как настройка пользователя 1С.
// Хранилище на localStorage + useSyncExternalStore: без расхождений гидратации.
const ROLE_KEY = 'kontur1c.role'

let roleListeners: (() => void)[] = []
function readRole(): string {
  try {
    const saved = window.localStorage.getItem(ROLE_KEY)
    return saved && ROLES.includes(saved) ? saved : 'Диспетчер'
  } catch {
    return 'Диспетчер' // приватный режим
  }
}
const roleStore = {
  subscribe(listener: () => void) {
    roleListeners.push(listener)
    return () => {
      roleListeners = roleListeners.filter((l) => l !== listener)
    }
  },
  get: readRole,
  getServer: () => 'Диспетчер',
  set(next: string) {
    try {
      window.localStorage.setItem(ROLE_KEY, next)
    } catch {
      /* приватный режим — просто не запоминаем */
    }
    for (const l of roleListeners) l()
  },
}

export function Workspace() {
  const role = useSyncExternalStore(roleStore.subscribe, roleStore.get, roleStore.getServer)

  const [openIds, setOpenIds] = useState<ScreenId[]>(['home'])
  const [activeId, setActiveId] = useState<ScreenId>('home')

  const allowed = (id: ScreenId) => SCREENS[id].roles.includes(role)

  function openWindow(id: string) {
    const sid = id as ScreenId
    if (!allowed(sid)) return
    setOpenIds((prev) => (prev.includes(sid) ? prev : [...prev, sid]))
    setActiveId(sid)
  }

  function closeWindow(id: string) {
    setOpenIds((prev) => {
      const next = prev.filter((w) => w !== id)
      setActiveId((cur) => (cur === id ? 'home' : cur))
      return next
    })
  }

  // смена рабочего места: запоминаем и закрываем окна, недоступные новой роли
  function changeRole(r: string) {
    roleStore.set(r)
    setOpenIds((prev) => {
      const next = prev.filter((w) => SCREENS[w].roles.includes(r))
      setActiveId((cur) => (next.includes(cur) ? cur : 'home'))
      return next
    })
  }

  // Панель разделов «1С:ERP»: разделы видны по правам роли (как в 1С —
  // недоступные подсистемы вообще не показываются в панели разделов)
  const sections: OneCSection[] = [
    { id: 'main', label: 'Главное', icon: <House className="h-4 w-4" />, windowId: 'home' },
    ...(allowed('orders')
      ? [{ id: 'sales', label: 'Продажи', icon: <ShoppingCart className="h-4 w-4" />, windowId: 'orders' }]
      : []),
    ...(allowed('route-sheets')
      ? [{ id: 'warehouse', label: 'Склад и доставка', icon: <Package className="h-4 w-4" />, windowId: 'route-sheets' }]
      : []),
    ...(allowed('trips')
      ? [
          {
            id: 'fleet',
            label: 'Управление автопарком',
            icon: <Truck className="h-4 w-4" />,
            menu: [
              { windowId: 'trips', label: 'Рейсы' },
              { windowId: 'monitoring', label: 'Мониторинг (GPS) — позиции машин', disabled: !allowed('monitoring') },
            ],
          },
        ]
      : []),
    ...(allowed('chat')
      ? [{ id: 'talk', label: 'Обсуждение', icon: <MessagesSquare className="h-4 w-4" />, windowId: 'chat' }]
      : []),
    {
      id: 'nsi',
      label: 'НСИ и администрирование',
      icon: <Settings className="h-4 w-4" />,
      menu: [
        { windowId: 'catalogs', label: 'Справочники (НСИ)', disabled: !allowed('catalogs') },
        { windowId: 'journal', label: 'Журнал регистрации', disabled: !allowed('journal') },
        { windowId: 'demo', label: 'Демо-панель', disabled: !allowed('demo') },
      ],
    },
  ]

  // Открытые окна в порядке открытия
  const windows: OneCWindow[] = openIds.map((id) => ({ id, title: SCREENS[id].title }))

  const close = (id: string) => closeWindow(id as ScreenId)

  return (
    <OneCShell
      sections={sections}
      windows={windows}
      activeId={activeId}
      onSelectWindow={(id) => setActiveId(id as ScreenId)}
      onOpenWindow={openWindow}
      onCloseWindow={closeWindow}
      userName="Котельников Роман Сергеевич"
      role={role}
      roles={ROLES}
      onRoleChange={changeRole}
      statusLeft="Эмулятор учётного контура 1С: справочники, документы, проведение, регистры, план обмена · экраны обновляются опросом раз в 5 секунд"
      statusRight={`Рабочее место: ${role} · Контур 1С (демо-стенд)`}
    >
      {activeId === 'home' && <DashboardScreen />}
      {activeId === 'orders' && <RequestsScreen onClose={() => close('orders')} />}
      {activeId === 'route-sheets' && <DispatchScreen onClose={() => close('route-sheets')} />}
      {activeId === 'trips' && <TripsScreen onClose={() => close('trips')} />}
      {activeId === 'monitoring' && <MonitoringScreen onClose={() => close('monitoring')} />}
      {activeId === 'chat' && <ChatScreen onClose={() => close('chat')} />}
      {activeId === 'catalogs' && <CatalogsScreen onClose={() => close('catalogs')} />}
      {activeId === 'journal' && <JournalScreen onClose={() => close('journal')} />}
      {activeId === 'demo' && <DemoScreen onClose={() => close('demo')} />}
    </OneCShell>
  )
}

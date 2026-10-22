'use client'

/**
 * Оболочка платформы: шапка с вошедшим пользователем и два вида платформы:
 *  — внутренний контур АЭМЗ (Логист 1 / Логист 2): площадка со встроенными торгами,
 *    сверка, реестр, справочники, отчёты;
 *  — кабинет перевозчика: участие в отборе рейсов, свои заявки и документы.
 *
 * Мобильная версия (ТЗ Task 67):
 *  — шапка предельно компактная (один ряд 48px), закреплена сверху (sticky) и содержит
 *    только критичное: логотип, название, колокольчик уведомлений, профиль и выход;
 *  — основное меню перенесено в нижний Tab Bar (как в мобильных приложениях):
 *    зафиксирован внизу (position: fixed), виден поверх контента при скролле,
 *    до 5 иконок с подписями, лишние разделы — в меню «Ещё»;
 *  — учтены нижние безопасные зоны iOS/Android (env(safe-area-inset-bottom)).
 *  Десктоп: прежняя шапка с горизонтальным меню + колокольчик уведомлений (Task 69).
 */
import { useState, type ComponentType } from 'react'
import {
  BarChart3, ClipboardList, FileUp, FolderOpen, LayoutGrid, ListChecks, LogOut,
  MoreHorizontal, ScanSearch, ShieldCheck, Truck, UserCog, Building2, Users,
} from 'lucide-react'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { NotificationBell } from '@/components/platform/notification-bell'
import type { RoleKind, TabKey } from '@/components/platform/common'

/** Полный список разделов с пометкой ролей: L — логист, C — перевозчик.
 *  Сводка удалена (полоса «Требует внимания» на площадке), торги влиты в площадку,
 *  настройки — будущий административный контур (экран settings.tsx остаётся в коде).
 *  Порядок вкладок перевозчика фиксирован (замечание пользователя): всё происходит
 *  по очереди — площадка → мои заявки → документы → экипаж → справочники. */
const NAV_ALL: { key: TabKey; label: string; roles: RoleKind[] }[] = [
  { key: 'board', label: 'Площадка заявок', roles: ['logist', 'carrier'] },
  { key: 'my', label: 'Мои заявки', roles: ['carrier'] },
  { key: 'apply', label: 'Подать документы', roles: ['carrier'] },
  { key: 'crew', label: 'Назначение экипажей', roles: ['carrier'] },
  { key: 'verify', label: 'Проверка документов', roles: ['logist'] },
  { key: 'requests', label: 'Реестр заявок', roles: ['logist'] },
  { key: 'registry', label: 'Реестр рейсов', roles: ['logist'] },
  { key: 'directory', label: 'Справочники', roles: ['logist', 'carrier'] },
  { key: 'reports', label: 'Отчёты', roles: ['logist'] },
]

/** Иконка и короткая подпись раздела для нижнего Tab Bar (мобильные) */
const TAB_ICONS: Record<TabKey, { Icon: ComponentType<{ className?: string }>; short: string }> = {
  board: { Icon: LayoutGrid, short: 'Площадка' },
  my: { Icon: ClipboardList, short: 'Заявки' },
  apply: { Icon: FileUp, short: 'Документы' },
  crew: { Icon: Users, short: 'Экипажи' },
  verify: { Icon: ScanSearch, short: 'Проверка' },
  requests: { Icon: ListChecks, short: 'Заявки' },
  registry: { Icon: Truck, short: 'Рейсы' },
  directory: { Icon: FolderOpen, short: 'Справочники' },
  reports: { Icon: BarChart3, short: 'Отчёты' },
}

/** Разделы, доступные выбранной роли */
export function navFor(role: RoleKind): { key: TabKey; label: string }[] {
  return NAV_ALL.filter((n) => n.roles.includes(role)).map(({ key, label }) => ({ key, label }))
}

export function firstTabFor(role: RoleKind): TabKey {
  return navFor(role)[0]?.key ?? 'board'
}

export interface RoleSelection {
  kind: RoleKind
  /** имя тестового логиста (для kind = logist) */
  logistName?: string
  /** перевозчик (для kind = carrier) */
  carrierId?: string | null
}

/** Кнопка нижней панели: иконка + короткая подпись, полоска-индикатор у активного раздела */
function TabItem({ tabKey, label, short, active, onClick, Icon }: {
  tabKey: string
  label: string
  short: string
  active: boolean
  onClick: () => void
  Icon: ComponentType<{ className?: string }>
}) {
  return (
    <button
      key={tabKey}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className={`relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 pb-1 transition-colors ${
        active ? 'text-blue-700' : 'text-slate-500 active:bg-slate-100'
      }`}
    >
      {/* индикатор активного раздела — полоска сверху */}
      <span
        aria-hidden
        className={`absolute top-0 h-0.5 w-8 rounded-full bg-blue-700 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
      />
      <Icon className="h-5 w-5" />
      <span className="max-w-full truncate text-[10px] font-medium leading-none">{short}</span>
    </button>
  )
}

/** Нижний Tab Bar (мобильные, < md): до 5 разделов иконками с подписями.
 *  Если разделов больше 5 — последний пункт «Ещё» открывает лист с остальными.
 *  Зафиксирован внизу экрана, поверх контента при скролле, с safe-area iOS/Android. */
function BottomTabBar({ tab, onNavigate, nav }: {
  tab: TabKey
  onNavigate: (t: TabKey) => void
  nav: { key: TabKey; label: string }[]
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const MAX_ITEMS = 5
  const visible = nav.slice(0, MAX_ITEMS - (nav.length > MAX_ITEMS ? 1 : 0))
  const hidden = nav.slice(visible.length)

  return (
    <>
      <nav
        aria-label="Нижняя навигация по разделам"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white shadow-[0_-4px_16px_rgba(15,23,42,0.08)] md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid auto-cols-fr grid-flow-col">
          {visible.map((n) => (
            <TabItem
              key={n.key}
              tabKey={n.key}
              label={n.label}
              short={TAB_ICONS[n.key].short}
              active={tab === n.key}
              onClick={() => onNavigate(n.key)}
              Icon={TAB_ICONS[n.key].Icon}
            />
          ))}
          {hidden.length > 0 && (
            <TabItem
              key="__more"
              tabKey="__more"
              label="Все разделы"
              short="Ещё"
              active={hidden.some((n) => n.key === tab)}
              onClick={() => setMoreOpen(true)}
              Icon={MoreHorizontal}
            />
          )}
        </div>
      </nav>

      {/* меню «Ещё»: разделы, не поместившиеся в панель */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="pb-1 text-left">
            <SheetTitle>Все разделы</SheetTitle>
            <SheetDescription>Разделы, не поместившиеся в нижнюю панель</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-1 gap-1 pb-2">
            {hidden.map((n) => {
              const { Icon } = TAB_ICONS[n.key]
              const active = tab === n.key
              return (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => { setMoreOpen(false); onNavigate(n.key) }}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="flex-1">{n.label}</span>
                  {active && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-700" aria-hidden />}
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export function Shell({ tab, onNavigate, role, userName, onLogout, liveTick, children }: {
  tab: TabKey
  onNavigate: (t: TabKey) => void
  role: RoleSelection
  /** имя вошедшего пользователя (логист или перевозчик) */
  userName: string
  onLogout: () => void
  /** счётчик live-обновлений шины WS — догружает колокольчик уведомлений (Task 69) */
  liveTick: number
  children: React.ReactNode
}) {
  const isLogist = role.kind === 'logist'
  const nav = navFor(role.kind)

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-[#0E1B2C] text-white shadow-lg shadow-slate-900/10">
        {/* Мобильная шапка (ТЗ Task 67): один ряд, минимальная высота, только критичные
            элементы — логотип, название, профиль и выход. Меню ушло в нижний Tab Bar. */}
        <div className="flex h-12 items-center gap-2 px-3 md:hidden">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </div>
          <div className="truncate text-sm font-bold leading-none">АЭМЗ Логистика</div>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <span className="max-w-[110px] truncate text-xs font-medium text-blue-100" title={userName}>
              {userName}
            </span>
            <NotificationBell role={role.kind} onNavigate={onNavigate} liveTick={liveTick} />
            <button
              type="button"
              onClick={onLogout}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/10 text-blue-100 transition-colors hover:bg-white/20 hover:text-white"
              aria-label="Выйти из платформы"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* Десктопная шапка: полный блок с бейджем контура, именем и горизонтальным меню */}
        <div className="hidden w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 md:flex">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight sm:text-base">АЭМЗ Логистика</div>
              <div className="text-[11px] uppercase tracking-widest text-slate-300">Отдел логистики</div>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* бейдж вида платформы. Real-time индикатор убран (Task 52):
                потеря связи теперь показывается оверлеем «Восстанавливаем соединение» */}
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                isLogist ? 'border-blue-400/40 bg-blue-500/15 text-blue-200' : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
              }`}
              role="status"
            >
              {isLogist ? <UserCog className="h-3.5 w-3.5" aria-hidden /> : <Building2 className="h-3.5 w-3.5" aria-hidden />}
              {isLogist ? 'Внутренний контур АЭМЗ' : 'Кабинет перевозчика'}
            </span>
            <Truck className="hidden h-4 w-4 text-blue-300 sm:block" aria-hidden />
            {/* колокольчик персональных уведомлений (Task 69) */}
            <NotificationBell role={role.kind} onNavigate={onNavigate} liveTick={liveTick} />
            {/* роль задаётся учётной записью: переключателя ролей больше нет */}
            <span className="max-w-[220px] truncate text-sm font-medium text-white sm:max-w-[280px]" title={userName}>
              {userName}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="flex h-9 items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 text-xs font-semibold text-blue-100 transition-colors hover:bg-white/20 hover:text-white"
              aria-label="Выйти из платформы"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Выйти
            </button>
          </div>
        </div>
        <nav aria-label="Разделы платформы" className="hidden border-t border-white/10 md:block">
          <div className="flex w-full gap-1 overflow-x-auto px-2 py-1.5 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {nav.map((item) => (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                aria-current={tab === item.key ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                  tab === item.key
                    ? 'bg-white font-semibold text-[#0E1B2C]'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="w-full flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="mt-auto bg-[#0E1B2C] text-blue-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs">
          <div>
            АЭМЗ · Отдел логистики
            <span className="ml-2 rounded border border-blue-100/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-blue-200">
              V 1.01
            </span>
          </div>
          <div className="text-blue-300">
            {isLogist ? userName : 'Кабинет перевозчика'}
          </div>
        </div>
      </footer>

      {/* Нижний Tab Bar (только мобильные): фиксирован поверх контента — под ним
          оставляем отбеливающий отступ, чтобы подвал не перекрывался панелью */}
      <div
        aria-hidden
        className="h-[calc(3.75rem+env(safe-area-inset-bottom,0px))] bg-[#0E1B2C] md:hidden"
      />
      <BottomTabBar tab={tab} onNavigate={onNavigate} nav={nav} />
    </div>
  )
}

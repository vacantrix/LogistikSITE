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
 *
 *  Мультиаккаунт (Task 74): вместо отдельной кнопки «Выйти» — меню аккаунта:
 *  текущий пользователь, быстрое переключение на сохранённые в браузере аккаунты,
 *  «Добавить аккаунт» (вход под новой учёткой без выбрасывания текущих сессий)
 *  и выход — затрагивающий только аккаунт этой вкладки.
 */
import { useState, type ComponentType } from 'react'
import {
  BarChart3, Building2, ChevronDown, CircleUserRound, ClipboardList, Database, FilePen, FileSignature, FileUp, FolderOpen,
  History, LayoutGrid, ListChecks, LogOut, MessagesSquare, MoreHorizontal, ScanSearch, ShieldCheck, Truck, UserCog, UserPlus, Users,
} from 'lucide-react'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificationBell } from '@/components/platform/notification-bell'
import { LogoMark } from '@/components/platform/logo-mark'
import type { RoleKind, TabKey } from '@/components/platform/common'
import type { SessionUserDTO } from '@/lib/types'
import { activateAccount, listAccounts } from '@/lib/api'

/** Полный список разделов с пометкой ролей: A — администрация, L — логист, C — перевозчик.
 *  Система прав (Task 109): три роли — администрация (профили, база данных), логист (внутренний
 *  контур), перевозчик/экспедитор (кабинет). Профиль и обращения — у всех ролей.
 *  Task 110: администрации доступны ВСЕ разделы логиста — на просмотр и правку данных
 *  (операционные решения внутри разделов остаются логисту). */
const NAV_ALL: { key: TabKey; label: string; roles: RoleKind[] }[] = [
  { key: 'board', label: 'Площадка заявок', roles: ['logist', 'carrier', 'admin'] },
  { key: 'drafts', label: 'Черновики заявок', roles: ['logist', 'admin'] },
  { key: 'my', label: 'Мои заявки', roles: ['carrier'] },
  { key: 'apply', label: 'Подать документы', roles: ['carrier'] },
  { key: 'crew', label: 'Назначение экипажей', roles: ['carrier'] },
  { key: 'verify', label: 'Проверка документов', roles: ['logist', 'admin'] },
  { key: 'requests', label: 'Реестр заявок', roles: ['logist', 'admin'] },
  { key: 'registry', label: 'Реестр рейсов', roles: ['logist', 'admin'] },
  { key: 'edo', label: 'Подписать ЭДО', roles: ['logist', 'carrier', 'admin'] },
  { key: 'directory', label: 'Справочники', roles: ['logist', 'carrier', 'admin'] },
  { key: 'reports', label: 'Отчёты', roles: ['logist', 'admin'] },
  { key: 'journal', label: 'Журнал событий', roles: ['logist', 'admin'] },
  { key: 'admin-users', label: 'Профили и доступы', roles: ['admin'] },
  { key: 'admin-db', label: 'База данных', roles: ['admin'] },
  { key: 'support', label: 'Обращения', roles: ['logist', 'carrier', 'admin'] },
  { key: 'profile', label: 'Профиль', roles: ['logist', 'carrier', 'admin'] },
]

/** Иконка и короткая подпись раздела для нижнего Tab Bar (мобильные) */
const TAB_ICONS: Record<TabKey, { Icon: ComponentType<{ className?: string }>; short: string }> = {
  board: { Icon: LayoutGrid, short: 'Площадка' },
  drafts: { Icon: FilePen, short: 'Черновики' },
  my: { Icon: ClipboardList, short: 'Заявки' },
  apply: { Icon: FileUp, short: 'Документы' },
  crew: { Icon: Users, short: 'Экипажи' },
  verify: { Icon: ScanSearch, short: 'Проверка' },
  requests: { Icon: ListChecks, short: 'Заявки' },
  registry: { Icon: Truck, short: 'Рейсы' },
  edo: { Icon: FileSignature, short: 'ЭДО' },
  directory: { Icon: FolderOpen, short: 'Справочники' },
  reports: { Icon: BarChart3, short: 'Отчёты' },
  journal: { Icon: History, short: 'Журнал' },
  'admin-users': { Icon: UserCog, short: 'Профили' },
  'admin-db': { Icon: Database, short: 'База' },
  support: { Icon: MessagesSquare, short: 'Обращения' },
  profile: { Icon: CircleUserRound, short: 'Профиль' },
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
        active ? 'text-slate-900' : 'text-slate-500 active:bg-slate-100'
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
                    active ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-100'
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

/** Иконка и бейдж роли в меню аккаунта */
function RoleIcon({ role, className }: { role: RoleKind; className?: string }) {
  if (role === 'admin') return <ShieldCheck className={`${className ?? 'h-4 w-4'} text-violet-600`} aria-hidden />
  return role === 'logist'
    ? <UserCog className={`${className ?? 'h-4 w-4'} text-blue-600`} aria-hidden />
    : <Building2 className={`${className ?? 'h-4 w-4'} text-emerald-600`} aria-hidden />
}

const roleLabelOf = (role: RoleKind): string =>
  role === 'admin' ? 'администрация' : role === 'logist' ? 'логист АЭМЗ' : 'перевозчик'

/**
 * Меню аккаунта (Task 74): текущий пользователь, переключение на сохранённые
 * в браузере аккаунты, «Добавить аккаунт» и выход. Переключение активирует токен
 * другого аккаунта для этой вкладки и перезагружает страницу.
 */
function AccountMenu({ user, compact, onLogout, onAddAccount }: {
  user: SessionUserDTO
  /** компактный вид для мобильной шапки (48px) */
  compact?: boolean
  onLogout: () => void
  onAddAccount: () => void
}) {
  const others = listAccounts().filter((a) => a.userId !== user.id)

  const switchTo = (userId: string) => {
    if (activateAccount(userId)) window.location.reload()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button
            type="button"
            aria-label="Меню аккаунта"
            title={`${user.name} — меню аккаунта`}
            className="flex h-8 min-w-0 items-center gap-1 rounded-md border border-white/20 bg-white/10 px-1.5 text-xs font-medium text-blue-100 transition-colors hover:bg-white/20 hover:text-white"
          >
            <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden />
            <span className="max-w-[92px] truncate">{user.name}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Меню аккаунта"
            title={`${user.name} — меню аккаунта`}
            className="flex h-9 max-w-full items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 text-sm font-medium text-blue-100 transition-colors hover:bg-white/20 hover:text-white"
          >
            <CircleUserRound className="h-[18px] w-[18px] shrink-0" aria-hidden />
            <span className="max-w-[180px] truncate sm:max-w-[240px]">{user.name}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate font-semibold text-slate-900">{user.name}</span>
          <span className="block truncate text-xs font-normal text-slate-500">
            {user.login} · {roleLabelOf(user.role)}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {others.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs font-medium text-slate-500">Сменить аккаунт</DropdownMenuLabel>
            {others.map((a) => (
              <DropdownMenuItem key={a.userId} onSelect={() => switchTo(a.userId)} className="gap-2.5">
                <RoleIcon role={a.role} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.name}</span>
                  <span className="block truncate text-xs text-slate-500">{a.login}</span>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={onAddAccount} className="gap-2.5">
          <UserPlus className="h-4 w-4" aria-hidden />
          Добавить аккаунт
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout} className="gap-2.5 text-red-600 focus:text-red-700">
          <LogOut className="h-4 w-4" aria-hidden />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Shell({ tab, onNavigate, role, user, onLogout, onAddAccount, liveTick, children }: {
  tab: TabKey
  onNavigate: (t: TabKey) => void
  role: RoleSelection
  /** вошедший пользователь (логист или перевозчик) */
  user: SessionUserDTO
  /** выход из аккаунта этой вкладки */
  onLogout: () => void
  /** «Добавить аккаунт»: на экран входа, сохраняя сессии других аккаунтов (Task 74) */
  onAddAccount: () => void
  /** счётчик live-обновлений шины WS — догружает колокольчик уведомлений (Task 69) */
  liveTick: number
  children: React.ReactNode
}) {
  const isLogist = role.kind === 'logist'
  const isAdmin = role.kind === 'admin'
  const nav = navFor(role.kind)
  const userName = user.name

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-[#0E1B2C] text-white shadow-lg shadow-slate-900/10">
        {/* Мобильная шапка (ТЗ Task 67): один ряд, минимальная высота, только критичные
            элементы — логотип, название, профиль и выход. Меню ушло в нижний Tab Bar. */}
        <div className="flex h-12 items-center gap-2 px-3 md:hidden">
          <LogoMark variant="inverse" className="h-7 w-7" />
          <div className="truncate text-sm font-bold leading-none">АЭМЗ Логистика</div>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <NotificationBell role={role.kind} onNavigate={onNavigate} liveTick={liveTick} />
            {/* меню аккаунта: смена/добавление/выход (Task 74) */}
            <AccountMenu user={user} compact onLogout={onLogout} onAddAccount={onAddAccount} />
          </div>
        </div>

        {/* Десктопная шапка: полный блок с бейджем контура, именем и горизонтальным меню */}
        <div className="hidden w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 md:flex">
          <div className="flex items-center gap-2.5">
            <LogoMark variant="inverse" className="h-9 w-9" />
            <div>
              <div className="text-sm font-bold leading-tight sm:text-base">АЭМЗ Логистика</div>
              <div className="text-[11px] text-slate-300">{isAdmin ? 'Администрация платформы' : isLogist ? 'Отдел логистики' : 'Кабинет перевозчика'}</div>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* Real-time индикатор убран (Task 52): потеря связи показывается оверлеем
                «Восстанавливаем соединение»; пузырь вида платформы убран (Task 70) */}
            {/* колокольчик персональных уведомлений (Task 69) */}
            <NotificationBell role={role.kind} onNavigate={onNavigate} liveTick={liveTick} />
            {/* меню аккаунта: смена/добавление/выход (Task 74); роль задаётся учётной записью */}
            <AccountMenu user={user} onLogout={onLogout} onAddAccount={onAddAccount} />
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
            АЭМЗ · {isAdmin ? 'Администрация платформы' : isLogist ? 'Отдел логистики' : 'Кабинет перевозчика'}
            <span className="ml-2 rounded border border-blue-100/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-blue-200">
              V 1.01
            </span>
          </div>
          <div className="text-blue-300">{userName}</div>
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

'use client'

/**
 * Оболочка платформы: шапка с вошедшим пользователем и два вида платформы:
 *  — внутренний контур АЭМЗ (Логист 1 / Логист 2): площадка со встроенными торгами,
 *    сверка, реестр, справочники, отчёты;
 *  — кабинет перевозчика: участие в отборе рейсов, свои заявки и документы.
 *
 *  Мобильная версия (ТЗ Task 67):
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
import { useState, useEffect, useRef, type ComponentType } from 'react'
import {
  ArrowLeft, BarChart3, BookOpen, BookUser, Bot, Brain, Building2, CalendarDays, ChevronDown, CircleUserRound, ClipboardList, CloudCog, Database, FilePen, FileSignature, FileUp, FolderOpen,
  Gavel, History, Inbox, LayoutGrid, ListChecks, Loader2, LogOut, Mail, MessagesSquare, MoreHorizontal, Network, Phone, Radar, Save, ScanSearch, ScrollText, ShieldCheck, SlidersHorizontal, Smartphone, Star, Truck,
  UserCog, UserPen, UserPlus, UserRoundCheck, Users,
} from 'lucide-react'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { NotificationBell } from '@/components/platform/notification-bell'
import { LogoMark } from '@/components/platform/logo-mark'
import { useCan } from '@/components/platform/perms'
import type { PermKey } from '@/lib/perm-catalog'
import { OneCMark, type RoleKind, type TabKey } from '@/components/platform/common'
import type { ProfileDTO, SessionUserDTO } from '@/lib/types'
import { activateAccount, api, getSessionToken, listAccounts } from '@/lib/api'

/** Полный список разделов с пометкой ролей: A — администрация, L — логист, C — перевозчик.
 *  Система прав (Task 109): три роли — администрация (максимальные права: операционный
 *  контур логиста плюс профили и база данных), логист (внутренний контур),
 *  перевозчик/экспедитор (кабинет). Профиль и обращения — у всех ролей.
 *  Task 113: внутри разделов функции скрываются по гранулярным правам (useCan).
 *
 *  Двухуровневая навигация: group = attracted — верхний уровень «Привлечённый транспорт»,
 *  own — нижний уровень «Собственный транспорт», admin — служебное меню «Управление».
 *  Видимость каждого раздела дополнительно закрыта правом section:* (SECTION_PERM). */
type NavGroup = 'attracted' | 'own' | 'admin'

const NAV_ALL: { key: TabKey; label: string; roles: RoleKind[]; group: NavGroup; muted?: boolean }[] = [
  { key: 'board', label: 'Площадка заявок', roles: ['logist', 'carrier', 'admin'], group: 'attracted' },
  { key: 'drafts', label: 'Черновики заявок', roles: ['logist', 'admin'], group: 'attracted' },
  { key: 'my', label: 'Мои заявки', roles: ['carrier'], group: 'attracted' },
  { key: 'apply', label: 'Подать документы', roles: ['carrier'], group: 'attracted' },
  { key: 'crew', label: 'Назначение экипажей', roles: ['carrier'], group: 'attracted' },
  { key: 'verify', label: 'Проверка документов', roles: ['logist', 'admin'], group: 'attracted' },
  { key: 'requests', label: 'Реестр заявок', roles: ['logist', 'admin'], group: 'attracted' },
  { key: 'registry', label: 'Реестр рейсов', roles: ['logist', 'admin'], group: 'attracted' },
  { key: 'edo', label: 'Подписать ЭДО', roles: ['logist', 'carrier', 'admin'], group: 'attracted', muted: true },
  { key: 'directory', label: 'Справочники', roles: ['logist', 'carrier', 'admin'], group: 'attracted' },
  { key: 'reports', label: 'Отчёты', roles: ['logist', 'admin'], group: 'attracted' },
  { key: 'journal', label: 'Журнал событий', roles: ['logist', 'admin'], group: 'attracted' },
  { key: 'support', label: 'Обращения', roles: ['logist', 'carrier', 'admin'], group: 'attracted' },
  { key: 'contacts', label: 'Память контактов', roles: ['logist', 'admin'], group: 'attracted' },

  { key: 'own-requests', label: 'Заявки 1С', roles: ['logist', 'admin'], group: 'own' },
  { key: 'own-atisu', label: 'ATI.SU', roles: ['logist', 'admin'], group: 'own' },
  { key: 'ai', label: 'ИИ-помощник', roles: ['logist', 'admin'], group: 'own' },
  { key: 'favorites', label: 'Избранное', roles: ['logist', 'admin'], group: 'own' },
  { key: 'own-occupancy', label: 'Занятость', roles: ['logist', 'admin'], group: 'own' },
  { key: 'own-planning', label: 'Планирование', roles: ['logist', 'admin'], group: 'own' },
  { key: 'own-monitor', label: 'Мониторинг', roles: ['logist', 'admin'], group: 'own' },
  { key: 'own-directory', label: 'Справочники парка', roles: ['logist', 'admin'], group: 'own' },
  { key: 'own-audit', label: 'Аудит контура', roles: ['admin'], group: 'own' },
  { key: 'driver-app', label: 'Приложение водителя', roles: ['admin'], group: 'own' },

  { key: 'nn', label: 'Padleocr', roles: ['admin'], group: 'admin' },
  { key: 'llm', label: 'Облачная LLM', roles: ['admin'], group: 'admin' },
  { key: 'settings', label: 'Настройки', roles: ['admin'], group: 'admin' },
  { key: 'admin-users', label: 'Профили и доступы', roles: ['admin'], group: 'admin' },
  { key: 'admin-db', label: 'База данных', roles: ['admin'], group: 'admin' },
  { key: 'arch', label: 'Архитектура', roles: ['admin'], group: 'admin' },
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
  nn: { Icon: Brain, short: 'Padleocr' },
  llm: { Icon: CloudCog, short: 'LLM' },
  settings: { Icon: SlidersHorizontal, short: 'Настройки' },
  'admin-users': { Icon: UserCog, short: 'Профили' },
  'admin-db': { Icon: Database, short: 'База' },
  arch: { Icon: Network, short: 'Архитектура' },
  support: { Icon: MessagesSquare, short: 'Обращения' },
  contacts: { Icon: BookUser, short: 'Контакты' },
  ai: { Icon: Bot, short: 'ИИ' },
  favorites: { Icon: Star, short: 'Избранное' },
  'own-requests': { Icon: Inbox, short: 'Заявки 1С' },
  'own-atisu': { Icon: Gavel, short: 'ATI.SU' },
  'own-occupancy': { Icon: LayoutGrid, short: 'Занятость' },
  'own-planning': { Icon: CalendarDays, short: 'План' },
  'own-monitor': { Icon: Radar, short: 'Мониторинг' },
  'own-directory': { Icon: BookOpen, short: 'Парк' },
  'own-audit': { Icon: ScrollText, short: 'Аудит' },
  'driver-app': { Icon: Smartphone, short: 'Водитель' },
}

/** Разделы, доступные выбранной роли. muted — раздел приглушён в навигации
 *  (в подготовке), но остаётся доступным. */
export function navFor(role: RoleKind): { key: TabKey; label: string; group: NavGroup; muted?: boolean }[] {
  return NAV_ALL.filter((n) => n.roles.includes(role)).map(({ key, label, group, muted }) => ({ key, label, group, muted }))
}

/** Короткие подписи для рядов шапки (десктоп): чтобы все кнопки вмещались
 *  в один ряд без переноса. Полное название остаётся в тултипе, боковом меню
 *  и заголовке раздела. */
const ROW_SHORT: Partial<Record<TabKey, string>> = {
  board: 'Площадка', // Площадка заявок
  drafts: 'Черновики', // Черновики заявок
  verify: 'Проверка', // Проверка документов
  requests: 'Заявки', // Реестр заявок
  registry: 'Рейсы', // Реестр рейсов
  edo: 'ЭДО', // Подписать ЭДО
  journal: 'Журнал', // Журнал событий
  contacts: 'Контакты', // Память контактов
}

/** подпись кнопки в ряду шапки: короткая, если есть, иначе полная */
function rowLabel(key: TabKey, label: string): string {
  return ROW_SHORT[key] ?? label
}

/** Разделы, закрытые правом: без права раздел не показывается в меню и не открывается */
const SECTION_PERM: Partial<Record<TabKey, PermKey>> = {
  board: 'section:board',
  drafts: 'section:drafts',
  my: 'section:my',
  apply: 'section:apply',
  crew: 'section:crew',
  verify: 'section:verify',
  requests: 'section:requests',
  registry: 'section:registry',
  edo: 'section:edo',
  directory: 'section:directory',
  reports: 'section:reports',
  journal: 'section:journal',
  support: 'section:support',
  contacts: 'section:contacts',
  ai: 'section:ai',
  favorites: 'section:ai',
  nn: 'section:neural',
  llm: 'section:llm',
  settings: 'section:settings',
  'admin-users': 'section:adminUsers',
  'admin-db': 'section:adminDb',
  arch: 'section:arch',
  'own-requests': 'section:ownRequests',
  'own-atisu': 'section:ownAtisu',
  'own-occupancy': 'section:ownOccupancy',
  'own-planning': 'section:ownPlanning',
  'own-monitor': 'section:ownMonitor',
  'own-directory': 'section:ownDirectory',
  'own-audit': 'section:ownAudit',
  'driver-app': 'section:driverApp',
}

export function sectionAllowed(tab: TabKey, can: (key: PermKey) => boolean): boolean {
  const key = SECTION_PERM[tab]
  return !key || can(key)
}

export const isOwnTab = (tab: TabKey): boolean => tab.startsWith('own-')

export function firstTabFor(role: RoleKind): TabKey {
  return navFor(role)[0]?.key ?? 'board'
}

/** Первый доступный раздел с учётом прав: используется после загрузки прав и при смене роли */
export function firstAllowedTab(role: RoleKind, can: (key: PermKey) => boolean): TabKey {
  return navFor(role).find((n) => sectionAllowed(n.key, can))?.key ?? firstTabFor(role)
}

export interface RoleSelection {
  kind: RoleKind
  /** имя тестового логиста (для kind = logist) */
  logistName?: string
  /** перевозчик (для kind = carrier) */
  carrierId?: string | null
}

/** Кнопка нижней панели: иконка + короткая подпись, полоска-индикатор у активного раздела */
function TabItem({ tabKey, label, short, active, onClick, Icon, muted }: {
  tabKey: string
  label: string
  short: string
  active: boolean
  onClick: () => void
  Icon: ComponentType<{ className?: string }>
  muted?: boolean
}) {
  return (
    <button
      key={tabKey}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={muted ? `${label} — в подготовке` : label}
      className={`relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 pb-1 transition-colors ${
        active ? 'text-slate-900' : muted ? 'text-slate-400/70 active:bg-slate-100' : 'text-slate-500 active:bg-slate-100'
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
  nav: { key: TabKey; label: string; muted?: boolean }[]
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
              muted={n.muted}
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
                    active ? 'bg-slate-100 text-slate-900' : n.muted ? 'text-slate-400 hover:bg-slate-50' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="flex-1">{n.label}</span>
                  {n.muted && !active && <span className="text-[11px] font-normal text-slate-400">в подготовке</span>}
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

/** Данные проформы для плашки аккаунта: ФИО крупнее, ниже — должность и организация.
 *  Без проформы — имя учётки и роль. */
function pillLines(profile: ProfileDTO | null, user: SessionUserDTO): { title: string; position: string; company: string } {
  return {
    title: profile?.fullName?.trim() || user.name,
    position: profile?.position?.trim() || '',
    company: profile?.companyName?.trim() || '',
  }
}

/** Строка под ФИО в триггере плашки: должность слева, затем организация (переносится внутри пузыря) */
const pillSub = (l: { position: string; company: string }, fallback: string): string =>
  [l.position, l.company].filter(Boolean).join(' · ') || fallback

/** Редактируемые поля проформы — форма правки переехала из раздела «Профиль» в плашку */
type ProfileDraft = Pick<ProfileDTO,
  'fullName' | 'position' | 'phone' | 'email' | 'companyName' | 'inn' | 'kpp' | 'address' | 'director' | 'contactName' | 'note'>

const toDraft = (p: ProfileDTO): ProfileDraft => ({
  fullName: p.fullName, position: p.position, phone: p.phone, email: p.email,
  companyName: p.companyName, inn: p.inn, kpp: p.kpp, address: p.address,
  director: p.director, contactName: p.contactName, note: p.note,
})

/** Поле формы правки профиля внутри плашки */
function EditField({ id, label, value, onChange, placeholder, type = 'text' }: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-[11px] font-normal text-slate-500">{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
    </div>
  )
}

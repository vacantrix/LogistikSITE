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

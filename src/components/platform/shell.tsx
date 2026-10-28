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
import { useState, useEffect, useRef, type ComponentType } from 'react'
import {
  ArrowLeft, BarChart3, Building2, ChevronDown, CircleUserRound, ClipboardList, Database, FilePen, FileSignature, FileUp, FolderOpen,
  History, LayoutGrid, ListChecks, Loader2, LogOut, Mail, MessagesSquare, MoreHorizontal, Phone, Save, ScanSearch, ShieldCheck, Truck,
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
import type { RoleKind, TabKey } from '@/components/platform/common'
import type { ProfileDTO, SessionUserDTO } from '@/lib/types'
import { activateAccount, api, listAccounts } from '@/lib/api'

/** Полный список разделов с пометкой ролей: A — администрация, L — логист, C — перевозчик.
 *  Система прав (Task 109): три роли — администрация (максимальные права: операционный
 *  контур логиста плюс профили и база данных), логист (внутренний контур),
 *  перевозчик/экспедитор (кабинет). Профиль и обращения — у всех ролей.
 *  Task 113: внутри разделов функции скрываются по гранулярным правам (useCan). */
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
}

/** Разделы, доступные выбранной роли */
export function navFor(role: RoleKind): { key: TabKey; label: string }[] {
  return NAV_ALL.filter((n) => n.roles.includes(role)).map(({ key, label }) => ({ key, label }))
}

/** Разделы, закрытые правом: без права раздел не показывается в меню и не открывается */
const SECTION_PERM: Partial<Record<TabKey, PermKey>> = {
  reports: 'reports:view',
  'admin-users': 'admin:users',
  'admin-db': 'admin:db',
}

export function sectionAllowed(tab: TabKey, can: (key: PermKey) => boolean): boolean {
  const key = SECTION_PERM[tab]
  return !key || can(key)
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

/**
 * Меню аккаунта: белая плашка — полноценный раздел «Профиль» (Task 114):
 * просмотр по макету (крупный значок человека, ФИО, должность · организация,
 * телефон и почта) и правка прямо внутри плашки — все поля проформы; без права
 * profile:edit пункт «Изменить профиль» отсутствует вовсе. Здесь же переключение
 * на сохранённые аккаунты, «Добавить аккаунт» и выход (Task 74). Строка «логин ·
 * роль» не показывается (Task 113); после сохранения рядом с ФИО появляется
 * значок человека «Профиль обновлён» (гаснет через несколько секунд).
 */
function AccountMenu({ user, profile, compact, canEditProfile, onLogout, onAddAccount }: {
  user: SessionUserDTO
  /** проформа текущего пользователя (ФИО, должность, организация, контакты) */
  profile: ProfileDTO | null
  /** компактный вид для мобильной шапки (48px) */
  compact?: boolean
  /** право «Редактирование своего профиля» — показывает «Изменить профиль» */
  canEditProfile?: boolean
  onLogout: () => void
  onAddAccount: () => void
}) {
  const { toast } = useToast()
  const others = listAccounts().filter((a) => a.userId !== user.id)
  const pill = pillLines(profile, user)
  const phone = profile?.phone?.trim() || ''
  const email = profile?.email?.trim() || ''
  const isCarrier = user.role === 'carrier'
  // значок человека при изменении профиля: событие из плашки или из «Профилей и доступов»
  const [justUpdated, setJustUpdated] = useState(false)
  const updatedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const onProfileUpdated = () => {
      setJustUpdated(true)
      if (updatedTimer.current) clearTimeout(updatedTimer.current)
      updatedTimer.current = setTimeout(() => setJustUpdated(false), 8000)
    }
    window.addEventListener('aemz:profile-updated', onProfileUpdated)
    return () => {
      window.removeEventListener('aemz:profile-updated', onProfileUpdated)
      if (updatedTimer.current) clearTimeout(updatedTimer.current)
    }
  }, [])

  // ——— правка профиля внутри плашки ———
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    if (!profile) return
    setDraft(toDraft(profile))
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    setDraft(null)
  }
  const saveEdit = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const res = await api.saveProfile(draft)
      setDraft(toDraft(res.profile))
      setEditing(false)
      // плашка обновится через собственный слушатель этого события
      window.dispatchEvent(new CustomEvent<ProfileDTO>('aemz:profile-updated', { detail: res.profile }))
      toast({ title: 'Профиль сохранён' })
    } catch (e) {
      toast({
        title: 'Не удалось сохранить профиль',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }
  const setField = (key: keyof ProfileDraft) => (v: string) =>
    setDraft((d) => (d ? { ...d, [key]: v } : d))

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
            title={`${pill.title} — меню аккаунта`}
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
            title={`${pill.title} — меню аккаунта`}
            className="flex max-w-full items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-left transition-colors hover:bg-white/20 hover:text-white"
          >
            <CircleUserRound className="h-[22px] w-[22px] shrink-0" aria-hidden />
            <span className="flex min-w-0 max-w-[150px] flex-col leading-tight sm:max-w-[240px]">
              <span className="truncate text-[15px] font-semibold text-white">{pill.title}</span>
              <span className="line-clamp-2 break-words text-left text-[11px] font-normal leading-snug text-blue-100/85">
                {pillSub(pill, roleLabelOf(user.role))}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[calc(100vh-5rem)] w-80 overflow-y-auto">
        {editing && draft ? (
          // ——— правка профиля внутри плашки (бывший раздел «Профиль») ———
          <div className="p-1">
            <div className="flex items-center gap-1 px-1.5 pb-2 pt-1">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                aria-label="Вернуться к профилю"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </button>
              <span className="text-sm font-semibold text-slate-900">Изменение профиля</span>
            </div>
            <div className="space-y-2.5 border-t border-slate-100 pt-2.5">
              <EditField id="menu-fullname" label="ФИО" value={draft.fullName} onChange={setField('fullName')} placeholder="Иванов Иван Иванович" />
              <EditField id="menu-position" label="Должность" value={draft.position} onChange={setField('position')} placeholder="Менеджер по логистике" />
              <EditField id="menu-phone" label="Телефон" value={draft.phone} onChange={setField('phone')} placeholder="+7 900 000-00-00" />
              <EditField id="menu-email" label="Рабочая почта" type="email" value={draft.email} onChange={setField('email')} placeholder="name@company.ru" />
              {isCarrier && (
                <>
                  <EditField id="menu-company" label="Наименование организации" value={draft.companyName} onChange={setField('companyName')} placeholder="ООО «Перевозчик»" />
                  <div className="grid grid-cols-2 gap-2.5">
                    <EditField id="menu-inn" label="ИНН" value={draft.inn} onChange={setField('inn')} placeholder="0000000000" />
                    <EditField id="menu-kpp" label="КПП" value={draft.kpp} onChange={setField('kpp')} placeholder="000000000" />
                  </div>
                  <EditField id="menu-address" label="Юридический адрес" value={draft.address} onChange={setField('address')} placeholder="Индекс, город, улица, дом" />
                  <EditField id="menu-director" label="Руководитель" value={draft.director} onChange={setField('director')} placeholder="Генеральный директор" />
                  <EditField id="menu-contact" label="Контактное лицо" value={draft.contactName} onChange={setField('contactName')} placeholder="ФИО и телефон" />
                </>
              )}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="menu-note" className="text-[11px] font-normal text-slate-500">Примечание</Label>
                <Textarea
                  id="menu-note"
                  value={draft.note}
                  onChange={(e) => setField('note')(e.target.value)}
                  rows={2}
                  placeholder="Реквизиты договора и другие заметки"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-3">
              <Button variant="outline" className="h-9 flex-1" onClick={cancelEdit} disabled={saving}>
                Отмена
              </Button>
              <Button className="h-9 flex-1" onClick={() => void saveEdit()} disabled={saving}>
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  : <Save className="h-4 w-4" aria-hidden />}
                Сохранить
              </Button>
            </div>
          </div>
        ) : (
          // ——— просмотр: карточка профиля по макету ———
          <>
            <DropdownMenuLabel className="px-0">
              <div className="flex flex-col items-center px-4 pb-2 pt-3 text-center">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100" aria-hidden>
                  <CircleUserRound className="h-9 w-9 text-slate-400" />
                </span>
                <span className="mt-2.5 block break-words text-base font-bold leading-snug text-slate-900">{pill.title}</span>
                {justUpdated && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <UserRoundCheck className="h-3 w-3" aria-hidden />
                    Профиль обновлён
                  </span>
                )}
                {(pill.position || pill.company) && (
                  <span className="mt-0.5 block break-words text-center text-xs leading-snug text-slate-500">
                    {[pill.position, pill.company].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <div className="space-y-1.5 border-t border-slate-100 px-3.5 pt-2.5">
                <span className="flex items-center gap-2 text-xs text-slate-600">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className={`min-w-0 truncate ${phone ? '' : 'text-slate-300'}`}>{phone || 'Телефон не указан'}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-slate-600">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className={`min-w-0 truncate ${email ? '' : 'text-slate-300'}`}>{email || 'Почта не указана'}</span>
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* правка профиля — только с правом: без права пункт отсутствует.
                Обычная кнопка вместо DropdownMenuItem — меню не закрывается при переходе к форме */}
            {canEditProfile && (
              <button
                type="button"
                role="menuitem"
                onClick={startEdit}
                disabled={!profile}
                className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-slate-100 focus:bg-slate-100 disabled:opacity-50"
              >
                <UserPen className="h-4 w-4" aria-hidden />
                Изменить профиль
              </button>
            )}
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
          </>
        )}
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
  const can = useCan()
  // разделы роли; «Отчёты» дополнительно закрыты правом reports:view (Task 111) —
  // без права пункт меню исчезает целиком
  const nav = navFor(role.kind).filter((n) => sectionAllowed(n.key, can))
  const userName = user.name
  // проформа для плашки аккаунта: ФИО, должность, организация (Task 111)
  const [profile, setProfile] = useState<ProfileDTO | null>(null)
  useEffect(() => {
    let alive = true
    api.getProfile().then((d) => { if (alive) setProfile(d.profile) }).catch(() => { /* плашка покажет имя учётки */ })
    return () => { alive = false }
  }, [user.id])
  // сохранение проформы в разделе «Профиль» отражается в плашке сразу (Task 112)
  useEffect(() => {
    const onProfileUpdated = (e: Event) => {
      const detail = (e as CustomEvent<ProfileDTO>).detail
      if (detail) setProfile(detail)
    }
    window.addEventListener('aemz:profile-updated', onProfileUpdated)
    return () => window.removeEventListener('aemz:profile-updated', onProfileUpdated)
  }, [])
  // проформа может быть отредактирована админом в «Профилях и доступах» — обновляем по возврату на вкладку
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        api.getProfile().then((d) => setProfile(d.profile)).catch(() => { /* плашка покажет прошлые данные */ })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

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
            <AccountMenu
              user={user}
              profile={profile}
              compact
              canEditProfile={can('profile:edit')}
              onLogout={onLogout}
              onAddAccount={onAddAccount}
            />
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
            <AccountMenu
              user={user}
              profile={profile}
              canEditProfile={can('profile:edit')}
              onLogout={onLogout}
              onAddAccount={onAddAccount}
            />
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

'use client'

/**
 * «Память контактов» (Task 5) — рабочая тетрадь логиста/экспедитора.
 *
 * С кем работали и какие сделки заключались: перевозчики, грузовладельцы, водители
 * и менеджеры биржи — включая «отказных», чтобы не звонить повторно в пустоту.
 * Контакты выводятся карточками, клик по карточке раскрывает её сделки; добавление
 * и правка — в диалогах, перечисления (тип, статус, рейтинг) — кнопками-чипами.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookUser,
  ChevronDown,
  Handshake,
  Loader2,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  SectionHeader,
  type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { getSessionToken } from '@/lib/api'

/** Тонкий аккуратный скроллбар для длинных списков сделок */
const THIN_SCROLL =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

// ——— типы ответа API ———

interface DealDTO {
  id: string
  contactId: string
  direction: string
  route: string
  cargo: string
  amount: number | null
  status: string
  dealDate: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

interface ContactDTO {
  id: string
  name: string
  company: string
  kind: string
  phone: string
  email: string
  source: string
  atiRef: string | null
  rating: number
  notes: string
  createdAt: string
  updatedAt: string
  deals: DealDTO[]
  dealsTotal: number
  dealsDone: number
  lastDealAt: string | null
}

interface ContactsResponse {
  contacts: ContactDTO[]
  stats: { total: number; done: number; talks: number; refused: number }
}

// ——— собственный тонкий fetch к API (lib/api.ts не трогаем) ———

/** Запрос с токеном этой вкладки и JSON-заголовками; при 401 — обычная ошибка */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (init?.body !== undefined && init?.body !== null) headers['Content-Type'] = 'application/json'
  const token = getSessionToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { ...init, headers })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(String((data as { error?: string }).error || `Ошибка запроса (${res.status})`))
  }
  return data as T
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Неизвестная ошибка')

/** Сумма сделки: «125 000 ₽» или прочерк */
const fmtAmount = (amount: number | null): string =>
  amount === null || amount === undefined ? '—' : `${amount.toLocaleString('ru-RU')} ₽`

// ——— подписи и цвета ———

const KIND_META: Record<string, { label: string; badge: string }> = {
  carrier: { label: 'Перевозчик', badge: 'border-transparent bg-slate-100 text-slate-700' },
  shipper: { label: 'Грузовладелец', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  driver: { label: 'Водитель', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
  other: { label: 'Другое', badge: 'border-transparent bg-slate-100 text-slate-600' },
}

const STATUS_META: Record<string, { label: string; badge: string }> = {
  talks: { label: 'Переговоры', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
  done: { label: 'Заключена', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  refuse: { label: 'Отказ', badge: 'border-red-200 bg-red-50 text-red-700' },
  lost: { label: 'Не вышло', badge: 'border-transparent bg-slate-100 text-slate-600' },
}

const DIRECTION_LABEL: Record<string, string> = { load: 'Груз', truck: 'Машина' }

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'carrier', label: 'Перевозчики' },
  { value: 'shipper', label: 'Грузовладельцы' },
  { value: 'driver', label: 'Водители' },
  { value: 'other', label: 'Другое' },
]

// ——— формы диалогов ———

interface ContactForm {
  name: string
  company: string
  kind: string
  phone: string
  email: string
  atiRef: string
  rating: number
  notes: string
}

interface DealForm {
  direction: string
  route: string
  cargo: string
  amount: string
  status: string
  dealDate: string
  notes: string
}

const EMPTY_CONTACT: ContactForm = {
  name: '',
  company: '',
  kind: 'carrier',
  phone: '',
  email: '',
  atiRef: '',
  rating: 0,
  notes: '',
}

const EMPTY_DEAL: DealForm = {
  direction: 'load',
  route: '',
  cargo: '',
  amount: '',
  status: 'talks',
  dealDate: '',
  notes: '',
}

/** Кнопка-чип для перечислений (тип, статус, рейтинг): min 44px под палец */
function Chip({ active, onClick, children, className = '' }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900'
      } ${className}`}
    >
      {children}
    </button>
  )
}

/** Рейтинг 0..5 звёздами: заполненные — янтарные, пустые — серые */
function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Рейтинг: ${rating} из 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={`h-4 w-4 ${i < rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'}`}
        />
      ))}
    </span>
  )
}

/** Строка сделки в раскрытой карточке контакта */
function DealRow({ deal, onEdit, onDelete }: {
  deal: DealDTO
  onEdit: () => void
  onDelete: () => void
}) {
  const status = STATUS_META[deal.status] ?? { label: deal.status, badge: 'border-transparent bg-slate-100 text-slate-600' }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant="outline" className="border-slate-200 text-slate-600">
          {DIRECTION_LABEL[deal.direction] ?? deal.direction}
        </Badge>
        <span className="min-w-0 text-sm font-medium text-slate-800">{deal.route || '—'}</span>
        <span className="ml-auto whitespace-nowrap text-sm font-semibold text-slate-900">{fmtAmount(deal.amount)}</span>
      </div>
      {deal.cargo && <div className="mt-1 text-sm text-slate-500">{deal.cargo}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge className={status.badge}>{status.label}</Badge>
        {deal.dealDate && <span className="text-xs text-slate-500">{deal.dealDate}</span>}
        {deal.notes && <span className="min-w-0 basis-full truncate text-xs text-slate-400">{deal.notes}</span>}
      </div>
      <div className="mt-2 flex justify-end gap-1">
        <Button
          variant="ghost"
          className="h-11 px-3 text-slate-500 hover:text-slate-900"
          onClick={onEdit}
          aria-label={`Изменить сделку ${deal.route || 'без маршрута'}`}
        >
          <Pencil aria-hidden />
          Изменить
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="h-11 px-3 text-slate-500 hover:text-red-600" aria-label={`Удалить сделку ${deal.route || 'без маршрута'}`}>
              <Trash2 aria-hidden />
              Удалить
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить сделку?</AlertDialogTitle>
              <AlertDialogDescription>
                {`«${deal.route || 'без маршрута'}» — запись о сделке будет удалена безвозвратно.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Удалить</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

/** Карточка контакта: шапка кликабельна и раскрывает блок сделок */
function ContactCard({ contact, expanded, onToggle, onEdit, onAddDeal, onEditDeal, onDeleteContact, onDeleteDeal }: {
  contact: ContactDTO
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onAddDeal: () => void
  onEditDeal: (deal: DealDTO) => void
  onDeleteContact: () => void
  onDeleteDeal: (deal: DealDTO) => void
}) {
  const kind = KIND_META[contact.kind] ?? KIND_META.other
  return (
    <Card className="border-slate-200 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            aria-label={`Контакт ${contact.name}${contact.dealsTotal > 0 ? `, сделок ${contact.dealsTotal}` : ''}`}
            onClick={onToggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle()
              }
            }}
            className="min-w-0 flex-1 cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold leading-snug text-slate-900">{contact.name}</span>
              <Badge className={kind.badge}>{kind.label}</Badge>
              <ChevronDown
                aria-hidden
                className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </div>
            {contact.company && <div className="mt-0.5 truncate text-sm text-slate-500">{contact.company}</div>}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-11 text-slate-500 hover:text-slate-900"
              onClick={onEdit}
              aria-label={`Изменить контакт ${contact.name}`}
              title="Изменить"
            >
              <Pencil aria-hidden />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 text-slate-500 hover:text-red-600"
                  aria-label={`Удалить контакт ${contact.name}`}
                  title="Удалить"
                >
                  <Trash2 aria-hidden />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Удалить контакт?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {`«${contact.name}» и все его сделки (${contact.dealsTotal}) будут удалены безвозвратно.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction onClick={onDeleteContact}>Удалить</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Phone aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />
            {contact.phone ? <span className="truncate">{contact.phone}</span> : <span className="text-slate-400">телефон не указан</span>}
          </span>
          <RatingStars rating={contact.rating} />
        </div>

        {contact.notes && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{contact.notes}</p>}

        <div className="mt-2 text-sm text-slate-600">{`Сделок: ${contact.dealsTotal} · заключено ${contact.dealsDone}`}</div>

        {expanded && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-700">Сделки</span>
              <Button variant="outline" className="h-11 px-3" onClick={onAddDeal}>
                <Plus aria-hidden />
                Сделка
              </Button>
            </div>
            {contact.deals.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">Сделок пока нет — добавьте первую</p>
            ) : (
              <div className={`mt-2 max-h-96 space-y-2 overflow-y-auto pr-1 ${THIN_SCROLL}`}>
                {contact.deals.map((deal) => (
                  <DealRow key={deal.id} deal={deal} onEdit={() => onEditDeal(deal)} onDelete={() => onDeleteDeal(deal)} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ——— раздел ———

export default function ContactsMemoryTab({ liveTick }: TabProps) {
  const { toast } = useToast()
  const [contacts, setContacts] = useState<ContactDTO[]>([])
  const [stats, setStats] = useState<ContactsResponse['stats']>({ total: 0, done: 0, talks: 0, refused: 0 })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [contactDialog, setContactDialog] = useState<{ open: boolean; edit: ContactDTO | null }>({ open: false, edit: null })
  const [contactForm, setContactForm] = useState<ContactForm>(EMPTY_CONTACT)
  const [dealDialog, setDealDialog] = useState<{ open: boolean; contactId: string; edit: DealDTO | null }>({
    open: false,
    contactId: '',
    edit: null,
  })
  const [dealForm, setDealForm] = useState<DealForm>(EMPTY_DEAL)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await apiFetch<ContactsResponse>('/api/contacts')
      setContacts(data.contacts)
      setStats(data.stats)
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // первая загрузка и автообновление по liveTick (Task 49) + ручное «Обновить»
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts.filter((c) => {
      if (kindFilter !== 'all' && c.kind !== kindFilter) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q)
        || c.company.toLowerCase().includes(q)
        || c.phone.toLowerCase().includes(q)
        || c.deals.some((d) => d.route.toLowerCase().includes(q))
      )
    })
  }, [contacts, search, kindFilter])

  function openContact(edit: ContactDTO | null) {
    setContactForm(
      edit
        ? {
            name: edit.name,
            company: edit.company,
            kind: edit.kind,
            phone: edit.phone,
            email: edit.email,
            atiRef: edit.atiRef ?? '',
            rating: edit.rating,
            notes: edit.notes,
          }
        : { ...EMPTY_CONTACT },
    )
    setContactDialog({ open: true, edit })
  }

  function openDeal(contactId: string, edit: DealDTO | null) {
    setDealForm(
      edit
        ? {
            direction: edit.direction,
            route: edit.route,
            cargo: edit.cargo,
            amount: edit.amount === null ? '' : String(edit.amount),
            status: edit.status,
            dealDate: edit.dealDate ?? '',
            notes: edit.notes,
          }
        : { ...EMPTY_DEAL },
    )
    setDealDialog({ open: true, contactId, edit })
  }

  async function submitContact() {
    const name = contactForm.name.trim()
    if (!name) {
      toast({ title: 'Укажите имя контакта', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = { ...contactForm, name, atiRef: contactForm.atiRef.trim() || null }
      if (contactDialog.edit) {
        await apiFetch(`/api/contacts/${contactDialog.edit.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/api/contacts', { method: 'POST', body: JSON.stringify(payload) })
      }
      toast({ title: 'Контакт сохранён' })
      setContactDialog({ open: false, edit: null })
      await load()
    } catch (e) {
      toast({ title: `Не удалось сохранить: ${errMsg(e)}`, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function submitDeal() {
    const amountRaw = dealForm.amount.trim()
    let amount: number | null = null
    if (amountRaw !== '') {
      const n = Number(amountRaw.replace(',', '.'))
      if (!Number.isFinite(n)) {
        toast({ title: 'Сумма должна быть числом', variant: 'destructive' })
        return
      }
      amount = n
    }
    setSaving(true)
    try {
      const payload = {
        direction: dealForm.direction,
        route: dealForm.route,
        cargo: dealForm.cargo,
        amount,
        status: dealForm.status,
        dealDate: dealForm.dealDate.trim() || null,
        notes: dealForm.notes,
      }
      if (dealDialog.edit) {
        await apiFetch(`/api/deals/${dealDialog.edit.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch(`/api/contacts/${dealDialog.contactId}/deals`, { method: 'POST', body: JSON.stringify(payload) })
      }
      toast({ title: 'Сделка сохранена' })
      setDealDialog((s) => ({ ...s, open: false }))
      await load()
    } catch (e) {
      toast({ title: `Не удалось сохранить: ${errMsg(e)}`, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function removeContact(contact: ContactDTO) {
    try {
      await apiFetch(`/api/contacts/${contact.id}`, { method: 'DELETE' })
      toast({ title: 'Контакт удалён' })
      await load()
    } catch (e) {
      toast({ title: `Не удалось удалить: ${errMsg(e)}`, variant: 'destructive' })
    }
  }

  async function removeDeal(deal: DealDTO) {
    try {
      await apiFetch(`/api/deals/${deal.id}`, { method: 'DELETE' })
      toast({ title: 'Сделка удалена' })
      await load()
    } catch (e) {
      toast({ title: `Не удалось удалить: ${errMsg(e)}`, variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        eyebrow="Привлечённый транспорт"
        tone="blue"
        title="Память контактов"
        desc="С кем работали и какие сделки заключались: перевозчики, грузовладельцы, водители и менеджеры биржи — включая тех, с кем не сложилось, чтобы не звонить повторно в пустоту"
      >
        <Button variant="outline" size="sm" className="h-9" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw aria-hidden className={`mr-1 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </SectionHeader>

      {loading ? (
        <LoadingBlock label="Загружаем рабочую тетрадь…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              icon={<BookUser aria-hidden className="h-5 w-5" />}
              label="Контактов"
              value={stats.total}
              hint="Все, с кем хотя бы разговаривали по сделке — включая «отказных»"
            />
            <KpiCard
              icon={<Handshake aria-hidden className="h-5 w-5" />}
              label="Сделок заключено"
              value={stats.done}
              tone="green"
              hint="Заключённые и выполненные сделки по всем контактам"
            />
            <KpiCard
              icon={<Phone aria-hidden className="h-5 w-5" />}
              label="В переговорах"
              value={stats.talks}
              tone="amber"
              hint="Сделки, по которым переговоры ещё идут"
            />
            <KpiCard
              icon={<XCircle aria-hidden className="h-5 w-5" />}
              label="Отказов"
              value={stats.refused}
              hint="Отказались от сотрудничества — не звонить повторно в пустоту"
            />
          </div>

          {/* панель управления: поиск, фильтр типа, обновление и новый контакт */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Имя, компания, телефон, маршрут…"
                    aria-label="Поиск по контактам"
                    className="h-11 pl-10"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button className="h-11 flex-1 sm:flex-none" onClick={() => openContact(null)}>
                    <Plus aria-hidden />
                    Контакт
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Фильтр по типу контакта">
                {KIND_FILTERS.map((f) => (
                  <Chip key={f.value} active={kindFilter === f.value} onClick={() => setKindFilter(f.value)}>
                    {f.label}
                  </Chip>
                ))}
              </div>
            </CardContent>
          </Card>

          {error ? (
            <ErrorBlock message={error} onRetry={() => void load()} />
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={<BookUser aria-hidden className="h-10 w-10" />}
              title="Контактов пока нет — добавьте первого"
              hint="Память контактов хранит всех, с кем работали: перевозчиков, грузовладельцев и водителей. Заведите первую запись кнопкой «Контакт»."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="Ничего не найдено"
              hint="Измените поисковый запрос или фильтр типа — возможно, контакт записан под другим именем."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((contact) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  expanded={expanded[contact.id] ?? false}
                  onToggle={() => setExpanded((s) => ({ ...s, [contact.id]: !(s[contact.id] ?? false) }))}
                  onEdit={() => openContact(contact)}
                  onAddDeal={() => openDeal(contact.id, null)}
                  onEditDeal={(deal) => openDeal(contact.id, deal)}
                  onDeleteContact={() => void removeContact(contact)}
                  onDeleteDeal={(deal) => void removeDeal(deal)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* диалог «Новый контакт» / «Изменить контакт» */}
      <Dialog open={contactDialog.open} onOpenChange={(open) => setContactDialog((s) => ({ ...s, open }))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{contactDialog.edit ? 'Изменить контакт' : 'Новый контакт'}</DialogTitle>
            <DialogDescription>
              {contactDialog.edit
                ? 'Правка записи рабочей тетради — имя должно быть заполнено.'
                : 'Запишите, с кем работали: тип, контакты и чем запомнился — чтобы не звонить повторно в пустоту.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="contact-name">Имя *</Label>
              <Input
                id="contact-name"
                className="h-11"
                value={contactForm.name}
                onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="ФИО или имя контактного лица"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-company">Компания</Label>
              <Input
                id="contact-company"
                className="h-11"
                value={contactForm.company}
                onChange={(e) => setContactForm((f) => ({ ...f, company: e.target.value }))}
                placeholder="Организация"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Тип</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Тип контакта">
                {(['carrier', 'shipper', 'driver', 'other'] as const).map((k) => (
                  <Chip key={k} active={contactForm.kind === k} onClick={() => setContactForm((f) => ({ ...f, kind: k }))}>
                    {KIND_META[k].label}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="contact-phone">Телефон</Label>
                <Input
                  id="contact-phone"
                  className="h-11"
                  inputMode="tel"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+7 900 000-00-00"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contact-email">Почта</Label>
                <Input
                  id="contact-email"
                  className="h-11"
                  inputMode="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="name@company.ru"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-ati">Привязка к ATI.SU (номер груза/машины)</Label>
              <Input
                id="contact-ati"
                className="h-11"
                value={contactForm.atiRef}
                onChange={(e) => setContactForm((f) => ({ ...f, atiRef: e.target.value }))}
                placeholder="Например, 87123456"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Рейтинг — как отработали вместе</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Рейтинг от 0 до 5">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setContactForm((f) => ({ ...f, rating: n }))}
                    aria-pressed={contactForm.rating === n}
                    aria-label={`Рейтинг ${n} из 5`}
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                      contactForm.rating === n
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-notes">Заметка</Label>
              <Textarea
                id="contact-notes"
                value={contactForm.notes}
                onChange={(e) => setContactForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Чем запомнился: возит аккуратно, платит в срок…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setContactDialog({ open: false, edit: null })}>
              Отмена
            </Button>
            <Button className="h-11" onClick={() => void submitContact()} disabled={saving}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* диалог «Новая сделка» / «Изменить сделку» */}
      <Dialog open={dealDialog.open} onOpenChange={(open) => setDealDialog((s) => ({ ...s, open }))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dealDialog.edit ? 'Изменить сделку' : 'Новая сделка'}</DialogTitle>
            <DialogDescription>
              Что искали и на чём остановились — направление, маршрут, груз, сумма и статус.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Направление</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Направление сделки">
                <Chip active={dealForm.direction === 'load'} onClick={() => setDealForm((f) => ({ ...f, direction: 'load' }))}>
                  Груз — нашли груз
                </Chip>
                <Chip active={dealForm.direction === 'truck'} onClick={() => setDealForm((f) => ({ ...f, direction: 'truck' }))}>
                  Машина — нашли перевозчика
                </Chip>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="deal-route">Маршрут</Label>
              <Input
                id="deal-route"
                className="h-11"
                value={dealForm.route}
                onChange={(e) => setDealForm((f) => ({ ...f, route: e.target.value }))}
                placeholder="Скопин → Ростов-на-Дону"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="deal-cargo">Груз</Label>
              <Input
                id="deal-cargo"
                className="h-11"
                value={dealForm.cargo}
                onChange={(e) => setDealForm((f) => ({ ...f, cargo: e.target.value }))}
                placeholder="Что возили или что искали"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="deal-amount">Сумма, ₽</Label>
                <Input
                  id="deal-amount"
                  className="h-11"
                  inputMode="decimal"
                  value={dealForm.amount}
                  onChange={(e) => setDealForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="Например, 125000"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="deal-date">Дата</Label>
                <Input
                  id="deal-date"
                  className="h-11"
                  value={dealForm.dealDate}
                  onChange={(e) => setDealForm((f) => ({ ...f, dealDate: e.target.value }))}
                  placeholder="ДД.ММ.ГГГГ"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Статус</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Статус сделки">
                {(['talks', 'done', 'refuse', 'lost'] as const).map((s) => (
                  <Chip key={s} active={dealForm.status === s} onClick={() => setDealForm((f) => ({ ...f, status: s }))}>
                    {STATUS_META[s].label}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="deal-notes">Заметка</Label>
              <Textarea
                id="deal-notes"
                value={dealForm.notes}
                onChange={(e) => setDealForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Условия и нюансы"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setDealDialog((s) => ({ ...s, open: false }))}>
              Отмена
            </Button>
            <Button className="h-11" onClick={() => void submitDeal()} disabled={saving}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

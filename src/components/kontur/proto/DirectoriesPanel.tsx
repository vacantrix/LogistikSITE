'use client'

/**
 * «Справочники» — кадры и техника собственного парка АЭМЗ (стиль LogistikSITE,
 * адаптация под логистический контур): ровно три раздела — водители, тягачи,
 * прицепы. Каждый открывается на весь экран с табличным списком, поиском,
 * фильтром по срокам документов и статусу занятости, пагинацией (парк большой:
 * ~300 единиц техники и ~150 водителей, карточная сетка не масштабируется).
 * На главной странице раздела — сводка: последние добавления, сроки документов,
 * плитки-счётчики. Ручное добавление и правка записей — с записью в аудит.
 * Привлечённый транспорт в контуре не используется: весь парк принадлежит заводу.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authFetch } from '@/lib/kontur/session-token'
import {
  ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Database, Link2, Loader2, Pencil, Plus,
  Search, Send, Truck, User, Wrench, X,
} from 'lucide-react'
import { Badge } from '@/components/kontur/ui/badge'
import { Button } from '@/components/kontur/ui/button'
import { Card, CardContent } from '@/components/kontur/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/kontur/ui/dialog'
import { Input } from '@/components/kontur/ui/input'
import { Label } from '@/components/kontur/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/kontur/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/kontur/ui/table'
import { useToast } from '@/hooks/use-toast'
import type { Driver, StateResponse, Trailer, Vehicle } from '@/lib/kontur/client-types'
import { expiryInfo, rowTint, worseState, type ExpiryState } from '@/lib/kontur/client-types'
import { DotWord, InfoTip, Pill } from './bits'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'
const PAGE_SIZE = 25

type SectionKind = 'drivers' | 'trucks' | 'trailers'

const SECTION_TITLES: Record<SectionKind, string> = {
  drivers: 'Водители',
  trucks: 'Тягачи',
  trailers: 'Прицепы',
}

/** Тип записи в API /api/directory (раздел → вид записи) */
const API_KIND: Record<SectionKind, string> = {
  drivers: 'driver',
  trucks: 'vehicle',
  trailers: 'trailer',
}

const SECTIONS: { key: SectionKind; icon: typeof User; hint: string }[] = [
  { key: 'drivers', icon: User, hint: 'ФИО, телефоны, паспорта, сроки ВУ' },
  { key: 'trucks', icon: Truck, hint: 'Марки, госномера, VIN, СТС, техосмотр' },
  { key: 'trailers', icon: Wrench, hint: 'Типы, госномера, СТС, техосмотр' },
]

const fmtCreated = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

/** Срок действия документа точкой и словом: красная точка — истёк, янтарная — истекает */
function ExpiryBadge({ date }: { date?: string | null }) {
  const info = expiryInfo(date)
  if (info.state === 'none') return <span className="text-sm text-slate-400">{date || '—'}</span>
  if (info.state === 'ok') return <span className="whitespace-nowrap text-sm text-slate-600">{info.date}</span>
  if (info.state === 'expired') return <DotWord dot="bg-red-500" tone="danger">{info.label}</DotWord>
  if (info.state === 'warn') return <DotWord dot="bg-amber-500" tone="warning">{info.label}</DotWord>
  return <DotWord dot="bg-slate-400">{info.label}</DotWord>
}

// ——— поля форм добавления/правки ———

interface FieldDef {
  key: string
  label: string
  placeholder?: string
  type?: 'text' | 'date' | 'number'
}

const FORM_FIELDS: Record<SectionKind, FieldDef[]> = {
  drivers: [
    { key: 'fullName', label: 'ФИО', placeholder: 'Смирнов Олег Викторович' },
    { key: 'phone', label: 'Телефон', placeholder: '+79181234567' },
    { key: 'birthDate', label: 'Дата рождения', placeholder: '11.03.1993', type: 'date' },
    { key: 'passport', label: 'Паспорт (серия и номер)', placeholder: '23 07 123456' },
    { key: 'licenseUntil', label: 'ВУ действительно до', placeholder: 'ДД.ММ.ГГГГ', type: 'date' },
  ],
  trucks: [
    { key: 'brand', label: 'Марка', placeholder: 'MAN TGX 18.440' },
    { key: 'plate', label: 'Госномер', placeholder: 'АЕ 12345 23' },
    { key: 'vin', label: 'VIN', placeholder: '17 символов' },
    { key: 'sts', label: 'СТС', placeholder: '23 25 123456' },
    { key: 'techTill', label: 'Техосмотр до', placeholder: 'ДД.ММ.ГГГГ', type: 'date' },
    { key: 'capacityT', label: 'Грузоподъёмность, т', placeholder: '20', type: 'number' },
    { key: 'volumeM3', label: 'Объём, м³', placeholder: '92', type: 'number' },
  ],
  trailers: [
    { key: 'brand', label: 'Марка', placeholder: 'Тонар 9678' },
    { key: 'plate', label: 'Госномер', placeholder: 'АК 11112 23' },
    { key: 'type', label: 'Тип', placeholder: 'Полуприцеп тент' },
    { key: 'sts', label: 'СТС', placeholder: '23 25 123457' },
    { key: 'techTill', label: 'Техосмотр до', placeholder: 'ДД.ММ.ГГГГ', type: 'date' },
    { key: 'volumeM3', label: 'Объём, м³', placeholder: '92', type: 'number' },
    { key: 'beltsCount', label: 'Ремней крепления', placeholder: '12', type: 'number' },
  ],
}

/** Запись в сводке «Последние добавления» */
interface RecentAddition {
  key: string
  tab: SectionKind
  icon: typeof User
  title: string
  kindLabel: string
  createdAt?: string | null
}

/** Запись в блоке «Сроки документов» */
interface ExpiryItem {
  key: string
  tab: SectionKind
  icon: typeof User
  title: string
  docLabel: string
  info: ReturnType<typeof expiryInfo>
}

// ——— панель фильтров раздела ———

function DirFilterBar({ query, onQuery, expiry, onExpiry, status, onStatus, statusOptions, count, extraActive, onReset, children }: {
  query: string
  onQuery: (v: string) => void
  expiry: 'all' | 'soon' | 'expired'
  onExpiry: (v: 'all' | 'soon' | 'expired') => void
  status: string
  onStatus: (v: string) => void
  statusOptions: { value: string; label: string }[]
  count?: string
  extraActive?: boolean
  onReset?: () => void
  children?: ReactNode
}) {
  const active = query.trim() !== '' || expiry !== 'all' || status !== 'all' || !!extraActive
  const reset = onReset ?? (() => { onQuery(''); onExpiry('all'); onStatus('all') })
  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Поиск по справочнику…"
            className="h-9 pl-8"
            aria-label="Поиск по справочнику"
          />
        </div>
        <Select value={expiry} onValueChange={(v) => onExpiry(v as 'all' | 'soon' | 'expired')}>
          <SelectTrigger className="h-9 w-[205px]" aria-label="Фильтр по сроку документов">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все сроки документов</SelectItem>
            <SelectItem value="soon">Истекает (90 дней)</SelectItem>
            <SelectItem value="expired">Истёкшие документы</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={onStatus}>
          <SelectTrigger className="h-9 w-[170px]" aria-label="Фильтр по статусу">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {children}
        {active && (
          <Button size="sm" variant="ghost" className="h-9" onClick={reset}>
            Сбросить
          </Button>
        )}
        {count && <div className="ml-auto text-xs text-slate-500">{count}</div>}
      </div>
    </div>
  )
}

export function DirectoriesPanel({ state, onChanged }: { state: StateResponse; onChanged: () => void }) {
  const { toast } = useToast()
  const [open, setOpen] = useState<SectionKind | null>(null)
  const [addKind, setAddKind] = useState<SectionKind | null>(null)
  const [editing, setEditing] = useState<{ kind: SectionKind; id: string; title: string } | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [notifying, setNotifying] = useState(false)

  // ——— фильтры раздела (действуют в полноэкранной таблице) ———
  const [dirQuery, setDirQuery] = useState('')
  const [dirExpiry, setDirExpiry] = useState<'all' | 'soon' | 'expired'>('all')
  const [dirStatus, setDirStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [unpinBusy, setUnpinBusy] = useState<string | null>(null)

  const busyVehicleIds = useMemo(
    () => new Set(state.trips.filter((t) => t.status === 'active').map((t) => t.vehicleId)),
    [state.trips],
  )
  const busyTrailerIds = useMemo(
    () => new Set(state.trips.filter((t) => t.status === 'active' && t.trailerId).map((t) => t.trailerId as string)),
    [state.trips],
  )
  const busyDriverIds = useMemo(
    () => new Set(state.trips.filter((t) => t.status === 'active').map((t) => t.driverId)),
    [state.trips],
  )

  // при смене фильтров возвращаемся на первую страницу
  useEffect(() => { setPage(1) }, [dirQuery, dirExpiry, dirStatus, open])

  const closeSection = useCallback(() => {
    setOpen(null)
    setDirQuery('')
    setDirExpiry('all')
    setDirStatus('all')
  }, [])

  // полноэкранный раздел: блокируем прокрутку фона, закрытие по Escape
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSection() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, closeSection])

  // ——— фильтрация ———
  const dirQ = dirQuery.trim().toLowerCase()
  const byQuery = useCallback(
    (...fields: (string | null | undefined)[]) => !dirQ || fields.some((f) => (f ?? '').toLowerCase().includes(dirQ)),
    [dirQ],
  )
  const byExpiry = useCallback((dates: (string | null | undefined)[]) => {
    if (dirExpiry === 'all') return true
    const worst = dates.reduce<ExpiryState>((acc, d) => worseState(acc, expiryInfo(d).state), 'none')
    return dirExpiry === 'expired' ? worst === 'expired' : worst === 'soon' || worst === 'warn'
  }, [dirExpiry])

  const driversFlat = useMemo(() => state.drivers.filter((d) => {
    if (!byQuery(d.fullName, d.phone, d.passport)) return false
    if (!byExpiry([d.licenseUntil])) return false
    if (dirStatus === 'all') return true
    if (dirStatus === 'ontrip') return busyDriverIds.has(d.id)
    if (dirStatus === 'free') return !busyDriverIds.has(d.id) && d.status === 'active'
    return !busyDriverIds.has(d.id) && d.status !== 'active'
  }), [state.drivers, byQuery, byExpiry, dirStatus, busyDriverIds])

  const trucksFlat = useMemo(() => state.vehicles.filter((v) => {
    if (!byQuery(v.brand, v.plate, v.vin, v.sts)) return false
    if (!byExpiry([v.techTill])) return false
    if (dirStatus === 'all') return true
    if (dirStatus === 'ontrip') return busyVehicleIds.has(v.id)
    if (dirStatus === 'repair') return v.isRepair
    return !busyVehicleIds.has(v.id) && !v.isRepair
  }), [state.vehicles, byQuery, byExpiry, dirStatus, busyVehicleIds])

  const trailersFlat = useMemo(() => state.trailers.filter((z) => {
    if (!byQuery(z.brand, z.plate, z.type, z.sts)) return false
    if (!byExpiry([z.techTill])) return false
    if (dirStatus === 'all') return true
    if (dirStatus === 'ontrip') return busyTrailerIds.has(z.id)
    if (dirStatus === 'repair') return z.isRepair === true
    return !busyTrailerIds.has(z.id) && z.isRepair !== true
  }), [state.trailers, byQuery, byExpiry, dirStatus, busyTrailerIds])

  const counts: Record<SectionKind, number> = {
    drivers: state.drivers.length,
    trucks: state.vehicles.length,
    trailers: state.trailers.length,
  }

  // ——— сводка: последние добавления ———
  const recentAdditions = useMemo<RecentAddition[]>(() => {
    const items: RecentAddition[] = [
      ...state.drivers.map((d) => ({ key: `d-${d.id}`, tab: 'drivers' as const, icon: User, title: d.fullName, kindLabel: 'Водитель', createdAt: d.createdAt })),
      ...state.vehicles.map((v) => ({ key: `t-${v.id}`, tab: 'trucks' as const, icon: Truck, title: `${v.brand} · ${v.plate}`, kindLabel: 'Тягач', createdAt: v.createdAt })),
      ...state.trailers.map((z) => ({ key: `z-${z.id}`, tab: 'trailers' as const, icon: Wrench, title: `${z.plate} · ${z.type}`, kindLabel: 'Прицеп', createdAt: z.createdAt })),
    ]
    return items
      .filter((i) => i.createdAt)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, 6)
  }, [state.drivers, state.vehicles, state.trailers])

  // ——— сводка: что и когда истекает (ВУ, техосмотры) ———
  const expiryItems = useMemo<ExpiryItem[]>(() => {
    const items: ExpiryItem[] = []
    const bad = (i: ReturnType<typeof expiryInfo>) => i.state === 'expired' || i.state === 'warn'
    for (const d of state.drivers) {
      const v = expiryInfo(d.licenseUntil)
      if (bad(v)) items.push({ key: `d-${d.id}`, tab: 'drivers', icon: User, title: d.fullName, docLabel: 'Вод. удостоверение', info: v })
    }
    for (const v of state.vehicles) {
      const i = expiryInfo(v.techTill)
      if (bad(i)) items.push({ key: `t-${v.id}`, tab: 'trucks', icon: Truck, title: `${v.brand} · ${v.plate}`, docLabel: 'Техосмотр', info: i })
    }
    for (const z of state.trailers) {
      const i = expiryInfo(z.techTill)
      if (bad(i)) items.push({ key: `z-${z.id}`, tab: 'trailers', icon: Wrench, title: `${z.type} · ${z.plate}`, docLabel: 'Техосмотр', info: i })
    }
    return items.sort((a, b) => (a.info.days ?? 0) - (b.info.days ?? 0))
  }, [state.drivers, state.vehicles, state.trailers])

  const expiredCount = expiryItems.filter((i) => i.info.state === 'expired').length

  // ——— диалоги добавления/правки ———

  const openAdd = (kind: SectionKind) => {
    setForm(kind === 'drivers'
      ? { status: 'active' }
      : {})
    setEditing(null)
    setAddKind(kind)
  }

  const openEdit = (kind: SectionKind, id: string, record: Record<string, string>, title: string) => {
    setForm({ ...record })
    setAddKind(null)
    setEditing({ kind, id, title })
  }

  const closeDialog = () => { setAddKind(null); setEditing(null) }

  const submit = async () => {
    const section = addKind ?? editing?.kind
    if (!section) return
    setSaving(true)
    try {
      const res = await authFetch('/api/directory', {
        method: addKind ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addKind
          ? { kind: API_KIND[section], ...form }
          : { kind: API_KIND[section], id: editing?.id, ...form }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: addKind ? 'Не удалось добавить запись' : 'Не удалось сохранить запись', description: data?.error?.message, variant: 'destructive' })
        return
      }
      toast({
        title: addKind ? 'Запись добавлена в справочник' : 'Запись обновлена',
        description: `${SECTION_TITLES[section]}: ${addKind ? 'запись создана и доступна при назначении состава на рейс' : 'данные и сроки документов сохранены'}`,
      })
      closeDialog()
      onChanged()
    } catch {
      toast({ title: 'Ошибка сети', description: 'Повторите попытку', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  /** Открепить состав от водителя (кнопка в списке закреплений) */
  const unpinBinding = async (driverId: string, driverName: string) => {
    setUnpinBusy(driverId)
    try {
      const res = await authFetch('/api/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unpin', driverId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'Не удалось открепить', description: data?.error?.message, variant: 'destructive' })
        return
      }
      toast({ title: 'Закрепление снято', description: `${driverName} — подбор больше не отдаёт приоритет этому составу` })
      onChanged()
    } catch {
      toast({ title: 'Ошибка сети', description: 'Повторите попытку', variant: 'destructive' })
    } finally {
      setUnpinBusy(null)
    }
  }

  /** «Уведомить ответственных» (прототип): рассылка о истекающих сроках */
  const notifyResponsible = async () => {
    setNotifying(true)
    try {
      await new Promise((r) => setTimeout(r, 600))
      toast({
        title: 'Уведомление отправлено',
        description: `Получатели: начальник колонны, отдел логистики. По ${expiryItems.length} записям с истекающими сроками (истекло: ${expiredCount})`,
      })
    } finally {
      setNotifying(false)
    }
  }

  const dialogKind = addKind ?? editing?.kind ?? null
  const addLabel = dialogKind ? SECTION_TITLES[dialogKind] : ''

  // пагинация текущего раздела
  const flat = open === 'drivers' ? driversFlat : open === 'trucks' ? trucksFlat : open === 'trailers' ? trailersFlat : []
  const total = open ? counts[open] : 0
  const pageCount = Math.max(1, Math.ceil(flat.length / PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount)
  const pageRows = flat.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  const driverRow = (d: Driver) => (
    <TableRow key={d.id} className={rowTint([expiryInfo(d.licenseUntil).state])}>
      <TableCell className="font-medium text-slate-800">{d.fullName}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{d.phone}</TableCell>
      <TableCell className="whitespace-nowrap text-slate-600">{d.birthDate || '—'}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{d.passport || '—'}</TableCell>
      <TableCell><ExpiryBadge date={d.licenseUntil} /></TableCell>
      <TableCell>
        {busyDriverIds.has(d.id) ? <DotWord dot="bg-blue-500">в рейсе</DotWord>
          : d.status === 'active' ? <DotWord dot="bg-emerald-500">готов к работе</DotWord>
          : <DotWord dot="bg-amber-500" tone="warning">{d.status === 'vacation' ? 'отпуск' : d.status === 'sick' ? 'больничный' : d.statusComment || 'недоступен'}</DotWord>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(d.createdAt)}</TableCell>
      <TableCell>
        <Button
          size="icon" variant="ghost" className="h-8 w-8" aria-label={`Изменить: ${d.fullName}`}
          onClick={() => openEdit('drivers', d.id, {
            fullName: d.fullName, phone: d.phone, birthDate: d.birthDate ?? '', passport: d.passport ?? '',
            licenseUntil: d.licenseUntil ?? '', status: d.status, statusComment: d.statusComment ?? '',
          }, d.fullName)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  )

  const truckRow = (v: Vehicle) => (
    <TableRow key={v.id} className={rowTint([expiryInfo(v.techTill).state])}>
      <TableCell className="font-medium text-slate-800">{v.brand}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-800">{v.plate}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-500">{v.vin || '—'}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{v.sts || '—'}</TableCell>
      <TableCell><ExpiryBadge date={v.techTill} /></TableCell>
      <TableCell className="whitespace-nowrap text-slate-600">{v.capacityT ? `${v.capacityT} т` : '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-slate-600">{v.volumeM3 ? `${v.volumeM3} м³` : '—'}</TableCell>
      <TableCell>
        {v.isRepair ? <DotWord dot="bg-red-500" tone="danger">в ремонте</DotWord>
          : busyVehicleIds.has(v.id) ? <DotWord dot="bg-blue-500">в рейсе</DotWord>
          : <DotWord dot="bg-emerald-500">свободен</DotWord>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(v.createdAt)}</TableCell>
      <TableCell>
        <Button
          size="icon" variant="ghost" className="h-8 w-8" aria-label={`Изменить: ${v.plate}`}
          onClick={() => openEdit('trucks', v.id, {
            brand: v.brand, plate: v.plate, vin: v.vin ?? '', sts: v.sts ?? '', techTill: v.techTill ?? '',
            capacityT: v.capacityT != null ? String(v.capacityT) : '', volumeM3: v.volumeM3 != null ? String(v.volumeM3) : '',
            isRepair: v.isRepair ? 'true' : '',
          }, `${v.brand} · ${v.plate}`)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  )

  const trailerRow = (z: Trailer) => (
    <TableRow key={z.id} className={rowTint([expiryInfo(z.techTill).state])}>
      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-800">{z.plate}</TableCell>
      <TableCell className="text-slate-600">{z.type}</TableCell>
      <TableCell className="text-slate-600">{z.brand}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{z.sts || '—'}</TableCell>
      <TableCell><ExpiryBadge date={z.techTill} /></TableCell>
      <TableCell className="whitespace-nowrap text-slate-600">{z.volumeM3 ? `${z.volumeM3} м³` : '—'}</TableCell>
      <TableCell>
        {z.isRepair ? <DotWord dot="bg-red-500" tone="danger">в ремонте</DotWord>
          : busyTrailerIds.has(z.id) ? <DotWord dot="bg-blue-500">в рейсе</DotWord>
          : <DotWord dot="bg-emerald-500">свободен</DotWord>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(z.createdAt)}</TableCell>
      <TableCell>
        <Button
          size="icon" variant="ghost" className="h-8 w-8" aria-label={`Изменить: ${z.plate}`}
          onClick={() => openEdit('trailers', z.id, {
            brand: z.brand, plate: z.plate, type: z.type, sts: z.sts ?? '', techTill: z.techTill ?? '',
            volumeM3: z.volumeM3 != null ? String(z.volumeM3) : '', beltsCount: z.beltsCount != null ? String(z.beltsCount) : '',
            workingBoards: z.workingBoards ? 'true' : '', isRepair: z.isRepair ? 'true' : '',
          }, `${z.type} · ${z.plate}`)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  )

  return (
    <div>
      {/* Собственный парк: назначение состава на рейсы — только отсюда */}

      {/* Последние добавления */}
      <Card className="mb-4 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Database className="h-4 w-4 text-slate-400" aria-hidden />
              Кадры и техника
              <InfoTip label="Кадры и техника">
                Штатные водители и техника завода. Записи пополняются вручную или загрузкой из 1С —
                последние добавления видны здесь, полный состав — в разделах ниже.
              </InfoTip>
            </div>
            <Pill className="bg-slate-100 text-slate-600">{counts.drivers + counts.trucks + counts.trailers} записей в справочниках</Pill>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-medium text-slate-500">Последние добавления</div>
            <ul className="flex flex-wrap gap-1.5">
              {recentAdditions.map((r) => {
                const Icon = r.icon
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => setOpen(r.tab)}
                      title={`${r.kindLabel} — добавлен ${fmtCreated(r.createdAt)}`}
                      className="flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className="max-w-[200px] truncate font-medium">{r.title}</span>
                      <span className="shrink-0 text-slate-400">· {fmtCreated(r.createdAt)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Сроки документов: что и когда истекает */}
      <Card className="mb-4 border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              {expiryItems.length === 0
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                : <CalendarClock className={`h-4 w-4 ${expiredCount > 0 ? 'text-red-600' : 'text-amber-600'}`} aria-hidden />}
              Сроки документов
              {expiryItems.length > 0 && (
                <DotWord dot={expiredCount > 0 ? 'bg-red-500' : 'bg-amber-500'} tone={expiredCount > 0 ? 'danger' : 'warning'} className="font-normal">
                  {expiredCount > 0 ? `истекло: ${expiredCount}` : 'требуют внимания'}
                  {expiryItems.length > expiredCount ? ` · истекает: ${expiryItems.length - expiredCount}` : ''}
                </DotWord>
              )}
              <InfoTip label="Цвета сроков">
                Красная точка — срок истёк, янтарная — осталось до 30 дней. Истекающие записи подсвечиваются
                в таблицах разделов и фильтруются «Истекает (90 дней)».
              </InfoTip>
            </div>
            {expiryItems.length > 0 && (
              <Button size="sm" variant="outline" onClick={notifyResponsible} disabled={notifying}>
                {notifying
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  : <Send className="h-4 w-4" aria-hidden />}
                Уведомить ответственных
              </Button>
            )}
          </div>

          {expiryItems.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Истекающих сроков нет</p>
          ) : (
            <ul className={`mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1 ${THIN_SCROLL}`}>
              {expiryItems.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <Icon className={`h-4 w-4 shrink-0 ${item.info.state === 'expired' ? 'text-red-500' : 'text-amber-500'}`} aria-hidden />
                    <span className="text-sm font-medium text-slate-800">{item.title}</span>
                    <span className="text-xs text-slate-500">{item.docLabel}</span>
                    <ExpiryBadge date={item.info.date} />
                    <button
                      onClick={() => setOpen(item.tab)}
                      className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                    >
                      Открыть
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Закрепления состава: водитель ↔ тягач ↔ прицеп */}
      <Card className="mb-4 border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Link2 className="h-4 w-4 text-slate-400" aria-hidden />
              Закрепления состава
              <Pill className="bg-slate-100 text-slate-600">{state.bindings.length}</Pill>
              <InfoTip label="Закрепления состава">
                Водители АЭМЗ почти всегда работают на «своих» тягаче и прицепе: подбор и диалог планирования
                предлагают закреплённый состав первым и добавляют ему балл. Закрепить можно кнопкой «Закрепить»
                в умном подборе по заявке или в диалоге назначения состава; здесь — список и открепление.
              </InfoTip>
            </div>
          </div>
          {state.bindings.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Закреплений пока нет — нажмите «Закрепить» в подборе по заявке или в диалоге назначения состава.
            </p>
          ) : (
            <ul className={`mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1 ${THIN_SCROLL}`}>
              {state.bindings.map((b) => {
                const vehBusy = busyVehicleIds.has(b.vehicleId)
                const vehRepair = b.vehicle?.isRepair === true
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                    <span className="text-sm font-medium text-slate-800">{b.driver?.fullName ?? '—'}</span>
                    <span className="text-slate-300" aria-hidden>→</span>
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {b.vehicle ? `${b.vehicle.brand} · ${b.vehicle.plate}` : 'тягач снят с учёта'}
                    </span>
                    {b.trailer && (
                      <span className="font-mono text-xs text-slate-600">+ {b.trailer.type === 'шторный' ? '' : `${b.trailer.type} `}{b.trailer.plate}</span>
                    )}
                    {vehRepair ? (
                      <DotWord dot="bg-red-500" tone="danger">машина в ремонте</DotWord>
                    ) : vehBusy ? (
                      <DotWord dot="bg-blue-500">в рейсе</DotWord>
                    ) : (
                      <DotWord dot="bg-emerald-500">на базе</DotWord>
                    )}
                    <span className="ml-auto text-xs text-slate-400">с {fmtCreated(b.pinnedAt)}</span>
                    <Button
                      size="sm" variant="outline" className="h-7"
                      disabled={unpinBusy === b.driverId}
                      onClick={() => void unpinBinding(b.driverId, b.driver?.fullName ?? '')}
                      title="Открепить состав от водителя"
                    >
                      {unpinBusy === b.driverId ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                      Открепить
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* три раздела справочника — каждый открывается на весь экран */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon
          const expiring = expiryItems.filter((i) => i.tab === s.key).length
          return (
            <button
              key={s.key}
              type="button"
              title={s.hint}
              onClick={() => setOpen(s.key)}
              className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              aria-label={`Открыть раздел «${SECTION_TITLES[s.key]}» на весь экран`}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-slate-200 group-hover:text-slate-900">
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <span className="text-sm font-bold text-slate-900">{SECTION_TITLES[s.key]}</span>
                {expiring > 0 && (
                  <DotWord dot="bg-amber-500" tone="warning" className="ml-auto text-xs">
                    истекает: {expiring}
                  </DotWord>
                )}
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div className="text-2xl font-bold tabular-nums text-slate-900">{counts[s.key]}</div>
                <span className="flex items-center gap-1 text-xs font-medium text-blue-700">
                  Открыть раздел
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden />
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* ——— раздел на весь экран ——— */}
      {open !== null && (() => {
        const section = SECTIONS.find((s) => s.key === open)!
        const Icon = section.icon
        const statusOptions = open === 'drivers'
          ? [
              { value: 'all', label: 'Все статусы' },
              { value: 'ontrip', label: 'В рейсе' },
              { value: 'free', label: 'Готов к работе' },
              { value: 'away', label: 'Отпуск / больничный' },
            ]
          : [
              { value: 'all', label: 'Все статусы' },
              { value: 'ontrip', label: 'В рейсе' },
              { value: 'free', label: 'Свободны' },
              { value: 'repair', label: 'В ремонте' },
            ]
        return (
          <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={`${SECTION_TITLES[open]} — на весь экран`}>
            {/* шапка раздела — на всю ширину экрана */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={closeSection}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Справочники
                </Button>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <h2 className="text-base font-bold text-slate-900">{SECTION_TITLES[open]}</h2>
                <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-600">{total}</Badge>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" className="h-9 gap-1.5" onClick={() => openAdd(open)}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Добавить вручную
                  </Button>
                </div>
              </div>
            </div>

            {/* таблица раздела — на всю ширину экрана */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <DirFilterBar
                query={dirQuery} onQuery={setDirQuery}
                expiry={dirExpiry} onExpiry={setDirExpiry}
                status={dirStatus} onStatus={setDirStatus}
                statusOptions={statusOptions}
                count={`Показано: ${flat.length === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1}–${Math.min(pageSafe * PAGE_SIZE, flat.length)} из ${flat.length}`}
                onReset={() => { setDirQuery(''); setDirExpiry('all'); setDirStatus('all') }}
              />

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <Table>
                  {open === 'drivers' && (
                    <>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead>ФИО</TableHead>
                          <TableHead>Телефон</TableHead>
                          <TableHead>Дата рождения</TableHead>
                          <TableHead>Паспорт</TableHead>
                          <TableHead>ВУ до</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Добавлен</TableHead>
                          <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageRows.map((d) => driverRow(d as Driver))}
                        {flat.length === 0 && (
                          <TableRow><TableCell colSpan={8} className="py-6 text-center text-slate-400">Записей по фильтрам не найдено</TableCell></TableRow>
                        )}
                      </TableBody>
                    </>
                  )}
                  {open === 'trucks' && (
                    <>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead>Марка</TableHead>
                          <TableHead>Госномер</TableHead>
                          <TableHead>VIN</TableHead>
                          <TableHead>СТС</TableHead>
                          <TableHead>Техосмотр до</TableHead>
                          <TableHead>Г/п</TableHead>
                          <TableHead>Объём</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Добавлен</TableHead>
                          <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageRows.map((v) => truckRow(v as Vehicle))}
                        {flat.length === 0 && (
                          <TableRow><TableCell colSpan={10} className="py-6 text-center text-slate-400">Записей по фильтрам не найдено</TableCell></TableRow>
                        )}
                      </TableBody>
                    </>
                  )}
                  {open === 'trailers' && (
                    <>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead>Госномер</TableHead>
                          <TableHead>Тип</TableHead>
                          <TableHead>Марка</TableHead>
                          <TableHead>СТС</TableHead>
                          <TableHead>Техосмотр до</TableHead>
                          <TableHead>Объём</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Добавлен</TableHead>
                          <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageRows.map((z) => trailerRow(z as Trailer))}
                        {flat.length === 0 && (
                          <TableRow><TableCell colSpan={9} className="py-6 text-center text-slate-400">Записей по фильтрам не найдено</TableCell></TableRow>
                        )}
                      </TableBody>
                    </>
                  )}
                </Table>
              </div>

              {/* пагинация: парк большой, листаем постранично */}
              {flat.length > PAGE_SIZE && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-500">
                    Страница {pageSafe} из {pageCount}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-8" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)} aria-label="Предыдущая страница">
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" disabled={pageSafe >= pageCount} onClick={() => setPage(pageSafe + 1)} aria-label="Следующая страница">
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* диалог добавления / изменения записи */}
      <Dialog open={!!dialogKind} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{addKind ? 'Добавить запись' : 'Изменить запись'} — {addLabel}</DialogTitle>
            <DialogDescription className="sr-only">
              {addKind ? 'Новая запись справочника собственного парка' : 'Изменение записи справочника собственного парка'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {dialogKind === 'drivers' && (
              <div className="space-y-1.5">
                <Label>Статус водителя</Label>
                <Select value={form.status ?? 'active'} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger aria-label="Статус водителя">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Готов к работе</SelectItem>
                    <SelectItem value="vacation">Отпуск</SelectItem>
                    <SelectItem value="sick">Больничный</SelectItem>
                    <SelectItem value="other">Другое</SelectItem>
                  </SelectContent>
                </Select>
                {form.status && form.status !== 'active' && (
                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="add-statusComment">Комментарий</Label>
                    <Input
                      id="add-statusComment"
                      placeholder="Например: отпуск до 30 числа"
                      value={form.statusComment ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, statusComment: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            )}

            {dialogKind && FORM_FIELDS[dialogKind].map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`add-${field.key}`}>{field.label}</Label>
                <Input
                  id={`add-${field.key}`}
                  placeholder={field.placeholder}
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                />
              </div>
            ))}

            {dialogKind && dialogKind !== 'drivers' && (
              <div className="space-y-1.5">
                <Label>Состояние техники</Label>
                <Select
                  value={form.isRepair === 'true' ? 'repair' : 'ok'}
                  onValueChange={(v) => setForm((f) => ({ ...f, isRepair: v === 'repair' ? 'true' : '' }))}
                >
                  <SelectTrigger aria-label="Состояние техники">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ok">Исправна</SelectItem>
                    <SelectItem value="repair">В ремонте</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {dialogKind === 'trailers' && (
              <div className="space-y-1.5">
                <Label>Ремни крепления</Label>
                <Select
                  value={form.workingBoards === 'true' ? 'yes' : 'no'}
                  onValueChange={(v) => setForm((f) => ({ ...f, workingBoards: v === 'yes' ? 'true' : '' }))}
                >
                  <SelectTrigger aria-label="Ремни крепления">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Исправны</SelectItem>
                    <SelectItem value="no">Требуют замены</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Отмена</Button>
            <Button disabled={saving} onClick={() => void submit()}>
              {saving ? 'Сохранение…' : addKind ? 'Добавить' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

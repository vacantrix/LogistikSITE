'use client'

/**
 * «Справочники» — кадры и техника: логисту — весь парк перевозчиков,
 * перевозчику — только свой. Ровно три раздела (водители, тягачи, прицепы),
 * каждый открывается на весь экран с табличным списком и фильтрами.
 * На главной странице раздела — сводка «Кадры и техника»: кто и когда добавлен,
 * что истекает. Справочник грузов — внутренняя сущность платформы: в интерфейсе
 * не показывается, доступен только через API (для заявок). Отдельного раздела
 * «Перевозчики» больше нет — парк фильтруется по перевозчику внутри раздела.
 * Логисту внизу — «Компании-исполнители»: роль компании (перевозчик или экспедитор)
 * определяет договорной документ рейса в «Подписать ЭДО».
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Search,
  Truck,
  User,
  Wrench,
  X,
} from 'lucide-react'
import {
  ErrorBlock, ExpiryBadge, InfoTip, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { DocumentPreviewModal, ZoomableThumb } from '@/components/platform/document-preview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { api, secureFileUrl } from '@/lib/api'
import { expiryInfo, rowTint, worseState, type ExpiryState } from '@/lib/expiry'
import type {
  CarrierDTO, DirectoryPhotoDTO, DriverDTO, ExecutorRole, OwnershipType, TrailerDTO, TruckDTO,
} from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

type Kind = 'driver' | 'truck' | 'trailer'

type SectionKind = 'drivers' | 'trucks' | 'trailers'

interface FieldDef {
  key: string
  label: string
  placeholder?: string
}

const FORM_FIELDS: Record<Kind, FieldDef[]> = {
  driver: [
    { key: 'fullName', label: 'ФИО', placeholder: 'Смирнов Олег Викторович' },
    { key: 'birthDate', label: 'Дата рождения', placeholder: '11.03.1993' },
    { key: 'passport', label: 'Паспорт (серия и номер)', placeholder: '52 07 123456' },
  ],
  truck: [
    { key: 'brand', label: 'Марка', placeholder: 'MAN TGX' },
    { key: 'plate', label: 'Госномер', placeholder: 'А321ВС777' },
    { key: 'vin', label: 'VIN', placeholder: '17 символов' },
    { key: 'sts', label: 'СТС', placeholder: '99 00 123456' },
    { key: 'techTill', label: 'Техосмотр до', placeholder: 'ДД.ММ.ГГГГ' },
    { key: 'owner', label: 'Собственник', placeholder: 'ООО «Перевозчик А»' },
  ],
  trailer: [
    { key: 'plate', label: 'Госномер', placeholder: 'АВ123777' },
    { key: 'type', label: 'Тип', placeholder: 'Полуприцеп тент' },
    { key: 'sts', label: 'СТС', placeholder: '99 00 123457' },
    { key: 'techTill', label: 'Техосмотр до', placeholder: 'ДД.ММ.ГГГГ' },
    { key: 'owner', label: 'Собственник', placeholder: 'ООО «Перевозчик А» или ИП Иванов И.И.' },
  ],
}

const KIND_TITLES: Record<Kind, string> = {
  driver: 'Водители',
  truck: 'Тягачи (ТС)',
  trailer: 'Прицепы',
}

/** Плитки разделов на странице «Справочники» */
const SECTIONS: { key: SectionKind; kind: Kind; icon: typeof User; hint: string }[] = [
  { key: 'drivers', kind: 'driver', icon: User, hint: 'ФИО и паспорта' },
  { key: 'trucks', kind: 'truck', icon: Truck, hint: 'Марки, госномера, СТС, техосмотр' },
  { key: 'trailers', kind: 'trailer', icon: Wrench, hint: 'Типы, госномера, СТС, собственник' },
]

// ——— принадлежность записи справочника (Task 62): собственный парк / наёмный / аренда-лизинг ———

/** Подписи бейджа «Принадлежность» */
const OWNERSHIP_LABEL: Record<OwnershipType, string> = {
  OWNED: 'Собственный парк',
  HIRED: 'Наёмный',
  LEASE: 'Аренда · Лизинг',
}

/** Стили бейджа «Принадлежность» */
const OWNERSHIP_BADGE_CLS: Record<OwnershipType, string> = {
  OWNED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  HIRED: 'border-blue-200 bg-blue-50 text-blue-700',
  LEASE: 'border-amber-200 bg-amber-50 text-amber-700',
}

/** Ячейка «Принадлежность»: бейдж типа + собственник; для аренды/лизинга — строка договора (Task 62).
 *  Для тягачей/прицепов имя собственника не дублируем — оно видно в колонке «Собственник» */
function OwnershipCell({ type, owner, contract, hideOwner = false }: { type: OwnershipType; owner: string; contract: string; hideOwner?: boolean }) {
  const showOwner = !hideOwner && owner !== '' && owner !== '—'
  const showContract = type === 'LEASE' && contract !== '' && contract !== '—'
  return (
    <TableCell className="max-w-[210px]">
      <Badge variant="outline" className={OWNERSHIP_BADGE_CLS[type]}>{OWNERSHIP_LABEL[type]}</Badge>
      {showOwner && <div className="mt-1 truncate text-xs text-slate-500" title={owner}>{owner}</div>}
      {showContract && (
        <div className="truncate text-[11px] text-slate-400" title={`Договор-основание: ${contract}`}>{contract}</div>
      )}
    </TableCell>
  )
}

// ——— окно «Прикрепленные документы»: слоты документов записи со статусами (Task 62) ———

/** Ожидаемый скан записи: подпись + ключ даты срока (для статуса без загруженного файла) */
interface PhotoSlot {
  label: string
  expiryKey?: 'techTill'
}

const PHOTO_SLOTS: Record<Kind, PhotoSlot[]> = {
  driver: [
    { label: 'Паспорт: стр. с фото' },
    { label: 'Паспорт: регистрация' },
  ],
  truck: [
    { label: 'СТС тягача' },
    { label: 'Фото тягача' },
    { label: 'Техосмотр (диагностическая карта)', expiryKey: 'techTill' },
  ],
  trailer: [
    { label: 'СТС прицепа' },
    { label: 'Фото прицепа' },
    { label: 'Техосмотр (диагностическая карта)', expiryKey: 'techTill' },
  ],
}

/** Бейдж статуса документа: иконка + подпись + классы */
interface SlotStatus {
  label: string
  cls: string
  icon: typeof X
}

const STATUS_LOADED: SlotStatus = { label: 'Загружен', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2 }
const STATUS_MISSING: SlotStatus = { label: 'Отсутствует', cls: 'border-slate-200 bg-slate-100 text-slate-500', icon: X }
const STATUS_EXPIRED: SlotStatus = { label: 'Истекает срок', cls: 'border-red-300 bg-red-100 text-red-700', icon: CalendarClock }
const STATUS_EXPIRING: SlotStatus = { label: 'Истекает срок', cls: 'border-amber-300 bg-amber-100 text-amber-700', icon: CalendarClock }
const STATUS_REVIEW: SlotStatus = { label: 'Требует проверки', cls: 'border-amber-300 bg-amber-100 text-amber-700', icon: AlertTriangle }

/** Статус слота документа: по скану (NEEDS_REVIEW) и сроку из карточки записи (Task 62) */
function slotStatus(photo: DirectoryPhotoDTO | undefined, expiryDate: string | undefined): SlotStatus {
  const info = expiryDate === undefined ? null : expiryInfo(expiryDate)
  if (photo) {
    // сначала скан: помеченный «требует проверки» важнее срока
    if (photo.status === 'NEEDS_REVIEW') return STATUS_REVIEW
    if (info?.state === 'expired') return STATUS_EXPIRED
    if (info?.state === 'warn' || info?.state === 'soon') return STATUS_EXPIRING
    return STATUS_LOADED
  }
  if (info) {
    if (info.state === 'expired') return STATUS_EXPIRED
    if (info.state === 'warn' || info.state === 'soon') return STATUS_EXPIRING
    if (info.state === 'none') return STATUS_MISSING
    return STATUS_LOADED
  }
  return STATUS_MISSING
}

/** Запись в блоке «Требуют внимания» */
interface ExpiryItem {
  key: string
  tab: SectionKind
  icon: typeof User
  title: string
  docLabel: string
  info: ReturnType<typeof expiryInfo>
  carrierName: string
}

/** Запись в сводке «Последние добавления» */
interface RecentAddition {
  key: string
  tab: SectionKind
  icon: typeof User
  title: string
  kindLabel: string
  carrierName: string
  createdAt: string
}

const fmtCreated = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Панель фильтров справочника: текстовый поиск + срок документов + доп. фильтры раздела */
function DirFilterBar({ query, onQuery, expiry, onExpiry, withExpiry, count, children, extraActive, onReset }: {
  query: string
  onQuery: (v: string) => void
  expiry: 'all' | 'soon' | 'expired'
  onExpiry: (v: 'all' | 'soon' | 'expired') => void
  withExpiry: boolean
  count?: string
  /** дополнительные фильтры раздела (перевозчик) */
  children?: ReactNode
  extraActive?: boolean
  onReset?: () => void
}) {
  const active = query.trim() !== '' || expiry !== 'all' || !!extraActive
  const reset = onReset ?? (() => { onQuery(''); onExpiry('all') })
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
        {withExpiry && (
          <Select value={expiry} onValueChange={(v) => onExpiry(v as 'all' | 'soon' | 'expired')}>
            <SelectTrigger className="h-9 w-[200px]" aria-label="Фильтр по сроку документов">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все сроки документов</SelectItem>
              <SelectItem value="soon">Истекает (90 дней)</SelectItem>
              <SelectItem value="expired">Истёкшие документы</SelectItem>
            </SelectContent>
          </Select>
        )}
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

export default function DirectoriesTab({ activeCarrierId, role, onNavigate, liveTick }: TabProps) {
  const { toast } = useToast()
  const [carriers, setCarriers] = useState<CarrierDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // открытый на весь экран раздел; null — сводка «Справочников»
  const [open, setOpen] = useState<SectionKind | null>(null)
  const [addKind, setAddKind] = useState<Kind | null>(null)
  const [editing, setEditing] = useState<{ kind: Kind; id: string } | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const isLogist = role === 'logist'
  // ——— фильтры справочника: текстовый поиск + срок документов + перевозчик (логисту) ———
  const [dirQuery, setDirQuery] = useState('')
  const [dirExpiry, setDirExpiry] = useState<'all' | 'soon' | 'expired'>('all')
  const [dirCarrier, setDirCarrier] = useState('all')
  // принадлежность записи: собственный парк / наёмный / аренда-лизинг (Task 62)
  const [dirOwnership, setDirOwnership] = useState<'all' | OwnershipType>('all')
  // ——— модальное окно «Прикрепленные документы» (Task 54 + статусы Task 62) ———
  const [photoView, setPhotoView] = useState<{
    kind: Kind; id: string; title: string; expiry?: { techTill?: string }
  } | null>(null)
  const [photoList, setPhotoList] = useState<DirectoryPhotoDTO[] | null>(null)
  const [photoLoading, setPhotoLoading] = useState(false)
  // полноразмерный просмотр документа: поворот, зум, скачивание (Task 62)
  const [preview, setPreview] = useState<{ src: string; title: string; fileName: string; downloadUrl: string } | null>(null)

  // открытие окна фото: подтягиваем загруженные и проверенные документы записи
  useEffect(() => {
    if (!photoView) return
    let cancelled = false
    setPhotoList(null)
    setPhotoLoading(true)
    api.directoryPhotos(photoView.kind, photoView.id)
      .then((res) => { if (!cancelled) setPhotoList(res.photos) })
      .catch(() => { if (!cancelled) setPhotoList([]) })
      .finally(() => { if (!cancelled) setPhotoLoading(false) })
    return () => { cancelled = true }
  }, [photoView])

  // перевозчику доступен только его собственный парк — данные конкурентов скрыты
  const visibleCarriers = useMemo(
    () => (isLogist ? (carriers ?? []) : (carriers ?? []).filter((c) => c.id === activeCarrierId)),
    [carriers, isLogist, activeCarrierId],
  )

  const load = useCallback(async () => {
    try {
      const dir = await api.directory()
      setCarriers(dir.carriers)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // real-time (Task 49): событие из шины WS мгновенно догружает справочники
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  // фильтры справочника — на весь экран: при закрытии раздела сбрасываем
  const closeSection = useCallback(() => {
    setOpen(null)
    setDirQuery('')
    setDirExpiry('all')
    setDirCarrier('all')
    setDirOwnership('all')
  }, [])

  // на весь экран: блокируем прокрутку фона и закрываем по Escape
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

  // —— фильтрация справочника ——
  const dirQ = dirQuery.trim().toLowerCase()
  const dirByQuery = useCallback(
    (...fields: (string | null | undefined)[]) =>
      !dirQ || fields.some((f) => (f ?? '').toLowerCase().includes(dirQ)),
    [dirQ],
  )
  const dirByExpiry = useCallback(
    (dates: (string | null | undefined)[]) => {
      if (dirExpiry === 'all') return true
      const worst = dates.reduce<ExpiryState>((acc, d) => worseState(acc, expiryInfo(d).state), 'none')
      return dirExpiry === 'expired' ? worst === 'expired' : worst === 'soon' || worst === 'warn'
    },
    [dirExpiry],
  )
  const dirByCarrier = useCallback(
    (carrierId: string) => !isLogist || dirCarrier === 'all' || carrierId === dirCarrier,
    [isLogist, dirCarrier],
  )
  const dirByOwnership = useCallback(
    (type: OwnershipType) => dirOwnership === 'all' || type === dirOwnership,
    [dirOwnership],
  )

  // —— полный (нефильтрованный) парк видимой области: сводка и счётчики ——
  const allDrivers = useMemo(
    () => visibleCarriers.flatMap((c) => c.drivers.map((d) => ({ d, carrierId: c.id, carrierName: c.name }))),
    [visibleCarriers],
  )
  const allTrucks = useMemo(
    () => visibleCarriers.flatMap((c) => c.trucks.map((t) => ({ t, carrierId: c.id, carrierName: c.name }))),
    [visibleCarriers],
  )
  const allTrailers = useMemo(
    () => visibleCarriers.flatMap((c) => c.trailers.map((z) => ({ z, carrierId: c.id, carrierName: c.name }))),
    [visibleCarriers],
  )

  // —— отфильтрованные выборки для таблиц ——
  const driversFlat = useMemo(
    () => allDrivers
      .filter(({ d, carrierId }) => dirByCarrier(carrierId) && dirByOwnership(d.ownershipType)
        && dirByQuery(d.fullName, d.passport, d.phone, d.ownerName) && dirByExpiry([])),
    [allDrivers, dirByQuery, dirByExpiry, dirByCarrier, dirByOwnership],
  )
  const driversTotal = allDrivers.length
  const trucksFlat = useMemo(
    () => allTrucks
      .filter(({ t, carrierId }) => dirByCarrier(carrierId) && dirByOwnership(t.ownershipType)
        && dirByQuery(t.brand, t.plate, t.vin, t.owner) && dirByExpiry([t.techTill])),
    [allTrucks, dirByQuery, dirByExpiry, dirByCarrier, dirByOwnership],
  )
  const trucksTotal = allTrucks.length
  const trailersFlat = useMemo(
    () => allTrailers
      .filter(({ z, carrierId }) => dirByCarrier(carrierId) && dirByOwnership(z.ownershipType)
        && dirByQuery(z.plate, z.type, z.owner) && dirByExpiry([z.techTill])),
    [allTrailers, dirByQuery, dirByExpiry, dirByCarrier, dirByOwnership],
  )
  const trailersTotal = allTrailers.length

  /** Краткая сводка: кто и когда добавлен агентом — последние записи по времени */
  const recentAdditions = useMemo<RecentAddition[]>(() => {
    const items: RecentAddition[] = [
      ...allDrivers.map(({ d, carrierName }) => ({ key: `d-${d.id}`, tab: 'drivers' as const, icon: User, title: d.fullName, kindLabel: 'Водитель', carrierName, createdAt: d.createdAt })),
      ...allTrucks.map(({ t, carrierName }) => ({ key: `t-${t.id}`, tab: 'trucks' as const, icon: Truck, title: `${t.brand} · ${t.plate}`, kindLabel: 'Тягач', carrierName, createdAt: t.createdAt })),
      ...allTrailers.map(({ z, carrierName }) => ({ key: `z-${z.id}`, tab: 'trailers' as const, icon: Wrench, title: `${z.plate} · ${z.type}`, kindLabel: 'Прицеп', carrierName, createdAt: z.createdAt })),
    ]
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6)
  }, [allDrivers, allTrucks, allTrailers])

  /** Что и когда истекает: все документы с плохими/близкими сроками */
  const expiryItems = useMemo<ExpiryItem[]>(() => {
    const items: ExpiryItem[] = []
    const bad = (i: ReturnType<typeof expiryInfo>) => i.state === 'expired' || i.state === 'warn'
    for (const c of visibleCarriers) {
      for (const t of c.trucks) {
        const v = expiryInfo(t.techTill)
        if (bad(v)) items.push({ key: t.id, tab: 'trucks', icon: Truck, title: `${t.brand} · ${t.plate}`, docLabel: 'Техосмотр', info: v, carrierName: c.name })
      }
      for (const z of c.trailers) {
        const v = expiryInfo(z.techTill)
        if (bad(v)) items.push({ key: z.id, tab: 'trailers', icon: Wrench, title: `${z.type} · ${z.plate}`, docLabel: 'Техосмотр', info: v, carrierName: c.name })
      }
    }
    return items.sort((a, b) => (a.info.days ?? 0) - (b.info.days ?? 0))
  }, [visibleCarriers])

  const expiredCount = expiryItems.filter((i) => i.info.state === 'expired').length

  const openAdd = (kind: Kind) => {
    setForm({ carrierId: isLogist ? (carriers?.[0]?.id ?? '') : (activeCarrierId ?? ''), ownershipType: 'OWNED' })
    setEditing(null)
    setAddKind(kind)
  }

  const openEdit = (kind: Kind, id: string, record: Record<string, string>) => {
    setForm({ ...record })
    setAddKind(null)
    setEditing({ kind, id })
  }

  const closeDialog = () => {
    setAddKind(null)
    setEditing(null)
  }

  const submitAdd = async () => {
    if (!addKind) return
    setSaving(true)
    try {
      await api.createDirectory(addKind, form)
      toast({
        title: 'Запись добавлена в справочник',
        description: `${KIND_TITLES[addKind]}: запись создана и доступна при назначении экипажа`,
      })
      closeDialog()
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось добавить запись',
        description: e instanceof Error ? e.message : 'Проверьте заполнение полей',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  /** Роль компании-исполнителя: от неё зависит договорной документ рейса в ЭДО */
  const [roleSaving, setRoleSaving] = useState<string | null>(null)
  const changeRole = async (c: CarrierDTO, role: ExecutorRole) => {
    if (c.role === role) return
    setRoleSaving(c.id)
    try {
      await api.updateDirectory('carrier', c.id, {
        name: c.name, inn: c.inn, contractNo: c.contractNo, contractDate: c.contractDate, role,
      })
      toast({
        title: 'Роль компании изменена',
        description: `${c.name}: ${role === 'FORWARDER' ? 'экспедитор — рейсы получают поручение экспедитору' : 'перевозчик — рейсы получают заказ-заявку на перевозку'}`,
      })
      await load()
    } catch (e) {
      toast({ title: 'Роль не сохранена', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setRoleSaving(null)
    }
  }

  const submitEdit = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await api.updateDirectory(editing.kind, editing.id, form)
      toast({
        title: 'Запись обновлена',
        description: `${KIND_TITLES[editing.kind]}: данные и сроки документов сохранены`,
      })
      closeDialog()
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось обновить запись',
        description: e instanceof Error ? e.message : 'Проверьте заполнение полей',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (carriers === null && !error) return <LoadingBlock label="Загрузка кадров и техники…" />
  if (error) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  const dialogKind = addKind ?? editing?.kind ?? null
  const addLabel = addKind ? KIND_TITLES[addKind] : editing ? KIND_TITLES[editing.kind] : ''
  const counts: Record<SectionKind, number> = { drivers: driversTotal, trucks: trucksTotal, trailers: trailersTotal }

  return (
    <div>
      <SectionHeader
        title="Справочники"
      />

      {/* Кадры и техника: сводка добавленного агентом */}
      <Card className="mb-4 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Database className="h-4 w-4 text-blue-700" aria-hidden />
              Кадры и техника
              <InfoTip label="Кадры и техника">
                {isLogist
                  ? 'Водители и техника, добавленные перевозчиками — агентами АЭМЗ.'
                  : 'Добавляется через «Подать документы» после допуска или кнопкой «Добавить вручную» в разделах ниже.'}
              </InfoTip>
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Последние добавления</div>
            {recentAdditions.length === 0 ? (
              <p className="text-xs text-slate-500">Пока ничего</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {recentAdditions.map((r) => {
                  const Icon = r.icon
                  return (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => setOpen(r.tab)}
                        title={`${r.kindLabel} — добавлен ${fmtCreated(r.createdAt)}${isLogist ? ` · ${r.carrierName}` : ''}`}
                        className="flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/60"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="max-w-[200px] truncate font-medium">{r.title}</span>
                        {isLogist && <span className="hidden max-w-[140px] truncate text-slate-400 sm:inline">· {r.carrierName}</span>}
                        <span className="shrink-0 text-slate-400">· {fmtCreated(r.createdAt)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Сроки документов: что и когда истекает */}
      <Card className={`mb-4 shadow-sm ${expiredCount > 0 ? 'border-red-200 bg-red-50/40' : expiryItems.length > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/40'}`}>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {expiryItems.length === 0
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                : <CalendarClock className={`h-4 w-4 ${expiredCount > 0 ? 'text-red-600' : 'text-amber-600'}`} aria-hidden />}
              Сроки документов
              {expiryItems.length > 0 && (
                <Badge variant="outline" className={expiredCount > 0 ? 'border-red-300 bg-red-100 text-red-700' : 'border-amber-300 bg-amber-100 text-amber-700'}>
                  {expiredCount > 0 ? `истекло: ${expiredCount}` : 'требуют внимания'}
                  {expiryItems.length > expiredCount ? ` · истекают: ${expiryItems.length - expiredCount}` : ''}
                </Badge>
              )}
              <InfoTip label="Цвета сроков">Подсветка: красный — срок истёк, янтарный — осталось до 30 дней, серый — до 90 дней.</InfoTip>
            </div>
          </div>

          {expiryItems.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Истекающих сроков нет</p>
          ) : (
            <ul className={`mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1 ${THIN_SCROLL}`}>
              {expiryItems.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.key} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${item.info.state === 'expired' ? 'border-red-200 bg-white' : 'border-amber-200 bg-white'}`}>
                    <Icon className={`h-4 w-4 shrink-0 ${item.info.state === 'expired' ? 'text-red-500' : 'text-amber-500'}`} aria-hidden />
                    <span className="text-sm font-medium text-slate-800">{item.title}</span>
                    {isLogist && <span className="text-xs text-slate-400">{item.carrierName}</span>}
                    <span className="text-xs text-slate-500">{item.docLabel}</span>
                    <ExpiryBadge date={item.info.date} className="ml-auto" />
                    <button
                      onClick={() => setOpen(item.tab)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
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
              className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              aria-label={`Открыть раздел «${KIND_TITLES[s.kind]}» на весь экран`}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-blue-50 group-hover:text-blue-700">
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <span className="text-sm font-bold text-slate-900">{KIND_TITLES[s.kind]}</span>
                {expiring > 0 && (
                  <Badge variant="outline" className="ml-auto border-amber-300 bg-amber-50 text-amber-700">
                    истекает: {expiring}
                  </Badge>
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

      {/* Компании-исполнители (логист): роль определяет договорной документ рейса */}
      {isLogist && (carriers ?? []).length > 0 && (
        <Card className="mt-4 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Building2 className="h-4 w-4 text-blue-700" aria-hidden />
                Компании-исполнители
                <InfoTip label="Роль компании">
                  Перевозчик — рейсы получают заказ-заявку на перевозку, экспедитор — поручение экспедитору. Смена роли меняет ещё не подписанные документы; подписанные остаются как есть.
                </InfoTip>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {(carriers ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-sm font-medium text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      ИНН {c.inn}{c.contractNo && c.contractNo !== '—' ? ` · договор ${c.contractNo}${c.contractDate && c.contractDate !== '—' ? ` от ${c.contractDate}` : ''}` : ''}
                    </div>
                  </div>
                  <Select value={c.role} onValueChange={(v) => void changeRole(c, v as ExecutorRole)} disabled={roleSaving === c.id}>
                    <SelectTrigger className="h-9 w-[180px]" aria-label={`Роль компании ${c.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CARRIER">Перевозчик</SelectItem>
                      <SelectItem value="FORWARDER">Экспедитор</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ——— раздел на весь экран ——— */}
      {open !== null && (() => {
        const section = SECTIONS.find((s) => s.key === open)!
        const Icon = section.icon
        const flat = open === 'drivers' ? driversFlat : open === 'trucks' ? trucksFlat : trailersFlat
        const total = counts[open]
        return (
          <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={`${KIND_TITLES[section.kind]} — на весь экран`}>
            {/* шапка раздела — на всю ширину экрана (Task 54: меньше пустых отступов слева) */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={closeSection}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Справочники
                </Button>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <h2 className="text-base font-bold text-slate-900">{KIND_TITLES[section.kind]}</h2>
                <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-600">{total}</Badge>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {!isLogist && open === 'drivers' && (
                    <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onNavigate('apply')}>
                      Подать документы
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                  <Button size="sm" className="h-9 gap-1.5" onClick={() => openAdd(section.kind)}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Добавить вручную
                  </Button>
                </div>
              </div>
            </div>

            {/* таблица раздела — на всю ширину экрана (Task 54: колонки левее, больше полезной площади) */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div>
                <DirFilterBar
                  query={dirQuery} onQuery={setDirQuery}
                  expiry={dirExpiry} onExpiry={setDirExpiry} withExpiry
                  count={`Показано: ${flat.length} из ${total}`}
                  extraActive={dirCarrier !== 'all' || dirOwnership !== 'all'}
                  onReset={() => { setDirQuery(''); setDirExpiry('all'); setDirCarrier('all'); setDirOwnership('all') }}
                >
                  <Select value={dirOwnership} onValueChange={(v) => setDirOwnership(v as 'all' | OwnershipType)}>
                    <SelectTrigger className="h-9 w-[200px]" aria-label="Фильтр по принадлежности">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Вся принадлежность</SelectItem>
                      <SelectItem value="OWNED">Собственный парк</SelectItem>
                      <SelectItem value="HIRED">Наёмные</SelectItem>
                      <SelectItem value="LEASE">Аренда и лизинг</SelectItem>
                    </SelectContent>
                  </Select>
                  {isLogist && (
                    <Select value={dirCarrier} onValueChange={setDirCarrier}>
                      <SelectTrigger className="h-9 w-[230px]" aria-label="Фильтр по перевозчику">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все перевозчики</SelectItem>
                        {(carriers ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </DirFilterBar>

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                  <Table>
                    {open === 'drivers' && (
                      <>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead>ФИО</TableHead>
                            {isLogist && <TableHead>Перевозчик</TableHead>}
                            <TableHead>Дата рождения</TableHead>
                            <TableHead>Паспорт</TableHead>
                            <TableHead>Принадлежность</TableHead>
                            <TableHead>Добавлен</TableHead>
                            <TableHead className="w-10"><span className="sr-only">Фото документов</span></TableHead>
                            {!isLogist && <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {driversFlat.map(({ d, carrierName }) => (
                            <DriverRow key={d.id} d={d} carrierName={carrierName} showCarrier={isLogist} onEdit={() => openEdit('driver', d.id, {
                              fullName: d.fullName, birthDate: d.birthDate, passport: d.passport,
                              ownershipType: d.ownershipType,
                              ownerName: d.ownerName === '—' ? '' : d.ownerName,
                              leaseContract: d.leaseContract === '—' ? '' : d.leaseContract,
                            })} onPhotos={() => setPhotoView({ kind: 'driver', id: d.id, title: d.fullName })} />
                          ))}
                          {driversFlat.length === 0 && (
                            <TableRow><TableCell colSpan={7} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                          )}
                        </TableBody>
                      </>
                    )}
                    {open === 'trucks' && (
                      <>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead>Марка</TableHead>
                            {isLogist && <TableHead>Перевозчик</TableHead>}
                            <TableHead>Госномер</TableHead>
                            <TableHead>СТС</TableHead>
                            <TableHead>Техосмотр до</TableHead>
                            <TableHead>Собственник</TableHead>
                            <TableHead>Принадлежность</TableHead>
                            <TableHead>Добавлен</TableHead>
                            <TableHead className="w-10"><span className="sr-only">Фото документов</span></TableHead>
                            {!isLogist && <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {trucksFlat.map(({ t, carrierName }) => (
                            <TruckRow key={t.id} t={t} carrierName={carrierName} showCarrier={isLogist} onEdit={() => openEdit('truck', t.id, {
                              brand: t.brand, plate: t.plate, vin: t.vin, sts: t.sts,
                              techTill: t.techTill === '—' ? '' : t.techTill, owner: t.owner,
                              ownershipType: t.ownershipType,
                              leaseContract: t.leaseContract === '—' ? '' : t.leaseContract,
                            })} onPhotos={() => setPhotoView({ kind: 'truck', id: t.id, title: `${t.brand} · ${t.plate}`, expiry: { techTill: t.techTill } })} />
                          ))}
                          {trucksFlat.length === 0 && (
                            <TableRow><TableCell colSpan={isLogist ? 9 : 10} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                          )}
                        </TableBody>
                      </>
                    )}
                    {open === 'trailers' && (
                      <>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead>Госномер</TableHead>
                            {isLogist && <TableHead>Перевозчик</TableHead>}
                            <TableHead>Тип</TableHead>
                            <TableHead>СТС</TableHead>
                            <TableHead>Техосмотр до</TableHead>
                            <TableHead>Собственник</TableHead>
                            <TableHead>Принадлежность</TableHead>
                            <TableHead>Добавлен</TableHead>
                            <TableHead className="w-10"><span className="sr-only">Фото документов</span></TableHead>
                            {!isLogist && <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {trailersFlat.map(({ z, carrierName }) => (
                            <TrailerRow key={z.id} z={z} carrierName={carrierName} showCarrier={isLogist} onEdit={() => openEdit('trailer', z.id, {
                              plate: z.plate, type: z.type, sts: z.sts, techTill: z.techTill === '—' ? '' : z.techTill,
                              owner: z.owner === '—' ? '' : z.owner,
                              ownershipType: z.ownershipType,
                              leaseContract: z.leaseContract === '—' ? '' : z.leaseContract,
                            })} onPhotos={() => setPhotoView({ kind: 'trailer', id: z.id, title: `${z.type} · ${z.plate}`, expiry: { techTill: z.techTill } })} />
                          ))}
                          {trailersFlat.length === 0 && (
                            <TableRow><TableCell colSpan={isLogist ? 9 : 10} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                          )}
                        </TableBody>
                      </>
                    )}
                  </Table>
                </div>
              </div>
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
              {addKind ? 'Новая запись справочника' : 'Изменение записи справочника'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* перевозчик записи: логист выбирает, перевозчику запись принадлежит его аккаунту */}
            {isLogist && dialogKind && (
              <div className="space-y-1.5">
                <Label>Перевозчик</Label>
                <Select value={form.carrierId ?? ''} onValueChange={(v) => setForm((f) => ({ ...f, carrierId: v }))} disabled={!!editing}>
                  <SelectTrigger aria-label="Выбор перевозчика">
                    <SelectValue placeholder="Выберите перевозчика" />
                  </SelectTrigger>
                  <SelectContent>
                    {(carriers ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* принадлежность записи: собственный парк / наёмный / аренда-лизинг (Task 62) */}
            {dialogKind && (
              <div className="space-y-1.5">
                <Label>Принадлежность</Label>
                <Select
                  value={form.ownershipType ?? 'OWNED'}
                  onValueChange={(v) => setForm((f) => ({ ...f, ownershipType: v }))}
                >
                  <SelectTrigger aria-label="Принадлежность записи">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OWNED">Собственный парк (Компания)</SelectItem>
                    <SelectItem value="HIRED">Наёмный (ИП / ООО)</SelectItem>
                    <SelectItem value="LEASE">Аренда / Лизинг (по договору)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* наёмный водитель: кто именно нанимает (контрагент) */}
            {dialogKind === 'driver' && (form.ownershipType ?? 'OWNED') !== 'OWNED' && (
              <div className="space-y-1.5">
                <Label htmlFor="add-ownerName">Контрагент (ИП / ООО «Название»)</Label>
                <Input
                  id="add-ownerName"
                  placeholder="ИП Смирнов О.В. или ООО «ТрансЛогистик»"
                  value={form.ownerName ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
                />
              </div>
            )}

            {/* аренда / лизинг: договор-основание (Task 62) */}
            {dialogKind && (form.ownershipType ?? 'OWNED') === 'LEASE' && (
              <div className="space-y-1.5">
                <Label htmlFor="add-leaseContract">Договор-основание (№, дата)</Label>
                <Input
                  id="add-leaseContract"
                  placeholder="№ 42-А от 15.01.2025"
                  value={form.leaseContract ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, leaseContract: e.target.value }))}
                />
              </div>
            )}

            {dialogKind && FORM_FIELDS[dialogKind].map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`add-${field.key}`}>{field.label}</Label>
                <Input
                  id={`add-${field.key}`}
                  placeholder={field.placeholder}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Отмена</Button>
            <Button disabled={saving} onClick={() => void (addKind ? submitAdd() : submitEdit())}>
              {saving ? 'Сохранение…' : addKind ? 'Добавить' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ——— окно «Прикрепленные документы»: слоты со статусами (Task 54 + Task 62) ——— */}
      <Dialog open={!!photoView} onOpenChange={(o) => { if (!o) setPhotoView(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          {photoView && (
            <>
              <DialogHeader>
                <DialogTitle>Прикрепленные документы — {photoView.title}</DialogTitle>
                <DialogDescription className="sr-only">
                  Клик по миниатюре открывает полноразмерный просмотр с поворотом и зумом.
                </DialogDescription>
              </DialogHeader>

              {photoLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Загружаем фото…
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {PHOTO_SLOTS[photoView.kind].map((slot) => {
                    const photo = photoList?.find((p) => p.label === slot.label)
                    const expiryDate = slot.expiryKey ? photoView.expiry?.[slot.expiryKey] : undefined
                    const status = slotStatus(photo, expiryDate)
                    const StatusIcon = status.icon
                    const info = expiryDate === undefined ? null : expiryInfo(expiryDate)
                    return (
                      <figure key={slot.label} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
                        {/* статус документа — бейдж сверху карточки */}
                        <div className="px-2.5 pt-2">
                          <Badge variant="outline" className={status.cls}>
                            <StatusIcon aria-hidden />
                            {status.label}
                          </Badge>
                        </div>
                        {photo ? (
                          <div className="px-2.5 pt-2">
                            <ZoomableThumb
                              src={secureFileUrl(photo.url)}
                              alt={`Скан: ${slot.label} — ${photoView.title}`}
                              className="h-40 w-full bg-slate-50"
                              onClick={() => setPreview({
                                src: secureFileUrl(photo.url),
                                title: `${slot.label} — ${photoView.title}`,
                                fileName: photo.fileName,
                                downloadUrl: secureFileUrl(`${photo.url}?download=1`),
                              })}
                            />
                          </div>
                        ) : (
                          <div className={`mx-2.5 mt-2 flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-3 py-8 text-center ${slot.expiryKey ? 'border-slate-200 bg-slate-50' : 'border-dashed border-slate-300 bg-slate-50'}`}>
                            <ImageIcon className="h-5 w-5 text-slate-300" aria-hidden />
                            <span className="text-xs text-slate-400">Скан не загружен</span>
                          </div>
                        )}
                        <figcaption className="mt-auto space-y-1.5 p-2.5">
                          <div className="truncate text-xs font-semibold text-slate-800" title={slot.label}>{slot.label}</div>
                          {photo && <div className="truncate text-[11px] text-slate-400" title={photo.fileName}>{photo.fileName}</div>}
                          {info && info.state !== 'none' && (
                            <div className="text-[11px] text-slate-400">Срок действия: {info.date}</div>
                          )}
                          {photo && (
                            /* скачивание — внутри окна документов (Task 54) */
                            <a
                              href={secureFileUrl(`${photo.url}?download=1`)}
                              download={photo.fileName}
                              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                              aria-label={`Скачать: ${slot.label}`}
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden />
                              Скачать
                            </a>
                          )}
                        </figcaption>
                      </figure>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ——— полноразмерный просмотр документа: поворот, зум, скачивание (Task 62) ——— */}
      {preview && (
        <DocumentPreviewModal
          open={!!preview}
          onOpenChange={(o) => { if (!o) setPreview(null) }}
          src={preview.src}
          title={preview.title}
          fileName={preview.fileName}
          downloadUrl={preview.downloadUrl}
        />
      )}
    </div>
  )
}

// ---------------- строки таблиц с подсветкой сроков ----------------

/** Кнопка фото-предосмотра (Task 54): открывает модальное окно с документами записи */
function PhotosButton({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-8 w-8 text-slate-400 hover:text-blue-700"
      title={`Фото документов: ${title}`}
      aria-label={`Предосмотр фото документов: ${title}`}
      onClick={onOpen}
    >
      <ImageIcon className="h-3.5 w-3.5" aria-hidden />
    </Button>
  )
}

function DriverRow({ d, carrierName, showCarrier, onEdit, onPhotos }: { d: DriverDTO; carrierName: string; showCarrier: boolean; onEdit: () => void; onPhotos: () => void }) {
  return (
    <TableRow>
      <TableCell className="font-medium text-slate-800">{d.fullName}</TableCell>
      {showCarrier && <TableCell className="whitespace-nowrap text-slate-600">{carrierName}</TableCell>}
      <TableCell className="whitespace-nowrap text-slate-600">{d.birthDate}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{d.passport}</TableCell>
      <OwnershipCell type={d.ownershipType} owner={d.ownerName} contract={d.leaseContract} />
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(d.createdAt)}</TableCell>
      <TableCell>
        <PhotosButton title={d.fullName} onOpen={onPhotos} />
      </TableCell>
      {!showCarrier && (
        <TableCell>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Изменить ${d.fullName}`} onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

function TruckRow({ t, carrierName, showCarrier, onEdit, onPhotos }: { t: TruckDTO; carrierName: string; showCarrier: boolean; onEdit: () => void; onPhotos: () => void }) {
  const tech = expiryInfo(t.techTill)
  return (
    <TableRow className={rowTint([tech.state])}>
      <TableCell className="font-medium text-slate-800">{t.brand}</TableCell>
      {showCarrier && <TableCell className="whitespace-nowrap text-slate-600">{carrierName}</TableCell>}
      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-800">{t.plate}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{t.sts}</TableCell>
      <TableCell><ExpiryBadge date={t.techTill} /></TableCell>
      <TableCell className="text-slate-600">{t.owner}</TableCell>
      <OwnershipCell type={t.ownershipType} owner={t.owner} contract={t.leaseContract} hideOwner />
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(t.createdAt)}</TableCell>
      <TableCell>
        <PhotosButton title={`${t.brand} · ${t.plate}`} onOpen={onPhotos} />
      </TableCell>
      {!showCarrier && (
        <TableCell>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Изменить ${t.plate}`} onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

function TrailerRow({ z, carrierName, showCarrier, onEdit, onPhotos }: { z: TrailerDTO; carrierName: string; showCarrier: boolean; onEdit: () => void; onPhotos: () => void }) {
  const tech = expiryInfo(z.techTill)
  return (
    <TableRow className={rowTint([tech.state])}>
      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-800">{z.plate}</TableCell>
      {showCarrier && <TableCell className="whitespace-nowrap text-slate-600">{carrierName}</TableCell>}
      <TableCell className="text-slate-600">{z.type}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{z.sts}</TableCell>
      <TableCell><ExpiryBadge date={z.techTill} /></TableCell>
      <TableCell className="text-slate-600">{z.owner}</TableCell>
      <OwnershipCell type={z.ownershipType} owner={z.owner} contract={z.leaseContract} hideOwner />
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(z.createdAt)}</TableCell>
      <TableCell>
        <PhotosButton title={`${z.type} · ${z.plate}`} onOpen={onPhotos} />
      </TableCell>
      {!showCarrier && (
        <TableCell>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Изменить ${z.plate}`} onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

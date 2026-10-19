'use client'

/**
 * «Справочники» — база аккаунта: логисту — весь парк перевозчиков,
 * перевозчику — только свой. Все данные агента в одном месте с подсветкой
 * сроков документов: что истекло и что истекает — видно сразу.
 * Нейро-функционал (добавление по документам) перенесён во вкладку «Подать заявку».
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Pencil,
  Plus,
  Truck,
  User,
  Users,
  Wrench,
} from 'lucide-react'
import {
  ErrorBlock, ExpiryBadge, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { expiryInfo, rowTint, type ExpiryState } from '@/lib/expiry'
import type { CarrierDTO, DriverDTO, TrailerDTO, TruckDTO } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

type Kind = 'carrier' | 'driver' | 'truck' | 'trailer'

type TabKind = 'carriers' | 'drivers' | 'trucks' | 'trailers'

interface FieldDef {
  key: string
  label: string
  placeholder?: string
}

const FORM_FIELDS: Record<Kind, FieldDef[]> = {
  carrier: [
    { key: 'name', label: 'Название', placeholder: 'ООО «Перевозчик Д»' },
    { key: 'inn', label: 'ИНН', placeholder: '2310045675' },
    { key: 'contractNo', label: 'Договор №', placeholder: '24-Д' },
    { key: 'contractDate', label: 'Дата договора', placeholder: '01.11.2025' },
  ],
  driver: [
    { key: 'fullName', label: 'ФИО', placeholder: 'Смирнов Олег Викторович' },
    { key: 'birthDate', label: 'Дата рождения', placeholder: '11.03.1993' },
    { key: 'passport', label: 'Паспорт (серия и номер)', placeholder: '52 07 123456' },
    { key: 'license', label: 'Номер ВУ', placeholder: '52 07 123456' },
    { key: 'licenseTill', label: 'ВУ действует до', placeholder: 'ДД.ММ.ГГГГ' },
    { key: 'medTill', label: 'Медсправка действует до', placeholder: 'ДД.ММ.ГГГГ' },
    { key: 'categories', label: 'Категории', placeholder: 'C, CE' },
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
  ],
}

const KIND_TITLES: Record<Kind, string> = {
  carrier: 'Перевозчики',
  driver: 'Водители',
  truck: 'Тягачи (ТС)',
  trailer: 'Прицепы',
}

/** Запись в блоке «Требуют внимания» */
interface ExpiryItem {
  key: string
  tab: Exclude<TabKind, 'carriers'>
  icon: typeof User
  title: string
  docLabel: string
  info: ReturnType<typeof expiryInfo>
  carrierName: string
}

function AccessBadge({ access }: { access: boolean }) {
  return access ? (
    <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-emerald-700">
      Доступ открыт
    </Badge>
  ) : (
    <Badge variant="outline" className="whitespace-nowrap border-slate-300 bg-slate-100 text-slate-600">
      Закрыт
    </Badge>
  )
}

const fmtCreated = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

export default function DirectoriesTab({ activeCarrierId, role, onNavigate }: TabProps) {
  const { toast } = useToast()
  const [carriers, setCarriers] = useState<CarrierDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKind>('carriers')
  const [addKind, setAddKind] = useState<Kind | null>(null)
  const [editing, setEditing] = useState<{ kind: Kind; id: string } | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const isLogist = role === 'logist'

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

  const driversFlat = useMemo(
    () => visibleCarriers.flatMap((c) => c.drivers.map((d) => ({ d, carrierName: c.name }))),
    [visibleCarriers],
  )
  const trucksFlat = useMemo(
    () => visibleCarriers.flatMap((c) => c.trucks.map((t) => ({ t, carrierName: c.name }))),
    [visibleCarriers],
  )
  const trailersFlat = useMemo(
    () => visibleCarriers.flatMap((c) => c.trailers.map((z) => ({ z, carrierName: c.name }))),
    [visibleCarriers],
  )

  /** Что и когда истекает: все документы с плохими/близкими сроками */
  const expiryItems = useMemo<ExpiryItem[]>(() => {
    const items: ExpiryItem[] = []
    const bad = (i: ReturnType<typeof expiryInfo>) => i.state === 'expired' || i.state === 'warn'
    for (const c of visibleCarriers) {
      for (const d of c.drivers) {
        const v = expiryInfo(d.licenseTill)
        if (bad(v)) items.push({ key: `${d.id}-lic`, tab: 'drivers', icon: User, title: d.fullName, docLabel: 'Водительское удостоверение', info: v, carrierName: c.name })
        const m = expiryInfo(d.medTill)
        if (bad(m)) items.push({ key: `${d.id}-med`, tab: 'drivers', icon: User, title: d.fullName, docLabel: 'Медсправка', info: m, carrierName: c.name })
      }
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
    setForm({ carrierId: isLogist ? (carriers?.[0]?.id ?? '') : (activeCarrierId ?? '') })
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
        title: 'Запись добавлена в базу',
        description: `${KIND_TITLES[addKind]}: запись создана и доступна при подаче заявки`,
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

  if (carriers === null && !error) return <LoadingBlock label="Загрузка базы аккаунта…" />
  if (error) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  const dialogKind = addKind ?? editing?.kind ?? null
  const addLabel = addKind ? KIND_TITLES[addKind] : editing ? KIND_TITLES[editing.kind] : ''
  // у перевозчика вкладка «Перевозчики» недоступна — ведём на «Водителей»
  const activeTab: TabKind = !isLogist && tab === 'carriers' ? 'drivers' : tab

  return (
    <div>
      <SectionHeader
        eyebrow={isLogist ? 'РЕШЕНИЕ 2 · СПРАВОЧНИК' : 'БАЗА АККАУНТА АГЕНТА'}
        title={isLogist ? 'Единый справочник: водитель вводится один раз' : 'База вашего аккаунта'}
        desc={isLogist
          ? 'Парк всех перевозчиков с контрольными сроками документов. Истекающие документы подсвечиваются — вы увидите проблему до заявки.'
          : 'Все данные, которые вы добавили: водители, тягачи и прицепы. Сроки документов подсвечиваются автоматически: красный — истёк, янтарный — истекает в ближайшие 30 дней.'}
      />

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
            </div>
            <span className="text-[11px] text-slate-500">подсветка: красный — истёк · янтарный — ≤ 30 дней · серый — ≤ 90 дней</span>
          </div>

          {expiryItems.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              Все документы базы действительны — истекающих сроков нет.
            </p>
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
                      onClick={() => setTab(item.tab)}
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

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKind)} className="gap-4">
        <TabsList className="flex-wrap">
          {isLogist && (
            <TabsTrigger value="carriers">
              <Users className="h-4 w-4" aria-hidden />
              Перевозчики
            </TabsTrigger>
          )}
          <TabsTrigger value="drivers">
            <User className="h-4 w-4" aria-hidden />
            Водители
          </TabsTrigger>
          <TabsTrigger value="trucks">
            <Truck className="h-4 w-4" aria-hidden />
            Тягачи (ТС)
          </TabsTrigger>
          <TabsTrigger value="trailers">
            <Wrench className="h-4 w-4" aria-hidden />
            Прицепы
          </TabsTrigger>
        </TabsList>

        {/* -------- Перевозчики (только логист) -------- */}
        {isLogist && (
        <TabsContent value="carriers">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">Записей: {(carriers ?? []).length}</div>
                <Button size="sm" onClick={() => openAdd('carrier')}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить перевозчика
                </Button>
              </div>
              <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Название</TableHead>
                      <TableHead>ИНН</TableHead>
                      <TableHead>Договор</TableHead>
                      <TableHead>Доступ</TableHead>
                      <TableHead>Взято заявок</TableHead>
                      <TableHead>Ставок</TableHead>
                      <TableHead>Водители/ТС</TableHead>
                      <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(carriers ?? []).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium text-slate-800">{c.name}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">{c.inn}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">№{c.contractNo} от {c.contractDate}</TableCell>
                        <TableCell><AccessBadge access={c.access} /></TableCell>
                        <TableCell className="font-semibold text-slate-800">{c.takenCount}</TableCell>
                        <TableCell className="text-slate-600">{c.bidsCount}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">
                          {c.drivers.length} / {c.trucks.length}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Изменить ${c.name}`}
                            onClick={() => openEdit('carrier', c.id, { name: c.name, inn: c.inn, contractNo: c.contractNo, contractDate: c.contractDate, access: String(c.access) })}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(carriers ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* -------- Водители -------- */}
        <TabsContent value="drivers">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              {!isLogist && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
                  <p className="max-w-xl text-xs leading-snug text-slate-600">
                    <b className="text-slate-800">Новый водитель?</b> Добавляйте по документам во вкладке «Подать заявку» — нейросеть сама прочитает паспорт, ВУ и СТС и заполнит карточку.
                  </p>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onNavigate('apply')}>
                    Подать заявку
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              )}
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">Записей: {driversFlat.length}</div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openAdd('driver')}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить вручную
                </Button>
              </div>
              <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>ФИО</TableHead>
                      <TableHead>Дата рождения</TableHead>
                      <TableHead>Паспорт</TableHead>
                      <TableHead>ВУ (номер)</TableHead>
                      <TableHead>ВУ действует до</TableHead>
                      <TableHead>Медсправка до</TableHead>
                      <TableHead>Категории</TableHead>
                      <TableHead>Добавлен</TableHead>
                      {!isLogist && <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {driversFlat.map(({ d, carrierName }) => (
                      <DriverRow key={d.id} d={d} carrierName={carrierName} showCarrier={isLogist} onEdit={() => openEdit('driver', d.id, {
                        fullName: d.fullName, birthDate: d.birthDate, passport: d.passport, license: d.license,
                        licenseTill: d.licenseTill === '—' ? '' : d.licenseTill, medTill: d.medTill === '—' ? '' : d.medTill,
                        categories: d.categories,
                      })} />
                    ))}
                    {driversFlat.length === 0 && (
                      <TableRow><TableCell colSpan={isLogist ? 8 : 9} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- Тягачи -------- */}
        <TabsContent value="trucks">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">Записей: {trucksFlat.length}</div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openAdd('truck')}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить тягач
                </Button>
              </div>
              <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Марка</TableHead>
                      <TableHead>Госномер</TableHead>
                      <TableHead>VIN</TableHead>
                      <TableHead>СТС</TableHead>
                      <TableHead>Техосмотр до</TableHead>
                      <TableHead>Собственник</TableHead>
                      <TableHead>Добавлен</TableHead>
                      {!isLogist && <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trucksFlat.map(({ t, carrierName }) => (
                      <TruckRow key={t.id} t={t} carrierName={carrierName} showCarrier={isLogist} onEdit={() => openEdit('truck', t.id, {
                        brand: t.brand, plate: t.plate, vin: t.vin, sts: t.sts,
                        techTill: t.techTill === '—' ? '' : t.techTill, owner: t.owner,
                      })} />
                    ))}
                    {trucksFlat.length === 0 && (
                      <TableRow><TableCell colSpan={isLogist ? 7 : 8} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- Прицепы -------- */}
        <TabsContent value="trailers">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">Записей: {trailersFlat.length}</div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openAdd('trailer')}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить прицеп
                </Button>
              </div>
              <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Госномер</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>СТС</TableHead>
                      <TableHead>Техосмотр до</TableHead>
                      <TableHead>Добавлен</TableHead>
                      {!isLogist && <TableHead className="w-10"><span className="sr-only">Изменить</span></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trailersFlat.map(({ z, carrierName }) => (
                      <TrailerRow key={z.id} z={z} carrierName={carrierName} showCarrier={isLogist} onEdit={() => openEdit('trailer', z.id, {
                        plate: z.plate, type: z.type, sts: z.sts, techTill: z.techTill === '—' ? '' : z.techTill,
                      })} />
                    ))}
                    {trailersFlat.length === 0 && (
                      <TableRow><TableCell colSpan={isLogist ? 5 : 6} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* диалог добавления / изменения записи */}
      <Dialog open={!!dialogKind} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{addKind ? 'Добавить запись' : 'Изменить запись'} — {addLabel}</DialogTitle>
            <DialogDescription>
              {addKind
                ? 'Запись появится в базе аккаунта и станет доступна при подаче заявки.'
                : 'Обновите данные и сроки действия документов — подсветка сроков пересчитается автоматически.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {addKind === 'driver' || addKind === 'truck' || addKind === 'trailer' ? (
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
            ) : null}

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

            {editing?.kind === 'carrier' && (
              <div className="space-y-1.5">
                <Label htmlFor="add-access">Доступ к площадке</Label>
                <Select value={form.access ?? 'true'} onValueChange={(v) => setForm((f) => ({ ...f, access: v }))}>
                  <SelectTrigger id="add-access" aria-label="Доступ к площадке">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Доступ открыт</SelectItem>
                    <SelectItem value="false">Закрыт</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Отмена</Button>
            <Button disabled={saving} onClick={() => void (addKind ? submitAdd() : submitEdit())}>
              {saving ? 'Сохранение…' : addKind ? 'Добавить' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------- строки таблиц с подсветкой сроков ----------------

function DriverRow({ d, carrierName, showCarrier, onEdit }: { d: DriverDTO; carrierName: string; showCarrier: boolean; onEdit: () => void }) {
  const lic = expiryInfo(d.licenseTill)
  const med = expiryInfo(d.medTill)
  const tint = rowTint([lic.state, med.state] as ExpiryState[])
  return (
    <TableRow className={tint}>
      <TableCell className="font-medium text-slate-800">{d.fullName}</TableCell>
      <TableCell className="whitespace-nowrap text-slate-600">{d.birthDate}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{d.passport}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{d.license}</TableCell>
      <TableCell><ExpiryBadge date={d.licenseTill} /></TableCell>
      <TableCell><ExpiryBadge date={d.medTill} /></TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {d.categories.split(',').map((cat) => cat.trim()).filter(Boolean).map((cat) => (
            <Badge key={cat} variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">{cat}</Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(d.createdAt)}</TableCell>
      {showCarrier && <TableCell className="text-slate-600">{carrierName}</TableCell>}
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

function TruckRow({ t, carrierName, showCarrier, onEdit }: { t: TruckDTO; carrierName: string; showCarrier: boolean; onEdit: () => void }) {
  const tech = expiryInfo(t.techTill)
  return (
    <TableRow className={rowTint([tech.state])}>
      <TableCell className="font-medium text-slate-800">{t.brand}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-800">{t.plate}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-500">{t.vin}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{t.sts}</TableCell>
      <TableCell><ExpiryBadge date={t.techTill} /></TableCell>
      <TableCell className="text-slate-600">{t.owner}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(t.createdAt)}</TableCell>
      {showCarrier && <TableCell className="text-slate-600">{carrierName}</TableCell>}
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

function TrailerRow({ z, carrierName, showCarrier, onEdit }: { z: TrailerDTO; carrierName: string; showCarrier: boolean; onEdit: () => void }) {
  const tech = expiryInfo(z.techTill)
  return (
    <TableRow className={rowTint([tech.state])}>
      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-800">{z.plate}</TableCell>
      <TableCell className="text-slate-600">{z.type}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{z.sts}</TableCell>
      <TableCell><ExpiryBadge date={z.techTill} /></TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{fmtCreated(z.createdAt)}</TableCell>
      {showCarrier && <TableCell className="text-slate-600">{carrierName}</TableCell>}
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

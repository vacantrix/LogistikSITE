'use client'

/**
 * «Реестр рейсов» — одна запись = один рейс: заявки, ставки, документы, затраты.
 * Вид синхронизирован с «Реестром заявок»: верхние табы по статусам со
 * счётчиками (В работе / Завершён), поиск по номеру/грузу/маршруту/перевозчику,
 * сортировка, статусы из общей системы платформы, sticky-шапка таблицы под шапкой
 * сайта (md+) и список, уходящий вниз без внутреннего скролл-окна.
 * Действия — иконками (просмотр, закрыть рейс). Карточка рейса — этапы (Pipeline)
 * и журнал событий. В реестр попадают заявки с выбранным перевозчиком:
 * «Перевозчик выбран» → «Документы проверяются» → «У логиста — сверка» →
 * «Рейс выполняется» → «Рейс закрыт».
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight, CircleCheck, Download, Eye, FileText, Files,
  Image as ImageIcon, ScrollText, Search,
} from 'lucide-react'
import {
  EmptyState, ErrorBlock, InfoTip, LoadingBlock, SectionHeader, StatusDot, WithTip, type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api, secureFileUrl } from '@/lib/api'
import { pointInfo } from '@/lib/points'
import { formatKm, straightLineKm } from '@/lib/geo'
import { useRoadDistance } from '@/lib/use-road-distance'
import { RouteButton } from '@/components/platform/route-dialog'
import { useCan } from '@/components/platform/perms'
import {
  REGISTRY_STEPS, REQUEST_STATUS_META, fmtDateTime, num, rate, registryStepIndex,
} from '@/lib/status'
import {
  REQUEST_FILE_META, TRANSPORT_OWNERSHIP_META,
  type DriverDTO, type ExecutorRole, type RequestDTO, type TrailerDTO, type TruckDTO,
} from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

/** Размер файла в списках обмена: до 1 МБ — килобайты, крупнее — мегабайты */
const kb = (n: number): string => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`)

/** Подписи исполнителя по заявке (Task 109): заказ-заявка перевозчику или поручение экспедитору */
const EXECUTOR_ROLE_LABEL: Record<ExecutorRole, string> = { CARRIER: 'Перевозчик', FORWARDER: 'Экспедитор' }

/** Адрес точки маршрута: из справочника либо «по данным заявки» с сырым значением */
const pointAddress = (raw: string): string => {
  const info = pointInfo(raw)
  return info.known ? info.address : `Адрес по данным заявки: ${raw}`
}

/**
 * Панель маршрута в карточке рейса (Task 110-c): полные названия и адреса точек
 * погрузки/выгрузки, расстояние по автомобильному маршруту (OSRM; пока не
 * посчитано — по прямой) и переход к автомобильному маршруту в Яндекс.Картах.
 * Точка, которой нет в справочнике, показывается «по данным заявки».
 */
function RoutePanel({ from, to, number }: { from: string; to: string; number: string }) {
  const { km: roadKm, road } = useRoadDistance(from, to)
  const km = roadKm ?? straightLineKm(from, to)
  const points = [
    { label: 'Погрузка', raw: from, info: pointInfo(from) },
    { label: 'Выгрузка', raw: to, info: pointInfo(to) },
  ]
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-slate-500">Маршрут</div>
        <div className="flex flex-wrap items-center gap-2">
          <WithTip tip={road ? 'Расстояние по автомобильным дорогам между точками погрузки и выгрузки (OSRM)' : 'Пока маршрут рассчитывается — расстояние по прямой; дорожное подставится автоматически'}>
            <span tabIndex={0} className="flex items-baseline gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
              <span className="text-[11px] text-slate-500">{road ? 'по маршруту' : 'по прямой'}</span>
              <span className="text-sm font-semibold text-slate-900">{km != null ? `${road ? '' : '≈ '}${formatKm(km)}` : '—'}</span>
            </span>
          </WithTip>
          <RouteButton from={from} to={to} number={number} />
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {points.map(({ label, raw, info }) => {
          const Icon = info.icon
          return (
            <div key={label} className="flex gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100" aria-hidden>
                <Icon className="h-3.5 w-3.5 text-slate-500" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] leading-tight text-slate-500">
                  {label}{info.known && ` · ${info.short}`}
                </div>
                <div className="text-sm font-semibold leading-snug text-slate-900">{info.known ? info.name : raw}</div>
                <div className={`mt-0.5 text-[13px] leading-snug ${info.known ? 'text-slate-600' : 'text-slate-500'}`}>
                  {pointAddress(raw)}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Файлы обмена перевозчик ↔ логист по заявке (Task 109): вид, автор, дата, размер, «Скачать» */
function RequestFilesList({ files }: { files: RequestDTO['files'] }) {
  return (
    <ul className="space-y-1.5">
      {files.map((f) => {
        const FileIcon = f.isImage ? ImageIcon : FileText
        return (
          <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <FileIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{f.fileName}</span>
              <span className="block text-[11px] text-slate-500">
                {REQUEST_FILE_META[f.kind].label} · {f.uploadedByName} · {fmtDateTime(f.createdAt)}
              </span>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{kb(f.sizeBytes)}</span>
            <a
              href={secureFileUrl(f.url)}
              download={f.fileName}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
              aria-label={`Скачать ${f.fileName}`}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Скачать
            </a>
          </li>
        )
      })}
    </ul>
  )
}

type TripGroup = 'work' | 'closed'
type SortOrder = 'desc' | 'asc'

/** Рейс в реестре — заявка, по которой уже выбран перевозчик. Статусы рейса
 *  берутся из общей системы платформы (REQUEST_STATUS_META), поэтому подписи
 *  совпадают с «Реестром заявок»: «Перевозчик выбран» → «Документы проверяются»
 *  → «У логиста — сверка» → «Рейс выполняется» → «Рейс закрыт». */
const TRIP_STATUSES = ['AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED'] as const
const isTrip = (status: string): boolean => (TRIP_STATUSES as readonly string[]).includes(status)
const tripStatusMeta = (status: string) =>
  REQUEST_STATUS_META[status as keyof typeof REQUEST_STATUS_META] ?? REQUEST_STATUS_META.PUBLISHED

/**
 * Группы рейсов в стиле «Реестра заявок» (Task 75→76): цвета и названия согласованы —
 * фиолетовый «В работе» = рейс готовится или выполняется (как «В работе» у заявок),
 * изумрудный «Завершён» = рейс закрыт (как «Завершена»). Точный статус внутри группы
 * показывается общей подписью REQUEST_STATUS_META.
 */
const TRIP_GROUP_META: Record<TripGroup, { label: string; badge: string; dot: string }> = {
  work: { label: 'В работе', badge: 'bg-violet-500 text-white border-violet-600 shadow-sm', dot: 'bg-violet-500' },
  closed: { label: 'Завершён', badge: 'bg-emerald-500 text-white border-emerald-600 shadow-sm', dot: 'bg-emerald-500' },
}

const tripGroupOf = (status: string): TripGroup => (status === 'CLOSED' ? 'closed' : 'work')

/** Пайплайн из 8 статусов записи реестра */
function Pipeline({ status, passPackage, etrnStatus }: { status: string; passPackage: boolean; etrnStatus: string }) {
  const cur = registryStepIndex(status, passPackage, etrnStatus)
  return (
    <div className="flex flex-wrap items-center gap-1" role="list" aria-label="Этапы рейса">
      {REGISTRY_STEPS.map((step, i) => (
        <Fragment key={step}>
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />}
          <span
            role="listitem"
            aria-current={i === cur ? 'step' : undefined}
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              i < cur
                ? 'border-slate-200 bg-white text-slate-600'
                : i === cur
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            {step}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

function DocBadges({ r, stacked }: { r: RequestDTO; stacked?: boolean }) {
  const docsChecked = ['AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(r.status)
  const docsReview = r.status === 'DOCS_REVIEW'
  const docsLoading = r.status === 'AWARDED'
  return (
    <div className={stacked ? 'flex flex-col items-start gap-1' : 'flex flex-wrap gap-1'}>
      <StatusDot
        dot={docsChecked ? 'bg-emerald-500' : docsReview || docsLoading ? 'bg-amber-500' : 'bg-slate-300'}
        className="text-xs"
      >
        {docsChecked
          ? 'Документы проверены'
          : docsReview
            ? 'Документы на проверке'
            : docsLoading
              ? 'Документы загружаются'
              : 'Документы не загружены'}
      </StatusDot>
      <StatusDot dot={r.passPackage ? 'bg-emerald-500' : 'bg-slate-300'} className="text-xs">
        {r.passPackage ? 'Пропуск оформлен' : 'Пропуск не оформлен'}
      </StatusDot>
    </div>
  )
}

export default function RegistryTab({ activeCarrierId: _activeCarrierId, liveTick }: TabProps) {
  const { toast } = useToast()
  // права платформы (Task 111): закрытие рейсов — trip:close; нет права — кнопки
  // «Закрыть рейс» не отображаются (сервер проверяет то же самое)
  const can = useCan()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [drivers, setDrivers] = useState<Map<string, DriverDTO>>(new Map())
  const [trucks, setTrucks] = useState<Map<string, TruckDTO>>(new Map())
  const [trailers, setTrailers] = useState<Map<string, TrailerDTO>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // фильтры (Task 75 — вид «Реестра заявок»): таб статуса, поиск, сортировка
  const [group, setGroup] = useState<'ALL' | TripGroup>('ALL')
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<SortOrder>('desc')

  // диалоги держим по id — свежие данные берём из списка (живое обновление)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [closeId, setCloseId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [rq, dir] = await Promise.all([api.listRequests(), api.directory()])
      setRequests(rq.requests)
      const dm = new Map<string, DriverDTO>()
      const tm = new Map<string, TruckDTO>()
      const zm = new Map<string, TrailerDTO>()
      for (const c of dir.carriers) {
        for (const d of c.drivers) dm.set(d.id, d)
        for (const t of c.trucks) tm.set(t.id, t)
        for (const z of c.trailers) zm.set(z.id, z)
      }
      setDrivers(dm)
      setTrucks(tm)
      setTrailers(zm)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // real-time (Task 49): событие из шины WS мгновенно догружает реестр рейсов
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  // записи реестра: заявки, по которым уже выбран перевозчик, — от «Перевозчик выбран»
  // до «Рейс закрыт»; черновики и заявки на площадке живут в «Реестре заявок»
  const base = useMemo(
    () => (requests ?? []).filter((r) => isTrip(r.status)),
    [requests],
  )

  // ——— фильтрация и сортировка ———
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = base.filter((r) => {
      if (group !== 'ALL' && tripGroupOf(r.status) !== group) return false
      if (!needle) return true
      // поиск по номеру рейса, грузу, маршруту и перевозчику
      return [r.number, r.cargo, r.fromPoint, r.toPoint, r.winnerName ?? '']
        .some((v) => v.toLowerCase().includes(needle))
    })
    return list.sort((a, b) => (order === 'desc' ? b.number.localeCompare(a.number) : a.number.localeCompare(b.number)))
  }, [base, group, q, order])

  const groupCounts = useMemo(() => {
    const counts: Record<TripGroup, number> = { work: 0, closed: 0 }
    for (const r of base) counts[tripGroupOf(r.status)] += 1
    return counts
  }, [base])

  const detail = base.find((r) => r.id === detailId) ?? null
  const closeTarget = base.find((r) => r.id === closeId) ?? null

  const closeTrip = async () => {
    if (!closeTarget) return
    setBusy(closeTarget.id)
    try {
      await api.action(closeTarget.id, 'close')
      toast({
        title: 'Рейс закрыт',
        description: `№${closeTarget.number}: данные в реестре и отчётах обновлены`,
      })
      setCloseId(null)
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось закрыть рейс',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <SectionHeader title="Реестр рейсов">
        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
          Рейсов: {filtered.length}{filtered.length !== base.length ? ` из ${base.length}` : ''}
        </Badge>
      </SectionHeader>

      {requests === null && !error && <LoadingBlock label="Загрузка реестра рейсов…" />}
      {error && <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />}

      {requests !== null && !error && (
        <div className="space-y-4">
          {/* Табы статусов (Task 75) — как в «Реестре заявок»: мгновенная фильтрация,
              счётчики считаются по всей базе реестра, а не по текущему поиску */}
          <Tabs value={group} onValueChange={(v) => setGroup(v as 'ALL' | TripGroup)}>
            <TabsList className="h-auto flex-wrap justify-start gap-1 bg-slate-100 p-1">
              <TabsTrigger value="ALL" className="gap-1.5 data-[state=active]:bg-white">
                Все рейсы
                <Badge variant="outline" className="h-5 border-slate-200 bg-white px-1.5 text-[10px] text-slate-500">{base.length}</Badge>
              </TabsTrigger>
              {(Object.keys(TRIP_GROUP_META) as TripGroup[]).map((g) => (
                <TabsTrigger key={g} value={g} className="gap-1.5 data-[state=active]:bg-white">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TRIP_GROUP_META[g].dot}`} aria-hidden />
                    {TRIP_GROUP_META[g].label}
                  </span>
                  <Badge variant="outline" className="h-5 border-slate-200 bg-white px-1.5 text-[10px] text-slate-500">{groupCounts[g]}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Инструменты: поиск и сортировка */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Поиск по номеру рейса, грузу, маршруту или перевозчику…"
                  className="pl-9"
                  aria-label="Поиск по номеру рейса, грузу, маршруту или перевозчику"
                />
              </div>
              <Select value={order} onValueChange={(v) => setOrder(v as SortOrder)}>
                <SelectTrigger className="w-[190px]" aria-label="Сортировка по номеру рейса">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Сначала новые</SelectItem>
                  <SelectItem value="asc">Сначала старые</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Таблица реестра */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="h-10 w-10" aria-hidden />}
              title={base.length === 0 ? 'Реестр пуст' : 'Ничего не найдено'}
              hint={base.length === 0
                ? 'Подтвердите заявку на сверке — запись рейса появится здесь'
                : 'Измените статус или условия поиска'}
            />
          ) : (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-0">
                {/* Task 75: как в «Реестре заявок» (Task 71/73) — без внутреннего скролл-окна,
                    список уходит вниз вместе со страницей; шапка таблицы прилипает под шапкой
                    сайта (md:top = высота хедера), перехват скролла отключён через
                    .registry-sticky-table (globals.css) */}
                <div className="registry-sticky-table">
                  <Table>
                    <TableHeader className="z-10 bg-slate-50 shadow-[0_2px_6px_-2px_rgba(15,23,42,0.12)] md:sticky md:top-[var(--header-h,105px)]">
                      <TableRow className="bg-slate-50">
                        <TableHead className="whitespace-nowrap">№</TableHead>
                        <TableHead className="whitespace-nowrap">Статус</TableHead>
                        <TableHead className="whitespace-nowrap">Направление</TableHead>
                        <TableHead className="whitespace-nowrap">Перевозчик</TableHead>
                        <TableHead className="whitespace-nowrap">Груз</TableHead>
                        <TableHead className="whitespace-nowrap">Экипаж</TableHead>
                        <TableHead className="whitespace-nowrap">Ставка</TableHead>
                        <TableHead className="whitespace-nowrap">Экономия</TableHead>
                        <TableHead className="whitespace-nowrap">Документы</TableHead>
                        <TableHead className="text-right">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((r) => {
                        const g = TRIP_GROUP_META[tripGroupOf(r.status)]
                        const driver = r.driverId ? drivers.get(r.driverId) : undefined
                        const truck = r.truckId ? trucks.get(r.truckId) : undefined
                        const trailer = r.trailerId ? trailers.get(r.trailerId) : undefined
                        return (
                          <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(r.id)}>
                            {/* номер + дата погрузки под ним (Task 75: компактно, как пузырь + подпись) */}
                            <TableCell className="whitespace-nowrap">
                              <div className="flex flex-col items-start leading-tight">
                                <span className="font-bold text-slate-900">№{r.number}</span>
                                <span className="text-[11px] text-slate-500">{r.loadDate}</span>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {/* группа точкой и словом + точный статус под ним (Task 75/76) */}
                              <div className="flex flex-col items-start gap-0.5">
                                <StatusDot dot={g.dot}>{g.label}</StatusDot>
                                <span className="text-xs leading-tight text-slate-500">
                                  {tripStatusMeta(r.status).label}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-700">
                              {/* ограничение ширины — на внутреннем блоке (max-width на td в auto-таблице не сдерживает текст,
                                  маршрут наезжал на соседнюю колонку) */}
                              <div className="max-w-[150px]" title={`${r.fromPoint} → ${r.toPoint}`}>
                                {/* whitespace-normal: у TableCell базово nowrap — без сброса маршрут не переносится и наезжает на соседний столбец */}
                                <span className="block whitespace-normal break-words">
                                  {pointInfo(r.fromPoint).short} → {pointInfo(r.toPoint).short}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-800">
                              <div className="max-w-[150px]">
                                <span className="block truncate font-medium" title={r.winnerName ?? ''}>{r.winnerName ?? '—'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-600">
                              <div className="max-w-[140px]">
                                <span className="line-clamp-2 whitespace-normal" title={`${r.cargo}, ${num(r.tonnage)} т`}>{r.cargo}, {num(r.tonnage)} т</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-600">
                              {/* водитель + ТС одной компактной ячейкой; без экипажа — честная подпись, а не два прочерка */}
                              {driver || truck ? (
                                <div className="flex max-w-[200px] flex-col items-start leading-tight">
                                  <span className="max-w-full break-words">{driver?.fullName ?? '—'}</span>
                                  <span className="max-w-full truncate text-[11px] text-slate-500" title={truck ? `${truck.brand} · ${truck.plate}${trailer ? ` + ${trailer.plate}` : ''}` : ''}>
                                    {truck ? `${truck.brand} · ${truck.plate}` : '—'}
                                    {trailer && ` + ${trailer.plate}`}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">экипаж не указан</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {/* итоговая ставка + старт под ней (Task 75: компактная ячейка) */}
                              <div className="flex flex-col items-start leading-tight">
                                <span className="font-semibold text-slate-900">{rate(r.bestRate)}</span>
                                <span className="text-[11px] text-slate-500">старт {rate(r.startRate)}</span>
                              </div>
                            </TableCell>
                            <TableCell className={`whitespace-nowrap font-semibold ${(r.savings ?? 0) > 0 ? 'text-slate-900' : 'text-slate-500'}`}>
                              {rate(r.savings)}
                            </TableCell>
                            <TableCell>
                              <DocBadges r={r} stacked />
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                                  onClick={() => setDetailId(r.id)}
                                  aria-label={`Просмотреть рейс №${r.number}`}
                                  title="Просмотр"
                                >
                                  <Eye className="h-4 w-4" aria-hidden />
                                </Button>
                                {/* закрытие рейса — по праву trip:close (Task 111) */}
                                {r.status === 'CONFIRMED' && can('trip:close') && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    disabled={busy === r.id}
                                    className="h-8 w-8 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"
                                    onClick={() => setCloseId(r.id)}
                                    aria-label={`Закрыть рейс №${r.number}`}
                                    title="Закрыть рейс"
                                  >
                                    <CircleCheck className="h-4 w-4" aria-hidden />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* карточка рейса */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetailId(null) }}>
        <DialogContent className={`max-h-[85vh] overflow-y-auto sm:max-w-3xl ${THIN_SCROLL}`}>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  Рейс <span className="text-slate-900">№{detail.number}</span>
                  <StatusDot dot={TRIP_GROUP_META[tripGroupOf(detail.status)].dot} className="font-normal">
                    {TRIP_GROUP_META[tripGroupOf(detail.status)].label}
                  </StatusDot>
                  <span className="text-sm font-normal text-slate-500">
                    · {tripStatusMeta(detail.status).label}
                  </span>
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Этапы рейса, документы и журнал событий
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <Pipeline status={detail.status} passPackage={detail.passPackage} etrnStatus={detail.etrnStatus} />

                {/* Маршрут (Task 110-c): полные адреса точек, расстояние, построение маршрута */}
                <RoutePanel from={detail.fromPoint} to={detail.toPoint} number={detail.number} />

                <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <div className="text-[11px] text-slate-500">Груз</div>
                    <div className="text-sm font-medium text-slate-800">{detail.cargo}, {num(detail.tonnage)} т · {detail.truckType}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Погрузка</div>
                    <div className="text-sm font-medium text-slate-800">{detail.loadDate} · {detail.loadWindow}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Перевозчик</div>
                    <div className="text-sm font-medium text-slate-800">{detail.winnerName ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Водитель</div>
                    <div className="text-sm font-medium text-slate-800">
                      {detail.driverId ? drivers.get(detail.driverId)?.fullName ?? '—' : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">ТС</div>
                    <div className="text-sm font-medium text-slate-800">
                      {detail.truckId ? (() => {
                        const t = trucks.get(detail.truckId)
                        return t ? `${t.brand} · ${t.plate}` : '—'
                      })() : '—'}
                      {detail.trailerId && trailers.get(detail.trailerId) && (
                        <span className="text-slate-500"> + {trailers.get(detail.trailerId)?.plate}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Ставка</div>
                    <div className="text-sm font-medium text-slate-800">{rate(detail.startRate)} → {rate(detail.bestRate)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Экономия</div>
                    <div className={`text-sm font-semibold ${(detail.savings ?? 0) > 0 ? 'text-slate-900' : 'text-slate-500'}`}>
                      {rate(detail.savings)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Документы</div>
                    <div className="mt-0.5"><DocBadges r={detail} /></div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Создатель</div>
                    <div className="text-sm font-medium text-slate-800">{detail.createdBy || '—'}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                      Исполнитель по заявке
                      {detail.executorRole === null && (
                        <InfoTip label="Исполнитель по заявке">
                          Перевозчик не выбирал исполнителя по этой заявке — работа ведётся по роли компании
                        </InfoTip>
                      )}
                    </div>
                    <div className="text-sm font-medium text-slate-800">
                      {detail.executorRole ? EXECUTOR_ROLE_LABEL[detail.executorRole] : 'По роли компании'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Транспорт по заявке</div>
                    <div className="text-sm font-medium text-slate-800">
                      {TRANSPORT_OWNERSHIP_META[detail.transportOwnership].label}
                    </div>
                  </div>
                </div>

                {/* комментарий для исполнителя и комментарий сверки (Task 110-c) */}
                {detail.comment && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-[11px] text-muted-foreground">Комментарий для исполнителя</div>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{detail.comment}</p>
                  </div>
                )}
                {detail.verifyComment && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-[11px] text-muted-foreground">Комментарий сверки</div>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{detail.verifyComment}</p>
                  </div>
                )}

                {/* обмен документами по заявке (Task 109) */}
                <section className="border-t border-slate-100 pt-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Files className="h-3.5 w-3.5" aria-hidden />
                    Обмен документами по заявке
                  </h4>
                  {detail.files.length === 0
                    ? <p className="mt-2 text-sm text-slate-400">Обмена документами не было</p>
                    : <div className="mt-2"><RequestFilesList files={detail.files} /></div>}
                </section>

                {/* журнал событий */}
                <div className="border-t border-slate-100 pt-3">
                  <div className="mb-2 text-xs font-medium text-slate-500">Журнал событий</div>
                  <div className={`max-h-60 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3 ${THIN_SCROLL}`}>
                    {[...detail.events]
                      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                      .map((ev) => (
                        <div key={ev.id} className="flex items-start gap-3 text-sm">
                          <span className="shrink-0 font-mono text-xs text-slate-500">{fmtDateTime(ev.createdAt)}</span>
                          <span className="text-slate-700">{ev.message}</span>
                        </div>
                      ))}
                    {detail.events.length === 0 && (
                      <div className="text-sm text-slate-400">Событий пока нет</div>
                    )}
                  </div>
                </div>

                {/* закрытие рейса — по праву trip:close (Task 111) */}
                {detail.status === 'CONFIRMED' && can('trip:close') && (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                    <Button
                      size="sm"
                      disabled={busy === detail.id}
                      onClick={() => setCloseId(detail.id)}
                    >
                      Закрыть рейс
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* подтверждение закрытия рейса */}
      <AlertDialog open={!!closeTarget} onOpenChange={(o) => { if (!o) setCloseId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть рейс?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {closeTarget && (
                  <>
                    Запись №{closeTarget.number} · {closeTarget.fromPoint} → {closeTarget.toPoint} ·{' '}
                    {closeTarget.winnerName ?? '—'} — {rate(closeTarget.bestRate)}. Рейс будет помечен закрытым
                    в реестре, документы — принятыми. Отчёты для бухгалтерии пересчитаются автоматически.
                    <span className="mt-2 block font-medium text-slate-900">
                      Связанная заявка №{closeTarget.number} автоматически станет «Завершена» — статус синхронно
                      обновится в реестре заявок и кабинетах без ручного обновления страницы.
                    </span>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => { e.preventDefault(); void closeTrip() }}
            >
              Закрыть рейс
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

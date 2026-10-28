'use client'

/**
 * «Назначение экипажей» — агент по каждой выигранной заявке выбирает
 * водителя, тягач и прицеп из своей базы и передаёт готовый комплект
 * логисту: логист видит, кто и на чём поедет. Прицеп обязателен —
 * рейсов без прицепа не бывает.
 *
 * Здесь же: массовое назначение из Excel (строка = заявка) и таблица
 * «Передано Логисту» — что и кого уже назначено по рейсам.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Send,
  Upload,
  Users,
} from 'lucide-react'
import {
  AgentStatusBadge, EmptyState, ErrorBlock, InfoTip, LoadingBlock, NoticeLine, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { busyElsewhere, busyMaps, busyReason } from '@/lib/busy'
import { expiryInfo, type ExpiryInfo } from '@/lib/expiry'
import { pointInfo } from '@/lib/points'
import { AGENT_STATUS_LABEL, MODE_META, rate, REQUEST_STATUS_META } from '@/lib/status'
import { TRANSPORT_OWNERSHIP_META } from '@/lib/types'
import type { CarrierDTO, DriverDTO, ExecutorRole, RequestDTO, TrailerDTO, TransportOwnership, TruckDTO } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

interface SelState {
  driverId?: string
  truckId?: string
  trailerId?: string
  /** исполнитель по заявке: перевозчик или экспедитор (Task 109) */
  executorRole?: ExecutorRole
  /** чей транспорт выйдет на рейс (Task 109) */
  transportOwnership?: TransportOwnership
}

/** Подписи роли исполнителя по заявке (Task 109) */
const EXECUTOR_ROLE_LABEL: Record<ExecutorRole, string> = { CARRIER: 'Перевозчик', FORWARDER: 'Экспедитор' }

/** Короткие подписи принадлежности транспорта — для компактной строки в таблице (Task 109) */
const OWNERSHIP_SHORT: Record<TransportOwnership, string> = {
  OWNED: 'в собственности',
  HIRED: 'наёмный',
  LEASE: 'аренда / лизинг',
}

// ——— helpers массовой загрузки Excel (переехали из «Подать документы») ———

/** госномер: латиница/кириллица — для сопоставления из Excel */
const PLATE_MAP: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
}
const normSpace = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()
const normFio = (s: unknown): string => normSpace(s).toUpperCase().replace(/Ё/g, 'Е')
const normPlate = (s: unknown): string => normSpace(s).toUpperCase().split('').map((c) => PLATE_MAP[c] ?? c).join('')

/** Номер заявки из ячейки Excel: «1042» → «Z-1042», русская «З» → латинская «Z» */
function normRequestNo(s: unknown): string {
  let v = normSpace(s).toUpperCase()
  if (!v) return ''
  if (/^\d{3,4}$/.test(v)) v = `Z-${v}`
  v = v.replace(/^З/, 'Z')
  return v
}

/** Строка предпросмотра массовой загрузки Excel */
interface ImportRow {
  line: number
  requestNo: string
  driverName: string
  truckPlate: string
  trailerPlate: string
  requestId?: string
  driverId?: string
  truckId?: string
  trailerId?: string
  ok: boolean
  message: string
}

/** Срок действия документа — плоским текстом в ячейке таблицы, без пузырей */
function ExpiryText({ info }: { info: ExpiryInfo }) {
  if (info.state === 'none') return <span className="text-slate-400">срок не указан</span>
  if (info.state === 'ok') return <span className="text-slate-500">до {info.date}</span>
  const cls = info.state === 'expired' ? 'font-semibold text-red-600' : info.state === 'warn' ? 'font-semibold text-amber-700' : 'font-medium text-slate-500'
  const tail = info.days != null && info.state !== 'expired' ? ` · через ${info.days} дн.` : ''
  return (
    <span className={`whitespace-nowrap ${cls}`}>
      {info.state === 'expired' ? 'истёк' : 'истекает'} {info.date}{tail}
    </span>
  )
}

/** Ячейка таблицы «Водитель»: данные выбранного водителя из базы */
function DriverCell({ d }: { d: DriverDTO }) {
  return (
    <div className="min-w-0 space-y-0.5 text-[11px] leading-snug text-slate-600" aria-label="Данные водителя из базы">
      <div className="break-words text-xs font-semibold text-slate-900">{d.fullName}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {d.passport && d.passport !== '—' && <span className="whitespace-nowrap">Паспорт: <span className="font-mono">{d.passport}</span></span>}
        {d.birthDate && d.birthDate !== '—' && <span className="whitespace-nowrap">Дата рожд.: {d.birthDate}</span>}
        {d.phone && d.phone !== '—' && <span className="whitespace-nowrap">{d.phone}</span>}
      </div>
    </div>
  )
}

/** Ячейка таблицы «Тягач»: данные выбранного тягача из базы */
function TruckCell({ t }: { t: TruckDTO }) {
  return (
    <div className="min-w-0 space-y-0.5 text-[11px] leading-snug text-slate-600" aria-label="Данные тягача из базы">
      <div className="break-words text-xs font-semibold text-slate-900">{t.brand}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="whitespace-nowrap">Госномер: <span className="font-mono">{t.plate}</span></span>
        {t.color && t.color !== '—' && <span className="whitespace-nowrap">Цвет: {t.color}</span>}
        <span className="whitespace-nowrap">Техосмотр: <ExpiryText info={expiryInfo(t.techTill)} /></span>
      </div>
      {t.owner && t.owner !== '—' && <div className="break-words">Собственник: {t.owner}</div>}
    </div>
  )
}

/** Ячейка таблицы «Прицеп»: данные выбранного прицепа из базы */
function TrailerCell({ z }: { z: TrailerDTO }) {
  return (
    <div className="min-w-0 space-y-0.5 text-[11px] leading-snug text-slate-600" aria-label="Данные прицепа из базы">
      <div className="break-words text-xs font-semibold text-slate-900">{z.type}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="whitespace-nowrap">Госномер: <span className="font-mono">{z.plate}</span></span>
        {z.color && z.color !== '—' && <span className="whitespace-nowrap">Цвет: {z.color}</span>}
        <span className="whitespace-nowrap">Техосмотр: <ExpiryText info={expiryInfo(z.techTill)} /></span>
      </div>
      {z.owner && z.owner !== '—' && <div className="break-words">Собственник: {z.owner}</div>}
    </div>
  )
}

/** Строка реквизитов заявки: подпись слева, значение справа — без пузырей и плашек */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row" className="w-28 bg-slate-50 px-3 py-2 text-left align-top text-[11px] font-medium text-slate-500 sm:w-36">
        {label}
      </th>
      <td className="px-3 py-2 align-top text-slate-800">{children}</td>
    </tr>
  )
}

export default function CrewTab({ activeCarrierId, role, liveTick }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [carrier, setCarrier] = useState<CarrierDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sel, setSel] = useState<Record<string, SelState>>({})
  const [busy, setBusy] = useState<string | null>(null)
  // массовая загрузка Excel
  const [excelOpen, setExcelOpen] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null)
  const [importing, setImporting] = useState(false)
  const excelInput = useRef<HTMLInputElement | null>(null)
  // поп-ап подтверждения перед «Утвердить» (Task 53): действие уходит только после подтверждения
  const [approveReq, setApproveReq] = useState<RequestDTO | null>(null)

  const isAgent = role === 'carrier'

  const load = useCallback(async () => {
    try {
      const [reqs, dir] = await Promise.all([api.listRequests(), api.directory()])
      setRequests(reqs.requests)
      setCarrier(dir.carriers.find((c) => c.id === activeCarrierId) ?? null)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [activeCarrierId])

  useEffect(() => { void load() }, [load])

  // real-time (Task 49): событие из шины WS мгновенно догружает заявки и справочники
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  const applyRequest = useCallback((updated: RequestDTO) => {
    setRequests((prev) => {
      const list = prev ?? []
      const i = list.findIndex((r) => r.id === updated.id)
      if (i === -1) return [updated, ...list]
      const next = [...list]
      next[i] = updated
      return next
    })
  }, [])

  const drivers = carrier?.drivers ?? []
  const trucks = carrier?.trucks ?? []
  const trailers = carrier?.trailers ?? []

  /** Роль компании-перевозчика: исполнитель по заявке по умолчанию (Task 109) */
  const companyRole: ExecutorRole = carrier?.role ?? 'CARRIER'

  // ——— Правило занятости (Task 50): кто уже «в рейсе» (комплект у логиста или рейс выполняется) ———
  const busyCrew = useMemo(
    () => busyMaps(requests ?? []),
    [requests],
  )

  /** Выбор водителя: занятого — не применяем, вместо этого показываем сообщение «занят» */
  const pickDriver = (reqId: string, driverId: string) => {
    const b = busyElsewhere(busyCrew.drivers, driverId, reqId)
    if (b) {
      const d = drivers.find((x) => x.id === driverId)
      toast({
        title: 'Водитель — занят',
        description: `${d?.fullName ?? 'Водитель'} ${busyReason(b.status)} по заявке ${b.number}. Выберите другого водителя.`,
      })
      return
    }
    setSelFor(reqId, { driverId })
  }

  /** Выбор тягача: занятое — не применяем, вместо этого показываем сообщение «занято» */
  const pickTruck = (reqId: string, truckId: string) => {
    const b = busyElsewhere(busyCrew.trucks, truckId, reqId)
    if (b) {
      const t = trucks.find((x) => x.id === truckId)
      toast({
        title: 'ТС — занято',
        description: `${t ? `${t.brand} (${t.plate})` : 'ТС'} ${busyReason(b.status)} по заявке ${b.number}. Выберите другое ТС.`,
      })
      return
    }
    setSelFor(reqId, { truckId })
  }

  /** Выбор прицепа: занятый — не применяем, вместо этого показываем сообщение «занят» */
  const pickTrailer = (reqId: string, trailerId: string) => {
    const b = busyElsewhere(busyCrew.trailers, trailerId, reqId)
    if (b) {
      const z = trailers.find((x) => x.id === trailerId)
      toast({
        title: 'Прицеп — занят',
        description: `${z?.plate ?? 'Прицеп'} ${busyReason(b.status)} по заявке ${b.number}. Выберите другой прицеп.`,
      })
      return
    }
    setSelFor(reqId, { trailerId })
  }

  const driverById = useCallback((id: string | null | undefined) => drivers.find((d) => d.id === id), [drivers])
  const truckById = useCallback((id: string | null | undefined) => trucks.find((t) => t.id === id), [trucks])
  const trailerById = useCallback((id: string | null | undefined) => trailers.find((z) => z.id === id), [trailers])

  /** Заявка утверждена агентом, если событие «Утвердить» позже последней передачи экипажа */
  const approvedAfterAssign = useCallback((r: RequestDTO): boolean => {
    const last = (type: string): number =>
      Math.max(0, ...r.events.filter((e) => e.type === type).map((e) => +new Date(e.createdAt)))
    return last('CREW_APPROVED') > last('DRIVER_ASSIGNED')
  }, [])

  /** Выигранные заявки, где нужно назначить (или можно утвердить) экипаж */
  const needCrew = useMemo(
    () => (requests ?? [])
      .filter((r) => r.winnerId === activeCarrierId && (r.status === 'AWARDED' || r.status === 'DOCS_REVIEW') && !approvedAfterAssign(r))
      .sort((a, b) => (a.loadDate < b.loadDate ? -1 : a.loadDate > b.loadDate ? 1 : a.number < b.number ? -1 : 1)),
    [requests, activeCarrierId, approvedAfterAssign],
  )

  /** Экипажи, уже переданные логисту (документы в проверке и дальше) */
  const onPlatform = useMemo(
    () => (requests ?? [])
      .filter((r) => r.winnerId === activeCarrierId && r.driverId && r.truckId && (r.status === 'AT_LOGIST' || r.status === 'CONFIRMED' || r.status === 'CLOSED'))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [requests, activeCarrierId],
  )

  /**
   * Состав по заявке. Сохранённый в заявке экипаж подставляется, только если он
   * не занят другим рейсом — занятого по умолчанию не предлагаем. Прицеп
   * обязателен: пока пользователь не выбрал прицеп сам, подставляем первый
   * свободный из базы. Если свободных нет, поле остаётся пустым с плейсхолдером,
   * и отправка формы заблокирована до сделанного выбора.
   */
  const selOf = (r: RequestDTO): SelState => {
    const base = sel[r.id]
    const free = (map: typeof busyCrew.drivers, id: string | null) => (id && !busyElsewhere(map, id, r.id) ? id : undefined)
    return {
      driverId: base?.driverId ?? free(busyCrew.drivers, r.driverId),
      truckId: base?.truckId ?? free(busyCrew.trucks, r.truckId),
      trailerId: base?.trailerId ?? free(busyCrew.trailers, r.trailerId)
        ?? trailers.find((z) => !busyElsewhere(busyCrew.trailers, z.id, r.id))?.id,
      // исполнитель и транспорт по заявке (Task 109): сохранённый выбор агента, иначе —
      // значения заявки; по умолчанию — роль компании и «Транспорт в собственности»
      executorRole: base?.executorRole ?? r.executorRole ?? companyRole,
      transportOwnership: base?.transportOwnership ?? r.transportOwnership ?? 'OWNED',
    }
  }

  /** Список выбора: сначала свободные, занятые — в конце с пометкой «занят» */
  const freeFirst = <T extends { id: string }>(list: T[], map: typeof busyCrew.drivers, reqId: string): T[] =>
    [...list].sort((a, b) => Number(Boolean(busyElsewhere(map, a.id, reqId))) - Number(Boolean(busyElsewhere(map, b.id, reqId))))

  const setSelFor = (id: string, patch: SelState) =>
    setSel((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))

  /** Передать экипаж логисту: водитель + тягач + прицеп — обязательный комплект вешается на заявку */
  const assign = async (r: RequestDTO) => {
    const s = selOf(r)
    if (!s.driverId || !s.truckId || !s.trailerId) return
    setBusy(r.id)
    try {
      const { request } = await api.action(r.id, 'assign', {
        driverId: s.driverId,
        truckId: s.truckId,
        trailerId: s.trailerId,
        executorRole: s.executorRole,
        transportOwnership: s.transportOwnership,
      })
      applyRequest(request)
      toast({
        title: `Экипаж передан логисту — ${r.number}`,
        description: 'Логист видит, кто и на чём поедет. Дальше загрузите документы во вкладке «Мои заявки».',
      })
    } catch (e) {
      toast({ title: 'Не удалось передать экипаж', description: e instanceof Error ? e.message : 'Ошибка сервера', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  /** Утвердить экипаж: состав сохраняется, заявка уходит из раздела в «Мои заявки» */
  const approve = async (r: RequestDTO) => {
    const s = selOf(r)
    if (!s.driverId || !s.truckId || !s.trailerId) return
    setBusy(r.id)
    try {
      const { request } = await api.action(r.id, 'approve-crew', {
        driverId: s.driverId,
        truckId: s.truckId,
        trailerId: s.trailerId,
        executorRole: s.executorRole,
        transportOwnership: s.transportOwnership,
      })
      applyRequest(request)
      toast({
        title: `Экипаж утверждён — ${r.number}`,
        description: 'Заявка ушла в работу — состояние рейса отслеживается во вкладке «Мои заявки».',
      })
    } catch (e) {
      toast({ title: 'Не удалось утвердить экипаж', description: e instanceof Error ? e.message : 'Ошибка сервера', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  // ——— Массовое назначение из Excel ———

  /** Шаблон .xlsx из реальных данных: выигранные рейсы + база аккаунта (прицеп обязателен) */
  const downloadTemplate = () => {
    const header = ['Заявка', 'Водитель', 'Тягач', 'Прицеп']
    const rows = needCrew.slice(0, 5).map((r, i) => [
      r.number,
      drivers[i]?.fullName ?? drivers[0]?.fullName ?? 'Иванов Иван Иванович',
      trucks[i]?.plate ?? trucks[0]?.plate ?? 'А123ВС777',
      trailers[i]?.plate ?? trailers[0]?.plate ?? '',
    ])
    if (rows.length === 0) {
      rows.push(['Z-1042', drivers[0]?.fullName ?? 'Иванов Иван Иванович', trucks[0]?.plate ?? 'А123ВС777', trailers[0]?.plate ?? ''])
    }
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 16 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Заявки')
    XLSX.writeFile(wb, 'shablon-ekipazhey.xlsx')
    toast({ title: 'Шаблон скачан', description: 'Заполните по строке на каждый рейс и загрузите файл обратно' })
  }

  /** Разбор Excel: строка = заявка + водитель + тягач (+прицеп), сверка с площадкой и базой аккаунта */
  const parseExcel = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) throw new Error('В файле нет листов')
      const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
      const grid = sheet.filter((row) => Array.isArray(row) && row.some((c) => normSpace(c)))
      if (grid.length === 0) throw new Error('Лист пуст')

      // колонки: по заголовкам, иначе позиционно (Заявка · Водитель · Тягач · Прицеп)
      const head = grid[0].map((c) => normSpace(c).toLowerCase())
      const hasHeader = head.some((h) => /заявк|рейс|водител|тягач|прицеп/.test(h))
      const col = (re: RegExp, fallback: number): number => {
        if (hasHeader) {
          const i = head.findIndex((h) => re.test(h))
          if (i !== -1) return i
        }
        return fallback
      }
      const cReq = col(/заявк|рейс/, 0)
      const cDrv = col(/водител|фио/, 1)
      const cTrk = col(/тягач|автомоб/, 2)
      const cTrl = col(/прицеп/, 3)
      const body = hasHeader ? grid.slice(1) : grid

      const eligible = new Map(needCrew.map((r) => [r.id, r]))
      const seen = new Set<string>()
      const rows: ImportRow[] = body.map((cells, idx) => {
        const requestNo = normRequestNo(cells[cReq])
        const driverName = normSpace(cells[cDrv])
        const truckPlate = normSpace(cells[cTrk])
        const trailerPlate = normSpace(cells[cTrl])
        const row: ImportRow = {
          line: idx + (hasHeader ? 2 : 1),
          requestNo, driverName, truckPlate, trailerPlate,
          ok: false, message: '',
        }
        if (!requestNo && !driverName && !truckPlate) {
          row.message = 'пустая строка'
          return row
        }
        const byNo = requests?.find((r) => r.number === requestNo)
        if (!byNo) {
          row.message = `заявка «${requestNo || '—'}» не найдена на площадке`
          return row
        }
        if (seen.has(byNo.id)) {
          row.requestId = byNo.id
          row.message = 'дубликат строки — эта заявка уже есть в файле'
          return row
        }
        if (byNo.winnerId !== activeCarrierId) {
          row.message = 'рейс не закреплён за вашей компанией'
          return row
        }
        if (!eligible.has(byNo.id)) {
          row.message = `статус «${REQUEST_STATUS_META[byNo.status]?.label ?? byNo.status}» — назначение недоступно`
          return row
        }
        const drv = drivers.find((d) => normFio(d.fullName) === normFio(driverName))
        if (!drv) {
          row.message = `водитель «${driverName || '—'}» не найден в базе аккаунта`
          return row
        }
        const trk = trucks.find((t) => normPlate(t.plate) === normPlate(truckPlate))
        if (!trk) {
          row.message = `тягач «${truckPlate || '—'}» не найден в базе аккаунта`
          return row
        }
        // Прицеп обязателен для рейса: строка без прицепа не проходит проверку
        if (!trailerPlate || /^(—|-|нет|без)$/i.test(trailerPlate)) {
          row.message = 'прицеп не указан — прицеп обязателен для рейса'
          return row
        }
        const found = trailers.find((z) => normPlate(z.plate) === normPlate(trailerPlate))
        if (!found) {
          row.message = `прицеп «${trailerPlate}» не найден в базе аккаунта`
          return row
        }
        const trl = found.id
        // Правило занятости (Task 50): водитель/ТС/прицеп «в рейсе» назначить нельзя
        const busyD = busyElsewhere(busyCrew.drivers, drv.id, byNo.id)
        const busyT = busyElsewhere(busyCrew.trucks, trk.id, byNo.id)
        const busyHit = busyD ?? busyT ?? busyElsewhere(busyCrew.trailers, trl, byNo.id)
        if (busyHit) {
          const who = busyD
            ? `Водитель ${drv.fullName}`
            : busyT
              ? `ТС ${trk.brand} (${trk.plate})`
              : `Прицеп ${trailerPlate}`
          row.message = `${who} занят — ${busyReason(busyHit.status)} по заявке ${busyHit.number}`
          return row
        }
        seen.add(byNo.id)
        Object.assign(row, { requestId: byNo.id, driverId: drv.id, truckId: trk.id, trailerId: trl, ok: true, message: 'готова к передаче' })
        return row
      })

      setImportRows(rows)
      setExcelOpen(true)
    } catch (e) {
      toast({
        title: 'Не удалось прочитать Excel',
        description: e instanceof Error ? e.message : 'Проверьте файл: первая строка — заголовки «Заявка · Водитель · Тягач · Прицеп»',
        variant: 'destructive',
      })
    }
  }

  const importOkCount = importRows?.filter((r) => r.ok).length ?? 0

  /** Передача всех валидных строк: экипаж вешается на каждый рейс одним запросом */
  const runImport = async () => {
    const ok = (importRows ?? []).filter((r) => r.ok && r.requestId && r.driverId && r.truckId && r.trailerId)
    if (ok.length === 0 || !activeCarrierId) return
    setImporting(true)
    try {
      const res = await api.bulkAssign({
        rows: ok.map((r) => ({ requestId: r.requestId!, driverId: r.driverId!, truckId: r.truckId!, trailerId: r.trailerId })),
      })
      toast({
        title: 'Массовое назначение завершено',
        description: `Экипажи переданы логисту: ${res.assigned} из ${res.total}. Документы грузятся по каждой заявке во вкладке «Мои заявки».`,
      })
      setExcelOpen(false)
      setImportRows(null)
      await load()
    } catch (e) {
      toast({ title: 'Ошибка массового назначения', description: e instanceof Error ? e.message : 'Ошибка сервера', variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  if (loadError) {
    return (
      <div>
        <SectionHeader title="Назначение экипажей" />
        <ErrorBlock message={loadError} onRetry={() => { setLoadError(null); void load() }} />
      </div>
    )
  }
  if (requests === null) {
    return (
      <div>
        <SectionHeader title="Назначение экипажей" />
        <LoadingBlock label="Загружаем выигранные заявки и базу аккаунта…" />
      </div>
    )
  }

  return (
    <div>
      <SectionHeader
        title="Назначение экипажей"
        desc="По каждой выигранной заявке выберите водителя, тягач и прицеп и утвердите состав — заявка уйдёт из раздела в «Мои заявки»."
      />

      {!activeCarrierId && (
        <NoticeLine tone="warning" className="mb-4">Выберите перевозчика в шапке, чтобы действовать от его имени</NoticeLine>
      )}

      {activeCarrierId && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            {/* ——— Требуют экипажа ——— */}
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="text-sm font-medium text-slate-500">
                Требуют экипажа · {needCrew.length}
              </h3>
            </div>

            {needCrew.length === 0 && (
              <EmptyState
                icon={<Users className="h-8 w-8" aria-hidden />}
                title="Выигранных заявок без экипажа нет"
                hint="Выиграйте рейс на Площадке заявок — он появится здесь для назначения водителя и ТС"
              />
            )}

            {needCrew.map((r) => {
              const s = selOf(r)
              const assigned = !!r.driverId && !!r.truckId
              const driver = driverById(s.driverId)
              const truck = truckById(s.truckId)
              const trailer = s.trailerId && s.trailerId !== 'none' ? trailerById(s.trailerId) : undefined
              const canAssign = !!s.driverId && !!s.truckId && !!s.trailerId && busy === null
              return (
                <Card key={r.id} className="border-slate-200 shadow-sm">
                  <CardContent className="space-y-3 p-4 sm:p-6">
                    {/* ——— реквизиты заявки: таблица вместо пузырей и плашек ——— */}
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <tbody className="divide-y divide-slate-100">
                          <InfoRow label="Заявка">
                            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                              <span className="font-mono text-base font-bold text-slate-900">{r.number}</span>
                              <span className="text-xs font-medium text-slate-700">{MODE_META[r.mode].label}</span>
                              <span className="text-xs text-slate-500">{AGENT_STATUS_LABEL[r.status] ?? REQUEST_STATUS_META[r.status].label}</span>
                            </span>
                          </InfoRow>
                          <InfoRow label="Маршрут">
                            <span className="font-medium">{pointInfo(r.fromPoint).short} → {pointInfo(r.toPoint).short}</span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                              {pointInfo(r.fromPoint).address} — {pointInfo(r.toPoint).address}
                            </span>
                          </InfoRow>
                          <InfoRow label="Груз">
                            {r.cargo}, {r.tonnage} т · {r.truckType}
                          </InfoRow>
                          <InfoRow label="Погрузка">
                            {r.loadDate}, {r.loadWindow}
                          </InfoRow>
                          <InfoRow label="Ставка">
                            <span className="font-bold tabular-nums">{rate(r.bestRate ?? r.startRate)}</span>
                          </InfoRow>
                        </tbody>
                      </table>
                    </div>

                    {/* ——— исполнитель и транспорт по заявке (Task 109): кого оформляем и чей транспорт выходит на рейс ——— */}
                    <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                          Исполнитель по заявке
                          <InfoTip label="Исполнитель по заявке">
                            Кого оформляем исполнителем по этой заявке: перевозчик — заказ-заявка на перевозку, экспедитор — поручение экспедитору. По умолчанию — роль вашей компании.
                          </InfoTip>
                        </div>
                        <Select
                          value={s.executorRole ?? 'CARRIER'}
                          onValueChange={(v) => setSelFor(r.id, { executorRole: v as ExecutorRole })}
                        >
                          <SelectTrigger className="w-full" aria-label={`Исполнитель по заявке ${r.number}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CARRIER">Перевозчик</SelectItem>
                            <SelectItem value="FORWARDER">Экспедитор</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                          Транспорт по заявке
                          <InfoTip label="Транспорт по заявке">
                            Чей транспорт выйдет на рейс. По умолчанию — транспорт в собственности.
                          </InfoTip>
                        </div>
                        <Select
                          value={s.transportOwnership ?? 'OWNED'}
                          onValueChange={(v) => setSelFor(r.id, { transportOwnership: v as TransportOwnership })}
                        >
                          <SelectTrigger className="w-full" aria-label={`Транспорт по заявке ${r.number}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(TRANSPORT_OWNERSHIP_META) as TransportOwnership[]).map((k) => (
                              <SelectItem key={k} value={k}>{TRANSPORT_OWNERSHIP_META[k].label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* ——— состав экипажа: три колонки (на телефоне — друг под другом), состав из базы ——— */}
                    <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-3">
                      <div className="min-w-0 space-y-2">
                        <div className="text-xs font-semibold text-slate-500">Водитель</div>
                        <Select value={s.driverId ?? ''} onValueChange={(v) => pickDriver(r.id, v)}>
                          <SelectTrigger className="w-full" aria-label={`Выбор водителя по заявке ${r.number}`}>
                            <SelectValue placeholder="Выберите водителя" />
                          </SelectTrigger>
                          <SelectContent>
                            {freeFirst(drivers, busyCrew.drivers, r.id).map((d) => {
                              const b = busyElsewhere(busyCrew.drivers, d.id, r.id)
                              return (
                                <SelectItem key={d.id} value={d.id} className={b ? 'text-slate-400' : undefined}>
                                  {d.fullName}{b ? ` · занят (${busyReason(b.status)}, ${b.number})` : ''}
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                        {driver ? <DriverCell d={driver} /> : <span className="text-[11px] text-slate-300">—</span>}
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="text-xs font-semibold text-slate-500">Тягач</div>
                        <Select value={s.truckId ?? ''} onValueChange={(v) => pickTruck(r.id, v)}>
                          <SelectTrigger className="w-full" aria-label={`Выбор тягача по заявке ${r.number}`}>
                            <SelectValue placeholder="Выберите тягач" />
                          </SelectTrigger>
                          <SelectContent>
                            {freeFirst(trucks, busyCrew.trucks, r.id).map((t) => {
                              const b = busyElsewhere(busyCrew.trucks, t.id, r.id)
                              return (
                                <SelectItem key={t.id} value={t.id} className={b ? 'text-slate-400' : undefined}>
                                  {t.brand} · {t.plate}{b ? ` · занят (${busyReason(b.status)}, ${b.number})` : ''}
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                        {truck ? <TruckCell t={truck} /> : <span className="text-[11px] text-slate-300">—</span>}
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="text-xs font-semibold text-slate-500">Прицеп</div>
                        <Select value={s.trailerId ?? ''} onValueChange={(v) => pickTrailer(r.id, v)}>
                          <SelectTrigger className="w-full" aria-label={`Выбор прицепа по заявке ${r.number}`}>
                            <SelectValue placeholder="Выберите прицеп" />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Прицеп обязателен: только реальные прицепы из базы, без варианта «Без прицепа» */}
                            {freeFirst(trailers, busyCrew.trailers, r.id).map((z) => {
                              const b = busyElsewhere(busyCrew.trailers, z.id, r.id)
                              return (
                                <SelectItem key={z.id} value={z.id} className={b ? 'text-slate-400' : undefined}>
                                  {z.plate} · {z.type}{b ? ` · занят (${busyReason(b.status)}, ${b.number})` : ''}
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                        {trailer ? <TrailerCell z={trailer} /> : <span className="text-[11px] text-slate-300">—</span>}
                      </div>
                    </div>

                    {drivers.length === 0 && (
                      <p className="text-xs text-amber-700">
                        В базе нет водителей — пополните её во вкладке «Подать документы».
                      </p>
                    )}

                    {trailers.length === 0 && (
                      <p className="text-xs text-amber-700">
                        В базе нет прицепов — прицеп обязателен для рейса, пополните базу во вкладке «Подать документы».
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                      <Button
                        disabled={!canAssign}
                        onClick={() => (assigned ? setApproveReq(r) : void assign(r))}
                        aria-label={assigned ? `Утвердить экипаж по заявке ${r.number}` : `Передать экипаж по заявке ${r.number} логисту`}
                      >
                        {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : assigned ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                        {assigned ? 'Утвердить' : 'Передать экипаж логисту'}
                      </Button>
                      {!assigned && (
                        <InfoTip label="Как передать экипаж">
                          Выберите водителя, тягач и прицеп — готовый комплект уйдёт логисту. Занятые в другом рейсе помечены в списках и не выбираются.
                        </InfoTip>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            {/* ——— Передано Логисту ——— */}
            <div className="pt-2">
              <h3 className="mb-2 px-1 text-sm font-medium text-slate-500">
                Передано Логисту · {onPlatform.length}
              </h3>
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-4 sm:p-6">
                  <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead>Заявка</TableHead>
                          <TableHead>Маршрут</TableHead>
                          <TableHead>Водитель</TableHead>
                          <TableHead>Тягач</TableHead>
                          <TableHead>Прицеп</TableHead>
                          <TableHead>Статус</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {onPlatform.map((r) => {
                          const d = driverById(r.driverId)
                          const t = truckById(r.truckId)
                          const z = trailerById(r.trailerId)
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="whitespace-nowrap font-mono text-sm font-bold text-slate-900">{r.number}</TableCell>
                              <TableCell className="whitespace-nowrap text-slate-600">
                                {pointInfo(r.fromPoint).short} → {pointInfo(r.toPoint).short}
                              </TableCell>
                              <TableCell className="font-medium text-slate-800">
                                {d?.fullName ?? '—'}
                                {/* исполнитель и транспорт по заявке (Task 109) */}
                                <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                                  Исполнитель: {r.executorRole ? EXECUTOR_ROLE_LABEL[r.executorRole] : 'по роли компании'}
                                  {' · '}Транспорт: {OWNERSHIP_SHORT[r.transportOwnership]}
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-slate-700">{t ? `${t.brand} · ${t.plate}` : '—'}</TableCell>
                              <TableCell className="whitespace-nowrap text-slate-600">{z ? `${z.plate} · ${z.type}` : '—'}</TableCell>
                              <TableCell><AgentStatusBadge status={r.status} /></TableCell>
                            </TableRow>
                          )
                        })}
                        {onPlatform.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-slate-400">
                              Экипажей пока нет
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ——— Правая колонка: массовое назначение из Excel ——— */}
          <div className="min-w-0 space-y-4">
            <Card className="border-slate-200 shadow-sm lg:sticky lg:top-4">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-700" aria-hidden />
                  Массовое назначение из Excel
                  <InfoTip label="Массовое назначение">
                    Скачайте шаблон: в нём ваши выигранные рейсы без экипажа. Впишите водителя, тягач и прицеп из базы и загрузите файл — экипажи встанут на все рейсы сразу.
                    {needCrew.length === 0 && ' Сейчас рейсов без экипажа нет.'}
                  </InfoTip>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <Button size="sm" variant="outline" className="justify-start gap-1.5" onClick={downloadTemplate}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Скачать шаблон
                  </Button>
                  <Button size="sm" variant="outline" className="justify-start gap-1.5" onClick={() => excelInput.current?.click()}>
                    <Upload className="h-3.5 w-3.5" aria-hidden />
                    Загрузить Excel
                  </Button>
                </div>
                <input
                  ref={excelInput}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  aria-label="Файл Excel с экипажами"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void parseExcel(f)
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Предпросмотр массовой загрузки Excel: проверка строк */}
      <Dialog open={excelOpen} onOpenChange={(o) => { setExcelOpen(o); if (!o) setImportRows(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Массовое назначение из Excel
              <InfoTip label="Проверка строк">
                Заявка должна быть вашей выигранной, водитель, тягач и прицеп — из базы аккаунта. После назначения загрузите документы по каждой заявке в «Мои заявки».
              </InfoTip>
            </DialogTitle>
            <DialogDescription className="sr-only">Проверка строк файла перед назначением экипажей</DialogDescription>
          </DialogHeader>
          <div className={`max-h-[50vh] overflow-auto rounded-xl border border-slate-200 ${THIN_SCROLL}`}>
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Стр.</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Заявка</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Водитель</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Тягач</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Прицеп</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Проверка</th>
                </tr>
              </thead>
              <tbody>
                {(importRows ?? []).map((r) => (
                  <tr key={r.line} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-400">{r.line}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-900">{r.requestNo || '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.driverName || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{r.truckPlate || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{r.trailerPlate || '—'}</td>
                    <td className="px-3 py-2">
                      {r.ok ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          {r.message}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {r.message}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setExcelOpen(false); setImportRows(null) }}>Отмена</Button>
            <Button onClick={() => void runImport()} disabled={importOkCount === 0 || importing}>
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Передача…
                </>
              ) : (
                `Назначить экипажи: ${importOkCount}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ——— Подтверждение утверждения экипажа (Task 53): состав уходит логисту
          только после того, как агент подтвердит выбор в поп-апе ——— */}
      <AlertDialog open={!!approveReq} onOpenChange={(o) => { if (!o) setApproveReq(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Утвердить экипаж по заявке {approveReq?.number}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2.5">
                <p>
                  После утверждения состав закрепится за рейсом, заявка уйдёт в работу и появится во вкладке «Мои заявки». Действие отправится только после вашего подтверждения.
                </p>
                {approveReq && (() => {
                  const s = selOf(approveReq)
                  const d = driverById(s.driverId)
                  const t = truckById(s.truckId)
                  const z = s.trailerId ? trailerById(s.trailerId) : undefined
                  return (
                    <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
                      <div className="flex gap-2">
                        <span className="w-20 shrink-0 text-muted-foreground">Водитель:</span>
                        <span className="font-semibold text-slate-900">{d?.fullName ?? '—'}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="w-20 shrink-0 text-muted-foreground">Тягач:</span>
                        <span className="font-semibold text-slate-900">{t ? `${t.brand} · ${t.plate}` : '—'}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="w-20 shrink-0 text-muted-foreground">Прицеп:</span>
                        <span className="font-semibold text-slate-900">{z ? `${z.plate} · ${z.type}` : '—'}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Назад</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault()
                const r = approveReq
                setApproveReq(null)
                if (r) void approve(r)
              }}
            >
              Да, утвердить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isAgent && carrier === null && requests !== null && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center" role="status">
          <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-600">База пуста</Badge>
          <p className="mt-2 text-sm text-slate-600">
            Не удалось определить перевозчика — выберите его в шапке платформы
          </p>
        </div>
      )}
    </div>
  )
}

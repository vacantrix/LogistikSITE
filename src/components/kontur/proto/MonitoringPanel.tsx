'use client'

// Раздел «Мониторинг» — диспетчерский центр АЭМЗ: онлайн-статусы машин и
// водителей, геолокация, прогресс плеча и оценочный ETA до выгрузки.
// Данные приходят из приложения водителя по контракту POST /api/driver/telemetry
// (пока тестово — из встроенного симулятора, source=test_sim).
// Карта — Leaflet + OpenStreetMap, на карте только водители с приложением.
//
// Структура профессиональной версии:
//   1) оперативная панель управления (live-сводка + инструменты);
//   2) KPI-плитки парка — клик работает фильтром реестра и карты;
//   3) карта + карточка объекта (прогресс, ETA, груз, документы, хронология);
//   4) реестр парка с поиском;
//   5) системный мониторинг контура (обмен с 1С, SLA назначений) и таблица
//      устройств водителей с разбором (бывший отдельный раздел «Устройства»);
//   6) тестовый контур — симулятор приложения в диалоге (после релиза приложения отключается).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as LMap, Marker as LMarker, Polyline as LPolyline } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Card, CardContent } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { Input } from '@/components/kontur/ui/input'
import { Label } from '@/components/kontur/ui/label'
import { Switch } from '@/components/kontur/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/kontur/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kontur/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  ACK_LABELS, CONSTANTS, MONITOR_KPIS, MONITOR_STATUSES, MONITOR_STATUS_DOT, MONITOR_STATUS_TONE, STATUS_LABELS,
} from '@/lib/kontur/constants'
import type { StateResponse } from '@/lib/kontur/client-types'
import { fmtDateTime } from '@/lib/kontur/client-types'
import { bearingDeg, haversineKm, interpolate, progressOnSegment, type LatLng } from '@/lib/kontur/geo'
import { DotWord, InfoTip, Pill, StatusChip } from './bits'
import { KpiTile } from '@/components/platform/common'
import { CallButton } from './CallButton'
import {
  AlertTriangle, Beaker, BookOpen, ClipboardList, Clock, Coffee, Compass, Flag, Gauge, Loader2, LocateFixed,
  MapPin, MapPinned, MousePointerClick, Navigation, Package, PackageCheck, PackageMinus, Play,
  Repeat2, RotateCcw, Route, Smartphone, Square, Truck, Undo2, Warehouse, WifiOff, Wrench,
} from 'lucide-react'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

// ---------------------------------------------------------------------------
// Типы (клиентское зеркало /api/monitor)
// ---------------------------------------------------------------------------

export type MonitorEventDto = {
  at: string
  status: string
  actorRole: string
  comment: string | null
  legSeq: number | null
  type: string
  result: string | null
}

export type MonitorRow = {
  driverId: string
  fullName: string
  phone: string
  vehicle: { id: string; brand: string; plate: string; isRepair: boolean } | null
  trailer: { brand: string; plate: string } | null
  tripId: string | null
  tripStatus: string | null
  tripStartedAt: string | null
  ackStatus: string | null
  waitingReturn: boolean
  leg: { id: string; seq: number; type: string; loadPoint: string; unloadPoint: string; status: string; kmPlan: number | null } | null
  route: { from: LatLng; to: LatLng } | null
  status: string
  rawStatus: string
  statusSetAt: string | null
  lastKnownStatus: string | null
  kmLeft: number | null
  legKm: number | null
  progressPct: number | null
  etaMin: number | null
  etaAt: string | null
  cargo: { desc: string | null; weightT: number | null; volumeM3: number | null } | null
  order: { number: string; customer: string } | null
  docsPending: boolean
  docsLost: boolean
  speedKmh: number | null
  headingDeg: number | null
  point: LatLng | null
  pointAt: string | null
  lastSeenAt: string | null
  appInstalled: boolean
  appVersion: string | null
  comment: string | null
  source: string | null
  events: MonitorEventDto[]
  track: LatLng[]
}

export type MonitorState = {
  rows: MonitorRow[]
  summary: {
    onMap: number; inMotion: number; atLoading: number; nearUnload: number
    breakdowns: number; offline: number; notInstalled: number; waitingBackhaul: number
    onTrip: number; withApp: number; totalDrivers: number
  }
  meta: { staleMin: number; nearUnloadKm: number; pollSec: number; etaKmK: number; etaAvgKmh: number; generatedAt: string }
}

export function MonitoringPanel({ state, onOpenTrip, onOpenRequests, onChanged, focusDevice, onFocusDeviceConsumed }: {
  state?: StateResponse | null
  onOpenTrip?: (tripId: string) => void
  onOpenRequests?: () => void
  onChanged?: () => void
  focusDevice?: { id: string; ts: number } | null
  onFocusDeviceConsumed?: () => void
}) {
  const { toast } = useToast()
  const [data, setData] = useState<MonitorState | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [nowTick, setNowTick] = useState(Date.now())
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false) // по умолчанию — только на линии
  const [activeKpi, setActiveKpi] = useState<string | null>(null) // фильтр KPI-плитки
  const [selectedId, setSelectedId] = useState('')
  const [centerReq, setCenterReq] = useState<{ driverId: string; ts: number } | null>(null)
  const [follow, setFollow] = useState(false)
  const [simOpen, setSimOpen] = useState(false)
  const [contractOpen, setContractOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Симулятор приложения водителя (тестовый контур)
  const [simDriverId, setSimDriverId] = useState('')
  const [autoMove, setAutoMove] = useState(false)
  const [pickMode, setPickMode] = useState(false)
  const [comment, setComment] = useState('')

  const dataRef = useRef<MonitorState | null>(null)
  dataRef.current = data

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor')
      if (res.ok) setData(await res.json())
    } catch {
      // следующий тик опроса повторит
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Авто-обновление сводки (оперативность статусов)
  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(() => void refresh(), CONSTANTS.MONITOR_POLL_SEC * 1000)
    return () => clearInterval(t)
  }, [autoRefresh, refresh])

  // Тикер относительного времени («в статусе N мин», «связь N мин назад»)
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  // Устройства водителей (бывший раздел «Устройства»): алерт-кнопка шапки ведёт
  // сюда — подсветить и прокрутить строку устройства
  const [hlDeviceId, setHlDeviceId] = useState<string | null>(null)
  const deviceRowRefs = useRef(new Map<string, HTMLTableRowElement>())
  useEffect(() => {
    if (!focusDevice) return
    setHlDeviceId(focusDevice.id)
    deviceRowRefs.current.get(focusDevice.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    onFocusDeviceConsumed?.()
  }, [focusDevice, onFocusDeviceConsumed])

  async function deviceAction(action: string, deviceId: string, value?: boolean) {
    const res = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, deviceId, value }),
    })
    if (res.ok) {
      toast({
        title: action === 'reset-skew' ? 'Счётчик сдвига сброшен' : 'Профиль устройства изменён',
        description: action === 'reset-skew' ? 'Синхронизируйте время на устройстве' : undefined,
      })
      onChanged?.()
    }
  }

  // Выбранный по умолчанию объект: первый требующий внимания, иначе первый на карте
  useEffect(() => {
    if (!selectedId && data) {
      const first =
        data.rows.find((r) => ['breakdown', 'repair', 'offline'].includes(r.status)) ??
        data.rows.find((r) => r.appInstalled && r.point) ??
        data.rows[0]
      if (first) setSelectedId(first.driverId)
    }
  }, [data, selectedId])

  // Дефолтный водитель в симуляторе — первый на карте
  useEffect(() => {
    if (!simDriverId && data) {
      const first = data.rows.find((r) => r.appInstalled && r.point) ?? data.rows[0]
      if (first) setSimDriverId(first.driverId)
    }
  }, [data, simDriverId])

  const post = useCallback(async (payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    try {
      const res = await fetch('/api/driver/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'test_sim', appVersion: '3.0.0-test', ...payload }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'Телеметрия отклонена', description: json?.error?.message ?? `HTTP ${res.status}`, variant: 'destructive' })
        return false
      }
      await refresh()
      return true
    } catch (e) {
      toast({ title: 'Сеть недоступна', description: String(e), variant: 'destructive' })
      return false
    } finally {
      setBusy(false)
    }
  }, [refresh, toast])

  const sendStatus = useCallback((status: string) => {
    if (!simDriverId) return
    void post({ driverId: simDriverId, status, ...(comment.trim() ? { comment: comment.trim() } : {}) })
  }, [comment, post, simDriverId])

  // Авто-движение по маршруту: каждые SIM_TICK_MS клиент (как приложение) шлёт точку.
  // Интервал живёт в панели, поэтому движение продолжается и при закрытом диалоге.
  useEffect(() => {
    if (!autoMove) return
    const tick = async () => {
      const row = dataRef.current?.rows.find((r) => r.driverId === simDriverId)
      if (!row?.route || !row.point) {
        toast({ title: 'Нет маршрута или точки', description: 'Выберите водителя на активном рейсе и поставьте точку', variant: 'destructive' })
        setAutoMove(false)
        return
      }
      const totalKm = Math.max(1, haversineKm(row.route.from, row.route.to))
      const t = progressOnSegment(row.route.from, row.route.to, row.point)
      const speed = 60 + Math.round(Math.random() * 18)
      const advance = (speed * (CONSTANTS.SIM_TICK_MS / 3600000) * CONSTANTS.SIM_SPEED_MULT) / totalKm
      const tNew = t + advance
      if (tNew >= 1) {
        await post({
          driverId: simDriverId,
          geo: { lat: row.route.to[0], lng: row.route.to[1], speedKmh: 0, headingDeg: row.headingDeg ?? 0 },
        })
        toast({ title: 'Машина прибыла на выгрузку', description: 'Авто-движение остановлено' })
        setAutoMove(false)
        return
      }
      const p = interpolate(row.route.from, row.route.to, tNew)
      await post({
        driverId: simDriverId,
        geo: { lat: p[0], lng: p[1], speedKmh: speed, headingDeg: Math.round(bearingDeg(row.route.from, row.route.to)) },
      })
    }
    const timer = setInterval(() => void tick(), CONSTANTS.SIM_TICK_MS)
    return () => clearInterval(timer)
  }, [autoMove, post, simDriverId, toast])

  const onPick = useCallback((lat: number, lng: number) => {
    if (!simDriverId) return
    void post({ driverId: simDriverId, geo: { lat, lng, speedKmh: 0 } })
  }, [post, simDriverId])

  async function resetDemo() {
    setAutoMove(false)
    const res = await fetch('/api/monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset-demo' }),
    })
    if (res.ok) {
      setData(await res.json())
      toast({ title: 'Телеметрия сброшена к демо-состоянию' })
    }
  }

  const allRows = data?.rows ?? []

  // Счётчики KPI-плиток по всему парку (не зависят от активного фильтра)
  const kpiCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const k of MONITOR_KPIS) {
      c[k.id] = k.id === 'on_map'
        ? allRows.filter((r) => r.appInstalled && r.point).length
        : allRows.filter((r) => k.statuses.includes(r.status)).length
    }
    return c
  }, [allRows])

  // Реестр и карта: фильтр «на линии», затем активная KPI-плитка, затем поиск
  const rows = useMemo(() => {
    let list = allRows
    if (!showAll) {
      // «На линии»: водители в активных рейсах или с установленным приложением —
      // остальной справочник (простой без рейса, без приложения) не шумит
      list = list.filter((r) => r.tripStatus === 'active' || r.appInstalled)
    }
    if (activeKpi) {
      const kpi = MONITOR_KPIS.find((k) => k.id === activeKpi)
      if (kpi) {
        list = list.filter((r) =>
          kpi.id === 'on_map' ? r.appInstalled && r.point : kpi.statuses.includes(r.status),
        )
      }
    }
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((r) =>
      r.fullName.toLowerCase().includes(q) ||
      (r.vehicle?.plate ?? '').toLowerCase().includes(q) ||
      (r.vehicle?.brand ?? '').toLowerCase().includes(q) ||
      (r.leg ? `${r.leg.loadPoint} ${r.leg.unloadPoint}`.toLowerCase().includes(q) : false) ||
      (r.order ? `${r.order.number} ${r.order.customer}`.toLowerCase().includes(q) : false) ||
      (MONITOR_STATUSES[r.status] ?? '').toLowerCase().includes(q),
    )
  }, [allRows, activeKpi, query, showAll])

  const selected = allRows.find((r) => r.driverId === selectedId) ?? null
  const simRow = allRows.find((r) => r.driverId === simDriverId) ?? null
  const summary = data?.summary

  // SLA и интеграционные счётчики контура (из /api/state)
  const ackPending = state?.trips.filter((t) => t.ackStatus === 'pending' && t.status === 'active').length ?? 0
  const docsPendingCount = state?.trips.reduce((n, t) => n + t.legs.filter((l) => l.docsPending).length, 0) ?? 0
  const docsLostCount = state?.trips.reduce((n, t) => n + t.legs.filter((l) => l.docsLost).length, 0) ?? 0
  const legacyDevices = state?.devices.filter((d) => d.isLegacy).length ?? 0
  const skewDevices = state?.devices.filter((d) => d.systematicSkew).length ?? 0
  const outbox = state?.outboxStats ?? null

  if (!data) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-10 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загрузка оперативной сводки…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 1. Оперативная панель управления */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 ${autoRefresh ? 'animate-ping opacity-60' : ''}`} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-sm font-bold text-slate-900">Мониторинг · парк АЭМЗ</span>
            <Pill className="bg-slate-100 text-slate-600" title="Момент последнего успешного опроса телеметрии">
              обновлено {new Date(data.meta.generatedAt).toLocaleTimeString('ru-RU')}
            </Pill>
            {autoMove && (
              <Pill className="bg-slate-100 text-slate-600">
                <Play className="h-3 w-3" /> симулятор: авто-движение
              </Pill>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Авто-обновление" />
              авто-опрос · {data.meta.pollSec} с
            </label>
            <Button size="sm" variant="outline" className="h-8" onClick={() => void refresh()}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />Обновить
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setSimOpen(true)}>
              <Beaker className="mr-1 h-3.5 w-3.5 text-amber-600" />Тестовый контур
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-slate-500" onClick={() => setContractOpen(true)}>
              <BookOpen className="mr-1 h-3.5 w-3.5" />Контракт API
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2. KPI-плитки парка (клик — фильтр): единая KpiTile платформы */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {MONITOR_KPIS.map((kpi) => {
          const active = activeKpi === kpi.id
          const Icon = KPI_ICONS[kpi.id]
          return (
            <KpiTile
              key={kpi.id}
              value={kpiCounts[kpi.id] ?? 0}
              label={kpi.label}
              icon={<Icon className={`h-4 w-4 opacity-60 ${KPI_TEXT[kpi.tone]}`} aria-hidden />}
              active={active}
              onClick={() => setActiveKpi(active ? null : kpi.id)}
              hint={active ? 'Сбросить фильтр' : `Показать только: ${kpi.label}`}
            />
          )
        })}
      </div>

      {/* 3. Карта + карточка объекта */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <MonitorMap
            rows={rows}
            selectedId={selectedId}
            pickMode={pickMode}
            onPick={onPick}
            follow={follow}
            centerReq={centerReq}
            generatedAt={data.meta.generatedAt}
            onRowFocus={(driverId) => {
              setSelectedId(driverId)
              setCenterReq({ driverId, ts: Date.now() })
            }}
          />
        </div>

        <div className="xl:col-span-2">
          <ObjectCard
            row={selected}
            nowTick={nowTick}
            follow={follow}
            onFollow={setFollow}
            onLocate={(driverId) => setCenterReq({ driverId, ts: Date.now() })}
            onOpenTrip={onOpenTrip}
            etaMeta={data.meta}
          />
        </div>
      </div>

      {/* 4. Реестр парка */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-bold text-slate-900">
                Реестр парка
                <span className="ml-1.5 font-normal text-slate-500">
                  {activeKpi ? `· фильтр «${MONITOR_KPIS.find((k) => k.id === activeKpi)?.label}»` : ''}
                  {` · ${rows.length} из ${showAll ? data.rows.length : data.rows.filter((r) => r.tripStatus === 'active' || r.appInstalled).length}`}
                </span>
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Только на линии' : `Весь парк (${data.rows.length})`}
              </Button>
              {activeKpi && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-700" onClick={() => setActiveKpi(null)}>
                  сбросить фильтр
                </Button>
              )}
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Водитель, госномер, ТС…"
              className="h-8 w-64 text-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3 font-medium">Объект</th>
                  <th className="pb-2 pr-3 font-medium">Статус</th>
                  <th className="pb-2 pr-3 font-medium">Маршрут</th>
                  <th className="pb-2 pr-3 font-medium">Прогресс плеча</th>
                  <th className="pb-2 pr-3 font-medium">Скорость</th>
                  <th className="pb-2 pr-3 font-medium">Связь</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const selectedRow = r.driverId === selectedId
                  return (
                    <tr
                      key={r.driverId}
                      onClick={() => {
                        setSelectedId(r.driverId)
                        setCenterReq({ driverId: r.driverId, ts: Date.now() })
                      }}
                      className={`cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 ${
                        selectedRow ? 'bg-slate-100' : ''
                      }`}
                      title="Открыть карточку объекта"
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-800">{r.fullName}</span>
                          <CallButton phone={r.phone} name={r.fullName} driverId={r.driverId} withLabel={false} className="h-6 w-6 p-0" />
                        </div>
                        <div className="text-xs text-slate-500">
                          {r.vehicle ? `${r.vehicle.plate} · ${r.vehicle.brand}` : 'ТС не назначено'}
                          {r.trailer ? ` + ${r.trailer.plate}` : ''}
                        </div>
                        {r.waitingReturn && <Pill className="mt-0.5 bg-slate-100 text-slate-600">ждёт обратку</Pill>}
                      </td>
                      <td className="py-2 pr-3">
                        <DotWord dot={MONITOR_STATUS_DOT[r.status] ?? 'bg-slate-400'} tone={MONITOR_STATUS_TONE[r.status]}>
                          {MONITOR_STATUSES[r.status] ?? r.status}
                        </DotWord>
                        <div className="text-[10px] text-slate-400">{fmtInStatus(r.statusSetAt, nowTick)}</div>
                        {r.status === 'offline' && r.lastKnownStatus && (
                          <div className="text-[10px] text-slate-400">было: {MONITOR_STATUSES[r.lastKnownStatus] ?? r.lastKnownStatus}</div>
                        )}
                        {r.comment && <div className="max-w-52 truncate text-[10px] text-red-600" title={r.comment}>{r.comment}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-600">
                        {r.leg ? (
                          <>
                            <div className="font-medium text-slate-700">{r.leg.loadPoint} → {r.leg.unloadPoint}</div>
                            <div className="text-[10px] text-slate-400">
                              плечо {r.leg.seq}{LEG_TYPE_LABELS[r.leg.type] ? ` · ${LEG_TYPE_LABELS[r.leg.type]}` : ''}
                              {r.order ? ` · зак. ${r.order.number}` : ''}
                            </div>
                            {(r.docsPending || r.docsLost) && (
                              <Pill className="mt-0.5 bg-slate-100 text-slate-600">
                                <span className={`h-1.5 w-1.5 rounded-full ${r.docsLost ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden />
                                {r.docsLost ? 'ТТН утрачена' : 'ТТН ожидается'}
                              </Pill>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">без рейса</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {r.progressPct != null && r.appInstalled ? (
                          <div className="w-40 space-y-1">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, r.progressPct)}%`, background: statusHex(r.status) }} />
                            </div>
                            <div className="text-[10px] leading-tight text-slate-500">
                              <b>{r.progressPct}%</b>
                              {r.kmLeft != null && <> · осталось <b>~{r.kmLeft}</b> км</>}
                            </div>
                            {r.etaMin != null && (
                              <div className="text-[10px] leading-tight text-slate-400">
                                ETA ~{fmtEtaMin(r.etaMin)} · {fmtEtaAt(r.etaAt, nowTick)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-600">
                        {r.appInstalled && r.speedKmh != null ? (r.speedKmh > 0 ? <span className="font-medium">{Math.round(r.speedKmh)} км/ч</span> : 'стоит') : '—'}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {r.appInstalled ? (
                          <>
                            <div>{fmtAgo(r.lastSeenAt, nowTick)}</div>
                            <div className="text-[10px] text-slate-400">
                              {r.appVersion ?? '—'}{r.source === 'test_sim' ? ' (сим.)' : ''}
                            </div>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400"><WifiOff className="h-3 w-3" />нет приложения</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400">
              {activeKpi || query ? 'Под фильтр ничего не подошло' : 'На линии никого нет'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Системный мониторинг контура */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SystemCard
          title="Обмен с 1С"
          icon={<Route className="h-4 w-4" />}
          items={outbox ? [
            { label: 'в очереди', value: outbox.pending, tone: outbox.pending > 0 ? 'slate' : 'ok' },
            { label: 'подтверждено', value: outbox.acked, tone: 'ok' },
            { label: 'stale (>24 ч без ответа)', value: outbox.stale, tone: outbox.stale > 0 ? 'warn' : 'ok' },
            { label: 'failed (не доставлено)', value: outbox.failed, tone: outbox.failed > 0 ? 'danger' : 'ok' },
          ] : []}
        />
        <SystemCard
          title="Устройства и покрытие"
          icon={<Smartphone className="h-4 w-4" />}
          items={[
            { label: 'покрытие приложением', value: `${summary && summary.totalDrivers > 0 ? Math.round((summary.withApp / summary.totalDrivers) * 100) : 0}% (${summary?.withApp ?? 0} из ${summary?.totalDrivers ?? 0})`, tone: 'ok' },
            { label: 'legacy-приложения', value: legacyDevices, tone: legacyDevices > 0 ? 'warn' : 'ok' },
            { label: 'систематический сдвиг часов', value: skewDevices, tone: skewDevices > 0 ? 'warn' : 'ok' },
            { label: 'нет приложения', value: summary?.notInstalled ?? 0, tone: (summary?.notInstalled ?? 0) > 0 ? 'slate' : 'ok' },
          ]}
        />
        <SystemCard
          title="SLA и документы"
          icon={<ClipboardList className="h-4 w-4" />}
          items={[
            { label: 'назначения без подтверждения', value: ackPending, tone: ackPending > 0 ? 'warn' : 'ok' },
            { label: 'фото ТТН ожидается', value: docsPendingCount, tone: docsPendingCount > 0 ? 'warn' : 'ok' },
            { label: 'фото ТТН утрачено', value: docsLostCount, tone: docsLostCount > 0 ? 'danger' : 'ok' },
            { label: 'эскалация SLA', value: `${CONSTANTS.ACK_SLA_MIN} мин`, tone: 'slate' },
          ]}
          action={onOpenRequests ? { label: 'Открыть заявки', onClick: onOpenRequests } : undefined}
        />
      </div>

      {/* 5б. Устройства водителей — разбор и действия (бывший отдельный раздел «Устройства») */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Smartphone className="h-4 w-4 text-slate-400" aria-hidden />
            <span className="text-sm font-bold text-slate-900">Устройства водителей</span>
            <span className="text-xs text-slate-400">({state?.devices.length ?? 0})</span>
            {legacyDevices > 0 && <Pill className="bg-slate-100 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />legacy: {legacyDevices}</Pill>}
            {skewDevices > 0 && <Pill className="bg-slate-100 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />systematic_skew: {skewDevices}</Pill>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="pb-2 pr-2">Устройство</th>
                  <th className="pb-2 pr-2">Водитель</th>
                  <th className="pb-2 pr-2">Версия</th>
                  <th className="pb-2 pr-2">Онлайн</th>
                  <th className="pb-2 pr-2">clock_skew (24ч)</th>
                  <th className="pb-2 pr-2">Флаги</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {(state?.devices ?? []).map((d) => (
                  <tr
                    key={d.id}
                    ref={(el) => { if (el) deviceRowRefs.current.set(d.id, el); else deviceRowRefs.current.delete(d.id) }}
                    className={`border-b border-slate-100 transition-colors ${hlDeviceId === d.id ? 'bg-slate-100 ring-2 ring-inset ring-slate-300' : ''}`}
                  >
                    <td className="py-2 pr-2 font-mono text-xs">{d.id}</td>
                    <td className="py-2 pr-2">{d.driver?.fullName || '—'}</td>
                    <td className="py-2 pr-2 font-mono text-xs">{d.appVersion}</td>
                    <td className="py-2 pr-2 text-xs">{fmtDateTime(d.lastSeenAt)}</td>
                    <td className="py-2 pr-2">
                      <span className={d.clockSkewCount24h >= CONSTANTS.CLOCK_SKEW_ALERT_COUNT ? 'font-bold text-red-600' : ''}>
                        {d.clockSkewCount24h}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {d.systematicSkew && (
                          <Pill className="bg-slate-100 text-slate-600">
                            <Clock className="h-3 w-3 text-red-600" />systematic_skew
                          </Pill>
                        )}
                        {d.isLegacy && (
                          <Pill className="bg-slate-100 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />legacy — требуется обновление</Pill>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        {d.systematicSkew && (
                          <Button size="sm" variant="ghost" onClick={() => deviceAction('reset-skew', d.id)}>
                            Время синхронизировано
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => deviceAction('set-legacy', d.id, !d.isLegacy)}>
                          {d.isLegacy ? 'Считать обновлённым' : 'Считать legacy'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(state?.devices.length ?? 0) === 0 && (
            <div className="py-4 text-center text-xs text-slate-400">Устройства не зарегистрированы</div>
          )}
        </CardContent>
      </Card>

      {/* 6а. Диалог: симулятор приложения водителя (тестовый контур) */}
      <Dialog open={simOpen} onOpenChange={setSimOpen}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-slate-500" />
              Симулятор приложения водителя
              <Pill className="bg-slate-100 text-slate-600">тестовый режим</Pill>
            </DialogTitle>
            <DialogDescription>
              Отправляет телеметрию от имени выбранного водителя — как будущее приложение водителя.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Водитель</Label>
              <Select value={simDriverId} onValueChange={setSimDriverId}>
                <SelectTrigger><SelectValue placeholder="Выберите водителя" /></SelectTrigger>
                <SelectContent>
                  {allRows.map((r) => (
                    <SelectItem key={r.driverId} value={r.driverId}>
                      {r.fullName}{r.vehicle ? ` · ${r.vehicle.plate}` : ''}{r.appInstalled ? '' : ' · без приложения'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {simRow && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
                <DotWord dot={MONITOR_STATUS_DOT[simRow.status] ?? 'bg-slate-400'} tone={MONITOR_STATUS_TONE[simRow.status]}>
                  {MONITOR_STATUSES[simRow.status] ?? simRow.status}
                </DotWord>
                {simRow.kmLeft != null && <span className="text-slate-500">до выгрузки ~<b>{simRow.kmLeft} км</b></span>}
                {simRow.speedKmh != null && simRow.speedKmh > 0 && <span className="text-slate-500">{Math.round(simRow.speedKmh)} км/ч</span>}
                <span className="text-slate-400">связь {fmtAgo(simRow.lastSeenAt, nowTick)}</span>
                {simRow.comment && <span className="text-red-600">{simRow.comment}</span>}
              </div>
            )}

            {SIM_STATUS_GROUPS.map((group) => (
              <div key={group.title} className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase text-slate-400">{group.title}</div>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map(({ status, icon: Icon }) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={simRow?.rawStatus === status ? 'default' : 'outline'}
                      className="h-8 text-xs"
                      disabled={!simDriverId || busy}
                      onClick={() => sendStatus(status)}
                      title={MONITOR_STATUSES[status]}
                    >
                      <Icon className="mr-1 h-3.5 w-3.5" />
                      {MONITOR_STATUSES[status]}
                    </Button>
                  ))}
                </div>
              </div>
            ))}

            <div className="space-y-1">
              <Label htmlFor="sim-comment">Комментарий (уходит вместе со статусом)</Label>
              <Input
                id="sim-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="например: поломка — лопнуло колесо, 41 км трассы"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="sim-automove" className="flex items-center gap-1.5 text-xs">
                  <Play className="h-3.5 w-3.5 text-slate-500" />
                  Авто-движение по маршруту (ускорение ×{CONSTANTS.SIM_SPEED_MULT})
                </Label>
                <Switch id="sim-automove" checked={autoMove} onCheckedChange={setAutoMove} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="sim-pick" className="flex items-center gap-1.5 text-xs">
                  <MousePointerClick className="h-3.5 w-3.5 text-slate-500" />
                  Точка кликом по карте
                </Label>
                <Switch id="sim-pick" checked={pickMode} onCheckedChange={setPickMode} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="sim-app" className="flex items-center gap-1.5 text-xs">
                  <Smartphone className="h-3.5 w-3.5 text-slate-500" />
                  Приложение установлено
                </Label>
                <Switch
                  id="sim-app"
                  checked={simRow?.appInstalled ?? false}
                  onCheckedChange={(v) => {
                    if (!simDriverId) return
                    if (v && simRow?.route) {
                      void post({ driverId: simDriverId, appInstalled: true, geo: { lat: simRow.route.from[0], lng: simRow.route.from[1], speedKmh: 0 } })
                    } else {
                      void post({ driverId: simDriverId, appInstalled: v })
                    }
                  }}
                />
              </div>
              {pickMode && (
                <div className="text-[11px] text-slate-600">Кликните по карте — точка уйдёт водителю из симулятора</div>
              )}
              {autoMove && (
                <div className="flex items-center gap-2 text-[11px] text-slate-600">
                  <Square className="h-3 w-3 animate-pulse" />
                  Пакеты телеметрии отправляются каждые {CONSTANTS.SIM_TICK_MS / 1000} с — трек растёт на карте
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button size="sm" variant="outline" className="h-8" onClick={() => void resetDemo()}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />Сбросить демо-телеметрию
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 6б. Диалог: контракт телеметрии для будущего приложения */}
      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Контракт синхронизации с приложением водителя</DialogTitle>
            <DialogDescription>
              Когда приложение будет готово, оно шлёт те же пакеты, что и симулятор
              (<code className="rounded bg-slate-100 px-1">source=app</code>). Гео — периодически
              (раз в 30–60 с при движении), статус — по событию.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs leading-relaxed text-slate-600">
              Сервер сам выводит системные статусы: <b>нет связи</b> (&gt; {CONSTANTS.ONLINE_STALE_MIN} мин без
              телеметрии), <b>скоро завершит рейс</b> (&lt; {CONSTANTS.NEAR_UNLOAD_KM} км до выгрузки),
              <b> в ремонте</b> (флаг машины), <b>приложение не установлено</b>. Статусы лестницы рейса
              через <code className="rounded bg-slate-100 px-1">/api/driver/sync</code> автоматически отражаются
              в мониторинге. ETA до выгрузки — оценочный: GPS-дистанция × {data.meta.etaKmK} (извилистость дорог),
              средняя скорость {data.meta.etaAvgKmh} км/ч + обязательные отдыхы (правило {CONSTANTS.ETA_BREAK_DRIVE_H} ч / {CONSTANTS.ETA_BREAK_MIN} мин).
            </div>
            <pre className="overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-snug text-slate-100">{CONTRACT_SNIPPET}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Карточка объекта (выбранный водитель: рейс, прогресс, ETA, документы, хронология)
// ---------------------------------------------------------------------------

const LEG_TYPE_LABELS: Record<string, string> = {
  main: 'основное плечо',
  return: 'возврат',
  empty_return: 'порожний возврат',
}

function Row2({ label, children }: { label: string; children: React.ReactNode }) {
  // Сетка с фиксированной колонкой метки: значения выровнены по одной вертикали —
  // без «рваного» правого края, когда значение длинное и переносится на новую строку
  return (
    <div className="grid grid-cols-[86px_minmax(0,1fr)] items-baseline gap-x-2 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="min-w-0 text-slate-700">{children}</span>
    </div>
  )
}

function ObjectCard({ row, nowTick, follow, onFollow, onLocate, onOpenTrip, etaMeta }: {
  row: MonitorRow | null
  nowTick: number
  follow: boolean
  onFollow: (v: boolean) => void
  onLocate: (driverId: string) => void
  onOpenTrip?: (tripId: string) => void
  etaMeta: MonitorState['meta']
}) {
  if (!row) {
    return (
      <Card className="flex h-full min-h-64 items-center justify-center rounded-xl border-slate-200 shadow-sm">
        <CardContent className="p-6 text-center text-sm text-slate-400">
          Выберите объект на карте или в реестре парка
        </CardContent>
      </Card>
    )
  }

  const coverage = etaMeta

  return (
    <Card className="flex h-full flex-col rounded-xl border-slate-200 shadow-sm">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {/* Шапка: водитель + статус */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-900">{row.fullName}</span>
              <CallButton phone={row.phone} name={row.fullName} driverId={row.driverId} withLabel={false} className="h-7 w-7" />
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {row.vehicle ? `${row.vehicle.plate} · ${row.vehicle.brand}` : 'ТС не назначено'}
              {row.trailer ? ` + ${row.trailer.plate}` : ''}
              {row.vehicle?.isRepair && <Pill className="ml-1.5 bg-slate-100 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />в ремонте</Pill>}
            </div>
          </div>
          <div className="text-right">
            <DotWord dot={MONITOR_STATUS_DOT[row.status] ?? 'bg-slate-400'} tone={MONITOR_STATUS_TONE[row.status]}>
              {MONITOR_STATUSES[row.status] ?? row.status}
            </DotWord>
            <div className="text-[10px] text-slate-400">{fmtInStatus(row.statusSetAt, nowTick)}</div>
          </div>
        </div>

        {/* Действия */}
        <div className="flex flex-wrap items-center gap-2 border-y border-slate-100 py-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onLocate(row.driverId)} title="Показать объект на карте">
            <LocateFixed className="mr-1 h-3.5 w-3.5 text-slate-500" />На карте
          </Button>
          <label className="flex items-center gap-2 text-xs text-slate-600" title="Карта следует за объектом при обновлении телеметрии">
            <Switch checked={follow} onCheckedChange={onFollow} aria-label="Следить за объектом" />
            следить
          </label>
          {row.tripId && onOpenTrip && (
            <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => onOpenTrip(row.tripId!)}>
              Открыть рейс
            </Button>
          )}
        </div>

        {/* Рейс */}
        {row.tripStatus === 'active' && row.leg ? (
          <div className="space-y-2.5">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <Route className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{row.leg.loadPoint} → {row.leg.unloadPoint}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                плечо {row.leg.seq}{LEG_TYPE_LABELS[row.leg.type] ? ` · ${LEG_TYPE_LABELS[row.leg.type]}` : ''}
                {row.order ? ` · заказ ${row.order.number}` : ''}
                {row.order ? ` · ${row.order.customer}` : ''}
              </div>
            </div>

            {/* Прогресс + ETA */}
            {row.progressPct != null && (
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, row.progressPct)}%`, background: statusHex(row.status) }} />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                  <span className="text-slate-600">пройдено <b>{row.progressPct}%</b>{row.legKm != null ? <> · плечо ~{row.legKm} км</> : null}</span>
                  {row.kmLeft != null && <span className="text-slate-600">осталось <b>~{row.kmLeft} км</b></span>}
                </div>
                {row.etaMin != null && (
                  <div className="flex items-center gap-1 text-xs text-slate-600">
                    <Flag className="h-3.5 w-3.5 text-cyan-600" />
                    <span>прибытие <b>~{fmtEtaMin(row.etaMin)}</b> · {fmtEtaAt(row.etaAt, nowTick)}</span>
                    <InfoTip label="Как считается ETA">
                      Оценочный прогноз: GPS-дистанция по прямой × {coverage.etaKmK} (извилистость дорог),
                      средняя скорость {coverage.etaAvgKmh} км/ч, плюс обязательные отдыхы водителя
                      ({CONSTANTS.ETA_BREAK_DRIVE_H} ч пути → {CONSTANTS.ETA_BREAK_MIN} мин отдыха).
                      Прогноз для планирования, не для сверки с 1С.
                    </InfoTip>
                  </div>
                )}
                {row.leg.kmPlan != null && <div className="text-[11px] text-slate-400">по плану: {row.leg.kmPlan} км</div>}
              </div>
            )}

            {/* Груз + заказчик */}
            <div className="space-y-1 rounded-lg bg-slate-50/80 px-3 py-2">
              {row.cargo?.desc && <Row2 label="Груз">{row.cargo.desc}</Row2>}
              {(row.cargo?.weightT != null || row.cargo?.volumeM3 != null) && (
                <Row2 label="Параметры">
                  {[
                    row.cargo?.weightT != null ? `${row.cargo.weightT} т` : null,
                    row.cargo?.volumeM3 != null ? `${row.cargo.volumeM3} м³` : null,
                  ].filter(Boolean).join(' · ')}
                </Row2>
              )}
              {row.leg.kmPlan == null && row.cargo == null && <div className="text-xs text-slate-400">Данные груза не заданы в плече</div>}
              {row.ackStatus && <Row2 label="Назначение">{ACK_LABELS[row.ackStatus] ?? row.ackStatus}</Row2>}
              {row.tripStartedAt && <Row2 label="Выезд">{fmtDateTimeShort(row.tripStartedAt)}</Row2>}
            </div>

            {/* Документы */}
            {(row.docsPending || row.docsLost) && (
              <div className="flex flex-wrap gap-1.5">
                {row.docsLost && <Pill className="bg-slate-100 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />фото ТТН утрачено</Pill>}
                {row.docsPending && !row.docsLost && <Pill className="bg-slate-100 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />фото ТТН ожидается</Pill>}
              </div>
            )}

            {/* Хронология плеча */}
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase text-slate-400">Хронология плеча</div>
              {row.events.length > 0 ? (
                <div className="space-y-1.5">
                  {row.events.map((ev, i) => (
                    <div key={`${ev.at}-${i}`} className="flex items-start gap-2 text-xs">
                      <span className="w-24 shrink-0 pt-0.5 text-right text-[10px] text-slate-400">{fmtEventTime(ev.at, nowTick)}</span>
                      <div className="min-w-0 flex-1 border-l-2 border-slate-100 pl-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusChip status={ev.status} />
                          {ev.type === 'correction' && <Pill className="bg-slate-100 text-slate-600">корректировка</Pill>}
                          {ev.result === 'rejected' && <Pill className="bg-red-100 text-red-700">отклонено</Pill>}
                          {ev.result === 'needs_review' && <Pill className="bg-slate-100 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />требует разбора</Pill>}
                          <span className="text-[10px] text-slate-400">{ACTOR_LABELS[ev.actorRole] ?? ev.actorRole}</span>
                        </div>
                        {ev.comment && <div className="text-[11px] text-slate-600">«{ev.comment}»</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400">Событий по плечу пока нет</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-400">
            {row.tripStatus === 'completed'
              ? 'Рейс завершён — объект вне активных перевозок'
              : 'Объект вне активных рейсов: назначение появится после планирования'}
          </div>
        )}

        {/* Телеметрия */}
        <div className="mt-auto space-y-1 border-t border-slate-100 pt-2">
          <Row2 label="Скорость">
            {row.appInstalled && row.speedKmh != null ? (
              <span className="inline-flex items-center gap-1.5">
                {row.headingDeg != null && row.speedKmh > 0 && (
                  <Compass className="h-3.5 w-3.5 text-slate-400" style={{ transform: `rotate(${row.headingDeg}deg)` }} aria-label={`Курс ${Math.round(row.headingDeg)}°`} />
                )}
                {row.speedKmh > 0 ? `${Math.round(row.speedKmh)} км/ч` : 'стоит'}
                {row.headingDeg != null && row.speedKmh > 0 ? ` · курс ${Math.round(row.headingDeg)}°` : ''}
              </span>
            ) : '—'}
          </Row2>
          <Row2 label="Связь">
            {row.appInstalled
              ? `${fmtAgo(row.lastSeenAt, nowTick)} · точка ${fmtAgo(row.pointAt, nowTick)}`
              : 'приложение не установлено'}
          </Row2>
          <Row2 label="Устройство">
            {row.appInstalled ? `${row.appVersion ?? '—'}${row.source === 'test_sim' ? ' · симулятор' : ''}` : '—'}
          </Row2>
        </div>
      </CardContent>
    </Card>
  )
}

const ACTOR_LABELS: Record<string, string> = {
  driver: 'водитель',
  logist: 'логист',
  system: 'система',
}

// ---------------------------------------------------------------------------
// Системный мониторинг контура (обмен с 1С, устройства, SLA)
// ---------------------------------------------------------------------------

function SystemCard({ title, icon, items, note, action }: {
  title: string
  icon: React.ReactNode
  items: { label: string; value: number | string; tone: 'ok' | 'warn' | 'danger' | 'slate' }[]
  note?: string
  action?: { label: string; onClick: () => void }
}) {
  const TONE: Record<string, string> = {
    ok: 'text-slate-700',
    slate: 'text-slate-500',
    warn: 'text-amber-700',
    danger: 'text-red-700',
  }
  const problem = items.some((i) => i.tone === 'danger')
  const warn = items.some((i) => i.tone === 'warn')
  return (
    <Card className="rounded-xl border border-slate-200 shadow-sm">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <span className={problem ? 'text-red-600' : warn ? 'text-amber-600' : 'text-slate-400'}>{icon}</span>
          {title}
          {problem && <Pill className="bg-slate-100 text-slate-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />требует разбора</Pill>}
          {!problem && warn && <Pill className="bg-slate-100 text-slate-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />внимание</Pill>}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {items.map((i) => (
            <div key={i.label} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-slate-500" title={i.label}>{i.label}</span>
              <span className={`font-semibold tabular-nums ${TONE[i.tone]}`}>{i.value}</span>
            </div>
          ))}
          {items.length === 0 && <div className="text-xs text-slate-400">Данные загружаются…</div>}
        </div>
        {(note || action) && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            {note && <span className="text-[10px] leading-snug text-slate-400">{note}</span>}
            {action && (
              <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px] text-blue-700" onClick={action.onClick}>
                {action.label}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Карта (Leaflet, динамический импорт — окно недоступно на сервере)
// ---------------------------------------------------------------------------

function popupHtml(row: MonitorRow): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    `<div style="min-width:220px">` +
    `<div style="font-weight:700;color:#0f172a">${esc(row.fullName)}</div>` +
    `<div style="color:#64748b;font-size:12px">${row.vehicle ? `${esc(row.vehicle.brand)} · ${esc(row.vehicle.plate)}` : 'машина не назначена'}${row.trailer ? ` + ${esc(row.trailer.plate)}` : ''}</div>` +
    `<div style="margin-top:4px;font-size:12px;color:#0f172a"><b>${esc(MONITOR_STATUSES[row.status] ?? row.status)}</b>` +
    `${row.speedKmh && row.speedKmh > 0 ? ` · ${Math.round(row.speedKmh)} км/ч` : ''}</div>` +
    (row.leg ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${esc(row.leg.loadPoint)} → ${esc(row.leg.unloadPoint)}</div>` : '') +
    (row.order ? `<div style="font-size:11px;color:#64748b">заказ ${esc(row.order.number)} · ${esc(row.order.customer)}</div>` : '') +
    (row.progressPct != null ? `<div style="font-size:11px;color:#334155;margin-top:2px">плечо пройдено: <b>${row.progressPct}%</b></div>` : '') +
    (row.kmLeft != null ? `<div style="font-size:11px;color:#0891b2">до выгрузки ~${row.kmLeft} км</div>` : '') +
    (row.etaMin != null ? `<div style="font-size:11px;color:#0891b2">ETA ~${fmtEtaMin(row.etaMin)} · ${fmtEtaAt(row.etaAt)}</div>` : '') +
    (row.lastSeenAt ? `<div style="font-size:11px;color:#94a3b8">связь: ${fmtAgo(row.lastSeenAt)}</div>` : '') +
    (row.comment ? `<div style="font-size:11px;color:#ef4444;margin-top:2px">${esc(row.comment)}</div>` : '') +
    `</div>`
  )
}

const MAP_LEGEND: string[] = [
  'en_route', 'near_unload', 'at_loading', 'at_unload', 'unloaded', 'trip_completed',
  'waiting_backhaul', 'breakdown', 'rest', 'offline',
]

function MonitorMap({ rows, selectedId, pickMode, onPick, follow, centerReq, generatedAt, onRowFocus }: {
  rows: MonitorRow[]
  selectedId: string
  pickMode: boolean
  onPick: (lat: number, lng: number) => void
  follow: boolean
  centerReq: { driverId: string; ts: number } | null
  generatedAt: string
  onRowFocus: (driverId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LMap | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const markersRef = useRef<Map<string, LMarker>>(new Map())
  const tracksRef = useRef<Map<string, LPolyline>>(new Map())
  const routeLineRef = useRef<LPolyline | null>(null)
  const pickRef = useRef({ pickMode, onPick })
  const fittedRef = useRef(false)
  const centerTsRef = useRef(0)
  const followKeyRef = useRef('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    pickRef.current = { pickMode, onPick }
  }, [pickMode, onPick])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      const map = L.map(containerRef.current).setView([45.0355, 38.9753], 8)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)
      map.on('click', (e) => {
        if (pickRef.current.pickMode) pickRef.current.onPick(e.latlng.lat, e.latlng.lng)
      })
      mapRef.current = map
      // отладочный доступ к инстансу карты (консоль): window.__monitorMap
      ;(window as unknown as { __monitorMap?: LMap }).__monitorMap = map
      setReady(true)
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      markersRef.current.clear()
      tracksRef.current.clear()
      routeLineRef.current = null
      fittedRef.current = false
      followKeyRef.current = ''
    }
  }, [])

  // Синхронизация маркеров/треков с данными
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || !ready) return

    const onMap = rows.filter((r) => r.appInstalled && r.point)

    // маркеры
    const seen = new Set<string>()
    for (const row of onMap) {
      seen.add(row.driverId)
      const moving = ['en_route', 'near_unload', 'en_route_loading', 'empty_return', 'breakdown'].includes(row.status)
      const selected = row.driverId === selectedId
      const size = selected ? 34 : 27
      const hex = statusHex(row.status)
      const icon = L.divIcon({
        className: '',
        html:
          `<div style="position:relative;width:${size}px;height:${size}px">` +
          (moving ? `<span class="drv-pulse" style="--dot:${hex}"></span>` : '') +
          `<div style="position:absolute;inset:0;border-radius:9999px;background:${hex};border:2px solid #fff;` +
          `box-shadow:0 1px 5px rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;` +
          (selected ? 'outline:3px solid #1d4ed8;outline-offset:2px;' : '') +
          `">${TRUCK_SVG}</div></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      })
      const existing = markersRef.current.get(row.driverId)
      if (existing) {
        existing.setLatLng(row.point!)
        existing.setIcon(icon)
        existing.setPopupContent(popupHtml(row))
      } else {
        const m = L.marker(row.point!, { icon })
          .addTo(map)
          .bindPopup(popupHtml(row))
          .on('click', () => onRowFocus(row.driverId))
        markersRef.current.set(row.driverId, m)
      }
    }
    for (const [driverId, m] of markersRef.current) {
      if (!seen.has(driverId)) {
        m.remove()
        markersRef.current.delete(driverId)
      }
    }

    // треки
    const seenTracks = new Set<string>()
    for (const row of onMap) {
      if (row.track.length < 2) continue
      seenTracks.add(row.driverId)
      const line = row.track.map((p) => [p[0], p[1]] as [number, number])
      const existing = tracksRef.current.get(row.driverId)
      if (existing) {
        existing.setLatLngs(line)
        existing.setStyle({ color: statusHex(row.status) })
      } else {
        const pl = L.polyline(line, { color: statusHex(row.status), weight: 2.5, opacity: 0.65 }).addTo(map)
        tracksRef.current.set(row.driverId, pl)
      }
    }
    for (const [driverId, pl] of tracksRef.current) {
      if (!seenTracks.has(driverId)) {
        pl.remove()
        tracksRef.current.delete(driverId)
      }
    }

    // маршрут выбранного водителя (план плеча)
    const selectedRow = rows.find((r) => r.driverId === selectedId && r.route)
    if (selectedRow?.route) {
      const line = [selectedRow.route.from, selectedRow.route.to].map((p) => [p[0], p[1]] as [number, number])
      if (routeLineRef.current) {
        routeLineRef.current.setLatLngs(line)
      } else {
        routeLineRef.current = L.polyline(line, { color: '#475569', weight: 2, opacity: 0.7, dashArray: '6 8' }).addTo(map)
      }
    } else if (routeLineRef.current) {
      routeLineRef.current.remove()
      routeLineRef.current = null
    }

    // первичный масштаб по точкам
    if (!fittedRef.current && onMap.length > 0) {
      fittedRef.current = true
      const pts = onMap.map((r) => r.point!)
      map.fitBounds(L.latLngBounds(pts.map((p) => [p[0], p[1]] as [number, number])).pad(0.25), { maxZoom: 10 })
    }
  }, [rows, selectedId, ready, onRowFocus])

  // Слежение за объектом / центрирование по запросу (клик в реестре, «На карте»)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const row = rows.find((r) => r.driverId === selectedId)
    if (!row?.point) return
    if (centerReq && centerReq.driverId === selectedId && centerTsRef.current !== centerReq.ts) {
      centerTsRef.current = centerReq.ts
      followKeyRef.current = ''
      map.setView(row.point, Math.max(map.getZoom(), 9), { animate: true })
      return
    }
    if (follow) {
      const key = `${selectedId}:${row.pointAt ?? row.point.join(',')}`
      if (followKeyRef.current !== key) {
        followKeyRef.current = key
        map.setView(row.point, Math.max(map.getZoom(), 9), { animate: true })
      }
    } else {
      followKeyRef.current = ''
    }
  }, [rows, selectedId, follow, centerReq, ready])

  function fitAll() {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return
    const pts = rows.filter((r) => r.appInstalled && r.point).map((r) => r.point!)
    if (pts.length === 1) map.setView(pts[0], 11, { animate: true })
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((p) => [p[0], p[1]] as [number, number])).pad(0.25), { maxZoom: 11 })
  }

  return (
    <div className={`relative overflow-hidden rounded-lg border ${pickMode ? 'border-slate-400 ring-2 ring-slate-100' : 'border-slate-200'}`}>
      <div ref={containerRef} className="h-[420px] w-full xl:h-[560px]" aria-label="Карта водителей" />

      {/* Оверлей: счётчик + авто-обновление + кнопка общего масштаба */}
      <div className="absolute right-2 top-2 z-[500] flex flex-col items-end gap-1.5">
        <div className="rounded-md bg-white/95 px-2 py-1 text-[10px] font-medium text-slate-600 shadow">
          {rows.filter((r) => r.appInstalled && r.point).length} объектов на карте · {new Date(generatedAt).toLocaleTimeString('ru-RU')}
        </div>
        <button
          type="button"
          onClick={fitAll}
          title="Показать весь парк"
          className="flex h-8 w-8 items-center justify-center rounded-md bg-white/95 text-slate-600 shadow transition-colors hover:text-slate-900"
          aria-label="Показать весь парк"
        >
          <LocateFixed className="h-4 w-4" />
        </button>
      </div>

      {/* Режим «точка кликом» (симулятор) */}
      {pickMode && (
        <div className="absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          Кликните по карте — точка уйдёт водителю из симулятора
        </div>
      )}

      {/* Легенда статусов */}
      <div className="absolute bottom-3 left-3 z-[500] max-w-[70%] rounded-lg bg-white/95 px-2.5 py-2 shadow">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Статусы</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {MAP_LEGEND.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[10px] text-slate-600">
              <span className="h-2 w-2 rounded-full" style={{ background: statusHex(s) }} aria-hidden />
              {MONITOR_STATUSES[s]}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Утилиты отображения
// ---------------------------------------------------------------------------

// Цвета статусов мониторинга для карты (hex — маркеры Leaflet вне Tailwind);
// дублируют MONITOR_STATUS_DOT из constants.ts — тот же словарь, в hex для Leaflet
const MONITOR_HEX: Record<string, string> = {
  not_installed: '#cbd5e1', offline: '#94a3b8', idle: '#64748b',
  assigned: '#f59e0b', en_route_loading: '#0ea5e9', at_loading: '#3b82f6',
  loaded: '#2563eb', en_route: '#8b5cf6', near_unload: '#06b6d4',
  at_unload: '#0891b2', unloaded: '#10b981', trip_completed: '#059669',
  empty_return: '#0d9488', waiting_backhaul: '#8b5cf6',
  breakdown: '#ef4444', repair: '#f87171', rest: '#fbbf24',
}

const TRUCK_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>'

// Иконки KPI-плиток (id → компонент)
const KPI_ICONS: Record<string, typeof Truck> = {
  on_trip: Truck,
  in_motion: Navigation,
  cargo_ops: Warehouse,
  near_unload: Flag,
  waiting_backhaul: Repeat2,
  attention: AlertTriangle,
  offline: WifiOff,
  on_map: MapPin,
}

// Тон числа KPI-плитки (navy — тёмный сланец основного показателя)
const KPI_TEXT: Record<string, string> = {
  navy: 'text-slate-900',
  violet: 'text-violet-600',
  blue: 'text-blue-600',
  cyan: 'text-cyan-600',
  red: 'text-red-600',
  emerald: 'text-emerald-600',
  slate: 'text-slate-500',
}

function statusHex(status: string): string {
  return MONITOR_HEX[status] ?? '#94a3b8'
}

function fmtAgo(iso?: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec} сек назад`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} мин назад`
  return `${Math.round(min / 60)} ч назад`
}

function fmtInStatus(iso?: string | null, now = Date.now()): string {
  if (!iso) return ''
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (min < 1) return 'только что'
  if (min < 60) return `в статусе ${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `в статусе ${h} ч${m > 0 ? ` ${m} мин` : ''}`
}

function fmtEtaMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} мин`
  return `${m} мин`
}

function fmtEtaAt(iso?: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date(now)
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `к ${time}`
  return `к ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`
}

function fmtDateTimeShort(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtEventTime(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const today = new Date(now)
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return time
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`
}

// Группы статусов симулятора (выбор водителя в приложении)
const SIM_STATUS_GROUPS: { title: string; items: { status: string; icon: typeof Truck }[] }[] = [
  {
    title: 'Плечо рейса',
    items: [
      { status: 'assigned', icon: ClipboardList },
      { status: 'en_route_loading', icon: Navigation },
      { status: 'at_loading', icon: Warehouse },
      { status: 'loaded', icon: PackageCheck },
      { status: 'en_route', icon: Truck },
      { status: 'at_unload', icon: PackageMinus },
      { status: 'unloaded', icon: PackageMinus },
      { status: 'trip_completed', icon: Flag },
    ],
  },
  {
    title: 'Обратный рейс',
    items: [
      { status: 'empty_return', icon: Undo2 },
      { status: 'waiting_backhaul', icon: Repeat2 },
    ],
  },
  {
    title: 'Особые ситуации',
    items: [
      { status: 'breakdown', icon: Wrench },
      { status: 'rest', icon: Coffee },
    ],
  },
]

// Контракт телеметрии (диалог «Контракт API»)
const CONTRACT_SNIPPET = `POST /api/driver/telemetry
{
  "driverId": "uuid",
  "tripId": "uuid | null",          // без поля — берётся активный рейс
  "status": "en_route",             // из приложения: assigned, en_route_loading, at_loading,
                                    //   loaded, en_route, at_unload, unloaded, trip_completed,
                                    //   empty_return, waiting_backhaul, breakdown, rest, idle
  "geo": {                          // опционально, при движении — периодически
    "lat": 45.0355, "lng": 38.9753,
    "speedKmh": 76, "headingDeg": 132, "accuracyM": 8,
    "at": "2026-11-19T09:00:00Z"
  },
  "appVersion": "3.0.0",
  "appInstalled": true,
  "comment": "поломка: лопнуло колесо",
  "source": "app"                   // app | test_sim
}

→ { "ok": true, "status": "near_unload" }`

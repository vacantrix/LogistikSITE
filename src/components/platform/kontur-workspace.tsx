'use client'

/**
 * Рабочее пространство собственного транспорта внутри единой оболочки «АЭМЗ Поток».
 *
 * Раньше диспетчерская была отдельным кабинетом /kontur со своей шапкой и входом.
 * Теперь её разделы — нижний уровень навигации платформы: «Заявки 1С», ATI.SU,
 * «Занятость», «Планирование», «Мониторинг», «Справочники парка» и «Аудит контура».
 * Данные по-прежнему отдаёт /kontur/api/state: один источник для всех панелей.
 *
 * Видимость и действия ограничены правами section:* и own:*: панели не показывают
 * чужие разделы, а API диспетчерской дублирует проверку на сервере.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ArrowRight, Camera, CameraOff, CircleAlert, Clock3, Inbox, RefreshCw, RotateCcw, Search, Smartphone, Timer, UserX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/components/platform/perms'
import type { TabKey } from '@/components/platform/common'
import type { Alert, StateResponse } from '@/lib/kontur/client-types'
import { authFetch } from '@/lib/kontur/session-token'
import { RequestsPanel } from '@/components/kontur/proto/RequestsPanel'
import { AtiSuPanel } from '@/components/kontur/proto/AtiSuPanel'
import { MonitoringPanel } from '@/components/kontur/proto/MonitoringPanel'
import { DirectoriesPanel } from '@/components/kontur/proto/DirectoriesPanel'
import { OccupancyPanel } from '@/components/kontur/proto/OccupancyPanel'
import { PlanningPanel } from '@/components/kontur/proto/PlanningPanel'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/kontur/ui/table'

/** Строка сквозного журнала (контракт /kontur/api/contour-audit) */
type ContourAuditEntry = {
  contour: 'platform' | 'dispatcher'
  action: string
  actorLogin?: string | null
  actorName?: string | null
  actorRole?: string | null
  objectType?: string | null
  objectId?: string | null
  requestNumber?: string | null
  before?: string | null
  after?: string | null
  message?: string
  at?: string
}

const TITLES: Partial<Record<TabKey, string>> = {
  'own-requests': 'Заявки 1С',
  'own-atisu': 'ATI.SU',
  'own-occupancy': 'Занятость',
  'own-planning': 'Планирование',
  'own-monitor': 'Мониторинг',
  'own-directory': 'Справочники парка',
  'own-audit': 'Аудит контура',
}

const ALERT_ICONS: Record<Alert['kind'], ReactNode> = {
  trip_ack: <UserX className="h-3.5 w-3.5" />,
  leg_docs: <Camera className="h-3.5 w-3.5" />,
  leg_docs_lost: <CameraOff className="h-3.5 w-3.5" />,
  outbox_stale: <Clock3 className="h-3.5 w-3.5" />,
  outbox_failed: <CircleAlert className="h-3.5 w-3.5" />,
  device_skew: <Timer className="h-3.5 w-3.5" />,
  device_legacy: <Smartphone className="h-3.5 w-3.5" />,
  new_orders: <Inbox className="h-3.5 w-3.5" />,
}

function AlertButton({ a, onGo }: { a: Alert; onGo: (a: Alert) => void }) {
  const iconColor = a.level === 'red' ? 'text-red-600' : a.level === 'amber' ? 'text-amber-600' : 'text-slate-400'
  return (
    <button
      type="button"
      onClick={() => onGo(a)}
      title={`Перейти к проблеме: ${a.text}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
    >
      <span className={`shrink-0 ${iconColor}`} aria-hidden>{ALERT_ICONS[a.kind] ?? <CircleAlert className="h-3.5 w-3.5" />}</span>
      {a.text}
      <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden />
    </button>
  )
}

/** Сквозной журнал платформы и диспетчерской — только для администрации. */
function ContourAuditPanel() {
  const [entries, setEntries] = useState<ContourAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [contour, setContour] = useState<'all' | 'platform' | 'dispatcher'>('all')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const sp = new URLSearchParams({ contour, limit: '300' })
      if (query.trim()) sp.set('q', query.trim())
      const res = await authFetch(`/api/contour-audit?${sp.toString()}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      setEntries(Array.isArray(json?.entries) ? json.entries : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Журнал недоступен')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [contour, query])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Источник журнала">
          {([['all', 'Оба контура'], ['platform', 'Платформа'], ['dispatcher', 'Собственный транспорт']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={contour === value}
              onClick={() => setContour(value)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${contour === value ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void load() }}
            placeholder="Действие, человек, объект…"
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <Button variant="outline" size="sm" className="h-9" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Обновить
        </Button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-40">Время</TableHead>
              <TableHead className="w-32">Контур</TableHead>
              <TableHead className="w-44">Кто</TableHead>
              <TableHead className="w-44">Действие</TableHead>
              <TableHead>Объект / сообщение</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e, i) => (
              <TableRow key={`${e.at ?? ''}-${i}`}>
                <TableCell className="whitespace-nowrap text-xs text-slate-500">
                  {e.at ? new Date(e.at).toLocaleString('ru-RU') : '—'}
                </TableCell>
                <TableCell className="text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${e.contour === 'platform' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {e.contour === 'platform' ? 'Платформа' : 'Собственный транспорт'}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  {[e.actorName, e.actorRole].filter(Boolean).join(' · ') || e.actorLogin || 'система'}
                </TableCell>
                <TableCell className="font-mono text-[11px] text-slate-600">{e.action}</TableCell>
                <TableCell className="text-xs text-slate-700">
                  {e.message || [e.objectType, e.objectId, e.after].filter(Boolean).join(' · ') || '—'}
                </TableCell>
              </TableRow>
            ))}
            {!loading && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-400">Записей нет</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-slate-500">Показаны последние {entries.length} записей. Журнал общий для платформы и диспетчерской.</div>
    </div>
  )
}

export function KonturWorkspace({ tab, onNavigate, liveTick }: {
  tab: TabKey
  onNavigate: (t: TabKey) => void
  liveTick: number
}) {
  const can = useCan()
  const { toast } = useToast()
  const [state, setState] = useState<StateResponse | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [focusTrip, setFocusTrip] = useState<{ id: string; ts: number } | null>(null)
  const [focusDevice, setFocusDevice] = useState<{ id: string; ts: number } | null>(null)
  const [atisuSub, setAtisuSub] = useState<'search' | 'deals'>('search')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch('/api/state')
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      }
      setState(await res.json())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Данные диспетчерской недоступны')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, reloadKey, liveTick])
  useEffect(() => {
    const t = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(t)
  }, [refresh])

  const onChanged = useCallback(() => setReloadKey((k) => k + 1), [])

  function openAlert(a: Alert) {
    if ((a.kind === 'trip_ack' || a.kind === 'leg_docs' || a.kind === 'leg_docs_lost') && a.tripId) {
      onNavigate('own-requests')
      setFocusTrip({ id: a.tripId, ts: Date.now() })
      return
    }
    if ((a.kind === 'device_skew' || a.kind === 'device_legacy') && a.deviceId) {
      onNavigate('own-monitor')
      setFocusDevice({ id: a.deviceId, ts: Date.now() })
      return
    }
    if (a.kind === 'outbox_stale' || a.kind === 'outbox_failed') {
      onNavigate('own-monitor')
      return
    }
    if (a.kind === 'new_orders') onNavigate('own-requests')
  }

  function openAtiDeals() {
    setAtisuSub('deals')
    onNavigate('own-atisu')
  }
  function openTripAnywhere(tripId: string) {
    onNavigate('own-requests')
    setFocusTrip({ id: tripId, ts: Date.now() })
  }
  function findOrder(number: string) {
    setQuery(number)
    onNavigate('own-requests')
  }

  const newOrders = state?.orders.filter((o) => o.status === 'new').length ?? 0
  const ackPending = state?.trips.filter((t) => t.ackStatus === 'pending' && t.status === 'active').length ?? 0
  const docsPending = state?.trips.reduce((n, t) => n + t.legs.filter((l) => l.docsPending).length, 0) ?? 0
  const docsLost = state?.trips.reduce((n, t) => n + t.legs.filter((l) => l.docsLost).length, 0) ?? 0
  const attentionTotal = newOrders + ackPending + docsPending + docsLost
  const showRequestAttention = can('section:ownRequests')

  // Алерты фильтруются правами: мониторинг — только тем, кто видит мониторинг,
  // очередь 1С — администрации, остальное — тем, кто работает с заявками.
  const alerts = (state?.alerts ?? []).filter((a) => {
    if (a.kind === 'outbox_stale' || a.kind === 'outbox_failed') return can('section:ownAudit')
    if (a.kind === 'device_skew' || a.kind === 'device_legacy') return can('section:ownMonitor')
    return can('section:ownRequests')
  })

  const title = TITLES[tab] ?? 'Собственный транспорт'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Собственный транспорт</div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />Обновить
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {state && showRequestAttention && attentionTotal > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Требует внимания:</span>
          {newOrders > 0 && (
            <button type="button" onClick={() => onNavigate('own-requests')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50">
              <Inbox className="h-3 w-3 text-blue-600" />новые заявки — <b>{newOrders}</b>
            </button>
          )}
          {ackPending > 0 && (
            <button type="button" onClick={() => onNavigate('own-requests')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50">
              <UserX className="h-3 w-3 text-amber-600" />не подтверждено — <b>{ackPending}</b>
            </button>
          )}
          {docsPending > 0 && (
            <button type="button" onClick={() => onNavigate('own-requests')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50">
              <Camera className="h-3 w-3 text-blue-600" />фото ожидается — <b>{docsPending}</b>
            </button>
          )}
          {docsLost > 0 && (
            <button type="button" onClick={() => onNavigate('own-requests')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50">
              <CameraOff className="h-3 w-3 text-red-600" />фото утрачено — <b>{docsLost}</b>
            </button>
          )}
        </div>
      )}

      {state && alerts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {alerts.slice(0, 8).map((a, i) => (
            <AlertButton key={`${a.kind}-${i}-${a.tripId ?? a.deviceId ?? ''}`} a={a} onGo={openAlert} />
          ))}
        </div>
      )}

      {tab === 'own-requests' && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск водителя, ТС, маршрута…"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            {can('admin:db') && (
              <Button variant="outline" size="sm" className="h-9" onClick={async () => {
                try {
                  const res = await authFetch('/api/demo/reset', { method: 'POST' })
                  if (!res.ok) throw new Error(`HTTP ${res.status}`)
                  toast({ title: 'Демо-данные пересозданы' })
                  onChanged()
                } catch (e) {
                  toast({ title: 'Не удалось пересоздать демо-данные', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
                }
              }}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />Пересоздать демо-данные
              </Button>
            )}
          </div>
        </div>
      )}

      {!state ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-10 text-slate-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" aria-hidden />
          Загрузка данных собственного транспорта…
        </div>
      ) : (
        <>
          {tab === 'own-requests' && (
            <RequestsPanel
              state={state}
              onChanged={onChanged}
              query={query}
              focusTrip={focusTrip}
              onFocusTripConsumed={() => setFocusTrip(null)}
            />
          )}
          {tab === 'own-atisu' && (
            <AtiSuPanel state={state} initialSub={atisuSub} onChanged={onChanged} onOpenTrip={openTripAnywhere} />
          )}
          {tab === 'own-occupancy' && (
            <OccupancyPanel state={state} onChanged={onChanged} onOpenTrip={openTripAnywhere} onOpenAtiDeals={openAtiDeals} />
          )}
          {tab === 'own-planning' && (
            <PlanningPanel state={state} onChanged={onChanged} onOpenTrip={openTripAnywhere} onOpenAtiDeals={openAtiDeals} onFindOrder={findOrder} />
          )}
          {tab === 'own-monitor' && (
            <MonitoringPanel
              state={state}
              onChanged={onChanged}
              focusDevice={focusDevice}
              onFocusDeviceConsumed={() => setFocusDevice(null)}
              onOpenTrip={openTripAnywhere}
              onOpenRequests={() => onNavigate('own-requests')}
            />
          )}
          {tab === 'own-directory' && <DirectoriesPanel state={state} onChanged={onChanged} />}
          {tab === 'own-audit' && <ContourAuditPanel />}
        </>
      )}
    </div>
  )
}

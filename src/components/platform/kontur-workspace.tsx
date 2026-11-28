'use client'

/**
 * Рабочее пространство собственного транспорта внутри единой оболочки «АЭМЗ Поток».
 *
 * Раньше диспетчерская была отдельным кабинетом /kontur со своей шапкой и входом.
 * Теперь её разделы — нижний уровень навигации платформы: «Заявки 1С», ATI.SU,
 * «Планирование» (доска «Сейчас» + график «Гант»), «Мониторинг» и «Аудит контура».
 * Данные по-прежнему отдаёт /kontur/api/state: один источник для всех панелей.
 * Справочники парка живут в единых «Справочниках» платформы (контур «Собственный
 * парк»), занятость — вид «Сейчас» раздела «Планирование».
 *
 * Видимость и действия ограничены правами section:* и own:*: панели не показывают
 * чужие разделы, а API диспетчерской дублирует проверку на сервере.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight, Camera, CameraOff, CircleAlert, Clock3, Inbox, RefreshCw, RotateCcw, Search, Smartphone, Timer, UserX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/components/platform/perms'
import { AttentionChip, Pill, SectionHeader, useLiveTab, type TabKey } from '@/components/platform/common'
import type { Alert, StateResponse } from '@/lib/kontur/client-types'
import { authFetch } from '@/lib/kontur/session-token'
import { RequestsPanel } from '@/components/kontur/proto/RequestsPanel'
import { AtiSuPanel } from '@/components/kontur/proto/AtiSuPanel'
import { MonitoringPanel } from '@/components/kontur/proto/MonitoringPanel'
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
  'own-planning': 'Планирование',
  'own-monitor': 'Мониторинг',
  'own-audit': 'Аудит контура',
}

// Описания разделов — под значком «i» заголовка (постоянных надписей в интерфейсе нет)
const TITLES_DESC: Partial<Record<TabKey, string>> = {
  'own-requests': 'Заявки приходят из 1С автоматически (документ «Заказы грузоотправителей»). Логист ведёт заявку до рейса: проверка → состав из собственного парка → карточка рейса.',
  'own-planning': 'Единая доска работы парка в двух видах: «Сейчас» — кто чем занят в моменте, «График» — план во времени. Один поиск, одни фильтры и одна очередь планирования на оба вида.',
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
  // значок без покраски — единый вид ленты внимания, как в «Площадке заявок»
  return (
    <AttentionChip
      icon={ALERT_ICONS[a.kind] ?? <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      label={a.text}
      trailing={<ArrowRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />}
      onClick={() => onGo(a)}
      title={`Перейти к проблеме: ${a.text}`}
    />
  )
}

/** Сквозной журнал платформы и диспетчерской — только для администрации. */
function ContourAuditPanel({ liveTick }: { liveTick: number }) {
  const [entries, setEntries] = useState<ContourAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [contour, setContour] = useState<'all' | 'platform' | 'dispatcher'>('all')
  const [error, setError] = useState('')
  // живой журнал: после первой загрузки обновления идут тихо — спиннер не мигает,
  // прежние строки остаются на месте, пока летит новый ответ
  const hasDataRef = useRef(false)

  const load = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true)
    setError('')
    try {
      const sp = new URLSearchParams({ contour, limit: '300' })
      if (query.trim()) sp.set('q', query.trim())
      const res = await authFetch(`/api/contour-audit?${sp.toString()}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      setEntries(Array.isArray(json?.entries) ? json.entries : [])
      hasDataRef.current = true
    } catch (e) {
      // тихое обновление не сносит таблицу: строки остаются, ошибка — строкой выше
      setError(e instanceof Error ? e.message : 'Журнал недоступен')
    } finally {
      setLoading(false)
    }
  }, [contour, query])

  useEffect(() => { void load() }, [load])
  // постоянное тихое автообновление: общий «пульс» платформы (события WS + page.tsx)
  // и страховочный интервал — окно журнала всегда живое, без кнопки «Обновить»
  useLiveTab(load, liveTick)

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
                  <Pill className={e.contour === 'platform' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}>
                    {e.contour === 'platform' ? 'Платформа' : 'Собственный транспорт'}
                  </Pill>
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
    </div>
  )
}

export function KonturWorkspace({ tab, onNavigate, liveTick, navFilters }: {
  tab: TabKey
  onNavigate: (t: TabKey) => void
  liveTick: number
  /** цель навигации от нейросети: filters.q — поиск заявок 1С; own-atisu — фильтры биржи */
  navFilters?: { tab: TabKey; filters: Record<string, string>; ts: number } | null
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
  // переход от нейросети с фильтрами (ai-links → filters): own-requests — поиск q,
  // own-atisu — фильтры витрины грузов (применяет AtiSuMarketPanel по ts)
  useEffect(() => {
    if (!navFilters || navFilters.tab !== 'own-requests') return
    const nextQ = navFilters.filters.q?.trim()
    if (nextQ && nextQ !== query) setQuery(nextQ)
  }, [navFilters])
  const atisuFilters =
    navFilters && navFilters.tab === 'own-atisu' ? { filters: navFilters.filters, ts: navFilters.ts } : null

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

  // общая картинка собственного транспорта постоянно живая: события шины WS и общий
  // «пульс» платформы (page.tsx, каждые 15 с) перечитывают /api/state — единый
  // источник данных для всех панелей. Свой интервал больше не нужен: один такт
  useEffect(() => { void refresh() }, [refresh, reloadKey, liveTick])

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
      {/* шапка — общий SectionHeader платформы: надзаголовок контура тем же
          словарём, что и привлечённый транспорт (синий) и ИИ (янтарный) */}
      <SectionHeader eyebrow="Собственный транспорт" tone="emerald" title={title} desc={TITLES_DESC[tab]}>
        <Button variant="outline" size="sm" className="h-9" onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />Обновить
        </Button>
      </SectionHeader>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {state && showRequestAttention && attentionTotal > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 border-y border-slate-200 py-2.5"
          role="status"
          aria-label="Требует внимания"
        >
          <span className="mr-1 text-xs font-medium text-amber-700">Требует внимания:</span>
          {newOrders > 0 && (
            <AttentionChip icon={<Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden />} label="новые заявки" count={newOrders} onClick={() => onNavigate('own-requests')} />
          )}
          {ackPending > 0 && (
            <AttentionChip icon={<UserX className="h-3.5 w-3.5 shrink-0" aria-hidden />} label="не подтверждено" count={ackPending} onClick={() => onNavigate('own-requests')} />
          )}
          {docsPending > 0 && (
            <AttentionChip icon={<Camera className="h-3.5 w-3.5 shrink-0" aria-hidden />} label="фото ожидается" count={docsPending} onClick={() => onNavigate('own-requests')} />
          )}
          {docsLost > 0 && (
            <AttentionChip icon={<CameraOff className="h-3.5 w-3.5 shrink-0" aria-hidden />} label="фото утрачено" count={docsLost} onClick={() => onNavigate('own-requests')} />
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
            <AtiSuPanel state={state} initialSub={atisuSub} onChanged={onChanged} onOpenTrip={openTripAnywhere} onOpenAi={() => onNavigate('ai')} marketFilters={atisuFilters} />
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
          {tab === 'own-audit' && <ContourAuditPanel liveTick={liveTick} />}
        </>
      )}
    </div>
  )
}

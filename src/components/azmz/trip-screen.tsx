'use client'

/**
 * Шторка «Рейс» — дашборд Z-1067 (мокап 5): карта остаётся фоном сверху,
 * прогресс «Погрузка → Сейчас → Разгрузка», большая карточка этапа
 * (stageLabel из TripEventRules), 2×2 плитки, чёрная кнопка «Отметить событие»
 * (работает без сети), таймлайн событий с интервалами.
 * ETA учитывает задержку из-за пробок (канал 3).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  Clock,
  Coffee,
  Flag,
  MapPin,
  MessageSquare,
  PackageCheck,
  Play,
  Truck,
  Warehouse,
} from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { stageLabel, trafficScoreColor, trafficScoreTitle } from '@/lib/rules'
import { fmtClock, fmtDuration, fmtKm, timeAgo } from '@/lib/format'
import { EventTimeline } from '@/components/azmz/event-timeline'

function iconFor(type: string, cls = 'h-4 w-4'): React.ReactNode {
  switch (type) {
    case 'DEPARTURE':
      return <Truck className={cls} />
    case 'ARRIVAL_LOADING':
      return <Warehouse className={cls} />
    case 'LOADING_DONE':
      return <PackageCheck className={cls} />
    case 'REST_START':
      return <Coffee className={cls} />
    case 'REST_END':
      return <Play className={cls} />
    case 'ARRIVAL_UNLOADING':
      return <MapPin className={cls} />
    case 'UNLOADING_DONE':
      return <PackageCheck className={cls} />
    case 'TRIP_DONE':
      return <Flag className={cls} />
    default:
      return <Clock className={cls} />
  }
}

export function TripScreen() {
  const trip = useAzmz((s) => s.trip)
  const events = useAzmz((s) => s.events)
  const points = useAzmz((s) => s.points)
  const outbox = useAzmz((s) => s.outbox)
  const traffic = useAzmz((s) => s.traffic)
  const setView = useAzmz((s) => s.setView)
  const setEventDialog = useAzmz((s) => s.setEventDialog)
  const simF = useAzmz((s) => s.simProgressF)
  const [, forceTick] = useState(0)

  // обновление «В движении …» раз в 30 с
  useEffect(() => {
    const t = setInterval(() => forceTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const sorted = useMemo(() => [...events].sort((a, b) => a.occurredAt - b.occurredAt), [events])
  const pendingEventIds = useMemo(
    () => new Set(outbox.filter((o) => o.type === 'TRIP_EVENT_CREATE').map((o) => (o.payload as { id: string }).id)),
    [outbox],
  )
  const unloading = points.find((p) => p.kind === 'unloading')
  const loading = points.find((p) => p.kind === 'loading')

  // прогресс: от выезда до планового прибытия (хуки — до раннего выхода)
  const progressT = useMemo(() => {
    const arrTimes = sorted.filter((e) => e.type === 'ARRIVAL_LOADING' || e.type === 'ARRIVAL_UNLOADING')
    const tLoad =
      arrTimes.find((e) => e.type === 'ARRIVAL_LOADING')?.occurredAt ?? trip?.plannedStartAt ?? Date.now()
    const tUn = unloading?.plannedArrivalAt ?? trip?.plannedFinishAt ?? Date.now()
    const now = Date.now()
    const pct = Math.max(6, Math.min(96, ((now - tLoad) / Math.max(1, tUn - tLoad)) * 100))
    return { pct, tLoad, tUn }
  }, [sorted, trip, unloading])

  if (!trip) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#64748B] text-sm px-6 text-center">
        Рейс загружается из журнала синхронизации…
      </div>
    )
  }

  const stage = stageLabel(trip.lastEventType)
  const lastEventAt = trip.lastEventAt ?? Date.now()
  const stageMs = Date.now() - lastEventAt
  const remainingM = (trip.routeDistanceM ?? 200_000) * (1 - simF)
  const passedM = (trip.routeDistanceM ?? 200_000) * simF
  const delayMin = traffic?.routeDelayMin ?? 0
  const arrivalMs = (unloading?.plannedArrivalAt ?? trip.plannedFinishAt ?? Date.now()) + delayMin * 60_000

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* шапка */}
      <div className="bg-[#101E2E] px-4 pt-2 pb-4 shrink-0 rounded-t-3xl">
        <div className="flex items-center gap-2">
          <button onClick={() => setView('map')} aria-label="Назад" className="text-white/70 hover:text-white">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <div className="text-white font-bold text-[17px] leading-tight">Рейс {trip.tripCode}</div>
            <div className="text-[11px] text-white/50">
              {loading?.address?.split(',')[0] ?? 'Абинск'} → {unloading?.address ?? 'Новороссийск'}
            </div>
          </div>
          <span className="bg-[#F97316] text-white text-[11px] font-bold rounded-full px-2.5 py-1">В пути</span>
        </div>

        {/* прогресс-рельс */}
        <div className="mt-4 px-2">
          <div className="relative h-1.5 bg-white/10 rounded-full">
            <div className="absolute left-0 top-0 bottom-0 bg-[#F97316] rounded-full" style={{ width: `${progressT.pct}%` }} />
            <div
              className="absolute -top-[9px] text-white"
              style={{ left: `calc(${progressT.pct}% - 12px)` }}
            >
              <div className="h-7 w-7 rounded-full bg-[#F97316] border-2 border-white flex items-center justify-center shadow-lg">
                <Truck className="h-3.5 w-3.5" />
              </div>
              <div className="text-[10px] text-white/80 text-center mt-0.5 font-medium">Сейчас</div>
            </div>
          </div>
          <div className="flex justify-between mt-1 text-[11px]">
            <div className="flex items-center gap-1 text-white/85">
              <span className="text-[#22C55E]">✓</span>
              Погрузка <span className="text-white/45 tabular-nums">{fmtClock(progressT.tLoad)}</span>
            </div>
            <div className="flex items-center gap-1 text-white/85">
              Разгрузка <span className="text-white/45 tabular-nums">{fmtClock(unloading?.plannedArrivalAt ?? trip.plannedFinishAt)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* плашка пробок на маршруте */}
        {traffic && (
          <button
            onClick={() => setView('traffic')}
            className="w-full flex items-center gap-3 bg-[#16283D] border border-white/10 rounded-2xl px-4 py-3 text-left"
          >
            <div className="flex items-center gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="h-6 w-1.5 rounded-full"
                  style={{ background: i < Math.ceil((traffic.score / 10) * 4) ? trafficScoreColor(traffic.score) : 'rgba(255,255,255,0.12)' }}
                />
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-[14px] font-semibold">
                Пробки: {traffic.score} из 10 · {trafficScoreTitle(traffic.score)}
              </div>
              <div className="text-white/50 text-[11px]">{traffic.contributors} ТС парка · обновлено {timeAgo(traffic.snapshotAt)}</div>
            </div>
            {delayMin > 0 && (
              <span className="text-[#FACC15] text-[15px] font-bold tabular-nums shrink-0">+{delayMin} мин</span>
            )}
          </button>
        )}

        {/* герой-карточка */}
        <div className="bg-gradient-to-br from-[#16283D] to-[#101E2E] border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-[#F97316]/15 border border-[#F97316]/40 flex items-center justify-center text-[#F97316]">
              {iconFor(trip.lastEventType ?? 'DEPARTURE', 'h-5 w-5')}
            </div>
            <div>
              <div className="text-white/70 text-[12px]">{stage}</div>
              <div className="text-white font-bold text-[22px] leading-tight tabular-nums">{fmtDuration(stageMs)}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-white/45 text-[11px]">до выгрузки</div>
              <div className="text-white font-bold text-lg tabular-nums">{fmtKm(remainingM)}</div>
            </div>
          </div>
        </div>

        {/* плитки 2×2 */}
        <div className="grid grid-cols-2 gap-3">
          <Tile title="Осталось" value={fmtKm(remainingM)} />
          <Tile title="Прибытие" value={fmtClock(arrivalMs)} hint={delayMin > 0 ? `пробки +${delayMin} мин` : undefined} />
          <Tile title="Пройдено" value={fmtKm(passedM)} />
          <Tile title="Отдых по тахографу" value="3 ч 15 мин" hint="за сутки" />
        </div>

        {/* кнопка события */}
        <button
          onClick={() => setEventDialog(true)}
          className="w-full py-3.5 rounded-xl bg-[#15202B] border border-white/15 text-white font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
        >
          <MapPin className="h-5 w-5 text-[#F97316]" />
          Отметить событие
        </button>

        {/* таймлайн */}
        <div>
          <div className="text-white/60 text-[12px] font-semibold uppercase tracking-wide mb-2">Таймлайн рейса</div>
          <EventTimeline events={sorted} pendingIds={pendingEventIds} />
        </div>

        <button
          onClick={() => setView('chat')}
          className="w-full h-11 rounded-xl bg-white/5 border border-white/10 text-white text-[14px] font-semibold flex items-center justify-center gap-2 mb-2"
        >
          <MessageSquare className="h-4 w-4 text-[#F97316]" />
          Написать в офис
        </button>
      </div>
    </div>
  )
}

function Tile({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="bg-[#16283D] border border-white/10 rounded-2xl px-3.5 py-3">
      <div className="text-white/45 text-[11px]">{title}</div>
      <div className="text-white font-bold text-[17px] mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-white/30 text-[10px]">{hint}</div>}
    </div>
  )
}

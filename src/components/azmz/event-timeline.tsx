'use client'

/**
 * Таймлайн событий рейса — аналог EventTimeline.kt: точечные события,
 * интервалы (длительность на «открывашке»), ручные отметки с бейджами,
 * события в очереди outbox помечаются часами.
 */

import { useState } from 'react'
import { ChevronDown, Clock } from 'lucide-react'
import { fmtClock, fmtDuration } from '@/lib/format'
import type { TripEventSnapshot } from '@/lib/protocol'

function typeTitle(code: string): string {
  const titles: Record<string, string> = {
    DEPARTURE: 'Выезд',
    ARRIVAL_LOADING: 'Прибытие на погрузку',
    LOADING_DONE: 'Погрузка завершена',
    REST_START: 'Стоянка по тахографу',
    REST_END: 'Стоянка завершена',
    ARRIVAL_UNLOADING: 'Прибытие на выгрузку',
    UNLOADING_DONE: 'Выгрузка завершена',
    TRIP_DONE: 'Рейс завершён',
  }
  return titles[code] ?? code
}

function intervalIcon(type: string, cls: string): React.ReactNode {
  // иконки по типам — единая карта с экраном рейса
  const map: Record<string, React.ReactNode> = {
    DEPARTURE: <TIcon d="M5 17h14M7 11h10M6 11V7a2 2 0 0 1 2-2h5l4 4v2" />,
    ARRIVAL_LOADING: <TIcon d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h6v8H9z" />,
    LOADING_DONE: <TIcon d="M20 6 9 17l-5-5" />,
    REST_START: <TIcon d="M17 8h1M4 8h9a4 4 0 1 1-9 0ZM6 12v9M16 12v9M17 8c0-2-1-3-2-3" />,
    REST_END: <TIcon d="m5 4 10 8-10 8V4ZM17 4v16" />,
    ARRIVAL_UNLOADING: <TIcon d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
    UNLOADING_DONE: <TIcon d="M20 6 9 17l-5-5" />,
    TRIP_DONE: <TIcon d="M4 22V4s1.5-1.5 4-1.5S12 4 12 4v9s1.5-1.5 4-1.5S20 13 20 13v9" />,
  }
  return map[type] ?? <TIcon d="M12 8v4l3 3" />
}

function TIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export function EventTimeline({
  events,
  pendingIds,
}: {
  events: TripEventSnapshot[]
  pendingIds: Set<string>
}) {
  return (
    <div className="bg-[#16283D] border border-white/10 rounded-2xl px-4 py-3">
      {events.map((e, i) => (
        <TimelineRow key={e.id} e={e} last={i === events.length - 1} pending={pendingIds.has(e.id)} />
      ))}
      {events.length === 0 && <div className="text-white/40 text-[13px] py-3">Событий пока нет</div>}
    </div>
  )
}

function TimelineRow({ e, last, pending }: { e: TripEventSnapshot; last: boolean; pending: boolean }) {
  const [open, setOpen] = useState(false)
  const manual = e.source !== 'GEOFENCE'
  const backdated = e.source === 'MANUAL_BACKDATED'
  const intervalMs = e.intervalClosedAt ? e.intervalClosedAt - e.occurredAt : null
  const isOpenInterval = !e.intervalClosedAt && ['ARRIVAL_LOADING', 'REST_START', 'ARRIVAL_UNLOADING'].includes(e.type)

  const detail = (
    <div className="text-[11px] text-white/45 mt-1 space-y-0.5">
      <div>время: {fmtClock(e.occurredAt)} · источник: {e.source === 'GEOFENCE' ? 'геозона' : manual ? 'вручную' : '—'}</div>
      {e.intervalClosedAt && (
        <div>
          интервал: {fmtClock(e.occurredAt)} – {fmtClock(e.intervalClosedAt)}
          {e.intervalAutoClosed ? ' · закрыт автоматически' : ''}
        </div>
      )}
      {e.note && <div>заметка: {e.note}</div>}
      {e.editedAt && <div>правка офиса: {fmtClock(e.editedAt)}</div>}
    </div>
  )

  return (
    <div className={`flex gap-3 ${!last ? 'pb-3' : ''}`}>
      {/* узел */}
      <div className="flex flex-col items-center pt-1">
        <div
          className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
            manual ? 'bg-[#F97316]/15 text-[#F97316] border border-[#F97316]/40' : 'bg-white/5 text-white/70 border border-white/10'
          } ${isOpenInterval ? 'animate-pulse' : ''}`}
        >
          {intervalIcon(e.type, 'h-4 w-4')}
        </div>
        {!last && <div className="flex-1 w-px bg-white/10 my-1" />}
      </div>

      {/* содержимое */}
      <div className="flex-1 min-w-0 pb-1">
        <button onClick={() => setOpen((v) => !v)} className="w-full text-left flex items-baseline gap-2">
          <span className="text-white text-[14px] font-medium">{typeTitle(e.type)}</span>
          {intervalMs != null && <span className="text-[#FACC15] text-[12px] font-semibold tabular-nums">{fmtDuration(intervalMs)}</span>}
          {isOpenInterval && <span className="text-[#FACC15] text-[12px] font-semibold">идёт…</span>}
          {backdated && <span className="text-[10px] bg-[#FACC15]/15 text-[#FACC15] rounded-full px-1.5 py-0.5 font-semibold">вручную</span>}
          {manual && !backdated && <span className="text-[10px] bg-[#F97316]/15 text-[#F97316] rounded-full px-1.5 py-0.5 font-semibold">вручную</span>}
          {pending && <Clock className="h-3.5 w-3.5 text-white/50 inline" />}
          <ChevronDown className={`h-3.5 w-3.5 text-white/30 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <div className="text-[12px] text-white/50 tabular-nums">
          {fmtClock(e.occurredAt)}
          {intervalMs != null && ` · ${fmtClock(e.occurredAt)}–${fmtClock(e.intervalClosedAt)}`}
        </div>
        {open && detail}
      </div>
    </div>
  )
}

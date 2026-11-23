'use client'

import { Card, CardContent } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { TRIP_STATUS_LABELS, ACK_LABELS, STATUS_LABELS } from '@/lib/kontur/constants'
import type { StateResponse, Trip } from '@/lib/kontur/client-types'
import { fmtTime } from '@/lib/kontur/client-types'
import { StatusChip, DotWord, Pill } from './bits'
import { AlertTriangle, Camera, CameraOff, Clock, FileWarning, ScrollText, UserCheck, UserX, Truck, Waypoints } from 'lucide-react'

export function Board({ state, onOpenTrip, query = '' }: { state: StateResponse; onOpenTrip: (tripId: string) => void; query?: string }) {
  const q = query.trim().toLowerCase()
  const trips = [...state.trips]
    .sort((a, b) => {
      const order: Record<string, number> = { active: 0, draft: 1, completed: 2, cancelled: 3 }
      return (order[a.status] ?? 9) - (order[b.status] ?? 9)
    })
    .filter((t) => {
      if (!q) return true
      const hay = [
        t.driver?.fullName, t.vehicle?.brand, t.vehicle?.plate, t.trailer?.plate,
        TRIP_STATUS_LABELS[t.status],
        ...t.legs.flatMap((l) => [l.loadPoint, l.unloadPoint, STATUS_LABELS[l.status]]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} onOpen={() => onOpenTrip(trip.id)} />
        ))}
        {trips.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center font-medium text-slate-700">
            По запросу ничего не найдено
          </div>
        )}
      </div>
      <EventJournal state={state} />
    </div>
  )
}

function TripCard({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const ackPending = trip.ackStatus === 'pending'
  const needsReview = trip.legs.some((l) => l.statusSource === 'logist')
  return (
    <Card className={`rounded-xl border-slate-200 shadow-sm transition-shadow hover:shadow-md ${trip.status === 'active' ? '' : 'opacity-80'}`}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Truck className="h-4 w-4 text-slate-500" />
              Рейс {trip.id.slice(0, 8)}
            </div>
            <div className="text-sm text-slate-600">
              {trip.driver?.fullName} · {trip.vehicle?.brand} ({trip.vehicle?.plate})
              {trip.trailer ? ` · ${trip.trailer.plate}` : ''}
            </div>
          </div>
          <DotWord
            dot={trip.status === 'active' ? 'bg-emerald-500' : trip.status === 'completed' ? 'bg-emerald-600' : trip.status === 'cancelled' ? 'bg-red-500' : 'bg-slate-400'}
            tone={trip.status === 'cancelled' ? 'danger' : undefined}
          >
            {TRIP_STATUS_LABELS[trip.status]}
          </DotWord>
        </div>
        <div className="space-y-2">
          {trip.legs.map((leg) => (
            <div key={leg.id} className="space-y-1.5 rounded-md border border-slate-200 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-xs text-slate-600">
                  Плечо {leg.seq} ({leg.type === 'main' ? 'основное' : leg.type === 'return' ? 'обратное' : 'порожний возврат'}): {leg.loadPoint} → {leg.unloadPoint}
                </div>
                <StatusChip status={leg.status} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {leg.statusSource === 'logist' && (
                  <Pill className="bg-violet-100 text-violet-700"><Clock className="h-3 w-3" />барьер корректировки</Pill>
                )}
                {leg.docsPending && (
                  <Pill className="bg-amber-100 text-amber-700"><Camera className="h-3 w-3" />документы не доставлены</Pill>
                )}
                {leg.docsLost && (
                  <Pill className="bg-red-100 text-red-700"><CameraOff className="h-3 w-3" />документ утрачен</Pill>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {ackPending ? (
              <Pill className="bg-amber-100 text-amber-700"><UserX className="h-3 w-3" />{ACK_LABELS.pending}</Pill>
            ) : (
              <Pill className="bg-emerald-100 text-emerald-700"><UserCheck className="h-3 w-3" />{ACK_LABELS[trip.ackStatus]}</Pill>
            )}
            {trip.legs.some((l) => l.docsLost) && (
              <Pill className="bg-red-100 text-red-700"><FileWarning className="h-3 w-3" />фото утрачено</Pill>
            )}
          </div>
          <Button size="sm" className="bg-[#0E1B2C] text-white hover:bg-[#16304f]" onClick={onOpen}>Карточка рейса</Button>
        </div>
        <div className="text-[11px] text-slate-400">
          создан {fmtTime(trip.createdAt)} · версия {trip.version}
        </div>
      </CardContent>
    </Card>
  )
}

/** Журнал событий главной: живые данные (needs_review, outbox, алерты) в стиле референса. */
function EventJournal({ state }: { state: StateResponse }) {
  type Item = { text: string; ts: string }
  const items: Item[] = []
  for (const a of state.alerts) items.push({ text: a.text, ts: '' })
  for (const ev of state.needsReview.slice(0, 6)) {
    const route = ev.leg ? ` (${ev.leg.loadPoint} → ${ev.leg.unloadPoint})` : ''
    items.push({ text: `Событие требует разбора: ${STATUS_LABELS[ev.status] ?? ev.status}${route}`, ts: ev.serverTs })
  }
  for (const o of state.outbox.slice(0, 6)) {
    const stateRu = o.state === 'acked' ? 'подтверждено 1С' : o.state === 'stale' ? 'нет ack (stale)' : o.state === 'failed_delivery' ? 'доставка не удалась' : 'в очереди'
    items.push({ text: `Outbox: ${o.eventType} — ${stateRu}`, ts: o.firstSeenAt })
  }
  const sorted = [...items].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 10)
  if (sorted.length === 0) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <ScrollText className="h-4 w-4 text-slate-400" />Журнал событий
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
        {sorted.map((it, i) => (
          <div key={i} className="flex items-start justify-between gap-4 text-xs">
            <div className="flex items-start gap-2 text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
              <span>{it.text}</span>
            </div>
            {it.ts && <span className="shrink-0 text-slate-400">{fmtTime(it.ts)}</span>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
        <AlertTriangle className="h-3 w-3" />источники: алерты правил B5/B7, разбор needs_review, outbox → 1С (B6.3)
        <Waypoints className="ml-1 h-3 w-3" />
      </div>
    </div>
  )
}

'use client'

// Реестр рейсов в виде списка документов «Рейсы» (стиль списка 1С)

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { C1Button, C1ToolButton, FormTitleBar } from '@/components/1c/kit'
import { apiPost, fmtDateTime, fmtInterval } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { CheckCircle2, MapPin } from 'lucide-react'

type TripRow = {
  number: string
  status: string
  contractor: { name: string }
  cargo: string
  weightT: number
  from: { name: string }
  to: { name: string }
  vehicle: { model: string; plate: string } | null
  trailer: { model: string; plate: string } | null
  driver: { fullName: string } | null
  trip: {
    routeDistanceM: number | null
    routeDurationS: number | null
    lastEventType: string | null
    lastEventAt: string | null
    points: { seqNo: number; kind: string; name: string | null }[]
    events: { id: string; type: string; occurredAt: string; source: string; intervalClosedAt: string | null }[]
  } | null
  pretrip: { done: number; total: number; steps: { stepId: string; at: string; photoUrl: string | null }[] }
  lastEventLabel: string | null
  openIntervals: { id: string; type: string; occurredAt: string }[]
}

const EVENT_RU: Record<string, string> = {
  DEPARTURE: 'выезд',
  ARRIVAL_LOADING: 'прибытие на погрузку',
  LOADING_DONE: 'погрузка завершена',
  REST_START: 'стоянка',
  REST_END: 'окончание стоянки',
  ARRIVAL_UNLOADING: 'прибытие на выгрузку',
  UNLOADING_DONE: 'выгрузка завершена',
  TRIP_DONE: 'рейс завершён',
}

const STATUS_RU: Record<string, string> = {
  assigned: 'Назначен', ASSIGNED: 'Назначен', accepted: 'Принят водителем', ACCEPTED: 'Принят водителем',
  in_progress: 'В пути', IN_PROGRESS: 'В пути', PRETRIP: 'Предрейсовая подготовка',
  completed: 'Выполнен', done: 'Выполнен', DONE: 'Выполнен', cancelled: 'Отменен', CANCELLED: 'Отменен',
}
const STATUS_DOT: Record<string, string> = {
  assigned: '#2f6db0', ASSIGNED: '#2f6db0', accepted: '#00a0b0', ACCEPTED: '#00a0b0',
  in_progress: '#1c5a3a', IN_PROGRESS: '#1c5a3a', PRETRIP: '#7a4fb0',
  completed: '#2f8a2f', done: '#2f8a2f', DONE: '#2f8a2f', cancelled: '#c43e1c', CANCELLED: '#c43e1c',
}

export function TripsScreen({ onClose }: { onClose?: () => void }) {
  const { data, reload } = usePoll<{ trips: TripRow[] }>('/api/office/trips')
  const [detail, setDetail] = useState<TripRow | null>(null)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const trips = data?.trips ?? []

  // Принудительное завершение «зависшего» рейса: заявка → DONE, событие
  // TRIP_DONE + SystemNote уходят водителю через план обмена.
  const forceComplete = async (trip: TripRow) => {
    if (!window.confirm(
      `Завершить рейс ${trip.number} принудительно?\nВодитель ${trip.driver?.fullName ?? '—'} освободится и сможет получить новую заявку. Водителю уйдёт уведомление.`,
    ))
      return
    setCompleting(true)
    setCompleteError(null)
    try {
      await apiPost(`/api/office/trips/${encodeURIComponent(trip.number)}/complete`, {})
      setDetail(null)
      reload()
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'Ошибка завершения')
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Рейсы" onClose={onClose} />

      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <C1ToolButton title="Обновить">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V5H8.5" stroke="#2f6db0" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </C1ToolButton>
        <C1Button className="!h-[24px]">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 1h6v3H3zM2 7h8v4H2z" stroke="#5c5c5c" strokeWidth="1.1" /><path d="M4 7V5h4v2" stroke="#5c5c5c" strokeWidth="1.1" /></svg>
          Печать
          <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
        </C1Button>
        <C1Button className="!h-[24px]">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1" y="2" width="10" height="8" rx="1" stroke="#5c5c5c" strokeWidth="1.1" /><path d="M4 12h4" stroke="#5c5c5c" strokeWidth="1.1" /></svg>
          Отчеты
          <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
        </C1Button>
        <span className="ml-3 text-[12px] text-[#5c5c5c]">Статусы рейсов обновляются из событий приложения водителя (last_event)</span>
        <span className="ml-auto text-[12px] text-[#8a8a8a]">Всего рейсов: {trips.length}</span>
      </div>

      <div className="c1-scroll min-h-0 flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr>
              <th className="w-[110px]">Рейс</th>
              <th className="w-[190px]">Водитель</th>
              <th className="w-[160px]">Транспортное средство</th>
              <th className="w-[150px]">Маршрут</th>
              <th className="w-[90px]">Дистанция</th>
              <th className="w-[140px]">Состояние</th>
              <th className="w-[170px]">Открытый интервал</th>
              <th>Предрейсовый осмотр</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => {
              const done = t.status === 'DONE' || t.status === 'completed' || t.status === 'done'
              const cancelled = t.status === 'CANCELLED' || t.status === 'cancelled'
              return (
                <tr key={t.number} className="cursor-default" onClick={() => setDetail(t)}>
                  <td><span className="c1-link">{t.number}</span></td>
                  <td>{t.driver?.fullName ?? '—'}</td>
                  <td>{t.vehicle ? `${t.vehicle.model} · ${t.vehicle.plate}` : '—'}{t.trailer ? ` + ${t.trailer.plate}` : ''}</td>
                  <td>{t.from.name} → {t.to.name}</td>
                  <td>{t.trip?.routeDistanceM ? `${Math.round(t.trip.routeDistanceM / 1000)} км` : '—'}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: STATUS_DOT[t.status] ?? '#8a8a8a' }} />
                      {STATUS_RU[t.status] ?? t.status}
                    </span>
                  </td>
                  <td>
                    {t.openIntervals.length > 0 && !done && !cancelled ? (
                      <span className="text-[#b07000]">
                        {EVENT_RU[t.openIntervals[0].type] ?? t.openIntervals[0].type} · {fmtInterval(t.openIntervals[0].occurredAt, null)}
                      </span>
                    ) : (
                      <span className="text-[#8a8a8a]">—</span>
                    )}
                  </td>
                  <td>
                    {done ? (
                      <span className="text-[#8a8a8a]">завершён</span>
                    ) : (
                      `${t.pretrip.done}/${t.pretrip.total}` + (t.pretrip.done === t.pretrip.total ? ' — готов к рейсу' : '')
                    )}
                  </td>
                </tr>
              )
            })}
            {trips.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-[12px] text-[#8a8a8a]">Рейсов нет — назначьте заявку в «Маршрутных листах»</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Рейс {detail?.number}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Водитель:</span> {detail.driver?.fullName ?? '—'}</div>
                <div>
                  <span className="text-muted-foreground">ТС:</span>{' '}
                  {detail.vehicle ? `${detail.vehicle.model} · ${detail.vehicle.plate}` : '—'}
                  {detail.trailer ? ` + ${detail.trailer.model} · ${detail.trailer.plate}` : ''}
                </div>
              </div>

              {detail.status !== 'DONE' && detail.status !== 'completed' && detail.status !== 'done' && detail.status !== 'CANCELLED' && detail.status !== 'cancelled' && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
                  <div className="text-sm text-amber-900">
                    Рейс не завершён — водитель занят и не может получить новую заявку, пока он открыт.
                  </div>
                  <div className="mt-2">
                    <C1Button
                      disabled={completing}
                      onClick={() => void forceComplete(detail)}
                      className="!h-[26px] gap-1.5"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {completing ? 'Провожу…' : 'Завершить рейс (принудительно)'}
                    </C1Button>
                  </div>
                  {completeError && <div className="mt-1.5 text-sm text-red-700">{completeError}</div>}
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                  <MapPin className="h-4 w-4" /> Точки маршрута
                </div>
                <div className="space-y-1">
                  {detail.trip?.points.map((p) => (
                    <div key={p.seqNo} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="w-24 justify-center border-slate-200 bg-slate-50 text-xs">
                        {p.kind === 'loading' ? 'погрузка' : 'выгрузка'}
                      </Badge>
                      {p.name}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-sm font-medium">События рейса</div>
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {detail.trip?.events.map((e) => (
                    <div key={e.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1 text-sm">
                      <span>{EVENT_RU[e.type] ?? e.type}</span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDateTime(e.occurredAt)}
                        {e.intervalClosedAt ? ` → интервал закрыт ${fmtDateTime(e.intervalClosedAt)}` : ' → интервал открыт'}
                      </span>
                    </div>
                  ))}
                  {(detail.trip?.events.length ?? 0) === 0 && (
                    <div className="text-sm text-muted-foreground">Событий пока нет</div>
                  )}
                </div>
              </div>

              {detail.pretrip.steps.length > 0 && (
                <div>
                  <div className="mb-1.5 text-sm font-medium">
                    Предрейсовый осмотр · фото (просмотр фиксируется в журнале регистрации, 152-ФЗ)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.pretrip.steps.map((s) => (
                      <div key={s.stepId} className="overflow-hidden rounded-lg border">
                        {s.photoUrl ? (
                          <img src={s.photoUrl} alt={s.stepId} className="h-20 w-28 object-cover" />
                        ) : (
                          <div className="flex h-20 w-28 items-center justify-center bg-slate-50 text-xs text-muted-foreground">
                            без фото
                          </div>
                        )}
                        <div className="px-1.5 py-1 text-xs text-muted-foreground">{s.stepId}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

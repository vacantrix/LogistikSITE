'use client'

/**
 * Диалог «Отметить событие» — аналог MarkEventDialog.kt: 8 типов событий,
 * выбор точки маршрута для привязанных событий, «Указать время» для поздних
 * отметок (source = MANUAL_BACKDATED), комментарий. Отметка сохраняется
 * локально (стор = Room) и уходит в outbox — работает без сети.
 */

import { useState } from 'react'
import { useAzmz } from '@/lib/store'
import { EVENT_TYPES, EXPLICIT_CLOSER } from '@/lib/rules'
import { DEVICE_ID, DRIVER_ID, TRIP_ID, VEHICLE_ID } from '@/lib/demo/route-data'
import type { TripEventSnapshot } from '@/lib/protocol'

export function MarkEventDialog({ onClose }: { onClose: () => void }) {
  const trip = useAzmz((s) => s.trip)
  const points = useAzmz((s) => s.points)
  const enqueueTripEvent = useAzmz((s) => s.enqueueTripEvent)
  const showToast = useAzmz((s) => s.showToast)
  const preselect = useAzmz((s) => s.eventDialogPreselect)

  const [selected, setSelected] = useState<string | null>(preselect ?? null)
  const [pointId, setPointId] = useState<string | null>(null)
  const [backdated, setBackdated] = useState(false)
  const [timeText, setTimeText] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const meta = EVENT_TYPES.find((t) => t.code === selected)
  const needsPoint = !!meta?.wantsKind
  const candidates = points.filter((p) => p.tripId === trip?.id && p.kind === meta?.wantsKind)
  const effectivePoint = needsPoint ? (candidates.find((c) => c.id === pointId) ?? candidates[0]) : undefined

  const submit = () => {
    if (!selected) {
      setError('Выберите тип события')
      return
    }
    let occurredAt = Date.now()
    if (backdated) {
      // формат дд.мм.гггг чч:мм — как в каркасе
      const m = timeText.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/)
      if (!m) {
        setError('Формат времени: дд.мм.гггг чч:мм')
        return
      }
      const parsed = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5])).getTime()
      if (Number.isNaN(parsed)) {
        setError('Формат времени: дд.мм.гггг чч:мм')
        return
      }
      occurredAt = parsed
    }
    const event: TripEventSnapshot = {
      id: crypto.randomUUID(),
      tripId: trip?.id ?? TRIP_ID,
      tripPointId: effectivePoint?.id,
      driverId: DRIVER_ID,
      vehicleId: trip?.vehicleId ?? VEHICLE_ID,
      deviceId: DEVICE_ID,
      type: selected,
      occurredAt,
      source: backdated ? 'MANUAL_BACKDATED' : 'MANUAL',
      note: note.trim() || undefined,
      createdAt: Date.now(),
    }
    enqueueTripEvent(event)
    const willClose = Object.values(EXPLICIT_CLOSER).includes(selected)
    showToast(
      willClose
        ? 'Событие сохранено — интервал закрыт'
        : EVENT_TYPES.find((t) => t.code === selected)?.opensInterval
          ? 'Интервал открыт — закроется завершающим событием'
          : 'Событие сохранено' + (useAzmz.getState().offlineMode ? ' · в очереди' : ''),
    )
    onClose()
  }

  return (
    <div className="absolute inset-0 z-50 bg-black/55 flex items-end" onClick={onClose}>
      <div
        className="bg-[#F5F7FA] w-full rounded-t-3xl max-h-[86%] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-[#CBD5E1] rounded-full mx-auto mt-3" />
        <div className="px-5 pt-3 pb-2 text-[17px] font-bold text-[#15202B]">Отметить событие</div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <div className="grid grid-cols-2 gap-2">
            {EVENT_TYPES.map((t) => {
              const sel = selected === t.code
              const dim = t.code === 'TRIP_DONE'
              return (
                <button
                  key={t.code}
                  onClick={() => {
                    setSelected(t.code)
                    setPointId(null)
                  }}
                  className={`rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold border transition-colors ${
                    sel
                      ? 'bg-[#15202B] text-white border-[#15202B]'
                      : `bg-white border-[#E2E8F0] ${dim ? 'text-[#64748B]' : 'text-[#15202B]'}`
                  }`}
                >
                  {t.title}
                </button>
              )
            })}
          </div>

          {needsPoint && candidates.length > 0 && (
            <>
              <div className="text-[12px] text-[#64748B] mt-3 mb-1.5">Точка маршрута</div>
              <div className="flex flex-wrap gap-2">
                {candidates.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPointId(p.id)}
                    className={`rounded-full px-3 h-8 text-[13px] font-semibold border ${
                      (effectivePoint?.id ?? '') === p.id
                        ? 'bg-[#F97316] text-white border-[#F97316]'
                        : 'bg-white border-[#E2E8F0] text-[#15202B]'
                    }`}
                  >
                    {p.name ?? p.address}
                  </button>
                ))}
              </div>
            </>
          )}

          <label className="flex items-center gap-2 mt-3.5 select-none">
            <input
              type="checkbox"
              checked={backdated}
              onChange={(e) => setBackdated(e.target.checked)}
              className="h-4.5 w-4.5 accent-[#F97316]"
            />
            <span className="text-[13px] text-[#15202B] font-medium">Указать время (для поздних отметок)</span>
          </label>
          {backdated && (
            <input
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              placeholder="дд.мм.гггг чч:мм"
              className="mt-2 w-full h-11 rounded-xl border border-[#E2E8F0] px-3 text-[14px] outline-none focus:border-[#F97316]"
            />
          )}

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Комментарий (необязательно)"
            className="mt-3 w-full h-11 rounded-xl border border-[#E2E8F0] px-3 text-[14px] outline-none focus:border-[#F97316]"
          />

          {error && <div className="text-[12px] text-[#EF4444] mt-2">{error}</div>}
          <div className="text-[11px] text-[#94A3B8] mt-3 leading-snug">
            Отметка сохраняется локально и уходит в очередь — индикатор связи покажет отправку.
          </div>
        </div>

        <div className="p-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-xl border border-[#E2E8F0] bg-white text-[#15202B] font-semibold text-[15px]"
          >
            Отмена
          </button>
          <button
            onClick={submit}
            className="flex-[1.4] h-12 rounded-xl bg-[#15202B] text-white font-bold text-[15px] active:scale-[0.99] transition-transform"
          >
            Отметить
          </button>
        </div>
      </div>
    </div>
  )
}

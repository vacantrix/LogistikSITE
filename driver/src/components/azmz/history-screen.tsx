'use client'

/**
 * Экран «История» — выполненные заявки (этап 1: отдельная вкладка внизу,
 * далее раздел переедет в «Настройки», как решили с заказчиком).
 *
 * Наполнение: демо-сид прошлой недели + реальные завершённые рейсы — после
 * прибытия водитель жмёт «Завершить рейс», и заявка уходит из «Главной» сюда.
 * В проде список подтягивается из 1С (рейсы с признаком «выполнен»).
 */

import { ClipboardList, Clock, MapPin, Route, Truck } from 'lucide-react'
import { useAzmz } from '@/lib/store'

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const fmtDur = (min: number) => `${Math.floor(min / 60)} ч ${min % 60} мин`

export function HistoryScreen() {
  const orderHistory = useAzmz((s) => s.orderHistory)
  const sorted = [...orderHistory].sort((a, b) => +new Date(b.completedAt) - +new Date(a.completedAt))

  const totalKm = sorted.reduce((acc, h) => acc + h.distanceKm, 0)

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F7FA]">
      {/* шапка */}
      <div className="sticky top-0 z-10 bg-[#F5F7FA]/95 backdrop-blur px-4 pt-1 pb-2.5 border-b border-[#E2E8F0]">
        <div className="text-[15px] font-black text-[#15202B] leading-tight">История</div>
        <div className="text-[10.5px] text-[#64748B] leading-tight">
          Выполненные заявки · {sorted.length} за период · {totalKm} км
        </div>
      </div>

      <div className="px-3 py-3 flex flex-col gap-2.5 pb-6">
        {sorted.length === 0 && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 flex flex-col items-center gap-2 text-center">
            <ClipboardList className="h-8 w-8 text-[#94A3B8]" />
            <div className="text-[14px] font-bold text-[#15202B]">Пока пусто</div>
            <div className="text-[12px] text-[#64748B] leading-snug">
              Завершённые рейсы появятся здесь: прибыл в точку выгрузки → «Завершить рейс» → заявка уходит в историю.
            </div>
          </div>
        )}

        {sorted.map((h) => (
          <div key={h.number} className="bg-white rounded-2xl border border-black/5 shadow-sm p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-black text-[#15202B]">{h.number}</span>
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#22C55E]/15 text-[#15803D]">
                Выполнена
              </span>
            </div>
            <div className="text-[13px] font-semibold text-[#15202B] mt-1">{h.client}</div>
            <div className="text-[12px] text-[#64748B] mt-0.5">
              {h.cargo} · {h.distanceKm} км
            </div>
            <div className="mt-2 flex items-start gap-1.5 text-[12px] text-[#15202B] font-medium">
              <MapPin className="h-3.5 w-3.5 text-[#3B82F6] mt-0.5 shrink-0" />
              <span>
                {h.fromLabel} <span className="text-[#94A3B8]">→</span> {h.toLabel}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#64748B]">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {fmtDT(h.completedAt)}
              </span>
              <span className="flex items-center gap-1">
                <Route className="h-3.5 w-3.5 shrink-0" />
                {fmtDur(h.durationMin)} в пути
              </span>
              <span className="flex items-center gap-1 min-w-0">
                <Truck className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{h.vehicle}</span>
              </span>
            </div>
          </div>
        ))}

        <div className="text-[10.5px] text-[#94A3B8] leading-snug px-1.5 pt-1">
          Этап 1: история отдельной вкладкой. В следующем релизе раздел переедет в «Настройки» — вместе с отчётами по
          смене.
        </div>
      </div>
    </div>
  )
}

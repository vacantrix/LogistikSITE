'use client'

/**
 * Экран «Главная» ПОСЛЕ разблокировки (рейс начат) — шторка поверх карты.
 *
 * До старта рейса вместо неё — полноэкранный StartScreen (логотип АЭМЗ +
 * большая кнопка «Взять заявку» + фотофиксация, см. start-screen.tsx).
 * Здесь: карточка активного рейса и прочие заявки диспетчерской (только
 * просмотр — взять вторую заявку во время рейса нельзя).
 */

import { useRef } from 'react'
import { MapPin, Truck } from 'lucide-react'
import { useAzmz } from '@/lib/store'
import type { Order1C } from '@/lib/demo/orders-data'

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function OrdersScreen() {
  const orders = useAzmz((s) => s.orders)
  const activeOrderNumber = useAzmz((s) => s.activeOrderNumber)
  const setView = useAzmz((s) => s.setView)
  const showToast = useAzmz((s) => s.showToast)
  const trip = useAzmz((s) => s.trip)
  const simProgressF = useAzmz((s) => s.simProgressF)
  const offlineMode = useAzmz((s) => s.offlineMode)

  const scrollRef = useRef<HTMLDivElement>(null)

  // Заявки приходят поллингом движка синхронизации (раз в 5 с):
  // назначение диспетчера появляется в списке без перезапуска приложения.

  const active = orders.find((o) => o.number === activeOrderNumber) ?? null
  const listOrders = orders.filter((o) => o.number !== activeOrderNumber && o.status !== 'DONE')

  const orderCard = (o: Order1C) => {
    const assigned = o.status === 'ASSIGNED'
    return (
      <button
        key={o.number}
        onClick={() => showToast('Во время рейса доступна одна заявка — завершите текущую')}
        className="w-full text-left bg-white rounded-2xl border border-black/5 shadow-sm p-3.5 opacity-80"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-black text-[#15202B]">{o.number}</span>
          <span
            className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
              assigned ? 'bg-[#F97316]/15 text-[#C2410C]' : 'bg-[#101E2E]/5 text-[#64748B]'
            }`}
          >
            {assigned ? 'Назначена вам' : 'В диспетчерской'}
          </span>
        </div>
        <div className="text-[13px] font-semibold text-[#15202B] mt-1 flex items-center gap-1.5">
          <Building2Icon />
          {o.client}
        </div>
        <div className="text-[12px] text-[#64748B] mt-0.5">
          {o.cargo} · {o.weightT.toFixed(1)} т
        </div>
        <div className="mt-2 flex items-start gap-1.5 text-[12px] text-[#15202B] font-medium">
          <MapPin className="h-3.5 w-3.5 text-[#3B82F6] mt-0.5 shrink-0" />
          <span>
            {o.fromLabel} <span className="text-[#94A3B8]">→</span> {o.toLabel}
          </span>
        </div>
        <div className="mt-1.5 text-[11px] text-[#64748B]">
          Погрузка: {fmtDT(o.loadingAt)} · выгрузка {o.unloadingWindow}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#64748B]">
          <Truck className="h-3.5 w-3.5 shrink-0" />
          {o.vehicle}
          {o.trailer !== '—' ? ` · прицеп ${o.trailer}` : ''}
        </div>
      </button>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[#F5F7FA]">
      {/* шапка */}
      <div className="sticky top-0 z-10 bg-[#F5F7FA]/95 backdrop-blur px-4 pt-1 pb-2.5 border-b border-[#E2E8F0]">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-black text-[#15202B] leading-tight">Главная</div>
            <div className="text-[10.5px] text-[#64748B] leading-tight">
              Заявки из 1С: Сбыт → ТС и готовность → Диспетчерская · автообновление 5 с
              {offlineMode ? ' · офлайн-режим: новые приходят только при связи' : ''}
            </div>
          </div>
          {activeOrderNumber && (
            <span className="text-[10px] font-bold rounded-full px-2 py-1 bg-[#F97316] text-white">
              {activeOrderNumber}
            </span>
          )}
        </div>
      </div>

      <div className="px-3 py-3 flex flex-col gap-2.5 pb-6">
        {/* активный рейс */}
        {active && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-[#F97316] text-white flex items-center justify-center shrink-0">
                <Truck className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-[#15202B]">Рейс {active.number.replace('ЗК', 'Z')} в пути</div>
                <div className="text-[12px] text-[#64748B]">
                  {active.fromLabel} → {active.toLabel}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[16px] font-black text-[#15202B] tabular-nums leading-none">
                  {Math.round(simProgressF * 100)}%
                </div>
                <div className="text-[10px] text-[#64748B] mt-0.5">
                  осталось{' '}
                  {trip?.routeDistanceM
                    ? Math.round((trip.routeDistanceM * (1 - simProgressF)) / 1000)
                    : active.distanceKm}{' '}
                  км
                </div>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden">
              <div className="h-full bg-[#F97316] rounded-full" style={{ width: `${Math.round(simProgressF * 100)}%` }} />
            </div>
            <button
              onClick={() => setView('map')}
              className="mt-3 w-full h-11 bg-[#101E2E] text-white rounded-xl text-[14px] font-bold shadow-lg flex items-center justify-center gap-2"
            >
              <MapPin className="h-4.5 w-4.5" />
              Открыть навигацию
            </button>
          </div>
        )}

        {/* другие заявки диспетчерской — только просмотр */}
        {listOrders.length > 0 && (
          <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide px-1 mt-1">
            Другие заявки диспетчерской ({listOrders.filter((o) => o.status === 'ASSIGNED').length} назначены)
          </div>
        )}
        {listOrders.map((o) => orderCard(o))}
      </div>
    </div>
  )
}

function Building2Icon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  )
}

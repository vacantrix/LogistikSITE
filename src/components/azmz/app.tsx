'use client'

/**
 * Корневой шелл приложения водителя АЗМЗ.
 *
 * До старта рейса — ПОЛНОЭКРАННЫЕ страницы без карты: «Главная» (логотип АЭМЗ
 * + большая кнопка «Взять заявку» + фотофиксация), «История», «Настройки».
 * После «Начать маршрут» открываются доступы: карта — постоянный фон, экраны
 * открываются шторками (bottom sheets) поверх неё, как в навигационных
 * приложениях.
 */

import { useEffect, useRef, useState } from 'react'
import { ClipboardList, History, MapPin, MessageSquare, Settings, TrafficCone } from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { useSimTicker, useSyncEngine } from '@/lib/sync'
import { MapScreen } from '@/components/azmz/map-screen'
import { OrdersScreen } from '@/components/azmz/orders-screen'
import { StartScreen } from '@/components/azmz/start-screen'
import { HistoryScreen } from '@/components/azmz/history-screen'
import { TripScreen } from '@/components/azmz/trip-screen'
import { MarksScreen } from '@/components/azmz/marks-screen'
import { ChatScreen } from '@/components/azmz/chat-screen'
import { SettingsScreen } from '@/components/azmz/settings-screen'
import { TrafficScreen } from '@/components/azmz/traffic-screen'
import { MarkEventDialog } from '@/components/azmz/event-dialog'
import type { View } from '@/lib/store'

export default function App() {
  useSyncEngine()
  useSimTicker()
  const view = useAzmz((s) => s.view)
  const setView = useAzmz((s) => s.setView)
  const notes = useAzmz((s) => s.notes)
  const toast = useAzmz((s) => s.toast)
  const hydrated = useAzmz((s) => s.hydrated)
  const pendingMarks = useAzmz((s) => s.pendingMarks)
  const eventDialogOpen = useAzmz((s) => s.eventDialogOpen)
  const setEventDialog = useAzmz((s) => s.setEventDialog)
  const orders = useAzmz((s) => s.orders)
  const activeOrderNumber = useAzmz((s) => s.activeOrderNumber)
  const orderStage = useAzmz((s) => s.orderStage)

  const unreadNotes = notes.filter((n) => !n.readAt).length
  const availableOrders = orders.filter((o) => o.status === 'ASSIGNED' && o.number !== activeOrderNumber).length
  // доступы: пока рейс не начат (фото не закрыты), приложение ограничено тремя вкладками
  const unlocked = orderStage === 'in_progress'

  // если прошлый сеанс оставил нас в закрытом разделе — возвращаем на «Главную»
  useEffect(() => {
    if (!hydrated || unlocked) return
    if (view !== 'orders' && view !== 'history' && view !== 'settings') {
      setView('orders')
    }
  }, [hydrated, unlocked, view, setView])

  const items: { key: View; icon: React.ReactNode; label: string; badge?: number; tab: View; locked?: boolean }[] = [
    { key: 'orders', tab: 'orders', icon: <ClipboardList className="h-5 w-5" />, label: 'Главная', badge: availableOrders },
    { key: 'history', tab: 'history', icon: <History className="h-5 w-5" />, label: 'История' },
    ...(unlocked
      ? [
          { key: 'marks' as View, tab: 'marks' as View, icon: <MapPin className="h-5 w-5" />, label: 'Пометки', badge: pendingMarks.length },
          { key: 'chat' as View, tab: 'chat' as View, icon: <MessageSquare className="h-5 w-5" />, label: 'Офис', badge: unreadNotes },
        ]
      : []),
    { key: 'settings', tab: 'settings', icon: <Settings className="h-5 w-5" />, label: 'Настройки' },
  ]

  return (
    <div className="min-h-screen bg-[#0A1420] text-[#15202B] flex items-center justify-center gap-8 2xl:px-3 2xl:py-4 xl:gap-12">
      <SidePanel className="hidden 2xl:flex" />

      {/* Полноэкранный контейнер: на телефоне — весь дисплей без рамки и статус-строки
          (время/зарядка даёт система, в APK они скрываются immersive-режимом). */}
      <div className="w-full max-w-full h-[100dvh] bg-[#F5F7FA] overflow-hidden flex flex-col relative 2xl:w-[430px] 2xl:h-[min(100dvh-32px,900px)] 2xl:min-h-[560px] 2xl:rounded-[38px] 2xl:border 2xl:border-[#22344A] 2xl:shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
        <div className="flex-1 relative overflow-hidden">
          {!hydrated ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[#64748B]">Загрузка…</div>
          ) : !unlocked ? (
            /* ДО старта рейса: полноэкранные страницы, карты нет.
               Главная = логотип АЭМЗ + «Взять заявку» + фотофиксация. */
            <div className="absolute inset-0 flex flex-col bg-[#F5F7FA]">
              {view === 'history' ? <HistoryScreen /> : view === 'settings' ? <SettingsScreen /> : <StartScreen />}
            </div>
          ) : (
            <>
              {/* РЕЙС ИДЁТ: карта — постоянный фон (слои, грузовик, камера) */}
              <MapScreen />

              {/* Шторки поверх карты */}
              {view === 'orders' && (
                <Sheet height="h-[88%]" onClose={() => setView('map')}>
                  <OrdersScreen />
                </Sheet>
              )}
              {view === 'history' && (
                <Sheet height="h-[84%]" onClose={() => setView('map')}>
                  <HistoryScreen />
                </Sheet>
              )}
              {view === 'trip' && (
                <Sheet height="h-[76%]" onClose={() => setView('map')}>
                  <TripScreen />
                </Sheet>
              )}
              {view === 'marks' && (
                <Sheet height="h-[66%]" onClose={() => setView('map')}>
                  <MarksScreen />
                </Sheet>
              )}
              {view === 'chat' && (
                <Sheet height="h-[74%]" onClose={() => setView('map')}>
                  <ChatScreen />
                </Sheet>
              )}
              {view === 'settings' && (
                <Sheet height="h-[82%]" onClose={() => setView('map')}>
                  <SettingsScreen inSheet />
                </Sheet>
              )}
              {view === 'traffic' && (
                <Sheet height="h-[58%]" onClose={() => setView('map')}>
                  <TrafficScreen />
                </Sheet>
              )}
            </>
          )}
          {eventDialogOpen && <MarkEventDialog onClose={() => setEventDialog(false)} />}
          {toast && (
            <div className="absolute bottom-4 left-4 right-4 z-[60] bg-[#101E2E] text-white text-[13px] rounded-2xl px-4 py-3 shadow-xl border border-white/10">
              {toast.text}
            </div>
          )}
        </div>

        {/* нижняя панель навигации: Главная / История / (доступы) / Настройки */}
        <nav className="bg-[#101E2E] h-16 shrink-0 flex items-stretch" aria-label="Главное меню">
          {items.map((it) => {
            const active =
              view === it.tab ||
              (it.tab === 'orders' && (view === 'map' || view === 'trip' || view === 'traffic'))
            return (
              <button
                key={it.key}
                onClick={() => setView(it.tab)}
                aria-label={it.label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-[#F97316]' : 'text-white/55 hover:text-white/80'
                }`}
              >
                {it.icon}
                <span className="text-[10px] leading-none">{it.label}</span>
                {!!it.badge && it.badge > 0 && (
                  <span className="absolute top-2 right-[calc(50%-16px)] bg-[#EF4444] text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1">
                    {it.badge > 9 ? '9+' : it.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      <SidePanelDemo className="hidden 2xl:flex" />
    </div>
  )
}

/**
 * Шторка поверх карты: карта остаётся видимой и живой сверху.
 * Шторку МОЖНО опустить жестом: тянешь за ручку вниз — шторка следует
 * за пальцем, отпустил — закрывается (возврат на карту).
 */
function Sheet({ children, height, onClose }: { children: React.ReactNode; height: string; onClose?: () => void }) {
  const [dy, setDy] = useState(0)
  const startY = useRef<number | null>(null)
  const dragging = useRef(false)

  const onDown = (e: React.PointerEvent) => {
    startY.current = e.clientY
    dragging.current = true
  }
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current || startY.current === null) return
    setDy(Math.max(0, e.clientY - startY.current))
  }
  const onUp = () => {
    if (!dragging.current) return
    dragging.current = false
    const moved = dy
    startY.current = null
    setDy(0)
    if (moved > 64) onClose?.()
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end pointer-events-none">
      <div
        className={`pointer-events-auto ${height} max-h-full bg-[#F5F7FA] rounded-t-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.35)] flex flex-col azmz-sheet-enter overflow-hidden`}
        style={
          dy > 0
            ? { transform: `translateY(${dy}px)`, transition: 'none' }
            : { transition: 'transform 0.25s cubic-bezier(0.22, 0.9, 0.36, 1)' }
        }
      >
        {/* зона жеста: ручка + запас сверху, чтобы палец не промахнулся */}
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="pt-2.5 pb-2 flex justify-center shrink-0 cursor-grab touch-none select-none"
          style={{ touchAction: 'none' }}
          aria-hidden
        >
          <span className="w-14 h-1.5 rounded-full bg-[#C3CBD6]" />
        </div>
        {children}
      </div>
      <style jsx global>{`
        @keyframes azmz-sheet-up {
          from {
            transform: translateY(18%);
            opacity: 0.6;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .azmz-sheet-enter {
          animation: azmz-sheet-up 0.28s cubic-bezier(0.22, 0.9, 0.36, 1);
        }
      `}</style>
    </div>
  )
}

function SidePanel({ className = '' }: { className?: string }) {
  return (
    <div className={`${className} w-72 flex-col gap-4 text-slate-300`}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#F97316] flex items-center justify-center text-white font-black text-lg">✓</div>
        <div>
          <div className="text-white font-bold">АЭМЗ Поток · Водитель</div>
          <div className="text-xs text-slate-400">Карта — фон · пробки онлайн</div>
        </div>
      </div>
      <div className="bg-[#0F1D2E] border border-[#1E324A] rounded-2xl p-4 text-[13px] leading-relaxed">
        <div className="text-white font-semibold mb-2">Сценарий демо</div>
        <ol className="list-decimal ml-4 space-y-1.5 text-slate-300">
          <li>Стартовый экран без карты: логотип АЭМЗ + большая кнопка «Взять заявку» → маршрут по дорогам → фото ТС и документов.</li>
          <li>До старта рейса внизу только «Главная», «История» и «Настройки» — доступы закрыты.</li>
          <li>После «Начать маршрут» открывается карта (постоянный фон): геопозиция водителя, маршрут с вариантами, «Пометки», «Офис».</li>
          <li>Шторки экранов опускаются жестом вниз (История, Рейс, Пометки…).</li>
          <li>Прибытие → «Завершить рейс» → заявка уходит в «Историю», из 1С приходит новая.</li>
        </ol>
      </div>
    </div>
  )
}

function SidePanelDemo({ className = '' }: { className?: string }) {
  return (
    <div className={`${className} w-72 flex-col gap-4 text-slate-300`}>
      <div className="bg-[#0F1D2E] border border-[#1E324A] rounded-2xl p-4 text-[13px] leading-relaxed">
        <div className="text-white font-semibold mb-2 flex items-center gap-2">
          <TrafficCone className="h-4 w-4 text-[#F97316]" />
          Пробки: как устроено
        </div>
        <ul className="space-y-1.5 text-slate-300">
          <li>Канал 3: <span className="text-[#F97316]">GET /traffic?bbox</span> — снимок, как пометки</li>
          <li>Источник: телеметрия парка (position_ping → V7)</li>
          <li>Обновление раз в минуту, офлайн — прошлый снимок</li>
          <li>ETA пересчитывается: «+N мин из-за пробок»</li>
        </ul>
      </div>
      <div className="bg-[#0F1D2E] border border-[#1E324A] rounded-2xl p-4 text-[13px] leading-relaxed">
        <div className="text-white font-semibold mb-2">Что под капотом</div>
        <ul className="space-y-1.5 text-slate-300">
          <li>Outbox + UUID → <span className="text-[#F97316]">POST /sync/push</span> (идемпотентно)</li>
          <li>Курсор → <span className="text-[#F97316]">GET /sync/pull</span> (канал 1)</li>
          <li>Пометки по bbox → <span className="text-[#F97316]">GET /sync/marks</span> (канал 2)</li>
          <li>Правила 8 событий = TripEventRules.kt</li>
          <li>Карта: MapLibre + OSM; маршрут — OSRM от геопозиции, перестроение при отклонении</li>
        </ul>
      </div>
      <div className="bg-[#0F1D2E] border border-[#1E324A] rounded-2xl p-4 text-[12px] text-slate-400">
        Демо-сервер: Next.js API + SQLite, зеркалит Spring Boot каркаса. Прод-архитектура пробок — в README каркаса (V7).
      </div>
    </div>
  )
}

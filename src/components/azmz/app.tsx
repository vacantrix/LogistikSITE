'use client'

/**
 * Корневой шелл приложения водителя АЗМЗ. Мобильный кадр (по мокапам) +
 * настольные подсказки демо. Вкладки нижней панели — как на мокапах:
 * Поиск (карта), Пометки, Офис, Настройки; «Рейс» открывается из панели
 * данных маршрута (нажатие на 123 км / Z-1067).
 */

import { useEffect, useState } from 'react'
import { BatteryMedium, MapPin, MessageSquare, Search, Settings } from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { useSimTicker, useSyncEngine } from '@/lib/sync'
import { MapScreen } from '@/components/azmz/map-screen'
import { TripScreen } from '@/components/azmz/trip-screen'
import { MarksScreen } from '@/components/azmz/marks-screen'
import { ChatScreen } from '@/components/azmz/chat-screen'
import { SettingsScreen } from '@/components/azmz/settings-screen'
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

  const unreadNotes = notes.filter((n) => !n.readAt).length
  const [clock, setClock] = useState('')
  useEffect(() => {
    const upd = () => setClock(`${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`)
    upd()
    const t = setInterval(upd, 20_000)
    return () => clearInterval(t)
  }, [])

  const items: { key: View; icon: React.ReactNode; label: string; badge?: number; tab: View }[] = [
    { key: 'map', tab: 'map', icon: <Search className="h-5 w-5" />, label: 'Поиск' },
    { key: 'marks', tab: 'marks', icon: <MapPin className="h-5 w-5" />, label: 'Пометки', badge: pendingMarks.length },
    { key: 'chat', tab: 'chat', icon: <MessageSquare className="h-5 w-5" />, label: 'Офис', badge: unreadNotes },
    { key: 'settings', tab: 'settings', icon: <Settings className="h-5 w-5" />, label: 'Настройки' },
  ]

  return (
    <div className="min-h-screen bg-[#0A1420] text-[#15202B] flex items-center justify-center gap-8 px-3 py-4 xl:gap-12">
      <SidePanel className="hidden 2xl:flex" />

      <div className="w-[430px] max-w-full h-[min(100dvh-32px,900px)] min-h-[560px] bg-[#F5F7FA] rounded-[38px] border border-[#22344A] shadow-[0_30px_80px_rgba(0,0,0,0.55)] overflow-hidden flex flex-col relative">
        {/* статусная строка устройства */}
        <div className="bg-[#101E2E] text-white/90 h-9 flex items-center justify-between px-6 text-xs font-medium shrink-0">
          <span className="tabular-nums">{clock}</span>
          <span className="tracking-[0.18em] uppercase text-[10px] text-white/60">АЗМЗ Логистика</span>
          <span className="flex items-center gap-1 tabular-nums">
            <BatteryMedium className="h-4 w-4 text-[#22C55E]" />
            78%
          </span>
        </div>

        <div className="flex-1 relative overflow-hidden">
          {!hydrated ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[#64748B]">Загрузка…</div>
          ) : (
            <>
              {view === 'map' && <MapScreen />}
              {view === 'trip' && <TripScreen />}
              {view === 'marks' && <MarksScreen />}
              {view === 'chat' && <ChatScreen />}
              {view === 'settings' && <SettingsScreen />}
            </>
          )}
          {eventDialogOpen && <MarkEventDialog onClose={() => setEventDialog(false)} />}
          {toast && (
            <div className="absolute bottom-4 left-4 right-4 z-[60] bg-[#101E2E] text-white text-[13px] rounded-2xl px-4 py-3 shadow-xl border border-white/10">
              {toast.text}
            </div>
          )}
        </div>

        {/* нижняя панель навигации — как в мокапе */}
        <nav className="bg-[#101E2E] h-16 shrink-0 flex items-stretch" aria-label="Главное меню">
          {items.map((it) => {
            const active = view === it.tab || (it.tab === 'map' && view === 'trip')
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

function SidePanel({ className = '' }: { className?: string }) {
  return (
    <div className={`${className} w-72 flex-col gap-4 text-slate-300`}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#F97316] flex items-center justify-center text-white font-black text-lg">✓</div>
        <div>
          <div className="text-white font-bold">АЗМЗ Логистика</div>
          <div className="text-xs text-slate-400">Сборка приложения из каркаса</div>
        </div>
      </div>
      <div className="bg-[#0F1D2E] border border-[#1E324A] rounded-2xl p-4 text-[13px] leading-relaxed">
        <div className="text-white font-semibold mb-2">Сценарий демо</div>
        <ol className="list-decimal ml-4 space-y-1.5 text-slate-300">
          <li>Карта: баннер «Через 20 м — налево на Промышленную», лимит 60, очередь связи.</li>
          <li>Нажмите на панель «123 км … Z-1067» внизу — откроется дашборд рейса.</li>
          <li>«Отметить событие» — 8 типов, работает без сети.</li>
          <li>Включите «Офлайн-режим» в Настройках — отметки встают в очередь.</li>
          <li>Выключите — индикатор «Отправка: N» очистит очередь.</li>
        </ol>
      </div>
    </div>
  )
}

function SidePanelDemo({ className = '' }: { className?: string }) {
  return (
    <div className={`${className} w-72 flex-col gap-4 text-slate-300`}>
      <div className="bg-[#0F1D2E] border border-[#1E324A] rounded-2xl p-4 text-[13px] leading-relaxed">
        <div className="text-white font-semibold mb-2">Что под капотом</div>
        <ul className="space-y-1.5 text-slate-300">
          <li>Outbox + UUID-операции → <span className="text-[#F97316]">POST /sync/push</span> (идемпотентно)</li>
          <li>Курсор журнала → <span className="text-[#F97316]">GET /sync/pull</span> (канал 1)</li>
          <li>Пометки по bbox → <span className="text-[#F97316]">GET /sync/marks</span> (канал 2)</li>
          <li>Правила 8 событий = TripEventRules.kt</li>
          <li>Авто-закрытие интервалов = TripEventApplier</li>
          <li>Карта: MapLibre + OSM/CARTO — без Yandex API</li>
        </ul>
      </div>
      <div className="bg-[#0F1D2E] border border-[#1E324A] rounded-2xl p-4 text-[12px] text-slate-400">
        Демо-сервер: Next.js API + SQLite, зеркалит Spring Boot каркаса (X-Driver-Id → этап MVP: JWT по смене).
      </div>
    </div>
  )
}

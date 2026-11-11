'use client'

/**
 * Шторка «Настройки»: смена и устройство (MDM, план этапа 2), состояние
 * синхронизации, офлайн-карты, пробки (канал 3) и — главное для демо —
 * управление симуляцией: офлайн-режим, движение по маршруту, инцидент
 * офиса, журнал операций. Карта остаётся фоном сверху.
 */

import { ChevronLeft, History, Map as MapIcon, Radio, RotateCcw, Sliders, Zap } from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { ConnectionChip } from '@/components/azmz/connection-chip'
import { InstallAppButton } from '@/components/pwa/install-button'
import { syncNow } from '@/lib/sync'
import { DEVICE_ID, DRIVER_NAME, VEHICLE_LABEL } from '@/lib/demo/route-data'
import { fmtClock, timeAgo } from '@/lib/format'

export function SettingsScreen({ inSheet = false }: { inSheet?: boolean }) {
  const setView = useAzmz((s) => s.setView)
  const offlineMode = useAzmz((s) => s.offlineMode)
  const setOfflineMode = useAzmz((s) => s.setOfflineMode)
  const simRunning = useAzmz((s) => s.simRunning)
  const setSimRunning = useAzmz((s) => s.setSimRunning)
  const outbox = useAzmz((s) => s.outbox)
  const cursor = useAzmz((s) => s.cursor)
  const lastSyncAt = useAzmz((s) => s.lastSyncAt)
  const traffic = useAzmz((s) => s.traffic)
  const orderHistory = useAzmz((s) => s.orderHistory)
  const orderStage = useAzmz((s) => s.orderStage)
  const showToast = useAzmz((s) => s.showToast)
  const resetDemo = useAzmz((s) => s.resetDemo)
  // до старта рейса карты нет — «Назад» ведёт на «Главную», после — на карту
  const backView = orderStage === 'in_progress' ? 'map' : 'orders'

  const runIncident = async () => {
    try {
      const res = await fetch('/api/demo/incident', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      showToast('Офис изменил выгрузку — изменение придёт по pull')
      void syncNow()
    } catch {
      showToast('Демо-инцидент недоступен: сервер не отвечает')
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`bg-[#101E2E] px-4 pt-2 pb-4 shrink-0 flex items-center gap-2 ${inSheet ? 'rounded-t-3xl' : ''}`}>
        <button onClick={() => setView(backView)} aria-label="Назад" className="text-white/70 hover:text-white">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="flex-1">
          <div className="text-white font-bold text-[17px]">Настройки</div>
          <div className="text-[11px] text-white/50">Смена · связь · демо-управление</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <InstallAppButton variant="block" />
        <Section icon={<Sliders className="h-4 w-4 text-[#F97316]" />} title="Смена и устройство">
          <Row k="Водитель" v={DRIVER_NAME} />
          <Row k="ТС" v={VEHICLE_LABEL} />
          <Row k="Смена" v="до 20:00 · вход по бейджу (этап MVP)" />
          <Row k="Устройство" v={`Планшет MDM P-042 · ${DEVICE_ID.slice(0, 8)}…`} />
        </Section>

        <Section icon={<Radio className="h-4 w-4 text-[#F97316]" />} title="Подключение">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[13px] text-[#64748B]">Индикатор</span>
            <ConnectionChip />
          </div>
          <Row k="Сервер" v="tms.azmz.ru/api/driver/v1" />
          <Row k="Курсор журнала" v={String(cursor)} />
          <Row k="Последняя синхронизация" v={lastSyncAt ? timeAgo(lastSyncAt) : '—'} />
          <Row k="В очереди" v={`${outbox.length} опер.`} />
        </Section>

        <Section icon={<MapIcon className="h-4 w-4 text-[#F97316]" />} title="Офлайн-карты и пробки">
          <Row k="Покрытие" v="коридор маршрута, z14–z17 (PMTiles)" />
          <Row k="Обновление" v={fmtClock(Date.now() - 3_600_000 * 14)} />
          <Row k="Профиль дорог" v="грузовой: габариты, оси (OSRM)" />
          <Row k="Пробки" v={traffic ? `канал 3 · балл ${traffic.score} · обновлено ${timeAgo(traffic.snapshotAt)}` : 'канал 3 · ждём первый снимок'} />
          <Row k="Источник пробок" v="телеметрия ТС парка · без Yandex API" />
        </Section>

        <Section icon={<Zap className="h-4 w-4 text-[#F97316]" />} title="Демо-управление">
          <ToggleRow
            label="Офлайн-режим (симуляция)"
            hint="операции копятся в очереди, индикатор красный"
            checked={offlineMode}
            onChange={setOfflineMode}
          />
          <ToggleRow
            label="Движение по маршруту (20×)"
            hint="грузовик едет, баннер манёвров живой"
            checked={simRunning}
            onChange={setSimRunning}
          />
          <div className="grid grid-cols-1 gap-2 mt-2">
            <button
              onClick={runIncident}
              className="h-11 rounded-xl bg-[#F97316] text-white font-bold text-[14px]"
            >
              Инцидент: офис меняет выгрузку
            </button>
            <button
              onClick={() => {
                void syncNow()
                showToast('Синхронизация запущена')
              }}
              className="h-11 rounded-xl bg-[#15202B] text-white font-bold text-[14px]"
            >
              Синхронизировать сейчас
            </button>
            <button
              onClick={resetDemo}
              className="h-11 rounded-xl border border-[#E2E8F0] bg-white text-[#15202B] font-semibold text-[14px] flex items-center justify-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Сбросить демо-данные
            </button>
          </div>
        </Section>

        <Section icon={<Radio className="h-4 w-4 text-[#F97316]" />} title="Журнал операций (outbox)">
          {outbox.length === 0 && <div className="text-[13px] text-[#94A3B8] py-1.5">Очередь пуста — всё отправлено</div>}
          {outbox.slice(-8).reverse().map((op) => (
            <div key={op.opId} className="flex items-center justify-between py-1.5 border-b border-[#EEF2F7] last:border-0">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[#15202B]">{op.type}</div>
                <div className="text-[10px] text-[#94A3B8]">{timeAgo(op.createdAt)} · попыток {op.attempts + 1}</div>
              </div>
              <span className={`text-[10px] font-bold rounded-full px-2 py-1 ${op.state === 'PENDING' ? 'bg-[#FACC15]/25 text-[#B45309]' : op.state === 'REJECTED' ? 'bg-[#EF4444]/15 text-[#EF4444]' : 'bg-[#22C55E]/15 text-[#16A34A]'}`}>
                {op.state}
              </span>
            </div>
          ))}
        </Section>

        <Section icon={<History className="h-4 w-4 text-[#F97316]" />} title="История рейсов">
          <div className="flex items-center justify-between gap-3 py-1.5">
            <div>
              <div className="text-[13px] text-[#15202B] font-medium">Выполненных заявок: {orderHistory.length}</div>
              <div className="text-[11px] text-[#94A3B8]">Этап 1 — отдельной вкладкой; в следующем релизе раздел переедет сюда</div>
            </div>
            <button
              onClick={() => {
                setView('history')
                showToast('История открыта — вкладка внизу')
              }}
              className="h-9 px-3 rounded-xl bg-[#15202B] text-white text-[12px] font-bold shrink-0"
            >
              Открыть
            </button>
          </div>
        </Section>

        <Section icon={<Sliders className="h-4 w-4 text-[#F97316]" />} title="О приложении">
          <Row k="Версия" v="0.5.0 — карта-фон · пробки онлайн" />
          <Row k="Синхронизация" v="outbox + курсор + 3 канала" />
          <Row k="Карты" v="MapLibre · OSM/CARTO (без Yandex API)" />
          <div className="text-[10px] text-[#94A3B8] pt-1 leading-snug">
            ПДн хранятся на сервере в РФ (152-ФЗ). Этап MVP: JWT по смене, RuStore Push, геозоны.
          </div>
        </Section>
        <div className="h-2" />
      </div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <div className="text-[13px] font-bold text-[#15202B] uppercase tracking-wide">{title}</div>
      </div>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px] text-[#64748B] shrink-0">{k}</span>
      <span className="text-[13px] text-[#15202B] font-medium text-right">{v}</span>
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[#EEF2F7] last:border-0">
      <div className="flex-1">
        <div className="text-[14px] font-semibold text-[#15202B]">{label}</div>
        <div className="text-[11px] text-[#94A3B8]">{hint}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition-colors shrink-0 ${checked ? 'bg-[#F97316]' : 'bg-[#CBD5E1]'}`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </div>
  )
}

'use client'

/**
 * Шторка «Пробки» (канал 3): балл 1–10, легенда уровней, худшие участки
 * маршрута и боковых улиц, пересчёт ETA, источники данных. Карта остаётся
 * фоном — слои трафика видны над шторкой.
 *
 * Прод-архитектура (зеркалится в V7 каркаса):
 *  position_ping (телеметрия ТС) → map-matching по сегментам OSRM →
 *  traffic_segment (агрегат скоростей, retention 2 ч) → этот снимок по bbox.
 */

import { useEffect, useState } from 'react'
import { ChevronLeft, Gauge, Radio, Timer, TrafficCone } from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { TRAFFIC_LEVELS, trafficScoreColor, trafficScoreTitle } from '@/lib/rules'
import { fmtClock, timeAgo } from '@/lib/format'

export function TrafficScreen() {
  const setView = useAzmz((s) => s.setView)
  const traffic = useAzmz((s) => s.traffic)
  const trip = useAzmz((s) => s.trip)
  const offlineMode = useAzmz((s) => s.offlineMode)
  const [, tick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 10_000)
    return () => clearInterval(t)
  }, [])

  const delayMin = traffic?.routeDelayMin ?? 0
  const etaMs = (trip?.plannedFinishAt ?? Date.now()) + delayMin * 60_000
  const worst = [...(traffic?.segments ?? [])]
    .filter((s) => s.level >= 2)
    .sort((a, b) => a.speedKmh - b.speedKmh)
    .slice(0, 4)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* шапка */}
      <div className="bg-[#101E2E] px-4 pt-2 pb-4 shrink-0 rounded-t-3xl">
        <div className="flex items-center gap-2">
          <button onClick={() => setView('map')} aria-label="Назад" className="text-white/70 hover:text-white">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <div className="text-white font-bold text-[17px]">Пробки</div>
            <div className="text-[11px] text-white/50">
              {traffic ? `обновлено ${timeAgo(traffic.snapshotAt)} · канал 3 (bbox-снимок)` : 'загружаем первый снимок…'}
            </div>
          </div>
          <TrafficCone className="h-5 w-5 text-[#F97316]" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {!traffic ? (
          <div className="text-center text-[#64748B] text-sm py-8">
            {offlineMode ? 'Офлайн: снимок пробок появится при появлении сети' : 'Загружаем снимок пробок по коридору маршрута…'}
          </div>
        ) : (
          <>
            {/* балл */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm px-4 py-4 flex items-center gap-4">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center text-white font-black text-xl shrink-0"
                style={{ background: trafficScoreColor(traffic.score) }}
              >
                {traffic.score}
              </div>
              <div className="min-w-0">
                <div className="text-[16px] font-bold text-[#15202B] leading-tight">{trafficScoreTitle(traffic.score)}</div>
                <div className="text-[12px] text-[#64748B] mt-0.5">Балл 1–10 · коридор маршрута Z-1067</div>
              </div>
            </div>

            {/* задержка */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm px-4 py-3.5 flex items-center gap-3">
              <Timer className="h-5 w-5 text-[#F97316] shrink-0" />
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-[#15202B]">
                  {delayMin > 0 ? <>Задержка из-за пробок: +{delayMin} мин</> : 'Пробки не влияют на прибытие'}
                </div>
                <div className="text-[11px] text-[#64748B]">
                  Прогноз прибытия: <span className="font-semibold tabular-nums">{fmtClock(etaMs)}</span>
                  {delayMin > 0 && trip?.plannedFinishAt ? ` вместо ${fmtClock(trip.plannedFinishAt)}` : ''}
                </div>
              </div>
            </div>

            {/* худшие участки */}
            {worst.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm px-4 py-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <Gauge className="h-4 w-4 text-[#F97316]" />
                  <div className="text-[13px] font-bold text-[#15202B] uppercase tracking-wide">Худшие участки</div>
                </div>
                <div className="space-y-2">
                  {worst.map((s) => (
                    <div key={s.id} className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: TRAFFIC_LEVELS[s.level].hex }} />
                      <span className="flex-1 text-[13px] text-[#15202B] font-medium truncate">{s.title ?? s.id}</span>
                      <span className="text-[13px] font-bold text-[#15202B] tabular-nums shrink-0">{s.speedKmh} км/ч</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* легенда */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm px-4 py-3.5">
              <div className="text-[13px] font-bold text-[#15202B] uppercase tracking-wide mb-2">Легенда</div>
              <div className="grid grid-cols-1 gap-1.5">
                {TRAFFIC_LEVELS.map((l, i) => (
                  <div key={l.title} className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ background: l.hex }} />
                    <span className="text-[13px] text-[#15202B] font-medium flex-1">{l.title}</span>
                    <span className="text-[12px] text-[#94A3B8]">{l.speedHint}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* источники */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm px-4 py-3.5">
              <div className="flex items-center gap-2 mb-2">
                <Radio className="h-4 w-4 text-[#F97316]" />
                <div className="text-[13px] font-bold text-[#15202B] uppercase tracking-wide">Откуда данные</div>
              </div>
              <ul className="space-y-1.5 text-[12px] text-[#64748B] leading-relaxed">
                <li>
                  <span className="text-[#15202B] font-semibold">Телеметрия парка:</span> {traffic.contributors} ТС присылают
                  позицию и скорость (position_ping) — агрегат по сегментам дорог.
                </li>
                <li>
                  <span className="text-[#15202B] font-semibold">Обновление:</span> раз в минуту, офлайн — последний снимок
                  с устройства.
                </li>
                <li>
                  <span className="text-[#15202B] font-semibold">Без Yandex API</span> (лицензия) — свой стек: OSM/OSRM,
                  свои данные.
                </li>
              </ul>
            </div>

            <div className="text-[10px] text-[#94A3B8] leading-snug pb-2">
              Прод: position_ping → map-matching → traffic_segment (V7) → этот снимок. Маршрут пересчитывается
              в OSRM с учётом скоростей сегментов.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

'use client'

/** Индикатор связи — три состояния из мокапов: зелёный / оранжевый «Отправка: N» / красный «Офлайн. В очереди: N».
 *  Демо-офлайн (тумблер в настройках) показываем отдельным янтарным чипом —
 *  чтобы симуляция не выглядела как реальная потеря связи. */

import { Loader2, Wifi, WifiOff } from 'lucide-react'
import { useAzmz } from '@/lib/store'

export function ConnectionChip({ className = '' }: { className?: string }) {
  const connection = useAzmz((s) => s.connection)
  const outbox = useAzmz((s) => s.outbox)
  const offlineMode = useAzmz((s) => s.offlineMode)
  const n = outbox.length

  if (connection === 'offline' && offlineMode) {
    return (
      <span className={`${className} inline-flex items-center gap-1.5 bg-[#F59E0B] text-white text-[11px] font-semibold rounded-full pl-2 pr-3 h-7 shadow`}>
        <WifiOff className="h-3.5 w-3.5" />
        Офлайн-режим (демо)
      </span>
    )
  }
  if (connection === 'offline') {
    return (
      <span className={`${className} inline-flex items-center gap-1.5 bg-[#EF4444] text-white text-[11px] font-semibold rounded-full pl-2 pr-3 h-7 shadow`}>
        <WifiOff className="h-3.5 w-3.5" />
        Офлайн. В очереди: {n}
      </span>
    )
  }
  if (connection === 'syncing') {
    return (
      <span className={`${className} inline-flex items-center gap-1.5 bg-[#FACC15] text-[#15202B] text-[11px] font-semibold rounded-full pl-2 pr-3 h-7 shadow`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Отправка: {n}
      </span>
    )
  }
  return (
    <span className={`${className} inline-flex items-center gap-1.5 bg-[#16A34A] text-white text-[11px] font-semibold rounded-full pl-2 pr-3 h-7 shadow`}>
      <Wifi className="h-3.5 w-3.5" />
      На связи
    </span>
  )
}

/** Оранжевая плашка офлайн-режима с карты (мокап 1). */
export function OfflineHint() {
  const connection = useAzmz((s) => s.connection)
  if (connection !== 'offline') return null
  return (
    <div className="bg-[#F97316] text-white text-[11px] font-medium rounded-lg px-3 py-1.5 shadow-lg flex items-center gap-2">
      Маршрут и пометки сохранены на устройстве
    </div>
  )
}

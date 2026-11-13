'use client'

/**
 * Диалог «Маршрут по ссылке Яндекс.Карт».
 *
 * Диспетчер строит маршрут в Яндекс.Картах → «Поделиться» → «Ссылка» →
 * отправляет водителю. Водитель (или сам диспетчер при тесте) вставляет
 * ссылку здесь — приложение разбирает точки (rtext) и строит по ним рейс.
 * Тот же формат ссылки понимают заявки, приходящие с платформы «Контур 1С».
 */

import { useState } from 'react'
import { Link2, LoaderCircle, MapPinPlus, X } from 'lucide-react'
import { useAzmz } from '@/lib/store'

export function ImportRouteDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = () => {
    if (busy) return
    setBusy(true)
    setError(null)
    // даём кадр спиннера, разбор мгновенный
    setTimeout(() => {
      const r = useAzmz.getState().importRouteFromLink(link)
      setBusy(false)
      if (!r.ok) {
        setError(r.error ?? 'Не удалось разобрать ссылку')
        return
      }
      onClose()
    }, 250)
  }

  return (
    <div className="absolute inset-0 z-50 bg-[#0B1622]/96 backdrop-blur-sm flex flex-col">
      <div className="p-4 pb-2 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-white rounded-xl px-3 h-11">
          <Link2 className="h-4.5 w-4.5 text-[#64748B] shrink-0" />
          <input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="https://yandex.ru/maps/?rtext=…"
            className="flex-1 outline-none text-[14px] bg-transparent min-w-0"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
          />
          <button onClick={onClose} aria-label="Закрыть">
            <X className="h-5 w-5 text-[#64748B]" />
          </button>
        </div>
      </div>

      <div className="px-4 text-[11px] text-white/50 mb-1">
        Ссылка маршрута из Яндекс.Карт: «Поделиться» → «Скопировать ссылку»
      </div>

      <div className="px-4">
        <button
          onClick={submit}
          disabled={!link.trim() || busy}
          className="w-full h-12 rounded-xl bg-[#F97316] text-white font-bold text-[15px] shadow-lg disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <MapPinPlus className="h-5 w-5" />}
          {busy ? 'Разбираем ссылку…' : 'Построить маршрут'}
        </button>
        {error && (
          <div className="mt-2 text-[12px] text-[#FDBA74] bg-[#7C2D12]/60 border border-[#F97316]/30 rounded-xl px-3 py-2 leading-snug">
            {error}
          </div>
        )}
      </div>

      <div className="flex-1" />
      <div className="px-4 pb-6 text-[11px] text-white/40 leading-snug">
        Маршрут строится по дорогам (OSRM) через все точки ссылки; баннеры манёвров и офлайн-карта
        подхватываются автоматически. Одна точка в ссылке — маршрут от вашей геопозиции до неё.
      </div>
    </div>
  )
}

'use client'

/**
 * Выбор точки «Точка А / Точка Б» (Task 64, переработано в 110-a): текстовый
 * ввод со свободным адресом + панель быстрого выбора. АЭМЗ — одной кнопкой,
 * точки справочника платформы (src/lib/points.ts) — из списка с поиском по
 * введённому тексту; любой другой адрес можно вписать руками — он сохраняется
 * в заявке как есть («Использовать адрес»). Расстояние КМ и маршрут считаются
 * по точкам справочника. Введённый произвольный текст при закрытии панели
 * не затирается — свободный адрес валиден.
 */
import { useEffect, useRef, useState } from 'react'
import { Factory, MapPin } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { POINT_SUGGESTIONS } from '@/lib/points'

/** Значение точки АЭМЗ в справочнике — быстрый выбор одной кнопкой */
const AEMZ_VALUE = 'Абинск'

export function PointSelect({ id, value, onChange, placeholder, ariaLabel }: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // клик вне панели закрывает; blur ничего не меняет — введённый адрес остаётся в поле
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const q = value.trim().toLowerCase()
  // точки справочника, отфильтрованные по введённому тексту (город, название, адрес)
  const list = q === ''
    ? POINT_SUGGESTIONS
    : POINT_SUGGESTIONS.filter((p) => `${p.value}\n${p.label}\n${p.sub}`.toLowerCase().includes(q))
  // свободный адрес: текст есть и он не совпадает (без регистра) ни с одним значением справочника
  const knownValue = POINT_SUGGESTIONS.some((p) => p.value.toLowerCase() === q)
  const showCustom = q !== '' && !knownValue

  return (
    <div ref={rootRef} className="relative">
      {/* в поле — текущее значение как есть: справочное или произвольный адрес;
          onChange уходит на каждое изменение, валидность (непустота) решает родитель */}
      <Input
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // закрыть только панель, а не диалог формы вокруг
            e.stopPropagation()
            setOpen(false)
          }
        }}
        placeholder={placeholder ?? 'Выберите точку'}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        autoComplete="off"
      />

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-1.5">
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-slate-400">Быстрый выбор</div>
            <button
              type="button"
              onClick={() => { onChange(AEMZ_VALUE); setOpen(false) }}
              className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
            >
              <Factory className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              <span className="block min-w-0 truncate text-sm font-medium text-slate-800">
                АЭМЗ · Абинский электрометаллургический завод
              </span>
            </button>
          </div>
          <div role="listbox" aria-label={ariaLabel ? `${ariaLabel}: точки справочника` : 'Точки справочника'} className="max-h-72 overflow-y-auto p-1">
            {list.map((p) => (
              <button
                key={p.value}
                type="button"
                role="option"
                aria-selected={p.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(p.value); setOpen(false) }}
                className="flex min-h-9 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{p.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.sub}</span>
                </span>
              </button>
            ))}
            {list.length === 0 && !showCustom && (
              <div className="px-3 py-4 text-sm text-slate-500">Ничего не найдено</div>
            )}
            {showCustom && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(value.trim()); setOpen(false) }}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                <span className="block min-w-0 truncate text-sm text-slate-700">Использовать адрес: «{value.trim()}»</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

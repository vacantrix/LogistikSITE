'use client'

/**
 * Автокомплит адресов «Точка А / Точка Б» в форме создания заявки (Task 64).
 * Подсказки берутся из справочника точек платформы (src/lib/points.ts):
 * выбор подсказки гарантирует, что маршрут, карта и расстояние КМ посчитаются
 * корректно; при этом свободный ввод адреса не запрещён.
 */
import { useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { POINT_SUGGESTIONS } from '@/lib/points'

export function PointAutocomplete({ id, value, onChange, placeholder, ariaLabel }: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)

  const items = useMemo(() => {
    const needle = value.trim().toLowerCase()
    if (!needle) return POINT_SUGGESTIONS.slice(0, 6)
    return POINT_SUGGESTIONS
      .filter((p) => [p.value, p.label, p.sub].some((v) => v.toLowerCase().includes(needle)))
      .slice(0, 6)
  }, [value])

  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false) }}>
      <Input
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open && items.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          role="listbox"
          aria-label="Подсказки адресов"
        >
          {items.map((p) => (
            <li key={p.value} role="option" aria-selected={p.value === value}>
              {/* onMouseDown до blur — иначе клик не успевает сработать */}
              <button
                type="button"
                tabIndex={-1}
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-blue-50"
                onMouseDown={(e) => { e.preventDefault(); onChange(p.value); setOpen(false) }}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">{p.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.sub}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

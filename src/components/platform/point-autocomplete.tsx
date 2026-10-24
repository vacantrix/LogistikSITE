'use client'

/**
 * Выбор точки «Точка А / Точка Б» в формах заявки (Task 64).
 * Только точки справочника платформы (src/lib/points.ts): в заявку пишется город
 * («Абинск», «Сочи»), полный адрес виден в списке — маршрут, карта и расстояние КМ
 * считаются корректно, а «Завод → Порт» и опечатки в маршрут не попадают.
 */
import { MapPin } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { POINT_SUGGESTIONS } from '@/lib/points'

export function PointSelect({ id, value, onChange, placeholder, ariaLabel }: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
}) {
  const selected = POINT_SUGGESTIONS.find((p) => p.value === value)
  return (
    <Select value={selected ? value : ''} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={ariaLabel} className="w-full">
        {/* в поле — только город (то, что попадёт в маршрут), название и адрес — в раскрытом списке */}
        <SelectValue placeholder={placeholder ?? 'Выберите точку'}>{selected?.value}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {POINT_SUGGESTIONS.map((p) => (
          <SelectItem key={p.value} value={p.value} className="py-2">
            <span className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">{p.label}</span>
                <span className="block text-xs text-muted-foreground">{p.sub}</span>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

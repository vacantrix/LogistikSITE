import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ── Месяцы для проформ-отчётов (Task 99) — клиентски-безопасный общий код ── */

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

/** «Октябрь 2025» из «2025-10» */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_RU[(m ?? 1) - 1] ?? ym} ${y}`
}

/* ── Дни периода для проформ-отчётов (Task 100) ── */

/** «YYYY-MM-DD» из даты (параметры периода отчётов) */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** «01.05.2025» — человекочитаемая дата */
export function fmtDayRu(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

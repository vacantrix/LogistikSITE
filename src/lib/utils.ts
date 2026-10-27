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

/** «2025-10» из даты */
export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** «Октябрь 2025» из «2025-10» */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_RU[(m ?? 1) - 1] ?? ym} ${y}`
}

/* ── Дни периода для проформ-отчётов (Task 100) ── */

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** «YYYY-MM-DD» из даты (параметры периода отчётов) */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** локальная Date (полночь) из «YYYY-MM-DD», null если строка не дата */
export function parseDay(s: string | null | undefined): Date | null {
  if (!s || !DAY_RE.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
  return Number.isNaN(dt.getTime()) ? null : dt
}

/** «01.05.2025» — человекочитаемая дата */
export function fmtDayRu(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

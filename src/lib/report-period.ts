/**
 * Период отчётов по московскому времени.
 *
 * Границы дней и месяцев считаются по МСК, а не по часовому поясу сервера: на сервере
 * в UTC заявка, созданная 1-го числа до 03:00 МСК, иначе попадала в прошлый месяц.
 * В Москве с 2014 года нет перехода на летнее время — смещение всегда +3 ч.
 *
 * Модуль без зависимостей: его можно проверить отдельно под разными TZ.
 */

const MSK_OFFSET_MS = 3 * 3600_000
const DAY_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** календарный день; m — 1…12 */
export interface CalendarDay { y: number; m: number; d: number }

export type PeriodKind = 'current-month' | 'done-month' | 'range'

export interface ReportPeriod {
  /** начало периода (включительно) и конец (не включая) — моменты времени для сравнения с createdAt */
  from: Date
  to: Date
  /** первый и последний день периода по МСК */
  first: CalendarDay
  last: CalendarDay
  /** идущий месяц (проекция) / полный месяц / произвольный диапазон */
  kind: PeriodKind
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** день по МСК, в который попадает момент времени */
export function mskDay(t: Date): CalendarDay {
  const s = new Date(t.getTime() + MSK_OFFSET_MS)
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate() }
}

/** полночь по МСК; день за пределами месяца переносится, как в Date.UTC (d + 1 — следующий день) */
export function mskMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - MSK_OFFSET_MS)
}

export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** «2026-10-05» */
export const isoDay = (x: CalendarDay): string => `${x.y}-${pad(x.m)}-${pad(x.d)}`
/** «05.10.2026» */
export const ruDay = (x: CalendarDay): string => `${pad(x.d)}.${pad(x.m)}.${x.y}`
/** «2026-10» */
export const isoMonth = (x: CalendarDay): string => `${x.y}-${pad(x.m)}`

/** «YYYY-MM-DD» → день; null — не дата, в том числе несуществующая (31.02) */
export function parseIsoDay(s: string | null | undefined): CalendarDay | null {
  const mt = s ? DAY_RE.exec(s) : null
  if (!mt) return null
  const x = { y: Number(mt[1]), m: Number(mt[2]), d: Number(mt[3]) }
  return x.d <= daysInMonth(x.y, x.m) ? x : null
}

/**
 * Период по параметрам запроса: from/to — «YYYY-MM-DD» включительно (перепутанные
 * местами даты упорядочиваются), month — legacy «YYYY-MM». Без параметров — текущий
 * месяц с 1-го числа по сегодня.
 */
export function resolvePeriod(params: { from?: string; to?: string; month?: string } = {}, now = new Date()): ReportPeriod {
  const today = mskDay(now)
  const f = parseIsoDay(params.from)
  const t = parseIsoDay(params.to)
  const month = params.month ? MONTH_RE.exec(params.month) : null
  let first: CalendarDay
  let last: CalendarDay
  if (f && t) {
    [first, last] = isoDay(f) <= isoDay(t) ? [f, t] : [t, f]
  } else if (month) {
    const y = Number(month[1])
    const m = Number(month[2])
    first = { y, m, d: 1 }
    last = { y, m, d: daysInMonth(y, m) }
  } else {
    first = { ...today, d: 1 }
    last = today
  }

  const from = mskMidnight(first.y, first.m, first.d)
  const to = mskMidnight(last.y, last.m, last.d + 1)
  const startsMonth = first.d === 1
  const kind: PeriodKind = startsMonth && isoMonth(first) === isoMonth(today) && to.getTime() > now.getTime()
    ? 'current-month'
    : startsMonth && isoMonth(last) === isoMonth(first) && last.d === daysInMonth(first.y, first.m)
      ? 'done-month'
      : 'range'
  return { from, to, first, last, kind }
}

/**
 * Сроки действия документов справочника: подсчёт дней до истечения
 * и состояния подсветки. Используется в «базе аккаунта» (Справочники)
 * и в блоке «Требуют внимания».
 *
 * Пороги: истёк (< 0 дней) → красный; ≤ 30 дней → янтарный;
 * ≤ 90 дней → нейтральный «скоро»; дальше — обычная дата.
 */

export type ExpiryState = 'none' | 'ok' | 'soon' | 'warn' | 'expired'

export interface ExpiryInfo {
  state: ExpiryState
  /** дней до истечения; отрицательное = истёк N дней назад; null — дату не распознать */
  days: number | null
  /** исходная строка даты (ДД.ММ.ГГГГ) */
  date: string
  /** краткий текст бейджа */
  label: string
  /** классы бейджа */
  badgeCls: string
  /** фон строки таблицы для подсветки */
  rowCls: string
}

const WARN_DAYS = 30
const SOON_DAYS = 90

const NONE: ExpiryInfo = {
  state: 'none', days: null, date: '', label: 'нет данных',
  badgeCls: 'border-slate-200 bg-slate-50 text-slate-400', rowCls: '',
}

function parseRu(dateStr: string): Date | null {
  const m = dateStr.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null
}

export function expiryInfo(dateStr?: string | null): ExpiryInfo {
  const date = (dateStr ?? '').trim()
  if (!date || date === '—') return NONE
  const d = parseRu(date)
  if (!d) return NONE
  // дни до конца указанного дня (дата истечения ещё «действует» весь день)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000)

  if (days < 0) {
    return {
      state: 'expired', days, date,
      label: `Истёк ${date} (${Math.abs(days)} дн. назад)`,
      badgeCls: 'border-red-300 bg-red-50 text-red-700',
      rowCls: 'bg-red-50/70',
    }
  }
  if (days <= WARN_DAYS) {
    return {
      state: 'warn', days, date,
      label: days === 0 ? `Истекает сегодня (${date})` : `Истекает ${date} · через ${days} дн.`,
      badgeCls: 'border-amber-300 bg-amber-50 text-amber-700',
      rowCls: 'bg-amber-50/60',
    }
  }
  if (days <= SOON_DAYS) {
    return {
      state: 'soon', days, date,
      label: `${date} · через ${days} дн.`,
      badgeCls: 'border-slate-300 bg-slate-50 text-slate-600',
      rowCls: '',
    }
  }
  return { state: 'ok', days, date, label: date, badgeCls: '', rowCls: '' }
}

/** Наихудшее из двух состояний (для подсветки всей строки) */
export function worseState(a: ExpiryState, b: ExpiryState): ExpiryState {
  const rank: Record<ExpiryState, number> = { none: 0, ok: 1, soon: 2, warn: 3, expired: 4 }
  return rank[a] >= rank[b] ? a : b
}

/** Класс строки таблицы по наихудшему состоянию */
export function rowTint(states: ExpiryState[]): string {
  const worst = states.reduce(worseState, 'ok' as ExpiryState)
  if (worst === 'expired') return 'bg-red-50/70'
  if (worst === 'warn') return 'bg-amber-50/60'
  return ''
}

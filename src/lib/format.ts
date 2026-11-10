/** Форматирование времени/расстояний (ru). Все метки — epoch millis. */

export function fmtClock(ms?: number | null): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDuration(ms?: number | null): string {
  if (ms == null || ms < 0) return '—'
  const min = Math.floor(ms / 60_000)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} мин`
  return `${h} ч ${m} мин`
}

export function fmtKm(meters?: number | null): string {
  if (meters == null) return '—'
  const km = meters / 1000
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} км`
  return `${Math.round(km)} км`
}

export function fmtTtl(msLeft: number): string {
  if (msLeft <= 0) return 'истекла'
  const min = Math.floor(msLeft / 60_000)
  if (min < 60) return `осталось ${min} мин`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `осталось ${hours} ч ${min % 60} мин`
  const days = Math.floor(hours / 24)
  return `осталось ${days} дн`
}

export function timeAgo(ms: number, now = Date.now()): string {
  const diff = now - ms
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  return fmtClock(ms)
}

/** Статусы, режимы, цвета, форматтеры — общий слой UI */

import type { DocStatus, RequestMode, RequestStatus } from '@/lib/types'

export const REQUEST_STATUS_META: Record<RequestStatus, { label: string; short: string; badge: string; dot: string }> = {
  PUBLISHED: { label: 'На площадке', short: 'На площадке', badge: 'bg-sky-100 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  AWARDED: { label: 'Перевозчик выбран', short: 'Выбран', badge: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  DOCS_REVIEW: { label: 'Документы проверяются', short: 'Проверка', badge: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  AT_LOGIST: { label: 'У логиста — сверка', short: 'У логиста', badge: 'bg-blue-100 text-blue-800 border-blue-200', dot: 'bg-blue-600' },
  CONFIRMED: { label: 'Данные в 1С', short: 'В 1С', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  CLOSED: { label: 'Рейс закрыт', short: 'Закрыт', badge: 'bg-slate-200 text-slate-700 border-slate-300', dot: 'bg-slate-500' },
}

export const MODE_META: Record<RequestMode, { label: string; badge: string; icon: string }> = {
  AUCTION: { label: 'Торги на понижение', badge: 'bg-blue-50 text-blue-700 border-blue-200', icon: '📉' },
  CLOSED: { label: 'Закрытые ставки', badge: 'bg-slate-100 text-slate-700 border-slate-200', icon: '🙈' },
}

export const DOC_STATUS_META: Record<DocStatus, { label: string; badge: string }> = {
  PENDING: { label: 'На проверке', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
  PASSED: { label: 'Передать дальше', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  REUPLOAD: { label: 'Перезагрузить документ', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  REJECTED: { label: 'Отказ с причиной', badge: 'bg-red-100 text-red-800 border-red-200' },
  MANUAL: { label: 'Ручная проверка', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
}

export const DOC_TYPE_LABEL: Record<string, string> = {
  PASSPORT_PHOTO: 'Паспорт: стр. с фото',
  PASSPORT_REG: 'Паспорт: регистрация',
  LICENSE: 'Водительское удостоверение',
  STS: 'СТС, лицевая сторона',
}

/** Реестр: 8 статусов записи по порядку */
export const REGISTRY_STEPS = [
  'Создана', 'Опубликована', 'Перевозчик выбран', 'Документы проверены',
  'Пропуск оформлен', 'В пути', 'Выполнена', 'Закрыта',
]

export function registryStepIndex(status: string, passPackage: boolean, etrnStatus: string): number {
  switch (status) {
    case 'PUBLISHED': return 1
    case 'AWARDED': return 2
    case 'DOCS_REVIEW': return 3
    case 'AT_LOGIST': return 3
    case 'CONFIRMED': return passPackage ? (etrnStatus === 'SIGNED' ? 6 : 4) : 4
    case 'CLOSED': return 7
    default: return 0
  }
}

export const money = (v: number | null | undefined): string =>
  v == null ? '—' : `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽`

export const num = (v: number): string => new Intl.NumberFormat('ru-RU').format(v)

export function timeLeft(deadline: string | null): { text: string; urgent: boolean } | null {
  if (!deadline) return null
  const ms = new Date(deadline).getTime() - Date.now()
  if (ms <= 0) return { text: 'Срок истёк', urgent: true }
  const h = Math.floor(ms / 3600_000)
  const m = Math.floor((ms % 3600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { text: h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`, urgent: ms < 3600_000 }
}

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

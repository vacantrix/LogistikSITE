import type { RequestDTO } from '@/lib/types'

/**
 * Правило занятости (Task 50, расширено): водитель, ТС и прицеп, закреплённые
 * за заявкой в работе, нельзя назначить на другую заявку — иначе один водитель
 * окажется на двух рейсах сразу. «В работе» — с момента выбора перевозчика
 * (экипаж назначен, документы, сверка у логиста) и до закрытия рейса.
 *
 * Состав своей же заявки можно свободно менять до передачи логисту; CLOSED
 * освобождает технику — рейс уже выполнен. Правило одинаково на сервере
 * (src/lib/requests.ts → validateCrew) и в интерфейсе (busyMaps).
 */
export const BUSY_STATUSES: RequestDTO['status'][] = ['AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED']

/** Где занят ресурс: какая заявка и какой у неё статус */
export interface BusyInfo {
  requestId: string
  number: string
  status: RequestDTO['status']
}

/** Подпись занятости для всплывающей подсказки */
export function busyReason(status: RequestDTO['status']): string {
  if (status === 'CONFIRMED') return 'в рейсе'
  if (status === 'AT_LOGIST') return 'готовится к рейсу'
  return 'назначен на рейс'
}

export interface BusyMaps {
  drivers: Map<string, BusyInfo>
  trucks: Map<string, BusyInfo>
  trailers: Map<string, BusyInfo>
}

/** Карты занятости по списку заявок: id ресурса → заявка, за которой он закреплён */
export function busyMaps(requests: RequestDTO[]): BusyMaps {
  const drivers = new Map<string, BusyInfo>()
  const trucks = new Map<string, BusyInfo>()
  const trailers = new Map<string, BusyInfo>()
  for (const r of requests) {
    if (!BUSY_STATUSES.includes(r.status)) continue
    if (r.driverId) drivers.set(r.driverId, { requestId: r.id, number: r.number, status: r.status })
    if (r.truckId) trucks.set(r.truckId, { requestId: r.id, number: r.number, status: r.status })
    if (r.trailerId) trailers.set(r.trailerId, { requestId: r.id, number: r.number, status: r.status })
  }
  return { drivers, trucks, trailers }
}

/** Занят ли ресурс другой заявкой (своя заявка ресурс не блокирует) */
export function busyElsewhere(map: Map<string, BusyInfo>, id: string | null | undefined, requestId: string): BusyInfo | null {
  if (!id) return null
  const b = map.get(id)
  return b && b.requestId !== requestId ? b : null
}

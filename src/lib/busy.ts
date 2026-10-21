import type { RequestDTO } from '@/lib/types'

/**
 * Правило занятости (Task 50): водитель, ТС и прицеп, которые закреплены за
 * рейсом, находящимся в работе (комплект у логиста или данные уже в 1С),
 * считаются «в рейсе» — выбрать их под другую заявку нельзя. При попытке
 * выбора появляется сообщение «Водитель/ТС/Прицеп — занят».
 *
 * Рейсы на более ранних этапах (площадка, подтверждено, документы) ресурс
 * ещё не занимают — состав там можно свободно менять; CLOSED освобождает
 * технику — рейс уже выполнен.
 */
export const BUSY_STATUSES: RequestDTO['status'][] = ['AT_LOGIST', 'CONFIRMED']

/** Где занят ресурс: какая заявка и какой у неё статус */
export interface BusyInfo {
  requestId: string
  number: string
  status: RequestDTO['status']
}

/** Подпись занятости для всплывающей подсказки: «в рейсе» / «готовится к рейсу» */
export function busyReason(status: RequestDTO['status']): string {
  return status === 'CONFIRMED' ? 'в рейсе' : 'готовится к рейсу'
}

export interface BusyMaps {
  drivers: Map<string, BusyInfo>
  trucks: Map<string, BusyInfo>
  trailers: Map<string, BusyInfo>
}

/** Карты занятости по списку заявок: id ресурса → заявка, по которой он в рейсе */
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

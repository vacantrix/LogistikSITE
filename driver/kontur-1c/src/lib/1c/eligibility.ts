// Правила проведения при назначении (раздел 5.3 ТЗ):
// готовность ТС, грузоподъёмность, совместимость кузова и груза, активность и занятость водителя, статус заявки.
import type { Prisma } from '@prisma/client'

export type VehicleLite = {
  id: string
  plate: string
  model: string
  bodyType: string
  capacityT: number
  readiness: string
  isActive: boolean
}
export type DriverLite = { id: string; fullName: string; isActive: boolean }

// Справочная матрица «тип кузова → виды груза» (ключевые слова на русском)
const BODY_CARGO: Record<string, string[]> = {
  tarp: ['металло', 'паллет', 'мешк', 'ферм', 'прокат', 'лист', 'оборудован', 'пиломатериал', 'труб', 'рулон', 'шпала', 'кирпич'],
  fridge: ['продукт', 'мясо', 'рыба', 'молок', 'заморож', 'овощ', 'фрукт', 'морожен', 'медикамент', 'цвет'],
  flatbed: ['металло', 'прокат', 'лист', 'труб', 'жби', 'плита', 'бетон', 'кирпич', 'ферм', 'контейнер', 'рулон'],
  tank: ['наливн', 'топлив', 'молок наливн', 'битум'],
}

// Груз распознан хотя бы одной строкой матрицы? Если нет — совместимость
// кузова проверить нечем, поэтому не блокируем все ТС подряд (иначе любой
// произвольный текст, например «ТТН», делает таблицу полностью красной).
export function isCargoClassified(cargo: string): boolean {
  const c = cargo.toLowerCase()
  return Object.values(BODY_CARGO).some((keys) => keys.some((k) => c.includes(k)))
}

export function bodyCompatible(bodyType: string, cargo: string): boolean {
  const keys = BODY_CARGO[bodyType]
  if (!keys) return false
  if (!isCargoClassified(cargo)) return true
  const c = cargo.toLowerCase()
  return keys.some((k) => c.includes(k))
}

export type EligibilityIssue = { code: string; text: string }

export function vehicleIssues(v: VehicleLite, request: { cargo: string; weightT: number }): EligibilityIssue[] {
  const issues: EligibilityIssue[] = []
  if (!v.isActive) issues.push({ code: 'VEHICLE_INACTIVE', text: 'ТС выведено из эксплуатации' })
  if (v.readiness !== 'ready')
    issues.push({ code: 'VEHICLE_NOT_READY', text: `ТС недоступно: ${v.readiness === 'repair' ? 'в ремонте' : 'на обслуживании'}` })
  if (request.weightT > v.capacityT)
    issues.push({ code: 'CAPACITY', text: `Грузоподъёмность ${v.capacityT} т меньше веса груза ${request.weightT} т` })
  if (!bodyCompatible(v.bodyType, request.cargo))
    issues.push({ code: 'BODY_TYPE', text: 'Тип кузова не совместим с грузом' })
  return issues
}

export async function driverIssues(
  tx: Prisma.TransactionClient,
  d: DriverLite,
): Promise<EligibilityIssue[]> {
  const issues: EligibilityIssue[] = []
  if (!d.isActive) issues.push({ code: 'DRIVER_INACTIVE', text: 'Водитель не активен' })
  const busy = await tx.trip.findFirst({
    where: { driverId: d.id, status: { in: ['assigned', 'in_progress'] } },
    select: { tripCode: true },
  })
  if (busy)
    issues.push({
      code: 'DRIVER_BUSY',
      text: `Занят в незавершённом рейсе ${busy.tripCode} — завершите его в реестре «Рейсы» или в приложении водителя`,
    })
  return issues
}

export const BODY_TYPE_LABELS: Record<string, string> = {
  tarp: 'штора',
  fridge: 'рефрижератор',
  flatbed: 'борт',
  tank: 'цистерна',
}
export const READINESS_LABELS: Record<string, string> = {
  ready: 'готов',
  maintenance: 'обслуживание',
  repair: 'ремонт',
}
export const KIND_LABELS: Record<string, string> = {
  tractor: 'тягач',
  tipper: 'самосвал',
  van: 'фургон',
}

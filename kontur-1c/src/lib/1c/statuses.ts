// Статусная модель заявки (раздел 5 ТЗ) и маппинг в статусы приложения водителя
export const REQUEST_STATUSES = [
  'NEW',
  'DISPATCH',
  'ASSIGNED',
  'ACCEPTED',
  'PRETRIP',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const STATUS_LABELS: Record<string, string> = {
  NEW: 'Заведена сбытом',
  DISPATCH: 'В диспетчерской',
  ASSIGNED: 'Назначена ТС и водителю',
  ACCEPTED: 'Взята водителем',
  PRETRIP: 'Предрейсовая подготовка',
  IN_PROGRESS: 'В пути',
  DONE: 'Выполнена',
  CANCELLED: 'Отменена',
}

// Таблица 8 ТЗ: внутренний статус → Order1C.status для водителя
export function mapOrderStatus(internal: string): 'DISPATCH' | 'ASSIGNED' | 'DONE' | null {
  switch (internal) {
    case 'NEW':
    case 'DISPATCH':
      return 'DISPATCH'
    case 'ASSIGNED':
    case 'ACCEPTED':
    case 'PRETRIP':
    case 'IN_PROGRESS':
      return 'ASSIGNED'
    case 'DONE':
      return 'DONE'
    default:
      return null // CANCELLED не возвращается — водитель получит SystemNote
  }
}

// Причины отмены («1С»: справочник причин закрытия заказов)
export const CANCEL_REASONS = [
  'Отмена заказчиком',
  'Нет доступного ТС',
  'Ошибка в заявке',
  'Груз не готов к отправке',
  'Отказ грузополучателя',
  'Дублирование заявки',
]

// Справочник шагов предрейсовой фотофиксации (таблица 9 ТЗ).
// Ровно три шага по требованиям заказчика — те же stepId, что в приложении
// водителя (src/lib/demo/orders-data.ts): согласованы через обратный канал
// PRETRIP_STEP, без маппинга наименований.
export const PRETRIP_STEPS = [
  { stepId: 'veh_front', label: 'Автомобиль спереди: кабина целиком, госномер в кадре', group: 'vehicle' },
  { stepId: 'trailer_rear', label: 'Прицеп сзади: кузов и прицеп целиком, госномер виден', group: 'vehicle' },
  { stepId: 'selfie_docs', label: 'Селфи с документами: водитель с документами по заявке', group: 'personal' },
] as const
export type PretripStepId = (typeof PRETRIP_STEPS)[number]['stepId']
export const PRETRIP_STEP_IDS = PRETRIP_STEPS.map((s) => s.stepId) as PretripStepId[]

/**
 * Демо-данные заявок (зеркало будущего интегрируемого потока 1С).
 *
 * Целевой процесс (со слов заказчика):
 *   Сбыт-отдел формирует заявки в 1С → из доступных и готовых ТС диспетчерская
 *   назначает водителя и ТС → водитель получает заявку в приложении.
 *
 * В проде водительский клиент получает их через серверный прокси
 * GET /api/1c/orders (HTTP-сервис 1С:Документооборот/УТ), статусы возвращает
 * POST /api/1c/orders. Здесь — те же JSON-контракты на демо-данных.
 */

export interface Order1C {
  /** Номер заявки, как в 1С (совпадает с tripCode рейса). */
  number: string
  /** GUID объекта 1С — для обратной синхронизации статусов. */
  externalId: string
  client: string
  cargo: string
  weightT: number
  fromLabel: string
  toLabel: string
  /** Плановая дата-время погрузки (ISO). */
  loadingAt: string
  /** Окно выгрузки (текстом, как в 1С). */
  unloadingWindow: string
  vehicle: string
  trailer: string
  /** Документы по заявке, которые водитель фотографирует перед рейсом. */
  docs: string[]
  distanceKm: number
  durationMin: number
  /** ASSIGNED — назначена водителю (можно взять); DISPATCH — ждёт решения диспетчерской; DONE — выполнена (в истории). */
  status: 'ASSIGNED' | 'DISPATCH' | 'DONE'
  /** Кто и когда назначил (диспетчерская). */
  assignedBy: string
  /**
   * Маршрут офиса из Яндекс.Карт. Офис строит маршрут в Яндексе и вставляет
   * ссылку; платформа присылает точки по порядку и готовую дорожную линию.
   * Приложение не подменяет их фиксированными точками демо-рейса.
   */
  routeLink?: string | null
  routeWaypoints?: { lat: number; lng: number }[]
  /** Готовая линия через точки офиса: [[lon,lat],…] (порядок GeoJSON). */
  routeCoords?: [number, number][]
  routeDistanceM?: number | null
  routeDurationS?: number | null
  routeSource?: 'yandex' | 'osrm' | null
}

export const DEMO_ORDERS: Order1C[] = [
  {
    number: 'ЗК-1067',
    externalId: 'b3f1c2a4-7d9e-4c1b-a6f8-2e5d8b9c0a71',
    client: 'ООО «Новороссийский терминал»',
    cargo: 'Металлоконструкции (фермы), штучные',
    weightT: 18.5,
    fromLabel: 'Абинск, пл. АЗМЗ',
    toLabel: 'Новороссийск, причал 27',
    loadingAt: new Date(new Date().setHours(9, 30, 0, 0)).toISOString(),
    unloadingWindow: 'сегодня 14:00–16:00',
    vehicle: 'МАЗ 5440 · А 123 БС 23',
    trailer: 'НЕФАЗ 93341 · АВ 456 23',
    docs: ['ТТН (2 экз.)', 'Паспорт груза', 'Пропуск на терминал', 'Акт допуска ТС'],
    distanceKm: 115,
    durationMin: 150,
    status: 'ASSIGNED',
    assignedBy: 'Диспетчер Е. Крылова',
  },
  {
    number: 'ЗК-1071',
    externalId: '9c4e8f21-3a7b-4d2c-b5e9-1f8a6d7c3b40',
    client: 'ООО «Кубань Агро»',
    cargo: 'Сахар-песок в мешках, 40 паллет',
    weightT: 17.0,
    fromLabel: 'Тимашевск, элеватор',
    toLabel: 'Краснодар, РЦ «Прогресс»',
    loadingAt: new Date(Date.now() + 26 * 3_600_000).toISOString(),
    unloadingWindow: 'завтра 08:00–12:00',
    vehicle: 'КАМАЗ 5490 · В 789 КС 93',
    trailer: 'Schmitz SCS · МН 210 93',
    docs: ['ТТН', 'Качественное удостоверение', 'Счёт-фактура'],
    distanceKm: 88,
    durationMin: 110,
    status: 'DISPATCH',
    assignedBy: '—',
  },
  {
    number: 'ЗК-1074',
    externalId: '5d8b2c93-1e6f-4a9d-8c7b-0f3a9e2d5c14',
    client: 'ООО «Донсталь»',
    cargo: 'Металлопрокат листовой, 2 шт.',
    weightT: 20.2,
    fromLabel: 'Абинск, пл. АЗМЗ',
    toLabel: 'Ростов-на-Дону, склад №4',
    loadingAt: new Date(Date.now() + 50 * 3_600_000).toISOString(),
    unloadingWindow: 'завтра 18:00–20:00',
    vehicle: 'МАЗ 6312 · Е 345 ОР 23',
    trailer: '—',
    docs: ['ТТН', 'Сертификат качества', 'Пропуск на склад'],
    distanceKm: 492,
    durationMin: 540,
    status: 'DISPATCH',
    assignedBy: '—',
  },
]

/**
 * Выполненная заявка для экрана «История» (этап 1 — отдельной вкладкой,
 * далее раздел переедет в «Настройки»). Заполняется: демо-сид + реальные
 * завершённые рейсы (прибытие → «Завершить рейс»).
 */
export interface HistoryEntry {
  number: string
  client: string
  cargo: string
  fromLabel: string
  toLabel: string
  distanceKm: number
  vehicle: string
  /** Когда рейс фактически завершён (ISO). */
  completedAt: string
  /** Фактическое время в пути, мин (для истории — плановое в демо-сиде). */
  durationMin: number
  status: 'DONE'
}

/** Демо-история за прошлую неделю — чтобы вкладка не была пустой на старте. */
export const DEMO_HISTORY: HistoryEntry[] = [
  {
    number: 'ЗК-1063',
    client: 'ООО «Кубань Агро»',
    cargo: 'Сахар-песок в мешках, 32 паллеты',
    fromLabel: 'Тимашевск, элеватор',
    toLabel: 'Краснодар, РЦ «Прогресс»',
    distanceKm: 88,
    vehicle: 'КАМАЗ 5490 · В 789 КС 93',
    completedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    durationMin: 118,
    status: 'DONE',
  },
  {
    number: 'ЗК-1059',
    client: 'ООО «Новороссийский терминал»',
    cargo: 'Металлоконструкции (фермы), штучные',
    fromLabel: 'Абинск, пл. АЗМЗ',
    toLabel: 'Новороссийск, причал 27',
    distanceKm: 115,
    vehicle: 'МАЗ 5440 · А 123 БС 23',
    completedAt: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(),
    durationMin: 161,
    status: 'DONE',
  },
  {
    number: 'ЗК-1052',
    client: 'ООО «Донсталь»',
    cargo: 'Металлопрокат листовой, 2 шт.',
    fromLabel: 'Абинск, пл. АЗМЗ',
    toLabel: 'Ростов-на-Дону, склад №4',
    distanceKm: 492,
    vehicle: 'МАЗ 6312 · Е 345 ОР 23',
    completedAt: new Date(Date.now() - 5 * 24 * 3_600_000).toISOString(),
    durationMin: 552,
    status: 'DONE',
  },
]

/** Шаги предрейсовой фотофиксации (перед кнопкой «Начать маршрут»). */
export interface PretripStepDef {
  id: string
  label: string
  hint: string
  kind: 'vehicle' | 'order_docs' | 'personal'
}

export const PRETRIP_STEPS: PretripStepDef[] = [
  { id: 'veh_side', label: 'Фото ТС — бок', hint: 'Правый борт целиком, госномер в кадре', kind: 'vehicle' },
  { id: 'veh_front', label: 'Фото ТС — голова', hint: 'Спереди, виден госномер тягача', kind: 'vehicle' },
  { id: 'veh_rear', label: 'Фото ТС — сзади', hint: 'Кузов и полуприцеп сзади', kind: 'vehicle' },
  { id: 'order_docs', label: 'Документы по заявке', hint: 'ТТН, паспорт груза, пропуск', kind: 'order_docs' },
  { id: 'lic', label: 'Фото ВУ', hint: 'Водительское удостоверение, обе стороны', kind: 'personal' },
  { id: 'passport', label: 'Фото паспорта', hint: 'Разворот с фото и регистрацией', kind: 'personal' },
]

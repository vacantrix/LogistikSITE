// Реестр сервисов ATI.SU для панели интеграции: что бесплатно и уже подключено
// живыми запросами, что бесплатно по документации (не тестируем в этой итерации),
// что платно (подключено заглушкой, реальные запросы не отправляются).
// Источники: ati.su/developers (документация), ati.su/prices (прайс с 01.01.2026).

export type AtiTier = 'free' | 'paid'
export type AtiStatus = 'live' | 'dryrun' | 'docs' | 'stub'

export type AtiService = {
  id: string
  tier: AtiTier
  status: AtiStatus
  title: string
  what: string
  endpoint?: string
  price?: string
  limits?: string
  backhaul: boolean // участвует в сценарии обратных рейсов
}

export const ATI_SERVICES: AtiService[] = [
  // ---- Бесплатно: проверено живыми запросами (live) ----
  {
    id: 'balance',
    tier: 'free',
    status: 'live',
    title: 'Баланс',
    what: 'Баланс контакта (атисы) — контроль средств на приоритетный показ и подписку на грузы.',
    endpoint: 'GET /v1.0/balance',
    backhaul: false,
  },
  {
    id: 'dictionaries',
    tier: 'free',
    status: 'live',
    title: 'Словари ATI.SU',
    what: 'Типы грузов, кузова, способы погрузки, упаковка, формы собственности, формы оплаты — для маппинга заявок и машин.',
    endpoint: 'GET /v1.0/dictionaries/{cargoTypes|carTypes|loadingTypes|packTypes|ownerships|moneyTypes}',
    limits: 'кэш 24 ч на стороне интеграции',
    backhaul: true,
  },
  {
    id: 'cities',
    tier: 'free',
    status: 'live',
    title: 'Гео-словарь городов',
    what: 'Имена городов по id из выдачи грузов и площадок — сопоставление направлений с рейсами АЭМЗ.',
    endpoint: 'POST /gw/gis-dict/v1/cities/by-ids',
    backhaul: true,
  },
  {
    id: 'trucks_list',
    tier: 'free',
    status: 'live',
    title: 'Ваши машины: список',
    what: 'Опубликованные машины фирмы (сейчас 0) — контроль, что висит на бирже.',
    endpoint: 'GET /gw/trucks/integrator/v1/trucks (+ /count)',
    backhaul: true,
  },
  {
    id: 'loads_by_boards',
    tier: 'free',
    status: 'live',
    title: 'Грузы закрытых площадок',
    what: 'Поиск грузов на Площадках, где состоит АЭМЗ (общая биржа в API-поиск не входит — ограничение ATI.SU). Источник обраток от партнёров.',
    endpoint: 'GET /gw/search_loads/integration/v1/loads/search/by-boards',
    limits: 'take ≤ 100, skip+take ≤ 10 000, выдача запоминается на 15 мин',
    backhaul: true,
  },
  // ---- Бесплатно: метод есть, но запись на реальную биржу выключена (dry-run) ----
  {
    id: 'truck_publish',
    tier: 'free',
    status: 'dryrun',
    title: 'Публикация машины на обратку',
    what: 'Выставить машину «ищу груз» с города выгрузки к базе. Черновик тела запроса собирается, отправка выключена (ATISU_ALLOW_WRITES=false).',
    endpoint: 'POST /gw/trucks/integrator/v1/trucks',
    limits: 'обновление машины — не чаще 1 раза в 60 мин',
    backhaul: true,
  },
  // ---- Бесплатно по документации: подключается по мере надобности (docs) ----
  {
    id: 'boards',
    tier: 'free',
    status: 'docs',
    title: 'Площадки',
    what: 'Своя площадка + приглашения партнёров — рекомендованный ATI.SU способ тестировать грузы без выхода на общую биржу.',
    endpoint: 'POST /v2/boards/public/boards/create, /participants/invite',
    backhaul: true,
  },
  {
    id: 'orders',
    tier: 'free',
    status: 'docs',
    title: 'Заказы и сделки',
    what: 'Оформление заказа по грузу, приглашение перевозчика, документы сделки.',
    endpoint: 'api.ati.su /v1.0 (orders)',
    backhaul: false,
  },
  {
    id: 'auctions',
    tier: 'free',
    status: 'docs',
    title: 'Торги',
    what: 'Автоматизация торгов по заказу на перевозку.',
    endpoint: 'api.ati.su (auctions)',
    backhaul: false,
  },
  {
    id: 'webhooks',
    tier: 'free',
    status: 'docs',
    title: 'Вебхуки',
    what: 'Push-уведомления об изменении грузов на площадках, заказах, приглашениях — вместо поллинга.',
    endpoint: 'api.ati.su (webhooks)',
    backhaul: true,
  },
  {
    id: 'messenger',
    tier: 'free',
    status: 'docs',
    title: 'АТИ Мессенджер',
    what: 'Переписка по грузам из кабинета.',
    endpoint: 'api.ati.su (messenger)',
    backhaul: false,
  },
  {
    id: 'doki',
    tier: 'free',
    status: 'docs',
    title: 'АТИ-Доки (ЭДО)',
    what: 'Электронные перевозочные документы. Подписание — 7 атисов за документ; ЭТрН обязательна с 01.09.2026.',
    endpoint: 'api.ati.su (doki)',
    backhaul: false,
  },
  // ---- Платно: заглушки, реальные запросы не отправляются (stub) ----
  {
    id: 'avg_rates',
    tier: 'paid',
    status: 'stub',
    title: 'API Средних ставок',
    what: 'Средние/мин/макс ставки по направлению — оценка доходности обратки.',
    price: '15 000 ₽ / 30 дн',
    backhaul: true,
  },
  {
    id: 'truck_search',
    tier: 'paid',
    status: 'stub',
    title: 'API Поиска транспорта',
    what: 'Свободные машины с контактами по направлению (роль грузовладельца).',
    price: '8 000 ₽ / 30 дн',
    backhaul: false,
  },
  {
    id: 'active_carriers',
    tier: 'paid',
    status: 'stub',
    title: 'API Поиска активных перевозчиков',
    what: 'Кто искал грузы/ставил машины по направлению — конкурентность обратного направления.',
    price: '12 000 ₽ / 30 дн',
    backhaul: false,
  },
  {
    id: 'distance',
    tier: 'paid',
    status: 'stub',
    title: 'API Расчёта расстояний',
    what: 'Точный маршрут, км и время в пути для плеча обратки.',
    price: '5 800 – 75 000 ₽ / 30 дн (1 000 – 50 000 з/с)',
    backhaul: true,
  },
  {
    id: 'geocoding',
    tier: 'paid',
    status: 'stub',
    title: 'API Геокодирования',
    what: 'Адрес ↔ координаты для карты и сопоставления точек.',
    price: '9 000 – 225 000 ₽ / 30 дн (1 000 – 50 000 з/с)',
    backhaul: false,
  },
  {
    id: 'nearest_cities',
    tier: 'paid',
    status: 'stub',
    title: 'API Ближайших городов',
    what: 'Города в радиусе от точки выгрузки — расширение поиска обратки.',
    price: '5 800 – 25 000 ₽ / 30 дн (1 000 – 10 000 з/с)',
    backhaul: true,
  },
]

/** Лицензии сайта, влияющие на видимость контактов (не API-подписки) — для справки в панели */
export const ATI_LICENSES_NOTE: { title: string; price: string; what: string }[] = [
  { title: 'Перевозчик', price: '3 990 ₽ / 30 дн', what: 'контакты по грузам, машинам, тендерам — без лицензии контакты в выдаче скрыты' },
  { title: 'Все грузы', price: '2 750 ₽ / 30 дн', what: 'контактная информация всех грузов без ограничений' },
  { title: 'Безлимитные уведомления о грузах', price: '2 290 ₽ / 30 дн', what: 'подписки на новые грузы по направлению без оплаты за сообщение' },
  { title: 'Статистика цен на грузоперевозки', price: '2 650 ₽ / 30 дн', what: 'сервисы «Средние ставки» и «Индекс ATI.SU» на сайте (данные, без API)' },
]

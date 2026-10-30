/**
 * Карта архитектуры платформы «АЭМЗ Логистика» — единый источник для раздела
 * «Архитектура» (виден администратору). Описывает, из чего состоит система,
 * как связаны части и что от чего зависит. Дерево статическое (меняется вместе
 * с кодом), а живые статусы сервисов приходят из /api/architecture/status.
 *
 * kinds:
 *   root — вершина дерева (контур системы)
 *   ui   — раздел интерфейса (вкладка платформы)
 *   api  — HTTP-маршрут (Next.js App Router, src/app/api)
 *   lib  — серверная библиотека (src/lib) — правила и логика
 *   service — отдельный процесс (мини-сервис / внешний)
 *   db   — база данных (таблицы Prisma)
 *   integration — внешняя интеграция (1С, туннель, нейросеть на ПК)
 */

export type ArchKind = 'root' | 'ui' | 'api' | 'lib' | 'service' | 'db' | 'integration'

export interface ArchNode {
  id: string
  label: string
  kind: ArchKind
  /** одно предложение — что это и как работает */
  desc?: string
  /** технология / файл, где живёт код */
  tech?: string
  /** порт или путь (API) */
  path?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** id сервисов из /api/architecture/status, от которых зависит узел */
  deps?: string[]
  children?: ArchNode[]
}

/** Живые сервисы: id совпадают с deps узлов и ответом /api/architecture/status */
export const ARCH_SERVICES = [
  { id: 'web', label: 'Веб-платформа', desc: 'Next.js 16 · порт 3000' },
  { id: 'db', label: 'База данных', desc: 'SQLite через Prisma' },
  { id: 'ws', label: 'Real-time шина', desc: 'socket.io · порт 3003' },
  { id: 'ocr-gateway', label: 'OCR-шлюз', desc: 'bun · порт 3020' },
  { id: 'neural', label: 'Нейросеть на ПК перевозчика', desc: 'PaddleOCR · туннель ngrok' },
  { id: 'onec', label: 'Шина 1С', desc: 'API-ключ · /api/integration/1c' },
] as const

export const ARCH_TREE: ArchNode[] = [
  {
    id: 'web',
    label: 'Веб-платформа (единый маршрут /)',
    kind: 'root',
    tech: 'Next.js 16 · App Router · Turbopack · порт 3000',
    desc: 'Всё работает на одном маршруте: роль берётся из сессии (/api/auth/me), разделы — вкладки под роль.',
    deps: ['web', 'db'],
    children: [
      {
        id: 'ui',
        label: 'Интерфейс — разделы по ролям',
        kind: 'root',
        tech: 'src/components/platform/*',
        desc: 'Логист и админ видят внутренний контур АЭМЗ, перевозчик — свой кабинет. Доступ к разделам режется ролью и правами (useCan).',
        children: [
          { id: 'ui-board', label: 'Площадка заявок', kind: 'ui', desc: 'Тендер: публикация заявок, ставки перевозчиков, перебитие, выбор победителя. Real-time обновление через шину WS.', deps: ['ws'] },
          { id: 'ui-drafts', label: 'Черновики заявок', kind: 'ui', desc: 'Заявки до публикации: ручные и пришедшие из 1С (бейдж «из 1С»). Публикация открывает тендер.', deps: [] },
          { id: 'ui-my', label: 'Мои заявки (перевозчик)', kind: 'ui', desc: 'Ставки, победы, обмен документами с логистом, кнопка «Отправить на проверку» — запуск нейросети своего ПК.', deps: [] },
          { id: 'ui-apply', label: 'Подать документы (перевозчик)', kind: 'ui', desc: 'Пополнение базы: водитель (12 полей + 2 фото), тягач и прицеп (по 3 фото). Нейропроверка читает сканы и допускает карточки в базу.', deps: ['ocr-gateway', 'neural'] },
          { id: 'ui-crew', label: 'Назначение экипажей', kind: 'ui', desc: 'Привязка водителя + тягача (+ прицепа) к заявке, на которую перевозчик выиграл тендер.', deps: [] },
          { id: 'ui-verify', label: 'Проверка документов', kind: 'ui', desc: 'Очередь комплектов: сверка «из заявки ↔ с документа» по каждому полю, решения логиста (принять/вернуть/отклонить).', deps: [] },
          { id: 'ui-requests', label: 'Реестр заявок', kind: 'ui', desc: 'Все заявки со статусами от черновика до закрытия рейса, журнал действий по каждой.', deps: [] },
          { id: 'ui-registry', label: 'Реестр рейсов', kind: 'ui', desc: 'Подтверждённые рейсы: экипаж, документы, выпуск и подписание ЭТрН.', deps: [] },
          { id: 'ui-edo', label: 'Подписать ЭДО', kind: 'ui', desc: 'Проформы и ЭТрН: статусы NONE → SENT → SIGNED, передача в 1С:ERP.', deps: [] },
          { id: 'ui-directory', label: 'Справочники', kind: 'ui', desc: 'Допущенные карточки водителей, тягачей и прицепов, сроки документов, ручное добавление.', deps: [] },
          { id: 'ui-reports', label: 'Отчёты', kind: 'ui', desc: 'Сводные показатели: заявки, ставки, перевозчики, документы.', deps: [] },
          { id: 'ui-journal', label: 'Журнал событий', kind: 'ui', desc: 'Технический журнал платформы: автопроверки, сбои OCR, действия пользователей.', deps: [] },
          { id: 'ui-admin-users', label: 'Профили и доступы', kind: 'ui', desc: 'Учётные записи, роли и гранулярные права (шаблоны доступа).', deps: [] },
          { id: 'ui-admin-db', label: 'База данных', kind: 'ui', desc: 'Прямой просмотр таблиц Prisma для администратора.', deps: ['db'] },
          { id: 'ui-arch', label: 'Архитектура', kind: 'ui', desc: 'Этот раздел: карта системы и живые статусы сервисов.', deps: ['web', 'db', 'ws', 'ocr-gateway', 'neural', 'onec'] },
          { id: 'ui-support', label: 'Обращения', kind: 'ui', desc: 'Переписка перевозчиков с поддержкой платформы.', deps: [] },
        ],
      },
      {
        id: 'api',
        label: 'API-маршруты',
        kind: 'root',
        tech: 'src/app/api/* · Next.js Route Handlers',
        desc: 'Только относительные вызовы с клиента; сессия — Bearer-токен или кука. Права проверяются на сервере.',
        children: [
          { id: 'api-auth', label: 'Аутентификация', kind: 'api', path: '/api/auth/{login,logout,me}', desc: 'Логин/пароль → Bearer-токен; /me отдаёт пользователя сессии. 401 в любом вызове возвращает на экран входа.' },
          { id: 'api-requests', label: 'Заявки и торги', kind: 'api', path: '/api/requests', method: 'GET', desc: 'Список/детали/создание/ставки/победа. Статусы: DRAFT → PUBLISHED → AWARDED → DOCS_REVIEW → AT_LOGIST → CONFIRMED → CLOSED.' },
          { id: 'api-verify', label: 'Автопроверка комплекта', kind: 'api', path: '/api/requests/[id]/verify', method: 'POST', desc: 'Каждый PENDING-документ уходит в OCR-шлюз, поля сверяются с водителем/ТС, правила выносят PASSED / REUPLOAD / MANUAL / REJECTED.', deps: ['ocr-gateway', 'neural'] },
          { id: 'api-intake', label: 'Нейропроверка карточек', kind: 'api', path: '/api/intake/{driver,vehicle}', method: 'POST', desc: 'Сканы из «Подать документы»: паспорт (2 страницы) или СТС (2 стороны) → распознанные поля + перекрёстные сверки.', deps: ['ocr-gateway', 'neural'] },
          { id: 'api-files', label: 'Файлы документов', kind: 'api', path: '/api/files/document/[id]', method: 'GET', desc: 'Скан выдаётся по токену с проверкой доступа — напрямую из БД, без публичных ссылок.', deps: ['db'] },
          { id: 'api-directory', label: 'Справочники', kind: 'api', path: '/api/directory/*', method: 'GET', desc: 'CRUD карточек водителей/ТС/прицепов с фото; запись только после допуска.' },
          { id: 'api-suggest', label: 'Адресные подсказки', kind: 'api', path: '/api/suggest', method: 'GET', desc: 'Подсказки адресов и «кем выдан» по мере ввода (гео-база проекта).' },
          { id: 'api-notify', label: 'Уведомления и события', kind: 'api', path: '/api/{notifications,events}', method: 'GET', desc: 'Колокольчик и журнал; после записи в БД сервер дёргает шину WS (notifyLive).' },
          { id: 'api-perms', label: 'Права и профили', kind: 'api', path: '/api/{permissions,profile,users}', desc: 'Матрица прав по должностям, исключения, управление учётками (только админ).' },
          { id: 'api-onec', label: 'Шина 1С', kind: 'api', path: '/api/integration/1c/*', desc: 'ping · dictionaries · requests (GET/POST) · etrn. Авторизация X-API-Key (ONEC_API_KEY), CORS для браузерного симулятора.', deps: ['onec'] },
          { id: 'api-arch-status', label: 'Статусы сервисов', kind: 'api', path: '/api/architecture/status', method: 'GET', desc: 'Опрашивает все контуры сервер-сайд и отдаёт живые статусы для этого раздела (только админ).', deps: ['web', 'db', 'ws', 'ocr-gateway', 'neural', 'onec'] },
        ],
      },
      {
        id: 'lib',
        label: 'Серверные библиотеки (правила)',
        kind: 'root',
        tech: 'src/lib/*',
        desc: 'Бизнес-логика живёт здесь — маршруты тонкие, правила переиспользуются.',
        children: [
          { id: 'lib-verify', label: 'verify.ts — правила автопроверки', kind: 'lib', desc: 'Качество фото → тип документа → сверка полей с заявкой → вердикт. Порог уверенности адреса 0.60, двойное подтверждение МЧЗ.' },
          { id: 'lib-ocr', label: 'ocr-service.ts — очередь к шлюзу', kind: 'lib', desc: 'Документы распознаются по одному: таймаут с момента отправки, очередь в процессе платформы.', deps: ['ocr-gateway'] },
          { id: 'lib-onec', label: 'onec.ts — слой 1С', kind: 'lib', desc: 'API-ключ (сравнение за постоянное время), CORS, статусы заявок/ЭТрН по-русски для 1С.', deps: ['onec'] },
          { id: 'lib-requests', label: 'requests.ts — заявки и торги', kind: 'lib', desc: 'Транзакции SQLite (inTx), финализация истёкших тендеров, деньги и даты.' },
          { id: 'lib-auth', label: 'auth.ts / permissions', kind: 'lib', desc: 'Сессии (Bearer + кука), роли, гранулярные права (perm-catalog), проверка на сервере.' },
          { id: 'lib-notify', label: 'notify / notify-users', kind: 'lib', desc: 'События → шина WS и адресные уведомления (перевозчику/логистам) после транзакции.', deps: ['ws'] },
        ],
      },
    ],
  },
  {
    id: 'db-node',
    label: 'База данных',
    kind: 'db',
    tech: 'SQLite · Prisma ORM · db/custom.db',
    desc: 'Единственный источник истины. Схема — prisma/schema.prisma, миграции через db:push.',
    deps: ['db'],
    children: [
      { id: 'db-people', label: 'Люди и компании', kind: 'db', desc: 'User (логины/роли), Carrier (перевозчики), Driver (водители с паспортными данными).' },
      { id: 'db-fleet', label: 'Техника', kind: 'db', desc: 'Truck (тягачи: марка, госномер, VIN, СТС), Trailer (прицепы: тип, госномер).' },
      { id: 'db-flow', label: 'Торги и рейсы', kind: 'db', desc: 'Request (заявка, ставки, статусы, onecRef), Bid (ставки), Event (журнал действий).' },
      { id: 'db-docs', label: 'Документы', kind: 'db', desc: 'Document (скан в dataUri, статус, поля, уверенность, вердикт нейросети), файлы карточек справочников.' },
      { id: 'db-sys', label: 'Служебные', kind: 'db', desc: 'Notification (уведомления), PlatformLog (техжурнал), настройки прав и сверки.' },
    ],
  },
  {
    id: 'realtime',
    label: 'Real-time шина',
    kind: 'service',
    tech: 'socket.io · mini-services/ws-service · порт 3003',
    desc: 'Событие platform:update после каждой записи: списки и статусы обновляются у всех без перезагрузки. Клиент: io(\'/?XTransformPort=3003\') через шлюз Caddy.',
    deps: ['ws'],
    children: [
      { id: 'realtime-auth', label: 'Проверка сессии на входе', kind: 'lib', desc: 'Шина пускает только с валидной сессией (кука или ?token= для окна предпросмотра).' },
      { id: 'realtime-events', label: 'Типы событий', kind: 'lib', desc: 'BID_PLACED, REQUEST_AWARDED, DOCS_VERIFIED, PERMS_CHANGED и др. — по ним вкладки перечитывают данные.' },
    ],
  },
  {
    id: 'ocr',
    label: 'OCR-шлюз распознавания',
    kind: 'service',
    tech: 'bun · mini-services/ocr-service · порт 3020 (только 127.0.0.1)',
    desc: 'Принимает скан (dataUri), передаёт движку по X-OCR-Token, возвращает поля с уверенностями. Слушает только локально — наружу не торчит.',
    deps: ['ocr-gateway', 'neural'],
    children: [
      { id: 'ocr-health', label: 'GET /health · GET /upstream', kind: 'api', method: 'GET', path: 'http://127.0.0.1:3020', desc: 'health — статус шлюза; upstream — живая проверка нейросети на ПК перевозчика (лёгкий запрос, без OCR).' },
      { id: 'ocr-post', label: 'POST /ocr', kind: 'api', method: 'POST', path: 'http://127.0.0.1:3020', desc: '{ type, dataUri } → поля + уверенности; 422 — вид документа без шаблона; 503 — движок недоступен (документ остаётся «на проверке»).' },
    ],
  },
  {
    id: 'neural-node',
    label: 'Нейросеть на ПК перевозчика',
    kind: 'integration',
    tech: 'Python · PaddleOCR 3.7 · PP-OCRv5 server_det + mobile_rec · RTX 3050 · порт 3031',
    desc: 'Сканы не покидают инфраструктуру перевозчика: движок поднимается на его Windows-ПК, наружу — только вечный ngrok-домен. Скорость: ~2.3 сек на документ.',
    deps: ['neural'],
    children: [
      { id: 'neural-tunnel', label: 'Туннель ngrok (вечный домен)', kind: 'integration', desc: 'HTTPS-туннель к порту 3031 на ноутбуке. Заголовок ngrok-skip-browser-warning для API-вызовов.' },
      { id: 'neural-docs', label: 'Типы документов', kind: 'lib', desc: 'PASSPORT_PHOTO, PASSPORT_REG, STS, POA, REQUEST_DOC (+LICENSE на движке) — шаблоны полей на каждой стороне.' },
      { id: 'neural-fallback', label: 'Отказоустойчивость', kind: 'lib', desc: 'Ноутбук уснул / туннель упал → документ остаётся PENDING, платформа пишет сбой в журнал, повтор — той же кнопкой.' },
    ],
  },
  {
    id: 'onec-node',
    label: 'Интеграция с 1С',
    kind: 'integration',
    tech: 'REST-шина · X-API-Key · симулятор 1С 8.3 «Такси»',
    desc: '1С (грузоотправитель) обменивается с площадкой: справочники, заявки (черновик из 1С → публикация логистом), статусы рейсов и ЭТрН.',
    deps: ['onec'],
    children: [
      { id: 'onec-ping', label: 'ping · dictionaries', kind: 'api', method: 'GET', path: '/api/integration/1c', desc: 'Проверка связи и ключа; справочники перевозчиков/водителей/ТС для подстановки в 1С.' },
      { id: 'onec-requests', label: 'requests (GET/POST)', kind: 'api', path: '/api/integration/1c/requests', desc: 'POST — черновик заявки из 1С (бейдж «из 1С», onecRef); GET — реестр рейсов со статусами для 1С:ERP.' },
      { id: 'onec-etrn', label: 'etrn (GET/POST)', kind: 'api', path: '/api/integration/1c/etrn', desc: 'ЭТрН: подтверждения из 1С (SENT/SIGNED) и данные для 1С:ERP.' },
      { id: 'onec-sim', label: 'Симулятор 1С «Заказы»', kind: 'integration', path: '/1c-simulator', desc: 'HTML-копия формы 1С «Заказы грузоотправителей» (демо-стенд): связь по ключу, отправка заказов, статусы обратно.' },
    ],
  },
  {
    id: 'gateway-node',
    label: 'Шлюз и стенд',
    kind: 'service',
    tech: 'Caddy (единый внешний порт) · демо-данные prisma/seed.ts',
    desc: 'Все вызовы клиента — относительные; на другой порт указывает query ?XTransformPort=. Демо-вход: NEXT_PUBLIC_DEMO_PASSWORD показывает доступы на экране входа.',
    deps: ['web', 'ws'],
    children: [
      { id: 'gateway-caddy', label: 'Caddy: /api/* → :3000, ?XTransformPort → сервис', kind: 'lib', desc: 'Платформа и мини-сервисы за одним портом; WS — тот же механизм с path=/.', deps: ['ws'] },
      { id: 'gateway-seed', label: 'Демо-контур', kind: 'lib', desc: 'Логины admin/logist1/logist2/carrier-a…g, пароль один; заявки и сканы для показа.' },
    ],
  },
]

/** Счётчики для шапки раздела */
export function archCounts(): { sections: number; api: number; services: number } {
  let sections = 0
  let api = 0
  let services = 0
  const walk = (nodes: ArchNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'ui') sections += 1
      if (n.kind === 'api') api += 1
      if (n.kind === 'service' || n.kind === 'integration') services += 1
      if (n.children) walk(n.children)
    }
  }
  walk(ARCH_TREE)
  return { sections, api, services }
}

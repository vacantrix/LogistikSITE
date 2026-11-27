// Ядро ИИ-помощника — ТОЛЬКО серверный модуль (импортировать на клиенте нельзя).
// Здесь собирается жёстко ограниченный контекст (частичное чтение: контакты
// без телефонов и почты) и вызывается модель.
//
// Движок один — GigaChat (Сбер): личный ключ GIGACHAT_API_PERS из .env.local,
// модель GIGACHAT_MODEL (по умолчанию GigaChat-2-Max — флагманский уровень).
// Раньше основной была GLM Ultra с резервами — GLM полностью отключена
// («glm не нужно, только пока гигачат»): скрытых переключений движка больше
// нет, сбой GigaChat уходит в роут и показывается человеку честной ошибкой —
// платформа не подменяет движок молча.

import { db } from '@/lib/db'
import { AI_RIGHTS, AI_RIGHT_MODE_LABELS, type AiRight, type AiRightMode } from './rights'
import { aiNavPromptLines, aiNavFiltersPromptLines } from './nav-catalog'
import { gigachatComplete, gigachatStreamComplete, isGigaChatConfigured, type GigaMessage } from './gigachat'

// ——— редактируемые права: администратор меняет режимы, применяются сразу ———

let rightsCache: { at: number; rights: AiRight[] } | null = null
const RIGHTS_TTL_MS = 30_000

/** Действующие права ИИ: значения по умолчанию (rights.ts) + переопределения
 *  администратора из БД (AiRight). Администратор правит режимы в разделе «Права»
 *  чата — новая матрица действует для следующих вопросов сразу. */
export async function getAiRights(): Promise<AiRight[]> {
  if (rightsCache && Date.now() - rightsCache.at < RIGHTS_TTL_MS) return rightsCache.rights
  try {
    const overrides = await db.aiRight.findMany()
    const byKey = new Map(overrides.map((o) => [o.key, o.mode as AiRightMode]))
    const rights = AI_RIGHTS.map((r) => (byKey.has(r.key) ? { ...r, mode: byKey.get(r.key) as AiRightMode } : r))
    rightsCache = { at: Date.now(), rights }
    return rights
  } catch {
    // БД недоступна — работаем на кодовых значениях по умолчанию
    return AI_RIGHTS
  }
}

/** Право не редактируется администратором — зашито в платформу (безопасность). */
export const AI_RIGHTS_LOCKED = new Set(['platform-write', 'personal'])

/** Сброс кэша прав — после сохранения администратором новых режимов. */
export function invalidateAiRightsCache(): void {
  rightsCache = null
}

/** Режим конкретного права в действующей матрице. */
export function aiRightMode(rights: AiRight[], key: string): AiRightMode {
  return rights.find((r) => r.key === key)?.mode ?? 'denied'
}

/** Запись в журнал нейросети — не должна ломать основной запрос */
export async function aiLog(level: 'info' | 'warn' | 'error', action: string, message: string, details?: unknown): Promise<void> {
  try {
    await db.aiLog.create({
      data: {
        level,
        action,
        message: message.slice(0, 2000),
        details: details === undefined || details === null ? null : JSON.stringify(details).slice(0, 4000),
      },
    })
  } catch {
    /* журнал не должен валить основной поток */
  }
}

const CONTACT_KIND_LABELS: Record<string, string> = { carrier: 'перевозчик', shipper: 'грузовладелец', driver: 'водитель', other: 'другое' }
const DEAL_STATUS_LABELS: Record<string, string> = { talks: 'переговоры', done: 'заключена', refuse: 'отказ', lost: 'не вышло' }
const DEAL_DIRECTION_LABELS: Record<string, string> = { load: 'груз', truck: 'машина' }
const REQUEST_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'черновик',
  PUBLISHED: 'на площадке',
  AWARDED: 'перевозчик выбран',
  DOCS_REVIEW: 'документы проверяются',
  AT_LOGIST: 'у логиста — сверка',
  QUARANTINE: 'карантин',
  CONFIRMED: 'рейс выполняется',
  CLOSED: 'рейс закрыт',
  DELETED: 'удалена',
}
const CARRIER_ROLE_LABELS: Record<string, string> = { CARRIER: 'перевозит сам', FORWARDER: 'экспедитор' }

const fmtRub = (v: number): string => `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽`
const pluralRu = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10
  const m100 = n % 100
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many}`
}

/** Память контактов в контексте — по режиму права contacts-read:
 *  denied — контактов нет; read-partial — имена/компании/роли без телефонов и почты;
 *  write — администратор разрешил полное чтение: контакты с телефонами и почтой. */
async function contactsContext(mode: AiRightMode): Promise<string> {
  if (mode === 'denied') return 'Память контактов недоступна: право закрыто администратором.'
  const full = mode === 'write'
  const contacts = await db.memoryContact.findMany({
    include: { deals: { orderBy: { createdAt: 'desc' }, take: 5 } },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  })
  if (contacts.length === 0) return 'Контактов в памяти пока нет.'
  const lines = contacts.map((c) => {
    const deals = c.deals
      .map((d) => `${DEAL_STATUS_LABELS[d.status] ?? d.status} — ${DEAL_DIRECTION_LABELS[d.direction] ?? d.direction}${d.route ? `, ${d.route}` : ''}${d.amount != null ? `, ${d.amount} ₽` : ''}`)
      .join('; ')
    const channels = full ? `, тел. ${c.phone || '—'}${c.email ? `, почта ${c.email}` : ''}` : ''
    return `- ${c.name}${c.company ? `, ${c.company}` : ''} — ${CONTACT_KIND_LABELS[c.kind] ?? c.kind}, рейтинг ${c.rating}/5${channels}${deals ? `, сделки: ${deals}` : ', сделок не было'}`
  })
  return lines.join('\n')
}

/** Свой список — последние записи (то, что нейросеть уже разбирала) */
async function ownListContext(): Promise<string> {
  const items = await db.aiListItem.findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
  if (items.length === 0) return ''
  return items
    .map((i) => `- ${new Date(i.createdAt).toLocaleString('ru-RU')} · ${i.kind}: «${i.query}»`)
    .join('\n')
}

/** Данные платформы в контексте — по праву platform-read:
 *  denied — данные не передаются; read-partial — бизнес-данные (справочник
 *  перевозчиков, заявки, ставки, победители, сводные показатели) без личных
 *  и служебных полей; write — плюс комментарии, создатели и все ставки.
 *  Личные данные людей (телефоны водителей, документы, доступы) не передаются
 *  ни в одном режиме — только бизнес-показатели. */
async function platformDataContext(mode: AiRightMode): Promise<{ text: string; summary: string }> {
  if (mode === 'denied') return { text: '', summary: 'закрыты правом' }
  const full = mode === 'write'
  const [carriers, requests] = await Promise.all([
    db.carrier.findMany({
      where: { access: true },
      include: { _count: { select: { drivers: true, trucks: true, trailers: true } } },
      orderBy: { name: 'asc' },
    }),
    db.request.findMany({
      where: { status: { notIn: ['DRAFT', 'DELETED'] } },
      include: { bids: { where: { withdrawn: false }, include: { carrier: true } }, winner: true },
      orderBy: { number: 'asc' },
      take: 60,
    }),
  ])
  if (carriers.length === 0 && requests.length === 0) {
    return { text: 'В платформе пока нет перевозчиков и заявок.', summary: 'нет данных' }
  }

  // сводка по перевозчикам: победы, ставки, объём и доход (лучшая ставка × тоннаж)
  const byCarrier = new Map(carriers.map((c) => [c.id, { name: c.name, wins: 0, bids: 0, tonnage: 0, revenue: 0 }]))
  for (const r of requests) {
    for (const b of r.bids) {
      const agg = byCarrier.get(b.carrierId)
      if (agg) agg.bids += 1
    }
    if (r.winner) {
      const agg = byCarrier.get(r.winner.id)
      if (agg) {
        agg.wins += 1
        agg.tonnage += r.tonnage || 0
        if (r.bestRate != null) agg.revenue += r.bestRate * (r.tonnage || 0)
      }
    }
  }

  const statusCount = new Map<string, number>()
  for (const r of requests) statusCount.set(r.status, (statusCount.get(r.status) ?? 0) + 1)
  const won = requests.filter((r) => r.winner)
  const totalRevenue = won.reduce((s, r) => s + (r.bestRate != null ? r.bestRate * (r.tonnage || 0) : 0), 0)
  const totalTonnage = won.reduce((s, r) => s + (r.tonnage || 0), 0)
  const bidsCount = requests.reduce((s, r) => s + r.bids.length, 0)

  const lines: string[] = []
  lines.push('Сводные показатели (посчитаны сервером на момент вопроса):')
  lines.push(
    `- перевозчики: ${carriers.length} (${carriers.filter((c) => c.role === 'CARRIER').length} перевозит сам, ${carriers.filter((c) => c.role !== 'CARRIER').length} экспедитор)`,
  )
  lines.push(
    `- заявки (без черновиков и удалённых): ${requests.length} — ${[...statusCount.entries()]
      .map(([s, n]) => `${REQUEST_STATUS_LABELS[s] ?? s}: ${n}`)
      .join(', ')}`,
  )
  lines.push(
    `- разыграно заявок: ${won.length} · объём перевозок: ${new Intl.NumberFormat('ru-RU').format(totalTonnage)} т · доход по лучшим ставкам (ставка ₽/т × тоннаж): ${fmtRub(totalRevenue)}`,
  )
  lines.push(`- ставок подано (без отозванных): ${bidsCount}`)

  lines.push('')
  lines.push('Доходы перевозчиков (по разыгранным заявкам — лучшая ставка × тоннаж):')
  for (const agg of byCarrier.values()) {
    if (agg.wins === 0 && agg.bids === 0) continue
    lines.push(
      `- ${agg.name}: побед ${agg.wins} · ставок ${agg.bids} · объём ${new Intl.NumberFormat('ru-RU').format(agg.tonnage)} т · доход ${fmtRub(agg.revenue)}`,
    )
  }

  lines.push('')
  lines.push('Справочник перевозчиков:')
  for (const c of carriers) {
    lines.push(
      `- ${c.name} · ИНН ${c.inn} · ${CARRIER_ROLE_LABELS[c.role] ?? c.role} · договор №${c.contractNo} от ${c.contractDate} · парк: ${c._count.drivers} водителей, ${c._count.trucks} машин, ${c._count.trailers} прицепов`,
    )
  }

  lines.push('')
  lines.push(`Заявки (площадка — по одной строке${requests.length >= 60 ? ', показаны первые 60' : ''}):`)
  for (const r of requests) {
    const parts = [
      `${r.number} · ${r.fromPoint} → ${r.toPoint}`,
      `${r.cargo} · ${String(r.tonnage).replace('.', ',')} т · ${r.truckType}`,
      `старт ${fmtRub(r.startRate)}/т`,
      r.bestRate != null ? `лучшая ${fmtRub(r.bestRate)}/т` : 'ставок нет',
      `погрузка ${r.loadDate}`,
      REQUEST_STATUS_LABELS[r.status] ?? r.status,
      r.winner ? `победитель ${r.winner.name}` : null,
      r.bids.length > 0 ? `ставок ${r.bids.length}` : null,
    ].filter(Boolean)
    if (full) {
      if (r.comment) parts.push(`комментарий: ${r.comment.slice(0, 120)}`)
      parts.push(`создал ${r.createdBy}`)
    }
    lines.push(`- ${parts.join(' · ')}`)
  }
  if (full) {
    lines.push('')
    lines.push('Ставки по заявкам (без отозванных):')
    for (const r of requests) {
      if (r.bids.length === 0) continue
      lines.push(
        `- ${r.number}: ${r.bids.map((b) => `${b.carrier.name} — ${fmtRub(b.amount)}/т${b.isWinner ? ' (победа)' : ''}`).join('; ')}`,
      )
    }
  }

  return {
    text: lines.join('\n'),
    summary: `${pluralRu(carriers.length, 'перевозчик', 'перевозчика', 'перевозчиков')} · ${pluralRu(requests.length, 'заявка', 'заявки', 'заявок')}`,
  }
}

export interface AiContextParts {
  contacts: string
  ownList: string
  /** данные платформы (справочник, заявки, ставки, сводка) — по праву platform-read */
  platform?: string
  /** витрина ATI.SU (демо-выдача грузов, машины фирмы) — только для поиска */
  market?: string
}

/** Сборка read-only контекста — по действующей матрице прав. */
export async function buildRestrictedContext(
  rights: AiRight[] = AI_RIGHTS,
): Promise<{ contacts: string; ownList: string; platform: string; platformSummary: string }> {
  const [contacts, ownList, platform] = await Promise.all([
    contactsContext(aiRightMode(rights, 'contacts-read')),
    aiRightMode(rights, 'own-list') === 'denied' ? Promise.resolve('') : ownListContext(),
    platformDataContext(aiRightMode(rights, 'platform-read')),
  ])
  return { contacts, ownList, platform: platform.text, platformSummary: platform.summary }
}

/** Системный промпт: роль, жёсткие права (действующая матрица), инструменты записи, стиль и частичный контекст */
export function buildSystemPrompt(parts: AiContextParts, rights: AiRight[] = AI_RIGHTS): string {
  const rightsBlock = rights.map((r) => `- ${r.title}: ${r.detail} [режим: ${AI_RIGHT_MODE_LABELS[r.mode]}]`).join('\n')
  const market = parts.market?.trim()
  const blocks = [
    'Ты — ИИ-помощник-консультант платформы «АЭМЗ Поток» (привлечённый транспорт, биржа ATI.SU).',
    'Помогаешь логисту и экспедитору: подбор грузов и перевозчиков, оценка заявок и ставок, ведение переговоров и запись перевозчиков в память контактов.',
    '',
    'ЖЁСТКИЕ ПРАВА — никогда не выходи за них и не обещай действий, которых не можешь выполнить:',
    rightsBlock,
    '',
    'Конфиденциальность и безопасность (без исключений):',
    '- не запрашивай и не обрабатывай персональные документы людей (паспорт, права, СНИЛС), пароли и доступы;',
    '- если человек прислал такое в чат — откажись обрабатывать и посоветуй удалить сообщение;',
    '- интернета и кода у тебя нет; данные платформы приходят тебе в контексте «Данные платформы» и только для чтения: менять сайт, сборку, заявки, рейсы, ЭДО и 1С ты не можешь — и не обещай этого;',
    '- прикреплённые человеком файлы приходят к тебе ТЕКСТОМ прямо в сообщении (раздел «Файлы, прикреплённые человеком») — читай, анализируй и ссылайся на их содержимое как на данные человека; своих файлов и файловой системы у тебя нет;',
    '- запись в память платформы — только блоки ai-contact; отображение для человека — блоки ai-best / ai-card / ai-report / ai-links; иного способа записи у тебя нет, сервер проверяет всё сам.',
    '',
    'Данные платформы (для таблиц, сводок и отчётов):',
    '- перевозчики, заявки, ставки и сводные показатели платформы приходят в контексте «Данные платформы» ниже — это реальные данные платформы;',
    '- когда человек просит таблицу, отчёт или сводку по платформе — строй их ТОЛЬКО на этих данных: настоящие названия перевозчиков, номера заявок, ставки и объёмы; ничего не выдумывай;',
    '- не переспрашивай человека о том, что уже есть в контексте (список перевозчиков, ставки, объёмы, доходы) — бери оттуда сразу;',
    '- если нужного показателя в контексте нет — скажи прямо и предложи, что построить из имеющегося;',
    '- личные данные людей (телефоны водителей, документы, доступы) в контекст не попадают — не обещай их показать.',
    '',
    'Инструменты записи (единственные):',
    '1) Записать перевозчика. Когда человек просит записать/запомнить/сохранить контакты, оформи карточки блоком:',
    '```ai-contact',
    '[{"name":"Пётр","company":"ООО Ромашка","kind":"carrier","phone":"+7 918 000-00-00","email":"","atiFirmId":"123456","atiRef":"","rating":0,"notes":"тент, 20 т, Краснодар, платит в срок","format":"card"}]',
    '```',
    'Правила блока: kind — carrier|shipper|driver|other; rating 0..5 — только если человек оценил; записывай только то, что сообщил человек, ничего не выдумывай; пустые поля — пустой строкой; atiFirmId — цифровой ID фирмы на ATI.SU, если человек его дал; format — card|list|table|text (как человек просил оформить запись). Человек может диктовать в любом формате — связный текст, список, таблица, JSON — разбери и приведи к карточкам. После блока коротко подтверди, кого и что записал.',
    '2) Список для выбора (главный инструмент подбора). Когда человек просит подобрать, найти, сравнить, перечислить варианты («грузы из Астрахани», «машины под тент», «лучшие предложения по заявке», «какие перевозчики…») — ОБЯЗАТЕЛЬНО закончи ответ блоком: платформа превратит его в карточки прямо на экране, и человеку останется только выбирать. Оформляй блоком:',
    '```ai-best',
    '[{"rank":1,"title":"Груз №123 (ООО Ромашка)","route":"Скопин → Ростов","rate":"165 000 ₽","date":"27.11","company":"ООО Ромашка","contact":"Ирина, +7 900 000-00-00","note":"ставка ниже рынка на 8% — стоит поторговаться"}]',
    '```',
    'Правила блока: 4–8 конкретных вариантов по убыванию привлекательности; rank — номер по порядку; title — что за вариант; route — маршрут; rate — ставка; date — дата/срок; company — фирма или имя; contact — кто отвечает и телефон (если известен из контекста человека); в note — почему вариант стоит выбрать и на что смотреть. Не выдумывай реальные номера грузов и фирмы: строй варианты как оценку рынка и демо-витрину ATI.SU, помечай это в тексте до блока. Список должен быть самодостаточным: человек выбирает вариант, не перечитывая весь текст.',
    '3) Карточки фактов (ai-card). Когда структура важнее прозы — профиль, характеристики, сравнение, памятка, чек-лист — оформляй карточками: платформа рисует их красиво в чате. Оформляй блоком:',
    '```ai-card',
    '[{"kind":"profile","title":"ИП Петров — профиль перевозчика","badges":["тент","20 т"],"fields":[{"label":"База","value":"Краснодар"},{"label":"Парк","value":"4 машины"},{"label":"Ориентир ставок","value":"38–42 ₽/км"}],"note":"По памяти контактов: платит в срок, рейтинг 4/5"}]',
    '```',
    'Правила блока: 1–6 карточек; kind — profile (профиль)|vehicle (машина)|route (маршрут)|market (рынок)|analysis (разбор)|notice (важно)|checklist (памятка); fields — до 12 пар «label — value» (короткие метки и значения); badges — до 6 коротких меток-фильтров («тент», «20 т», «РФ"); note — вывод одной строкой. Карточки показываются человеку вместо прозы — не дублируй то же самое текстом.',
    '4) Отчёт (ai-report). Когда человек просит отчёт, сводку, аналитику с цифрами и таблицами («отчёт по рынку», «сводка за месяц», «сравни в таблице») — оформляй отчётом: платформа рисует его с показателями и таблицами прямо в чате и даёт кнопку «Скачать Word». Оформляй блоком:',
    '```ai-report',
    '{"title":"Сводка рынка: Краснодар → Москва","period":"24.11.2026","summary":"Ставки на тент выросли на 4% за неделю; свободных машин мало — время торговаться.","kpis":[{"label":"Медиана ставки","value":"118 000 ₽","note":"тент, полная"},{"label":"Разброс","value":"96–145 тыс. ₽"},{"label":"Свободные машины","value":"~12"}],"sections":[{"heading":"Топ предложений","table":{"columns":["Вариант","Ставка","Фирма","Дата"],"rows":[["№1","120 000 ₽","ИП Петров","27.11"],["№2","115 000 ₽","ООО Логистик","28.11"]]},"paragraphs":["Оба варианта — из демо-витрины ATI.SU, проверь на бирже."]},{"heading":"Выводы","paragraphs":["Неделя удачная для фиксации ставки: предложение машин ограничено."]}]}',
    '```',
    'Правила блока: title до 120 символов; period — период/дата отчёта; summary — главный вывод; kpis — 2–6 показателей (label, value, note); sections — до 8 разделов, у каждого heading и paragraphs и/или table (columns — 2–10 заголовков, rows — до 30 строк, ячейки — короткие строки); отчёт самодостаточен: не повторяй его содержание текстом. Отчёт — данные из контекста и твои оценки рынка; помечай оценки честно.',
    '5) Ссылки на разделы платформы (ai-links). Когда человек должен что-то посмотреть или сделать на платформе («проверь заявку», «выстави счёт», «посмотри машину на карте») — дай кнопки-переходы: платформа рисует их в чате, нажатие открывает нужный раздел. Оформляй блоком:',
    '```ai-links',
    '[{"tab":"board","label":"Площадка заявок — проверить ставки"},{"tab":"reports","label":"Отчёты — выгрузить сводку Word"}]',
    '```',
    'Правила блока: 1–5 ссылок, обычно в конце ответа; tab — ТОЛЬКО ключ из каталога ниже (незнакомые ключи сервер отбрасывает); label — до 80 символов, что именно человек там сделает.',
    'Действия с фильтрами (нейросеть выполняет работу по платформе): у разделов с фильтрами добавляй объект filters — платформа при переходе сама выставит их в разделе. Разделы и ключи фильтров:',
    aiNavFiltersPromptLines(),
    'Значения: from/to — город; weight/volume — тонны/м³ числом; bodies — кузов через запятую (тент|изотерм|реф|бортовая|цельнометалл.|контейнер); payments — оплата через запятую (cashless_vat|cashless|cash|card); minRate — минимум ставки цифрой; q — поисковый запрос. Пример:',
    '```ai-links',
    '[{"tab":"own-atisu","label":"Грузы Абинск → Сочи, тент","filters":{"from":"Абинск","to":"Сочи","bodies":"тент"}},{"tab":"board","label":"Заявки по Сочи","filters":{"q":"Сочи"}}]',
    '```',
    'Когда человек просит «покажи/найди на бирже/площадке» — всегда оформляй ссылку с фильтрами: человек нажимает и сразу видит отфильтрованное. Не выдумывай города и значения сверх контекста.',
    'Каталог разделов платформы (tab — название — чем там занимаются):',
    aiNavPromptLines(),
    '',
    '6) Гиперссылки внутри текста ответа. По ходу текста можешь адресовать человека прямо к разделу — оберни фразу ссылкой вида [площадке заявок](#nav:board): ключ после #nav: — ТОЛЬКО из каталога выше; клик по фразе сразу открывает раздел. Не ставь таких ссылок в заголовках и не более 3–4 на ответ; используй там, где фраза естественно ведёт в раздел (например: «ставки смотрите на [площадке заявок](#nav:board)» или «машину видно в [мониторинге](#nav:own-monitor)»). Внешние ссылки (интернет) не давай — у тебя нет доступа к интернету.',
    '',
    'Стиль ответа:',
    '- по-русски, кратко и по делу; структура — markdown (заголовки и списки); суммы в рублях;',
    '- будь честным: если данных мало — скажи прямо; предупреждай о рисках (предоплата, «прямые» сделки в обход, ставки сильно ниже рынка);',
    '- не выдумывай номера грузов, фирмы и факты: работай только с данными контекста ниже и знаниями рынка;',
    '- ориентиры рынка помечай как оценку;',
    '- предпочитай виджеты прозе: подбор — ai-best, структура — ai-card, отчёт — ai-report, «где посмотреть/сделать» — ai-links (с фильтрами, если раздел их поддерживает), по ходу текста — гиперссылки #nav:. Смешивай в одном ответе, когда это уместно (например: отчёт со ссылками на разделы).',
    '',
    '### Контекст: память контактов (частичное чтение — телефоны и почта скрыты)',
    parts.contacts,
  ]
  if (parts.platform) {
    blocks.push('', '### Контекст: данные платформы (только чтение — реальные перевозчики, заявки, ставки и сводные показатели)', parts.platform)
  }
  if (parts.ownList) {
    blocks.push('', '### Контекст: собственный список нейросети — последние разборы', parts.ownList)
  }
  if (market) {
    blocks.push('', '### Контекст: витрина биржи ATI.SU (демо-режим, реальных запросов нет)', market)
  }
  return blocks.join('\n')
}

// ——— вызов модели: единственный движок — GigaChat (Сбер) ———

export type EngineMessage = GigaMessage

export type AiEngine = 'gigachat'

export interface AiCompletion {
  answer: string
  /** gigachat — единственный движок ИИ платформы (Сбер); GLM/Ultra отключены по требованию владельца */
  engine: AiEngine
  /** человекочитаемое имя модели — для бейджа в интерфейсе */
  model: string
  latencyMs: number
}

export interface AiEngineCallOptions {
  temperature?: number
  timeoutMs?: number
  /** уровень модели, выбранный человеком в чате (каталог — lib/ai/models.ts) */
  model?: string
}

/**
 * Единый вызов модели для всех роутов ИИ. Движок один — GigaChat (Сбер),
 * модель задаётся выбором человека в чате или GIGACHAT_MODEL из .env.local
 * (по умолчанию GigaChat-2-Max). Если ключи не заполнены или GigaChat
 * не ответил — ошибка уходит в роут: человек видит честное сообщение,
 * платформа не переключается на другой движок молча.
 */
export async function aiChatComplete(
  messages: EngineMessage[],
  opts: AiEngineCallOptions = {},
): Promise<AiCompletion> {
  if (!isGigaChatConfigured()) {
    await aiLog('error', 'engine_error', 'GigaChat не настроен: заполните GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET в .env.local (GLM-резерв отключён)')
    throw new Error('ИИ-движок GigaChat не настроен: заполните GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET в .env.local')
  }

  try {
    const r = await gigachatComplete(messages, opts)
    return { answer: r.content, engine: 'gigachat', model: r.model, latencyMs: r.latencyMs }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await aiLog('error', 'engine_error', `GigaChat не ответил: ${msg}`)
    throw new Error(`GigaChat не ответил: ${msg}`)
  }
}

/** То же, но потоково (SSE): чат печатает ответ чанками по мере генерации.
 *  Сбой потока уходит ошибкой в роут — роут может повторить обычным вызовом
 *  aiChatComplete: движок и уровень модели при этом не меняются. */
export async function aiChatStreamComplete(
  messages: EngineMessage[],
  opts: AiEngineCallOptions & { onDelta: (chunk: string) => void },
): Promise<AiCompletion> {
  if (!isGigaChatConfigured()) {
    await aiLog('error', 'engine_error', 'GigaChat не настроен: заполните GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET в .env.local (GLM-резерв отключён)')
    throw new Error('ИИ-движок GigaChat не настроен: заполните GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET в .env.local')
  }

  try {
    const r = await gigachatStreamComplete(messages, opts)
    return { answer: r.content, engine: 'gigachat', model: r.model, latencyMs: r.latencyMs }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await aiLog('error', 'engine_error', `GigaChat не ответил (стрим): ${msg}`)
    throw new Error(`GigaChat не ответил: ${msg}`)
  }
}

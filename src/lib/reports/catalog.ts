/**
 * Каталог отчётов раздела «Отчёты» и модель настроек выгрузки.
 *
 * Модуль общий для интерфейса и сервера (без обращений к базе): интерфейс строит по нему
 * форму настройки, сервер — проверяет настройки и собирает документ. У каждого отчёта
 * свой набор настроек (controls) и колонок; отчёты, для которых в платформе пока нет
 * данных (оплаты из 1С, отметки прибытия, статьи затрат), видны в каталоге как «Скоро».
 */

export type ReportId =
  | 'trips-payable'
  | 'edo-registry'
  | 'management-summary'
  | 'savings'
  | 'carriers'
  | 'rates-by-direction'
  | 'reconciliation'
  | 'downtime'
  | 'cost-centers'

export type ReportAudience = 'accounting' | 'management'

/** настройки формы, которые есть у отчёта */
export type ReportControl =
  | 'period' | 'dateBasis' | 'carriers' | 'scope' | 'vat' | 'grouping' | 'columns' | 'sections' | 'edoFilter' | 'signers'

export type Grouping = 'carrier' | 'direction' | 'month' | 'none'

export interface ReportOption { id: string; label: string; default: boolean }

export interface ReportDef {
  id: ReportId
  title: string
  /** одна строка в каталоге: для кого и что внутри */
  summary: string
  audience: ReportAudience
  /** код формы на бланке */
  formCode: string
  /** null — отчёт можно выгрузить; иначе — каких данных не хватает */
  missing: string | null
  controls: ReportControl[]
  groupings?: Grouping[]
  columns?: ReportOption[]
  sections?: ReportOption[]
  landscape?: boolean
}

export const GROUPING_LABEL: Record<Grouping, string> = {
  carrier: 'По перевозчикам',
  direction: 'По направлениям',
  month: 'По месяцам',
  none: 'Без групп',
}

export const REPORTS: ReportDef[] = [
  {
    id: 'trips-payable',
    title: 'Реестр рейсов к оплате',
    summary: 'Рейсы, тоннаж и суммы по перевозчикам',
    audience: 'accounting',
    formCode: 'АЭМЗ-Р-1',
    missing: null,
    controls: ['period', 'dateBasis', 'carriers', 'scope', 'vat', 'grouping', 'columns', 'signers'],
    groupings: ['carrier', 'direction', 'none'],
    columns: [
      { id: 'loadDate', label: 'Дата погрузки', default: true },
      { id: 'route', label: 'Маршрут', default: true },
      { id: 'cargo', label: 'Груз', default: true },
      { id: 'tonnage', label: 'Тоннаж', default: true },
      { id: 'rate', label: 'Ставка', default: true },
      { id: 'amount', label: 'Сумма', default: true },
      { id: 'etrn', label: 'ЭТрН', default: true },
      { id: 'contract', label: 'Договор', default: false },
      { id: 'crew', label: 'Водитель и ТС', default: false },
    ],
    landscape: true,
  },
  {
    id: 'edo-registry',
    title: 'Реестр ЭТрН и актов',
    summary: 'Что подписано в ЭДО, а что ещё нет',
    audience: 'accounting',
    formCode: 'АЭМЗ-Р-2',
    missing: null,
    controls: ['period', 'dateBasis', 'carriers', 'edoFilter', 'columns', 'signers'],
    columns: [
      { id: 'carrier', label: 'Перевозчик', default: true },
      { id: 'route', label: 'Маршрут', default: true },
      { id: 'aemz', label: 'Подпись АЭМЗ', default: true },
      { id: 'party', label: 'Подпись перевозчика', default: true },
      { id: 'stage', label: 'Этап в Диадоке', default: true },
      { id: 'uid', label: 'УИД ГИС ЭПД', default: false },
    ],
    landscape: true,
  },
  {
    id: 'management-summary',
    title: 'Сводка для руководства',
    summary: 'Итоги периода, сравнение с прошлым, выводы',
    audience: 'management',
    formCode: 'АЭМЗ-У-1',
    missing: null,
    controls: ['period', 'dateBasis', 'sections', 'signers'],
    sections: [
      { id: 'kpi', label: 'Главные цифры', default: true },
      { id: 'compare', label: 'Сравнение с прошлым периодом', default: true },
      { id: 'conclusions', label: 'Выводы', default: true },
      { id: 'charts', label: 'Диаграммы', default: true },
      { id: 'topCarriers', label: 'Крупнейшие перевозчики', default: true },
      { id: 'directions', label: 'Направления', default: true },
    ],
  },
  {
    id: 'savings',
    title: 'Экономия на торгах',
    summary: 'Снижение ставок по заявкам и направлениям',
    audience: 'management',
    formCode: 'АЭМЗ-У-2',
    missing: null,
    controls: ['period', 'dateBasis', 'carriers', 'grouping', 'columns', 'sections', 'signers'],
    groupings: ['direction', 'carrier', 'none'],
    columns: [
      { id: 'route', label: 'Маршрут', default: true },
      { id: 'cargo', label: 'Груз', default: true },
      { id: 'tonnage', label: 'Тоннаж', default: true },
      { id: 'startRate', label: 'Стартовая ставка', default: true },
      { id: 'finalRate', label: 'Итоговая ставка', default: true },
      { id: 'saving', label: 'Экономия', default: true },
      { id: 'pct', label: 'Снижение, %', default: true },
      { id: 'carrier', label: 'Перевозчик', default: true },
    ],
    sections: [
      { id: 'charts', label: 'Диаграммы', default: true },
      { id: 'zeroRows', label: 'Рейсы без экономии', default: false },
    ],
    landscape: true,
  },
  {
    id: 'carriers',
    title: 'Перевозчики',
    summary: 'Обороты, участие в торгах, победы, отказы',
    audience: 'management',
    formCode: 'АЭМЗ-У-3',
    missing: null,
    controls: ['period', 'dateBasis', 'carriers', 'columns', 'sections', 'signers'],
    columns: [
      { id: 'trips', label: 'Рейсов', default: true },
      { id: 'tonnage', label: 'Тоннаж', default: true },
      { id: 'turnover', label: 'Оборот', default: true },
      { id: 'share', label: 'Доля оборота', default: true },
      { id: 'avgRate', label: 'Средняя ставка', default: true },
      { id: 'bids', label: 'Участие в торгах', default: true },
      { id: 'winRate', label: 'Доля побед', default: true },
      { id: 'withdrawals', label: 'Снятия с торгов', default: false },
    ],
    sections: [{ id: 'charts', label: 'Диаграмма', default: true }],
    landscape: true,
  },
  {
    id: 'rates-by-direction',
    title: 'Ставки по направлениям',
    summary: 'Средние ставки и их динамика по месяцам',
    audience: 'management',
    formCode: 'АЭМЗ-У-4',
    missing: null,
    controls: ['period', 'dateBasis', 'carriers', 'sections', 'signers'],
    sections: [{ id: 'byMonth', label: 'Динамика по месяцам', default: true }],
    landscape: true,
  },
  {
    id: 'reconciliation',
    title: 'Акт сверки с перевозчиком',
    summary: 'Начислено, оплачено, задолженность',
    audience: 'accounting',
    formCode: 'АЭМЗ-Р-3',
    missing: 'Нужны данные об оплатах из 1С: платформа знает рейсы и суммы, но не платёжные поручения',
    controls: ['period', 'carriers', 'vat', 'signers'],
  },
  {
    id: 'downtime',
    title: 'Простои на погрузке',
    summary: 'Ожидание машин сверх окна погрузки',
    audience: 'management',
    formCode: 'АЭМЗ-У-5',
    missing: 'Нужны отметки фактического прибытия и выезда машин на складе',
    controls: ['period', 'carriers', 'signers'],
  },
  {
    id: 'cost-centers',
    title: 'Затраты по подразделениям',
    summary: 'Расходы на транспорт по статьям и подразделениям',
    audience: 'management',
    formCode: 'АЭМЗ-У-6',
    missing: 'Нужны статьи затрат и подразделения-заказчики у заявок',
    controls: ['period', 'signers'],
  },
]

export const reportDef = (id: string): ReportDef | undefined => REPORTS.find((r) => r.id === id)

export type DateBasis = 'load' | 'created'
export type TripScope = 'closed' | 'done'
export type VatMode = 'none' | 'included' | 'on-top'
export type EdoFilter = 'all' | 'unsigned' | 'signed'

export const VAT_RATES = [22, 20] as const

/** Настройки выгрузки — то, что человек выбрал в форме отчёта */
export interface ReportSettings {
  /** период «ГГГГ-ММ-ДД», включительно */
  from: string
  to: string
  /** по какой дате рейс попадает в период: погрузки или создания заявки */
  dateBasis: DateBasis
  /** пусто — все перевозчики */
  carrierIds: string[]
  /** closed — только закрытые рейсы; done — закрытые и выполняющиеся */
  scope: TripScope
  vat: VatMode
  vatRate: number
  grouping: Grouping
  columns: string[]
  sections: string[]
  edoFilter: EdoFilter
  organization: string
  department: string
  preparedPosition: string
  preparedName: string
  checkedPosition: string
  checkedName: string
}

export const DEFAULT_ORGANIZATION = 'АО «АЭМЗ»'

/** Что попадёт в отчёт при текущих настройках — показывается под формой до выгрузки */
export interface ReportPreview {
  periodLabel: string
  rows: number
  rowsLabel: string
  amount: number | null
  amountLabel: string | null
  empty: boolean
}

/** настройки по умолчанию для отчёта; период — текущий месяц по сегодня */
export function defaultSettings(def: ReportDef, opts: { today: string; userName: string }): ReportSettings {
  return {
    from: `${opts.today.slice(0, 8)}01`,
    to: opts.today,
    dateBasis: 'load',
    carrierIds: [],
    scope: 'closed',
    vat: 'none',
    vatRate: VAT_RATES[0],
    grouping: def.groupings?.[0] ?? 'none',
    columns: (def.columns ?? []).filter((c) => c.default).map((c) => c.id),
    sections: (def.sections ?? []).filter((s) => s.default).map((s) => s.id),
    edoFilter: 'all',
    organization: DEFAULT_ORGANIZATION,
    department: 'Отдел логистики',
    preparedPosition: def.audience === 'accounting' ? 'Логист' : 'Начальник отдела логистики',
    preparedName: opts.userName,
    checkedPosition: def.audience === 'accounting' ? 'Главный бухгалтер' : '',
    checkedName: '',
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, max: number, fallback: string): string => (typeof v === 'string' ? v.trim().slice(0, max) : fallback)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)
const ids = (v: unknown, allowed?: string[]): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && (!allowed || allowed.includes(x))))].slice(0, 200) : []

/**
 * Настройки из запроса → проверенные настройки (неизвестные значения — по умолчанию).
 * null — нет периода или он задан не датами.
 */
export function normalizeSettings(def: ReportDef, raw: unknown, opts: { today: string; userName: string }): ReportSettings | null {
  const base = defaultSettings(def, opts)
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const from = str(r.from, 10, base.from)
  const to = str(r.to, 10, base.to)
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return null
  const rate = Number(r.vatRate)
  return {
    from,
    to,
    dateBasis: oneOf(r.dateBasis, ['load', 'created'] as const, base.dateBasis),
    carrierIds: ids(r.carrierIds),
    scope: oneOf(r.scope, ['closed', 'done'] as const, base.scope),
    vat: oneOf(r.vat, ['none', 'included', 'on-top'] as const, base.vat),
    vatRate: (VAT_RATES as readonly number[]).includes(rate) ? rate : base.vatRate,
    grouping: oneOf(r.grouping, def.groupings ?? ['none'], base.grouping),
    columns: Array.isArray(r.columns) ? ids(r.columns, (def.columns ?? []).map((c) => c.id)) : base.columns,
    sections: Array.isArray(r.sections) ? ids(r.sections, (def.sections ?? []).map((s) => s.id)) : base.sections,
    edoFilter: oneOf(r.edoFilter, ['all', 'unsigned', 'signed'] as const, base.edoFilter),
    organization: str(r.organization, 200, base.organization) || base.organization,
    department: str(r.department, 200, base.department),
    preparedPosition: str(r.preparedPosition, 120, base.preparedPosition),
    preparedName: str(r.preparedName, 120, base.preparedName),
    checkedPosition: str(r.checkedPosition, 120, base.checkedPosition),
    checkedName: str(r.checkedName, 120, base.checkedName),
  }
}

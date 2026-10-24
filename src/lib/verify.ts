/**
 * Движок проверки документов (слайды 10, 21–24).
 *
 * Пайплайн: качество фото → тип документа → распознавание → сверка с данными заявки → правила.
 *
 * Распознавание — только локальный OCR-сервис на нашем сервере (PaddleOCR,
 * mini-services/paddle-ocr): фото документов не покидают сервер. Две нейросети
 * переключаются параметром mode (Task 83):
 *   "fast"     — лёгкая модель PP-OCRv5_mobile_det — кнопка «Автозаполнение» карточки;
 *   "accurate" — точная модель PP-OCRv5_server_det — кнопка «Проверить» перед попаданием в базу;
 *   без mode   — автоподбор: быстрый проход + точный повтор, если поля не дочитаны.
 *   Облачный резерв (GLM-4.6V) удалён (Task 79).
 * Ничего не подставляется: при сбое нейросети код не «читает» данные из заявки.
 * Имитация распознавания осталась только для демо-образцов (SVG) и только при DEMO_SAMPLES=1.
 *
 * Итог — один из четырёх статусов:
 *   PASSED   — «Передать дальше»: поля распознаны уверенно, проверки пройдены
 *   REUPLOAD — «Перезагрузить документ»: качество/не тот документ
 *   REJECTED — «Отказ с причиной»: явное несоответствие при высокой уверенности
 *   MANUAL   — «Ручная проверка»: результат неоднозначен, решает сотрудник
 */
import { ocrServiceOcr } from '@/lib/ocr-service'
import { demoSamplesEnabled } from '@/lib/settings'

export type DocType = 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'LICENSE' | 'STS' | 'REQUEST_DOC' | 'POA'

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  PASSPORT_PHOTO: 'Паспорт: страница с фото',
  PASSPORT_REG: 'Паспорт: страница регистрации',
  LICENSE: 'Водительское удостоверение',
  STS: 'СТС (лицевая сторона)',
  REQUEST_DOC: 'Заявка на перевозку (скан)',
  POA: 'Доверенность',
}

export interface FieldSpec {
  label: string
  kind: 'fio' | 'date' | 'passport' | 'license' | 'plate' | 'vin' | 'code' | 'text'
  /** необязательное поле: если не найдено — не повод для ручной проверки (нет на этой стороне/версии документа) */
  optional?: boolean
}

export const DOC_FIELDS: Record<DocType, FieldSpec[]> = {
  PASSPORT_PHOTO: [
    { label: 'Фамилия', kind: 'fio' },
    { label: 'Имя', kind: 'fio' },
    { label: 'Отчество', kind: 'fio' },
    { label: 'Дата рождения', kind: 'date' },
    { label: 'Серия и номер', kind: 'passport' },
    { label: 'Дата выдачи', kind: 'date' },
    { label: 'Код подразделения', kind: 'code' },
    { label: 'Место рождения', kind: 'text', optional: true },
  ],
  PASSPORT_REG: [
    { label: 'Дата регистрации', kind: 'date' },
    { label: 'Код подразделения', kind: 'code' },
    { label: 'Адрес регистрации', kind: 'text' },
  ],
  LICENSE: [
    { label: 'ФИО', kind: 'fio' },
    { label: 'Дата рождения', kind: 'date' },
    { label: 'Номер ВУ', kind: 'license' },
    { label: 'Категории', kind: 'text' },
    { label: 'Дата выдачи', kind: 'date' },
    { label: 'Действует до', kind: 'date' },
  ],
  STS: [
    { label: 'Госномер', kind: 'plate' },
    { label: 'VIN', kind: 'vin' },
    { label: 'Номер СТС', kind: 'passport' },
    { label: 'Марка', kind: 'text' },
    // собственник напечатан на обороте СТС — на лицевой стороне его нет
    { label: 'Владелец', kind: 'text', optional: true },
  ],
  REQUEST_DOC: [
    { label: 'Номер заявки', kind: 'text' },
    { label: 'Дата заявки', kind: 'date' },
    { label: 'Груз', kind: 'text' },
    { label: 'Ставка', kind: 'text' },
  ],
  POA: [
    { label: 'Номер доверенности', kind: 'text' },
    { label: 'Дата выдачи', kind: 'date' },
    { label: 'Действительна до', kind: 'date' },
    { label: 'Кем выдана (перевозчик)', kind: 'text' },
    { label: 'Представитель (ФИО)', kind: 'fio' },
    { label: 'Паспорт представителя', kind: 'passport', optional: true },
  ],
}

/** Оборот СТС: собственник и особые отметки (лизинг, временный учёт) */
export const STS_BACK_FIELDS: FieldSpec[] = [
  { label: 'Номер СТС', kind: 'passport' },
  { label: 'Владелец', kind: 'text' },
  { label: 'Лизингодатель', kind: 'text', optional: true },
  { label: 'Временный учёт до', kind: 'date', optional: true },
]

/** Поле «срок действия» у документов, где он есть (у ВУ и доверенности подписи разные) */
const EXPIRY_LABEL: Partial<Record<DocType, string>> = {
  LICENSE: 'Действует до',
  POA: 'Действительна до',
}

export interface ExpectedData {
  fullName?: string
  birthDate?: string
  passport?: string
  license?: string
  licenseTill?: string
  plate?: string
  vin?: string
  sts?: string
  owner?: string
  truckBrand?: string
  requestNumber?: string
  cargo?: string
  /** дата погрузки (ДД.ММ.ГГГГ): на неё ВУ и доверенность должны действовать */
  loadDate?: string
  /** в рейсе есть прицеп → у водителя нужна категория CE (берётся из заявки, а не из карточки водителя) */
  needCE?: boolean
}

export interface VerifySettings {
  confReupload: number // ниже — поле не принимается, решает человек (0.60)
  confReject: number // от этой уверенности расхождение с заявкой = отказ (0.60, настраивается отдельно)
  confAuto: number // выше — принято без подтверждений (0.95)
  minQuality: number // порог качества фото (60 из 100)
}

/** От этого уровня уверенности хватает одного подтверждения; ниже (но от confReupload) нужны два */
export const CONF_ONE_CONFIRM = 0.8

export interface OcrOutput {
  engine: string
  quality: number
  fields: Record<string, string>
  confidences: Record<string, number>
  /** какой вид документа распознан на изображении (для проверки соответствия слоту) */
  detectedType?: DocType | 'UNKNOWN'
  /** сторона документа (у СТС — лицевая или оборот) */
  side?: 'front' | 'back'
  /** какая нейросеть читала: fast (лёгкая) / accurate (точная) — Task 83 */
  engineMode?: 'fast' | 'accurate'
  /** независимые подтверждения, найденные самим движком: копии номера на полях паспорта,
   *  латинская строка ВУ, повторное чтение категорий, срок ВУ = выдача + 10 лет */
  confirmations?: Record<string, string[]>
}

export interface VerifyVerdict {
  /** PENDING — распознавание не выполнено (сервис занят), проверку нужно повторить */
  status: 'PASSED' | 'REUPLOAD' | 'REJECTED' | 'MANUAL' | 'PENDING'
  quality: number
  engine: string
  fields: Record<string, string>
  confidences: Record<string, number>
  issues: string[]
  message: string
  /** какая нейросеть читала: fast (лёгкая) / accurate (точная) — Task 83 */
  engineMode?: 'fast' | 'accurate'
  /** фактически распознанный вид документа (заполняется при первичном вводе) */
  detectedType?: DocType | 'UNKNOWN' | null
}

// ---------------- детерминированный псевдослучайный генератор (только демо) ----------------

function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return h >>> 0
}

function pseudo(seed: string, min: number, max: number): number {
  const h = hashStr(seed)
  return min + ((h % 10_000) / 10_000) * (max - min)
}

// ---------------- нормализация ----------------

/** Латинские буквы, похожие на русские: OCR нередко читает «РОМАН» как «POMAH» */
const LAT2CYR: Record<string, string> = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' }
const CYR2LAT: Record<string, string> = Object.fromEntries(Object.entries(LAT2CYR).map(([l, c]) => [c, l]))

/** Цифры, которые OCR путает с буквами в ФИО: «3ЕБКИН» → «ЗЕБКИН» */
const DIGIT2CYR: Record<string, string> = { '3': 'З', '0': 'О', '6': 'Б' }

function normalizeFio(s: string): string {
  return s.toUpperCase()
    .replace(/[ABCEHKMOPTXY]/g, (c) => LAT2CYR[c] ?? c)
    .replace(/[306]/g, (c) => DIGIT2CYR[c] ?? c)
    .replace(/Ё/g, 'Е')
    .replace(/[^А-Я\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ключ сверки ФИО: только буквы. OCR может потерять пробел («ИВАНИВАНОВИЧ») — это не расхождение */
const fioKey = (s: string): string => normalizeFio(s).replace(/[^А-Я]/g, '')

function fioEquals(a: string, b: string): boolean {
  return fioKey(a) === fioKey(b)
}

/** Госномер/серия ВУ: латиница и кириллица одного вида считаются одной буквой, пробелы не важны */
function plateLetters(s: string): string {
  return s.toUpperCase().replace(/\s/g, '').split('').map((c) => CYR2LAT[c] ?? c).join('')
}

const looseText = (s: string): string => s.toUpperCase().replace(/Ё/g, 'Е').replace(/[^А-ЯA-Z0-9]/g, '')

/** Категории ВУ как набор обозначений: «C1» не засчитывается как «C» (раньше искалось подстрокой) */
const CATEGORY_SET = new Set(['A', 'A1', 'B', 'B1', 'BE', 'C', 'C1', 'CE', 'C1E', 'D', 'D1', 'DE', 'D1E', 'M', 'TM', 'TB'])
export function parseCategories(s: string): Set<string> {
  const tokens = s.toUpperCase()
    .split('').map((c) => CYR2LAT[c] ?? c).join('')
    .split(/[^A-Z0-9]+/)
    .filter((t) => CATEGORY_SET.has(t))
  return new Set(tokens)
}

// ---------------- имитация распознавания (только демо-образцы) ----------------

/**
 * Имитация для демо-образцов (SVG): «читает» ожидаемые значения с высокой уверенностью.
 * Используется только для SVG-заглушек и только при DEMO_SAMPLES=1 — настоящие фото так не проверяются.
 */
export function simulateOcr(seedSource: string, type: DocType, expected: ExpectedData): OcrOutput {
  const docId = seedSource
  const blurry = /blur|размыт|noise|dark|смаз/i.test(seedSource)
  const quality = blurry ? pseudo('q' + docId, 15, 35) : pseudo('q' + docId, 86, 99)
  const fields: Record<string, string> = {}
  const confidences: Record<string, number> = {}

  // вымышленные значения для полей, которых нет в заявке
  const values: Record<string, string> = {
    'Фамилия': (expected.fullName ?? '').split(' ')[0] ?? '',
    'Имя': (expected.fullName ?? '').split(' ')[1] ?? '',
    'Отчество': (expected.fullName ?? '').split(' ')[2] ?? '',
    'ФИО': expected.fullName ?? '',
    'Дата рождения': expected.birthDate ?? '',
    'Серия и номер': expected.passport ?? '',
    'Дата выдачи': '01.02.2020',
    'Код подразделения': '770-001',
    'Дата регистрации': '01.02.2020',
    'Адрес регистрации': 'г. Москва, ул. Примерная, д. 1',
    'Номер ВУ': expected.license ?? '',
    'Категории': expected.needCE === false ? 'B, C' : 'B, C, CE',
    'Действует до': expected.licenseTill ?? '',
    'Госномер': expected.plate ?? '',
    'VIN': expected.vin ?? '',
    'Номер СТС': expected.sts ?? '',
    'Марка': expected.truckBrand ?? '',
    'Владелец': expected.owner ?? '',
    'Номер заявки': expected.requestNumber ?? '',
    'Дата заявки': new Date().toLocaleDateString('ru-RU'),
    'Груз': expected.cargo ?? '',
    'Ставка': '',
    'Номер доверенности': '47',
    'Действительна до': `31.12.${new Date().getFullYear() + 1}`,
    'Кем выдана (перевозчик)': expected.owner ?? '',
    'Представитель (ФИО)': expected.fullName ?? '',
  }

  for (const f of DOC_FIELDS[type]) {
    fields[f.label] = values[f.label] ?? ''
    confidences[f.label] = f.label === 'Адрес регистрации'
      ? pseudo('c' + docId + f.label, 0.42, 0.72) // штамп адреса — слабое место
      : blurry ? pseudo('c' + docId + f.label, 0.3, 0.58) : pseudo('c' + docId + f.label, 0.9, 0.999)
  }
  return { engine: 'Демо-образец (имитация)', quality: Math.round(quality), fields, confidences }
}

/** Сервис распознавания не ответил (занят или выключен): документ остаётся «на проверке», а не уходит в ручную */
export class OcrUnavailableError extends Error {
  constructor() { super('Сервис распознавания недоступен или занят') }
}

/** Какую нейросеть просим читать документ (Task 83): fast — лёгкая, accurate — точная */
export type OcrMode = 'fast' | 'accurate'

/**
 * Распознавание настоящего фото: только локальный сервис на нашем сервере
 * (облачный резерв удалён, Task 79 — фото документов не покидают сервер).
 * mode — какая нейросеть читает: fast (лёгкая, «Автозаполнение») / accurate (точная, «Проверить»);
 * без mode движок сам подбирает режим (быстрый проход + точный повтор при непрочитанных полях).
 * 'unsupported' — у движка нет шаблона этого вида документа (проверка вручную);
 * OcrUnavailableError — сервис не ответил: проверку нужно повторить.
 */
export async function recognize(dataUri: string, type: DocType, intake: boolean, mode?: OcrMode): Promise<OcrOutput | 'unsupported'> {
  const local = await ocrServiceOcr(dataUri, type, intake, mode)
  if (local.kind === 'ok') return local.ocr
  if (local.kind === 'unsupported') return 'unsupported'
  throw new OcrUnavailableError()
}

// ---------------- правила проверки ----------------

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/
const PASSPORT_RE = /^\d{2}\s?\d{2}\s?\d{6}$/
const LICENSE_RE = /^\d{2}\s?[\dА-ЯA-Z]{2}\s?\d{6}$/i
const CODE_RE = /^\d{3}-\d{3}$/
// госномер автомобиля (А123ВС777) или прицепа (АВ1234 23)
const PLATE_RE = /^(?:[АВЕКМНОРСТУХABEKMHOPCTYX]\d{3}[АВЕКМНОРСТУХABEKMHOPCTYX]{2}|[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\d{4})\s?\d{2,3}$/i
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i

export function parseDateRu(s: string): Date | null {
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? d : null
}

const startOfToday = (): Date => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Строгий формат поля: true/false; null — у поля нет формального правила */
function formatOk(kind: FieldSpec['kind'], value: string): boolean | null {
  switch (kind) {
    case 'passport': return PASSPORT_RE.test(value)
    case 'license': return LICENSE_RE.test(value)
    case 'code': return CODE_RE.test(value)
    case 'plate': return PLATE_RE.test(value)
    case 'vin': return VIN_RE.test(value)
    case 'date': return DATE_RE.test(value) && parseDateRu(value) !== null
    default: return null
  }
}

/** Форматы, которые считаются независимым подтверждением (структурные номера; даты и ФИО — нет) */
const FORMAT_CONFIRMS = new Set<FieldSpec['kind']>(['passport', 'license', 'code', 'plate', 'vin'])

export function applyRules(
  ocr: OcrOutput,
  type: DocType,
  expected: ExpectedData,
  settings: VerifySettings,
): VerifyVerdict {
  const issues: string[] = []
  const { fields, confidences } = ocr
  const verdict = (status: VerifyVerdict['status'], message: string): VerifyVerdict => ({
    status, quality: ocr.quality, engine: ocr.engine, fields, confidences, issues, message,
    ...(ocr.engineMode ? { engineMode: ocr.engineMode } : {}),
  })

  // 1. Качество изображения
  if (ocr.quality < settings.minQuality) {
    return verdict('REUPLOAD', `Качество изображения ${ocr.quality} при пороге ${settings.minQuality} — поля не проверяются, загрузите фото заново`)
  }

  // 2. Вид документа: движок распознал другой документ → это не тот файл
  if (ocr.detectedType && ocr.detectedType !== type) {
    const what = ocr.detectedType === 'UNKNOWN' ? 'не удалось распознать документ' : `распознан «${DOC_TYPE_LABEL[ocr.detectedType]}»`
    const msg = `Ожидался «${DOC_TYPE_LABEL[type]}», но ${what} — загрузите правильный документ`
    issues.push(msg)
    return verdict('REUPLOAD', msg)
  }

  const fioParts = expected.fullName ? normalizeFio(expected.fullName).split(' ') : []
  const checkOn = (() => {
    const load = expected.loadDate ? parseDateRu(expected.loadDate) : null
    const today = startOfToday()
    return load && load > today ? load : today
  })()

  // 3. Поля: формат → сверка с заявкой и правила → уверенность с подтверждениями
  let lowCount = 0
  const specs = type === 'STS' && ocr.side === 'back' ? STS_BACK_FIELDS : DOC_FIELDS[type]
  for (const f of specs) {
    const value = (fields[f.label] ?? '').trim()
    const conf = confidences[f.label] ?? 0
    if (!value) {
      if (f.optional) continue
      issues.push(`Поле «${f.label}» не найдено — решает человек`)
      lowCount++
      continue
    }
    const fmt = formatOk(f.kind, value)
    if (fmt === false) {
      issues.push(`Поле «${f.label}»: «${value}» — формат не соответствует правилу, решает человек`)
      lowCount++
      continue
    }

    const confirmations: string[] = [...(ocr.confirmations?.[f.label] ?? [])]
    if (fmt === true && FORMAT_CONFIRMS.has(f.kind)) confirmations.push('строгий формат')
    let mismatch = null as string | null
    const matched = (ok: boolean, text: string) => {
      if (ok) confirmations.push('совпадает с заявкой')
      else mismatch = text
    }

    // сверка с заявкой
    if (f.label === 'Дата рождения' && expected.birthDate) {
      matched(value === expected.birthDate, `Дата рождения на документе (${value}) не совпадает с заявкой (${expected.birthDate})`)
    }
    if ((f.label === 'ФИО' || f.label === 'Представитель (ФИО)') && expected.fullName) {
      matched(fioEquals(value, expected.fullName), `ФИО на документе («${value}») не совпадает с заявкой («${expected.fullName}»)`)
    }
    // паспорт: фамилия, имя и отчество сверяются каждое (раньше — только фамилия)
    const partIdx = ({ 'Фамилия': 0, 'Имя': 1, 'Отчество': 2 } as Record<string, number>)[f.label]
    if (type === 'PASSPORT_PHOTO' && partIdx !== undefined && fioParts[partIdx]) {
      matched(fioKey(value) === fioKey(fioParts[partIdx]), `${f.label} на документе («${value}») не совпадает с заявкой («${fioParts[partIdx]}»)`)
    }
    if (f.label === 'Паспорт представителя' && expected.passport) {
      matched(value.replace(/\s/g, '') === expected.passport.replace(/\s/g, ''), `Доверенность выдана на паспорт «${value}», а у водителя — «${expected.passport}»`)
    }
    if (f.label === 'Серия и номер' && expected.passport) {
      matched(value.replace(/\s/g, '') === expected.passport.replace(/\s/g, ''), `Серия и номер паспорта («${value}») не совпадают с заявкой («${expected.passport}»)`)
    }
    if (f.kind === 'license' && expected.license) {
      matched(plateLetters(value) === plateLetters(expected.license), `Номер ВУ («${value}») не совпадает с заявкой («${expected.license}»)`)
    }
    if (f.kind === 'plate' && expected.plate) {
      matched(plateLetters(value) === plateLetters(expected.plate), `Госномер («${value}») не совпадает с заявкой («${expected.plate}»)`)
    }
    if (f.kind === 'vin' && expected.vin) {
      matched(value.toUpperCase() === expected.vin.toUpperCase(), `VIN («${value}») не совпадает с заявкой («${expected.vin}»)`)
    }
    if (f.label === 'Номер СТС' && expected.sts && expected.sts !== '—') {
      matched(value.replace(/\s/g, '') === expected.sts.replace(/\s/g, ''), `Номер СТС («${value}») не совпадает с заявкой («${expected.sts}»)`)
    }
    if (f.label === 'Номер заявки' && expected.requestNumber) {
      matched(value.toUpperCase() === expected.requestNumber.toUpperCase(), `Номер заявки на документе («${value}») не совпадает с рейсом (${expected.requestNumber})`)
    }
    // свободный текст: совпадение — подтверждение, расхождение — не ошибка (форма записи разная)
    if (f.label === 'Владелец' && expected.owner && looseText(value) === looseText(expected.owner)) confirmations.push('совпадает с заявкой')
    if (f.label === 'Марка' && expected.truckBrand && looseText(value) === looseText(expected.truckBrand)) confirmations.push('совпадает с заявкой')
    if (f.label === 'Груз' && expected.cargo && looseText(value) === looseText(expected.cargo)) confirmations.push('совпадает с заявкой')

    // правила
    if (f.label === 'Дата выдачи') {
      const issued = parseDateRu(value)
      const born = expected.birthDate ? parseDateRu(expected.birthDate) : null
      if (issued && born && issued < born) mismatch = 'Дата выдачи раньше даты рождения — неверные данные'
      if (issued && issued > startOfToday()) mismatch = `Дата выдачи (${value}) ещё не наступила — неверные данные`
    }
    if (f.label === 'Временный учёт до') {
      const till = parseDateRu(value)
      if (till && till < checkOn) mismatch = `Временная регистрация ТС (лизинг) до ${value} — на ${checkOn.toLocaleDateString('ru-RU')} уже истекла`
    }
    if (EXPIRY_LABEL[type] === f.label) {
      const till = parseDateRu(value)
      if (till && till < checkOn) {
        const on = checkOn.toLocaleDateString('ru-RU')
        mismatch = type === 'POA'
          ? `Доверенность действует до ${value} — на ${on} уже недействительна`
          : `ВУ действует до ${value} — на ${on} уже недействительно`
      }
    }
    // категории: из заявки (есть прицеп → CE), обозначения целиком; без нужной — не «передать дальше»
    if (f.label === 'Категории' && expected.needCE !== undefined) {
      const has = parseCategories(value)
      const need = ['C', ...(expected.needCE ? ['CE'] : [])]
      const missing = need.filter((c) => !has.has(c))
      if (missing.length) {
        issues.push(`Категории: прочитано «${value}» — для рейса нужны ${need.join(' и ')}, нет ${missing.join(', ')}; решает человек`)
        lowCount++
        continue
      }
    }

    if (mismatch) {
      if (conf >= settings.confReject) {
        // расхождение при достаточной уверенности → отказ с причиной
        issues.push(mismatch)
        return verdict('REJECTED', mismatch)
      }
      issues.push(`${mismatch} (уверенность ${conf.toFixed(2)} ниже порога отказа — решает человек)`)
      lowCount++
      continue
    }
    // необязательное поле (место рождения, лизингодатель…) влияет на итог только расхождением
    if (f.optional) continue

    // уверенность: от confAuto — сразу; от 0.80 — нужно одно подтверждение; от confReupload — два
    if (conf >= settings.confAuto) continue
    if (conf < settings.confReupload) {
      issues.push(`Поле «${f.label}»: уверенность ${conf.toFixed(2)} — ниже порога ${settings.confReupload.toFixed(2)}, решает человек`)
      lowCount++
      continue
    }
    const need = conf >= CONF_ONE_CONFIRM ? 1 : 2
    const uniq = [...new Set(confirmations)]
    if (uniq.length >= need) {
      issues.push(`Поле «${f.label}»: уверенность ${conf.toFixed(2)} — принято по подтверждениям (${uniq.join(', ')})`)
    } else {
      issues.push(`Поле «${f.label}»: уверенность ${conf.toFixed(2)} — нужно подтверждений: ${need}, есть: ${uniq.length}${uniq.length ? ` (${uniq.join(', ')})` : ''}; решает человек`)
      lowCount++
    }
  }

  if (lowCount > 0) return verdict('MANUAL', 'Результат неоднозначен — требуется ручная проверка сотрудником')
  return verdict('PASSED', 'Документы распознаны, данные совпали — заявка уходит логисту')
}

const manualVerdict = (message: string, issue: string): VerifyVerdict => ({
  status: 'MANUAL', quality: 0, engine: '—', fields: {}, confidences: {}, issues: [issue], message,
})

const reuploadVerdict = (message: string): VerifyVerdict => ({
  status: 'REUPLOAD', quality: 0, engine: '—', fields: {}, confidences: {}, issues: [message], message,
})

/** Полный цикл проверки документа рейса: распознавание + правила */
export async function verifyDocument(
  docId: string,
  type: DocType,
  dataUri: string,
  expected: ExpectedData,
  settings: VerifySettings,
  fileName = '',
): Promise<VerifyVerdict> {
  if (dataUri.startsWith('data:image/svg')) {
    if (!demoSamplesEnabled()) return reuploadVerdict('Нужна фотография документа (JPG, PNG или WebP) — демо-образцы на этом стенде отключены')
    return applyRules(simulateOcr(`${fileName}:${docId}`, type, expected), type, expected, settings)
  }
  const ocr = await recognize(dataUri, type, false) // OcrUnavailableError — наверх, документ остаётся на проверке
  if (ocr === 'unsupported') {
    return manualVerdict(
      'Этот вид документа автоматически не распознаётся — его проверит сотрудник',
      'Автоматического шаблона для этого документа нет — сверка вручную',
    )
  }
  return applyRules(ocr, type, expected, settings)
}

export function expectedFor(
  driver: { fullName: string; birthDate: string; passport: string; license: string; licenseTill: string } | null,
  truck: { brand: string; plate: string; vin: string; sts: string; owner: string } | null,
  request?: { number: string; cargo: string; loadDate?: string; trailerId?: string | null } | null,
): ExpectedData {
  return {
    fullName: driver?.fullName,
    birthDate: driver?.birthDate,
    passport: driver?.passport,
    license: driver?.license,
    licenseTill: driver?.licenseTill,
    plate: truck?.plate,
    vin: truck?.vin,
    sts: truck?.sts,
    owner: truck?.owner,
    truckBrand: truck?.brand,
    requestNumber: request?.number,
    cargo: request?.cargo,
    loadDate: request?.loadDate,
    needCE: request ? Boolean(request.trailerId) : undefined,
  }
}

// ================= Ввод водителя с нейросетью (intake) =================
// Первичное добавление водителя: документы читаются нейросетью и сразу
// заполняют карточку водителя и тягача — без ручного ввода.

const FIO_RE = /^[А-ЯЁа-яё-]{2,}(?:\s+[А-ЯЁа-яё-]{2,}){1,2}$/

/** Читает текстовые элементы демо-SVG документа (dataUri) — только для DEMO_SAMPLES=1 */
function decodeSvgLines(dataUri: string): string[] | null {
  try {
    const comma = dataUri.indexOf(',')
    if (comma === -1) return null
    const meta = dataUri.slice(5, comma)
    const payload = dataUri.slice(comma + 1)
    const svg = meta.includes('base64')
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload)
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].trim()).filter(Boolean)
    return texts.length >= 2 ? texts : null
  } catch {
    return null
  }
}

const TITLE_HINTS: Record<DocType, RegExp> = {
  PASSPORT_PHOTO: /ПАСПОРТ/i,
  PASSPORT_REG: /РЕГИСТРАЦИЯ/i,
  LICENSE: /ВОДИТЕЛЬСКОЕ/i,
  STS: /СТС/i,
  REQUEST_DOC: /ЗАЯВКА/i,
  POA: /ДОВЕРЕННОСТЬ/i,
}

/**
 * Детерминированное «распознавание» демо-образцов (SVG-заглушек):
 * реально читает текст с изображения и раскладывает по полям документа.
 */
export function svgOcr(dataUri: string, type: DocType): OcrOutput | null {
  const lines = decodeSvgLines(dataUri)
  if (!lines) return null
  const [title, ...body] = lines
  const fields: Record<string, string> = {}
  const confidences: Record<string, number> = {}
  for (const f of DOC_FIELDS[type]) {
    fields[f.label] = ''
    confidences[f.label] = 0
  }
  const put = (label: string, value: string) => {
    if (!fields[label] && value) {
      fields[label] = value
      confidences[label] = pseudo('intake:' + type + label + value, 0.9, 0.999)
    }
  }
  const dates = body.filter((l) => DATE_RE.test(l))

  if (!TITLE_HINTS[type].test(title)) {
    // загруженный образец не того типа — низкое «качество», правила дадут REUPLOAD
    return { engine: 'Демо-образец (SVG)', quality: 20, fields, confidences }
  }

  if (type === 'PASSPORT_PHOTO') {
    const fio = body.find((l) => FIO_RE.test(l))
    if (fio) {
      const [fam, im, ot] = fio.split(/\s+/)
      put('Фамилия', fam ?? '')
      put('Имя', im ?? '')
      put('Отчество', ot ?? '')
    }
    put('Дата рождения', dates[0] ?? '')
    put('Дата выдачи', dates[1] ?? '')
    put('Серия и номер', body.find((l) => PASSPORT_RE.test(l)) ?? '')
    put('Код подразделения', body.find((l) => CODE_RE.test(l)) ?? '')
  } else if (type === 'PASSPORT_REG') {
    const head = (body[0] ?? '').split(/\s{2,}|\s+/)
    put('Дата регистрации', head.find((l) => DATE_RE.test(l)) ?? dates[0] ?? '')
    put('Код подразделения', head.find((l) => CODE_RE.test(l)) ?? '')
    const addr = body.slice(head.some((l) => CODE_RE.test(l)) || dates.some((d) => body[0]?.startsWith(d)) ? 1 : 0).join(', ')
    put('Адрес регистрации', addr)
  } else if (type === 'LICENSE') {
    put('ФИО', body.find((l) => FIO_RE.test(l)) ?? '')
    put('Дата рождения', dates[0] ?? '')
    put('Дата выдачи', dates[1] ?? '')
    put('Действует до', dates[2] ?? dates[1] ?? '')
    put('Номер ВУ', body.find((l) => LICENSE_RE.test(l)) ?? '')
    put('Категории', body.find((l) => !FIO_RE.test(l) && !DATE_RE.test(l) && !LICENSE_RE.test(l) && /^[A-Za-zА-Яа-я][A-Za-zА-Яа-я,\s]{0,14}$/.test(l)) ?? '')
  } else if (type === 'STS') {
    put('Госномер', body.find((l) => PLATE_RE.test(l)) ?? '')
    put('VIN', body.find((l) => VIN_RE.test(l)) ?? '')
    put('Номер СТС', body.find((l) => PASSPORT_RE.test(l)) ?? '')
    put('Владелец', body.find((l) => /«|»/.test(l) || /^(ООО|ИП|ОАО|ЗАО|АО)\b/i.test(l)) ?? '')
    put('Марка', body.find((l) => /[A-Za-zА-Яа-я]/.test(l) && /\d/.test(l) && !PLATE_RE.test(l) && !VIN_RE.test(l)) ?? '')
  } else if (type === 'REQUEST_DOC') {
    put('Номер заявки', body.find((l) => /Z-\d{3,4}/i.test(l))?.match(/Z-\d{3,4}/i)?.[0] ?? '')
    put('Дата заявки', dates[0] ?? '')
    put('Груз', body.find((l) => /ГРУЗ/i.test(l))?.replace(/^.*?:\s*/i, '') ?? '')
    put('Ставка', body.find((l) => /СТАВКА|₽|РУБ/i.test(l))?.replace(/^.*?:\s*/i, '') ?? '')
  } else if (type === 'POA') {
    put('Номер доверенности', body.find((l) => /№\s*\d+/i.test(l))?.replace(/^.*?№\s*/i, '') ?? '')
    put('Дата выдачи', dates[0] ?? '')
    put('Действительна до', dates[dates.length - 1] ?? '')
    put('Кем выдана (перевозчик)', body.find((l) => /«|»/.test(l) || /^(ООО|ИП|ОАО|ЗАО|АО)\b/i.test(l)) ?? '')
    put('Представитель (ФИО)', body.find((l) => FIO_RE.test(l)) ?? '')
  }
  return { engine: 'Демо-образец (SVG)', quality: Math.round(pseudo('q' + dataUri.slice(-40), 88, 99)), fields, confidences }
}

/**
 * Определяет фактический вид документа по заголовку демо-SVG образца.
 * Возвращает null, если заголовок не похож ни на один известный документ.
 */
export function detectSvgType(dataUri: string): DocType | null {
  const lines = decodeSvgLines(dataUri)
  if (!lines) return null
  const title = lines[0] ?? ''
  // «ПАСПОРТ РФ · РЕГИСТРАЦИЯ» содержит и «ПАСПОРТ» — проверяем регистрацию первой
  if (TITLE_HINTS.REQUEST_DOC.test(title)) return 'REQUEST_DOC'
  if (TITLE_HINTS.POA.test(title)) return 'POA'
  if (TITLE_HINTS.PASSPORT_REG.test(title)) return 'PASSPORT_REG'
  if (TITLE_HINTS.PASSPORT_PHOTO.test(title)) return 'PASSPORT_PHOTO'
  if (TITLE_HINTS.LICENSE.test(title)) return 'LICENSE'
  if (TITLE_HINTS.STS.test(title)) return 'STS'
  return null
}

/** Текст ошибки несоответствия вида документа (для карточки и списка проблем) */
export function mismatchMessage(declared: DocType, actual: DocType): string {
  return `Несоответствие вида документа: выбран слот «${DOC_TYPE_LABEL[declared]}», но на изображении распознан «${DOC_TYPE_LABEL[actual]}». Загрузите правильный документ.`
}

function mismatchVerdict(declared: DocType, actual: DocType, engine: string, quality: number): VerifyVerdict {
  const msg = mismatchMessage(declared, actual)
  return {
    status: 'REJECTED', quality, engine, fields: {}, confidences: {}, issues: [msg], message: msg,
    detectedType: actual,
  }
}

/**
 * Анализ одного документа при первичном вводе (intake / подача заявки):
 * сначала проверяется соответствие вида документа выбранному слоту,
 * затем — качество и распознанные поля (сверки с заявкой нет).
 */
export async function analyzeIntakeDoc(
  fileName: string,
  type: DocType,
  dataUri: string,
  settings: VerifySettings,
  mode?: OcrMode,
): Promise<VerifyVerdict> {
  if (dataUri.startsWith('data:image/svg')) {
    if (!demoSamplesEnabled()) return reuploadVerdict('Нужна фотография документа (JPG, PNG или WebP) — демо-образцы на этом стенде отключены')
    const actual = detectSvgType(dataUri)
    if (actual && actual !== type) return mismatchVerdict(type, actual, 'Демо-образец (SVG)', 92)
    const ocr = svgOcr(dataUri, type)
    if (ocr) return applyRules(ocr, type, {}, settings)
    return {
      status: 'REUPLOAD', quality: 30, engine: 'Демо-образец (SVG)', fields: {}, confidences: {},
      issues: ['Не удалось определить вид документа — загрузите чёткое изображение'],
      message: 'Вид документа не определён — загрузите изображение заново',
    }
  }

  let ocr: OcrOutput | 'unsupported'
  try {
    ocr = await recognize(dataUri, type, true, mode)
  } catch (e) {
    if (!(e instanceof OcrUnavailableError)) throw e
    return {
      status: 'PENDING', quality: 0, engine: '—', fields: {}, confidences: {},
      issues: ['Сервис распознавания занят или недоступен — проверка не выполнена'],
      message: 'Распознавание не выполнено — повторите проверку через минуту',
    }
  }
  if (ocr === 'unsupported') {
    return {
      status: 'MANUAL', quality: 0, engine: '—', fields: {}, confidences: {},
      issues: ['Автоматического шаблона для этого документа нет — проверьте его и заполните карточку вручную'],
      message: 'Этот документ проверяется вручную',
    }
  }
  if (ocr.detectedType && ocr.detectedType !== 'UNKNOWN' && ocr.detectedType !== type) {
    return mismatchVerdict(type, ocr.detectedType, ocr.engine, ocr.quality)
  }
  return { ...applyRules(ocr, type, {}, settings), detectedType: ocr.detectedType ?? null }
}

export interface IntakeDriverDraft {
  fullName: string
  birthDate: string
  passport: string
  license: string
  licenseTill: string
  categories: string
  birthPlace: string
  address: string
  confidence: Record<string, number>
}

export interface IntakeTruckDraft {
  brand: string
  plate: string
  vin: string
  sts: string
  owner: string
  confidence: Record<string, number>
}

export interface IntakeCrossCheck {
  label: string
  ok: boolean
  detail: string
}

export interface IntakeDraft {
  driver: IntakeDriverDraft
  truck: IntakeTruckDraft | null
  crossChecks: IntakeCrossCheck[]
}

/** Собирает из распознанных документов черновик карточки водителя (+тягача) со перекрёстными сверками */
export function buildIntakeDraft(docs: Partial<Record<DocType, VerifyVerdict>>): IntakeDraft {
  const pick = (type: DocType, label: string): { v: string; c: number } => {
    const d = docs[type]
    if (!d) return { v: '', c: 0 }
    return { v: (d.fields[label] ?? '').trim(), c: d.confidences[label] ?? 0 }
  }
  const best = (...cands: { v: string; c: number }[]) =>
    cands.filter((x) => x.v).sort((a, b) => b.c - a.c)[0] ?? { v: '', c: 0 }

  const pFam = pick('PASSPORT_PHOTO', 'Фамилия')
  const pIm = pick('PASSPORT_PHOTO', 'Имя')
  const pOt = pick('PASSPORT_PHOTO', 'Отчество')
  const pBirth = pick('PASSPORT_PHOTO', 'Дата рождения')
  const pPass = pick('PASSPORT_PHOTO', 'Серия и номер')
  const pPlace = pick('PASSPORT_PHOTO', 'Место рождения')
  const rAddr = pick('PASSPORT_REG', 'Адрес регистрации')
  const lFio = pick('LICENSE', 'ФИО')
  const lBirth = pick('LICENSE', 'Дата рождения')
  const lNum = pick('LICENSE', 'Номер ВУ')
  const lTill = pick('LICENSE', 'Действует до')
  const lCats = pick('LICENSE', 'Категории')

  const fullName =
    pFam.v || lFio.v
      ? best({ v: [pFam.v, pIm.v, pOt.v].filter(Boolean).join(' '), c: Math.min(...[pFam, pIm, pOt].filter((x) => x.v).map((x) => x.c)) }, lFio).v
      : ''
  const birth = best(pBirth, lBirth).v

  const driver: IntakeDriverDraft = {
    fullName,
    birthDate: birth,
    passport: pPass.v,
    license: lNum.v,
    licenseTill: lTill.v,
    categories: lCats.v,
    birthPlace: pPlace.v,
    address: rAddr.v,
    confidence: {
      fullName: best({ v: fullName, c: Math.min(pFam.c, pIm.c) || pFam.c }, lFio).c,
      birthDate: best(pBirth, lBirth).c,
      passport: pPass.c,
      license: lNum.c,
      licenseTill: lTill.c,
      categories: lCats.c,
      birthPlace: pPlace.c,
      address: rAddr.c,
    },
  }

  let truck: IntakeTruckDraft | null = null
  const sPlate = pick('STS', 'Госномер')
  if (sPlate.v || docs.STS) {
    truck = {
      brand: pick('STS', 'Марка').v,
      plate: sPlate.v,
      vin: pick('STS', 'VIN').v,
      sts: pick('STS', 'Номер СТС').v,
      owner: pick('STS', 'Владелец').v,
      confidence: {
        brand: pick('STS', 'Марка').c,
        plate: sPlate.c,
        vin: pick('STS', 'VIN').c,
        sts: pick('STS', 'Номер СТС').c,
        owner: pick('STS', 'Владелец').c,
      },
    }
  }

  const crossChecks: IntakeCrossCheck[] = []
  if (pFam.v && lFio.v) {
    const ok = fioEquals([pFam.v, pIm.v, pOt.v].filter(Boolean).join(' '), lFio.v)
    crossChecks.push({ label: 'ФИО: паспорт ↔ ВУ', ok, detail: ok ? 'совпадают' : `«${[pFam.v, pIm.v, pOt.v].filter(Boolean).join(' ')}» ↔ «${lFio.v}»` })
  }
  if (pBirth.v && lBirth.v) {
    const ok = pBirth.v === lBirth.v
    crossChecks.push({ label: 'Дата рождения: паспорт ↔ ВУ', ok, detail: ok ? 'совпадают' : `«${pBirth.v}» ↔ «${lBirth.v}»` })
  }
  if (lCats.v) {
    const has = parseCategories(lCats.v)
    const need = ['C', 'CE'].filter((c) => !has.has(c))
    crossChecks.push({ label: 'Категории для тягача (C, CE)', ok: need.length === 0, detail: need.length ? `прочитано «${lCats.v}», нет ${need.join(', ')}` : `прочитано «${lCats.v}»` })
  }
  if (lTill.v) {
    const till = parseDateRu(lTill.v)
    const ok = till ? till >= new Date() : false
    crossChecks.push({ label: 'Срок действия ВУ', ok, detail: ok ? `действительно до ${lTill.v}` : till ? `истёк ${lTill.v}` : `не распознана дата` })
  }
  return { driver, truck, crossChecks }
}

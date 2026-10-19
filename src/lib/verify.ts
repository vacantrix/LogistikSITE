/**
 * Движок проверки документов (слайды 10, 21–24).
 *
 * Пайплайн: качество фото → тип документа → распознавание (VLM, фолбэк —
 * детерминированная симуляция PaddleOCR) → сверка с данными заявки → правила.
 *
 * Итог — один из четырёх статусов:
 *   PASSED   — «Передать дальше»: поля распознаны уверенно, проверки пройдены
 *   REUPLOAD — «Перезагрузить документ»: качество/не тот документ
 *   REJECTED — «Отказ с причиной»: явное несоответствие при высокой уверенности
 *   MANUAL   — «Ручная проверка»: результат неоднозначен, решает сотрудник
 */
import ZAI from 'z-ai-web-dev-sdk'

export type DocType = 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'LICENSE' | 'STS'

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  PASSPORT_PHOTO: 'Паспорт: страница с фото',
  PASSPORT_REG: 'Паспорт: страница регистрации',
  LICENSE: 'Водительское удостоверение',
  STS: 'СТС (лицевая сторона)',
}

export interface FieldSpec {
  label: string
  kind: 'fio' | 'date' | 'passport' | 'license' | 'plate' | 'vin' | 'code' | 'text'
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
    { label: 'Владелец', kind: 'text' },
  ],
}

export interface ExpectedData {
  fullName?: string
  birthDate?: string
  passport?: string
  license?: string
  licenseTill?: string
  categories?: string
  plate?: string
  vin?: string
  sts?: string
  owner?: string
  truckBrand?: string
}

export interface VerifySettings {
  confReupload: number // ниже — перезагрузить (0.60)
  confAuto: number // выше — принято автоматически (0.95)
  minQuality: number // порог качества фото (60 из 100)
}

export interface OcrOutput {
  engine: string
  quality: number
  fields: Record<string, string>
  confidences: Record<string, number>
}

export interface VerifyVerdict {
  status: 'PASSED' | 'REUPLOAD' | 'REJECTED' | 'MANUAL'
  quality: number
  engine: string
  fields: Record<string, string>
  confidences: Record<string, number>
  issues: string[]
  message: string
}

// ---------------- детерминированный псевдослучайный генератор ----------------

function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return h >>> 0
}

function pseudo(seed: string, min: number, max: number): number {
  const h = hashStr(seed)
  return min + ((h % 10_000) / 10_000) * (max - min)
}

// ---------------- симуляция распознавания (фолбэк PaddleOCR) ----------------

function normalizeFio(s: string): string {
  return s.toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim()
}

function fioEquals(a: string, b: string): boolean {
  return normalizeFio(a) === normalizeFio(b)
}

function plateLetters(s: string): string {
  // А123ВС777 → A123BC777 (латиница к кириллице и обратно)
  const map: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' }
  return s.split('').map((c) => map[c] ?? c).join('').toUpperCase()
}

/** Симуляция: «нейросеть» читает ожидаемые значения с оценками уверенности. */
export function simulateOcr(seedSource: string, type: DocType, expected: ExpectedData): OcrOutput {
  const docId = seedSource
  const blurry = /blur|размыт|noise|dark|смаз/i.test(seedSource)
  const quality = blurry ? pseudo('q' + docId, 15, 35) : pseudo('q' + docId, 86, 99)
  const fields: Record<string, string> = {}
  const confidences: Record<string, number> = {}

  const values: Record<string, string> = {
    'Фамилия': (expected.fullName ?? '').split(' ')[0] ?? '',
    'Имя': (expected.fullName ?? '').split(' ')[1] ?? '',
    'Отчество': (expected.fullName ?? '').split(' ')[2] ?? '',
    'ФИО': expected.fullName ?? '',
    'Дата рождения': expected.birthDate ?? '',
    'Серия и номер': expected.passport ?? '',
    'Дата выдачи': '10.04.2024',
    'Код подразделения': '230-027',
    'Дата регистрации': '13.03.2024',
    'Адрес регистрации': 'г. Абинск, ул. Интернациональная д. 110',
    'Номер ВУ': expected.license ?? '',
    'Категории': expected.categories ?? '',
    'Действует до': expected.licenseTill ?? '',
    'Госномер': expected.plate ?? '',
    'VIN': expected.vin ?? '',
    'Номер СТС': expected.sts ?? '',
    'Марка': expected.truckBrand ?? '',
    'Владелец': expected.owner ?? '',
  }

  // редкий «промах» распознавания — одна цифра номера отличается (→ несоответствие)
  const misread = pseudo('mis' + docId, 0, 1) < 0.18
  for (const f of DOC_FIELDS[type]) {
    let v = values[f.label] ?? ''
    if (misread && (f.kind === 'passport' || f.kind === 'license') && v.length > 3) {
      const i = v.length - 1
      v = v.slice(0, i) + String((Number(v[i]) + 3) % 10)
      confidences[f.label] = pseudo('c' + docId + f.label, 0.93, 0.99) // уверенно, но не совпадает
    } else if (f.kind === 'text' && f.label === 'Адрес регистрации') {
      confidences[f.label] = pseudo('c' + docId + f.label, 0.42, 0.72) // штамп адреса — слабое место
    } else {
      confidences[f.label] = blurry ? pseudo('c' + docId + f.label, 0.3, 0.58) : pseudo('c' + docId + f.label, 0.9, 0.999)
    }
    fields[f.label] = v
  }
  return { engine: 'PaddleOCR-демо', quality: Math.round(quality), fields, confidences }
}

// ---------------- распознавание через VLM (основной путь) ----------------

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

export async function vlmOcr(dataUri: string, type: DocType, expected: ExpectedData | null): Promise<OcrOutput | null> {
  const fieldList = DOC_FIELDS[type].map((f) => `«${f.label}»`).join(', ')
  const prompt = [
    `Ты — OCR-модуль проверки транспортных документов (аналог PaddleOCR). Тип документа: ${DOC_TYPE_LABEL[type]}.`,
    `Прочитай изображение и верни СТРОГО JSON без пояснений:`,
    `{"quality": <0..100, качество фото: резкость, свет, документ целиком в кадре>,`,
    `"fields": {${fieldList}: <прочитанное значение, "" если не найдено>},`,
    `"confidences": {<поле>: <0..1 уверенность в прочитанном>},`,
    `"docOk": <true, если это действительно ${DOC_TYPE_LABEL[type]}>}`,
    ...(expected
      ? [`Для справки, ожидаемые в заявке значения: ${JSON.stringify(expected)}. Не подставляй их автоматически — читай только с фото.`]
      : [`Значений для сверки нет — это первичный ввод водителя: заполняй ТОЛЬКО реально прочитанные с изображения значения, ничего не выдумывай.`]),
    `Если изображение не является документом этого типа — поставь quality < 25 и docOk=false.`,
  ].join('\n')

  try {
    const zai = await Promise.race([
      ZAI.create(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('init-timeout')), 8000)),
    ])
    const response = await Promise.race([
      zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUri } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('vlm-timeout')), 30000)),
    ])
    const content = response.choices[0]?.message?.content
    if (!content) return null
    const json = extractJson(content)
    if (!json || typeof json.quality !== 'number') return null
    const fields = (json.fields ?? {}) as Record<string, string>
    const confidences = (json.confidences ?? {}) as Record<string, number>
    if (!json.docOk && json.quality >= 25) return null
    return { engine: 'GLM-Vision (VLM)', quality: Math.round(json.quality), fields, confidences }
  } catch {
    return null
  }
}

// ---------------- правила проверки ----------------

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/
const PASSPORT_RE = /^\d{2}\s?\d{2}\s\d{6}$/
const LICENSE_RE = /^\d{2}\s?\d{2}\s?\d{6}$/
const CODE_RE = /^\d{3}-\d{3}$/
const PLATE_RE = /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\s?\d{2,3}$/i
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i

export function parseDateRu(s: string): Date | null {
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null
}

export function applyRules(
  ocr: OcrOutput,
  type: DocType,
  expected: ExpectedData,
  settings: VerifySettings,
): VerifyVerdict {
  const issues: string[] = []
  const { fields, confidences } = ocr

  // 1. Качество изображения
  if (ocr.quality < settings.minQuality) {
    return {
      status: 'REUPLOAD', quality: ocr.quality, engine: ocr.engine, fields, confidences, issues,
      message: `Качество изображения ${ocr.quality} при пороге ${settings.minQuality} — поля не проверяются, загрузите фото заново`,
    }
  }

  // 2. Проверка полей: уверенность + сверка с заявкой + формат
  let lowCount = 0
  for (const f of DOC_FIELDS[type]) {
    const value = (fields[f.label] ?? '').trim()
    const conf = confidences[f.label] ?? 0
    if (!value) {
      issues.push(`Поле «${f.label}» не найдено — решает человек`)
      lowCount++
      continue
    }
    // формат поля
    const fmtOk =
      f.kind === 'passport' ? PASSPORT_RE.test(value)
      : f.kind === 'license' ? LICENSE_RE.test(value)
      : f.kind === 'code' ? CODE_RE.test(value)
      : f.kind === 'plate' ? PLATE_RE.test(value)
      : f.kind === 'vin' ? VIN_RE.test(value)
      : f.kind === 'date' ? DATE_RE.test(value)
      : true
    if (!fmtOk) {
      issues.push(`Поле «${f.label}»: «${value}» — формат не соответствует правилу, решает человек`)
      lowCount++
      continue
    }

    // сверка с заявкой (где применимо)
    let mismatch: string | null = null
    if (f.kind === 'date' && f.label === 'Дата рождения' && expected.birthDate && value !== expected.birthDate) {
      mismatch = `Дата рождения на документе (${value}) не совпадает с заявкой (${expected.birthDate})`
    }
    if (f.kind === 'fio' && f.label === 'ФИО' && expected.fullName && !fioEquals(value, expected.fullName)) {
      mismatch = `ФИО на документе («${value}») не совпадает с заявкой («${expected.fullName}»)`
    }
    if (f.kind === 'fio' && f.label === 'Фамилия' && expected.fullName) {
      const fam = normalizeFio(expected.fullName).split(' ')[0]
      if (fam && normalizeFio(value) !== fam) mismatch = `Фамилия на документе («${value}») не совпадает с заявкой («${fam}»)`
    }
    if (f.kind === 'passport' && f.label === 'Серия и номер' && expected.passport && value.replace(/\s/g, '') !== expected.passport.replace(/\s/g, '')) {
      mismatch = `Серия и номер паспорта («${value}») не совпадают с заявкой («${expected.passport}»)`
    }
    if (f.kind === 'license' && expected.license && value.replace(/\s/g, '') !== expected.license.replace(/\s/g, '')) {
      mismatch = `Номер ВУ («${value}») не совпадает с заявкой («${expected.license}»)`
    }
    if (f.kind === 'plate' && expected.plate && plateLetters(value) !== plateLetters(expected.plate)) {
      mismatch = `Госномер («${value}») не совпадает с заявкой («${expected.plate}»)`
    }
    if (f.kind === 'vin' && expected.vin && value.toUpperCase() !== expected.vin.toUpperCase()) {
      mismatch = `VIN («${value}») не совпадает с заявкой («${expected.vin}»)`
    }
    if (f.kind === 'date' && f.label === 'Дата выдачи' && expected.birthDate) {
      const issue = parseDateRu(value)
      const born = parseDateRu(expected.birthDate)
      if (issue && born && issue < born) mismatch = `Дата выдачи раньше даты рождения — неверные данные`
    }
    if (f.kind === 'date' && f.label === 'Действует до' && type === 'LICENSE') {
      const till = parseDateRu(value)
      if (till && till < new Date()) mismatch = `Срок действия ВУ истёк (${value})`
    }
    if (f.label === 'Категории' && expected.categories) {
      const need = expected.categories.toUpperCase().includes('CE') ? ['C', 'CE'] : ['C']
      const has = value.toUpperCase()
      const missing = need.filter((c) => !has.includes(c))
      if (missing.length) issues.push(`Категории: прочитаны «${value}» — для тягача нет ${missing.join(', ')}, решает человек`)
      else if (conf < settings.confAuto) issues.push(`Категории «${value}» — принято по совпадению с заявкой`)
    }

    if (mismatch && conf >= settings.confReupload) {
      // расхождение при высокой уверенности → отказ с причиной
      issues.push(mismatch)
      return {
        status: 'REJECTED', quality: ocr.quality, engine: ocr.engine, fields, confidences, issues,
        message: mismatch,
      }
    }
    if (mismatch) {
      issues.push(`${mismatch} (уверенность ниже порога — решает человек)`)
      lowCount++
      continue
    }
    if (conf < settings.confReupload) {
      issues.push(`Поле «${f.label}»: уверенность ${conf.toFixed(2)} — ниже порога ${settings.confReupload.toFixed(2)}, решает человек`)
      lowCount++
    } else if (conf < settings.confAuto && f.kind !== 'text') {
      // 0.60–0.95: решают подтверждения — совпадение с заявкой + строгий формат
      issues.push(`Поле «${f.label}»: уверенность ${conf.toFixed(2)} — принято по подтверждениям (совпадение с заявкой, формат)`)
    }
  }

  if (lowCount > 0) {
    return {
      status: 'MANUAL', quality: ocr.quality, engine: ocr.engine, fields, confidences, issues,
      message: 'Результат неоднозначен — требуется ручная проверка сотрудником',
    }
  }
  return {
    status: 'PASSED', quality: ocr.quality, engine: ocr.engine, fields, confidences, issues,
    message: 'Документы распознаны, данные совпали — заявка уходит логисту',
  }
}

/** Полный цикл: распознавание (VLM → фолбэк) + правила. */
export async function verifyDocument(
  docId: string,
  type: DocType,
  dataUri: string,
  expected: ExpectedData,
  settings: VerifySettings,
  fileName = '',
): Promise<VerifyVerdict> {
  // демо-режим образцов (SVG-заглушки) распознаём детерминированной симуляцией,
  // реальные фото — сначала через VLM
  const isDemoSample = dataUri.startsWith('data:image/svg')
  let ocr: OcrOutput | null = null
  if (!isDemoSample) ocr = await vlmOcr(dataUri, type, expected)
  if (!ocr) ocr = simulateOcr(`${fileName}:${docId}`, type, expected)
  return applyRules(ocr, type, expected, settings)
}

export function expectedFor(
  driver: { fullName: string; birthDate: string; passport: string; license: string; licenseTill: string; categories: string } | null,
  truck: { brand: string; plate: string; vin: string; sts: string; owner: string } | null,
): ExpectedData {
  return {
    fullName: driver?.fullName,
    birthDate: driver?.birthDate,
    passport: driver?.passport,
    license: driver?.license,
    licenseTill: driver?.licenseTill,
    categories: driver?.categories,
    plate: truck?.plate,
    vin: truck?.vin,
    sts: truck?.sts,
    owner: truck?.owner,
    truckBrand: truck?.brand,
  }
}

// ================= Ввод водителя с нейросетью (intake) =================
// Первичное добавление водителя: документы читаются нейросетью и сразу
// заполняют карточку водителя и тягача — без ручного ввода.

const FIO_RE = /^[А-ЯЁа-яё-]{2,}(?:\s+[А-ЯЁа-яё-]{2,}){1,2}$/

/** Читает текстовые элементы демо-SVG документа (dataUri) */
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
    return { engine: 'PaddleOCR-демо (SVG)', quality: 20, fields, confidences }
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
  }
  return { engine: 'PaddleOCR-демо (SVG)', quality: Math.round(pseudo('q' + dataUri.slice(-40), 88, 99)), fields, confidences }
}

/** Анализ одного документа при вводе водителя: распознавание + правила (сверки с заявкой нет) */
export async function analyzeIntakeDoc(
  fileName: string,
  type: DocType,
  dataUri: string,
  settings: VerifySettings,
): Promise<VerifyVerdict> {
  const isDemoSample = dataUri.startsWith('data:image/svg')
  let ocr: OcrOutput | null = null
  if (isDemoSample) ocr = svgOcr(dataUri, type)
  if (!ocr) ocr = await vlmOcr(dataUri, type, null)
  if (!ocr) {
    return {
      status: 'MANUAL',
      quality: 0,
      engine: '—',
      fields: {},
      confidences: {},
      issues: ['Нейросеть распознавания недоступна — проверьте документ или заполните карточку вручную'],
      message: 'Нейросеть недоступна — данные можно ввести вручную',
    }
  }
  return applyRules(ocr, type, {}, settings)
}

export interface IntakeDriverDraft {
  fullName: string
  birthDate: string
  passport: string
  license: string
  licenseTill: string
  categories: string
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
    confidence: {
      fullName: best({ v: fullName, c: Math.min(pFam.c, pIm.c) || pFam.c }, lFio).c,
      birthDate: best(pBirth, lBirth).c,
      passport: pPass.c,
      license: lNum.c,
      licenseTill: lTill.c,
      categories: lCats.c,
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
    const has = lCats.v.toUpperCase()
    const need = ['C', 'CE'].filter((c) => !has.includes(c))
    crossChecks.push({ label: 'Категории для тягача (C, CE)', ok: need.length === 0, detail: need.length ? `прочитано «${lCats.v}», нет ${need.join(', ')}` : `прочитано «${lCats.v}»` })
  }
  if (lTill.v) {
    const till = parseDateRu(lTill.v)
    const ok = till ? till >= new Date() : false
    crossChecks.push({ label: 'Срок действия ВУ', ok, detail: ok ? `действительно до ${lTill.v}` : till ? `истёк ${lTill.v}` : `не распознана дата` })
  }
  return { driver, truck, crossChecks }
}

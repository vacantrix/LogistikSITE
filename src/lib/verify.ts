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

export async function vlmOcr(dataUri: string, type: DocType, expected: ExpectedData): Promise<OcrOutput | null> {
  const fieldList = DOC_FIELDS[type].map((f) => `«${f.label}»`).join(', ')
  const prompt = [
    `Ты — OCR-модуль проверки транспортных документов (аналог PaddleOCR). Тип документа: ${DOC_TYPE_LABEL[type]}.`,
    `Прочитай изображение и верни СТРОГО JSON без пояснений:`,
    `{"quality": <0..100, качество фото: резкость, свет, документ целиком в кадре>,`,
    `"fields": {${fieldList}: <прочитанное значение, "" если не найдено>},`,
    `"confidences": {<поле>: <0..1 уверенность в прочитанном>},`,
    `"docOk": <true, если это действительно ${DOC_TYPE_LABEL[type]}>}`,
    `Если изображение не является документом этого типа — поставь quality < 25 и docOk=false.`,
    `Для справки, ожидаемые в заявке значения: ${JSON.stringify(expected)}. Не подставляй их автоматически — читай только с фото.`,
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

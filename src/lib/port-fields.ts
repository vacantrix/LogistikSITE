/**
 * Форматные правила полей «Авто в порт» (Task 80/83) — общий модуль для всех входов:
 * нейросетевое автозаполнение карточек, ручной ввод и серверная проверка перед записью.
 *
 * Зачем: OCR (и человек) может прочитать поле как мусор («22о2/гвкгк» вместо госномера) —
 * такой мусор не должен попадать в базу и в 1С. Правила жёсткие и человекочитаемые:
 *   Госномер — А123ВС777 (тягач) или АВ1234 23 (прицеп), буквы только из «транспортного» набора;
 *   СТС      — ровно 10 цифр;
 *   Цвет     — только буквы (и дефис), без цифр;
 *   VIN      — 17 знаков: латинские буквы без I, O, Q и цифры;
 *   Текстовые (марка, собственник) — без служебного мусора (/, \, ;, %…).
 *
 * Нормализация делает видимый пользователю ввод аккуратным: латинские двойники → кириллица
 * в госномере, пробелы/дефисы убираются из номера СТС и т.д.
 */

/** Буквы российских госномеров (только те, что имеют «двойников» и читаются однозначно) */
const PLATE_LETTERS = 'АВЕКМНОРСТУХ'
const PLATE_LETTERS_RE = new RegExp(`[${PLATE_LETTERS}]`)

/** Латинские двойники → кириллица (как в engine.py LAT2CYR) */
const LAT2CYR: Record<string, string> = {
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
}

export type PortFieldKind = 'plate' | 'plateTrailer' | 'sts' | 'color' | 'vin' | 'text'

export interface PortFieldRule {
  kind: PortFieldKind
  label: string
  /** человекочитаемое правило для тостов и подсветок */
  hint: string
}

export const PORT_FIELD_RULES: Record<PortFieldKind, PortFieldRule> = {
  plate: { kind: 'plate', label: 'Госномер тягача', hint: 'формат А123ВС777 — буква, 3 цифры, 2 буквы, регион' },
  plateTrailer: { kind: 'plateTrailer', label: 'Госномер прицепа', hint: 'формат АВ1234 23 — 2 буквы, 4 цифры, регион' },
  sts: { kind: 'sts', label: 'Номер СТС', hint: 'ровно 10 цифр' },
  color: { kind: 'color', label: 'Цвет', hint: 'только буквы, без цифр и символов' },
  vin: { kind: 'vin', label: 'VIN', hint: '17 знаков: латинские буквы без I, O, Q и цифры' },
  text: { kind: 'text', label: 'Текстовое поле', hint: 'без служебных символов (/ \\ ; % # и т.п.)' },
}

const GARBAGE_RE = /[/\\;<>%#@$^*_=|~§°€£¥]/
const COLOR_RE = /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\s-]*$/
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
/** Кириллические двойники → латиница (для VIN) */
const CYR2LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
}
/** тягач: А123ВС777; прицеп: АВ1234 23 (регион 2–3 цифры) */
const PLATE_TRUCK_RE = new RegExp(`^[${PLATE_LETTERS}]\\d{3}[${PLATE_LETTERS}]{2}\\d{2,3}$`)
const PLATE_TRAILER_RE = new RegExp(`^[${PLATE_LETTERS}]{2}\\d{4}\\d{2,3}$`)

/** Универсальная чистка текста: схлопнуть пробелы, обрезать краевые разделители */
export function cleanText(v: string): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

/** Приводит буквы госномера из латинских двойников к кириллице и убирает разделители */
function toCyrillicPlateLetters(v: string): string {
  return v
    .toUpperCase()
    .replace(/[ABEKMHOPCTYX]/g, (ch) => LAT2CYR[ch] ?? ch)
    .replace(/[^0-9А-ЯЁ]/g, '')
}

/**
 * Нормализация значения по типу поля. Возвращает аккуратную строку (без гарантии,
 * что она пройдёт валидацию — за этим validatePortField).
 */
export function normalizePortField(kind: PortFieldKind, value: string): string {
  const raw = cleanText(value)
  if (raw === '') return ''
  switch (kind) {
    case 'plate':
    case 'plateTrailer':
      return toCyrillicPlateLetters(raw)
    case 'sts':
      return raw.replace(/\D/g, '')
    case 'color':
      return raw.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim()
    case 'vin':
      // в VIN нет букв I, O, Q — нейросеть путает их с 1 и 0
      return raw.toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, (ch) => CYR2LAT[ch] ?? ch)
        .replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IQ]/g, (ch) => (ch === 'I' ? '1' : '0'))
    case 'text':
      return raw
  }
}

export interface PortFieldCheck {
  ok: boolean
  /** нормализованное значение (для подстановки в поле) */
  value: string
  /** причина отказа — показывается пользователю */
  message?: string
}

/** Валидация одного поля «Авто в порт»: нормализует и проверяет формат */
export function validatePortField(kind: PortFieldKind, value: string): PortFieldCheck {
  const norm = normalizePortField(kind, value)
  if (norm === '') return { ok: false, value: norm, message: 'поле пустое' }
  switch (kind) {
    case 'plate': {
      if (!PLATE_TRUCK_RE.test(norm)) {
        return { ok: false, value: norm, message: `«${norm}» — нужен формат А123ВС777` }
      }
      return { ok: true, value: norm }
    }
    case 'plateTrailer': {
      if (!PLATE_TRAILER_RE.test(norm)) {
        return { ok: false, value: norm, message: `«${norm}» — нужен формат АВ1234 23` }
      }
      return { ok: true, value: norm }
    }
    case 'sts': {
      if (norm.length !== 10) {
        return { ok: false, value: norm, message: `«${norm || '—'}» — нужно ровно 10 цифр (сейчас ${norm.length})` }
      }
      return { ok: true, value: norm }
    }
    case 'color': {
      if (!COLOR_RE.test(norm)) {
        return { ok: false, value: norm, message: `«${norm}» — цвет пишется буквами` }
      }
      return { ok: true, value: norm }
    }
    case 'vin': {
      if (!VIN_RE.test(norm)) {
        return { ok: false, value: norm, message: `«${norm}» — нужно 17 знаков: латинские буквы и цифры` }
      }
      return { ok: true, value: norm }
    }
    case 'text': {
      if (GARBAGE_RE.test(norm)) {
        return { ok: false, value: norm, message: `«${norm}» — похоже на мусор, проверьте поле` }
      }
      return { ok: true, value: norm }
    }
  }
}

/** Короткая проверка «похоже ли на транспортную букву» — для UI-подсказок */
export const isPlateLetter = (ch: string): boolean => PLATE_LETTERS_RE.test(ch)

/** Валидация черновика техники/водителя: возвращает нормализованные поля и список проблем.
 *  keys — какие поля каким правилом проверять (только переданные ключи). */
export function validateVehicleDraft(
  draft: Record<string, string>,
  kinds: Record<string, PortFieldKind>,
): { values: Record<string, string>; issues: { field: string; message: string }[] } {
  const values: Record<string, string> = { ...draft }
  const issues: { field: string; message: string }[] = []
  for (const key of Object.keys(kinds)) {
    const kind = kinds[key]
    const res = validatePortField(kind, values[key] ?? '')
    values[key] = res.value
    if (!res.ok && res.message) issues.push({ field: key, message: `${PORT_FIELD_RULES[kind].label}: ${res.message}` })
  }
  return { values, issues }
}

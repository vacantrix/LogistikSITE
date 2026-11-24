// Инструменты нейросети: разбор блоков ```ai-contact, ```ai-best, ```ai-card,
// ```ai-report и ```ai-links из её ответов.
//
// Модель ничего не вызывает напрямую — у неё нет доступа к файлам, коду и базе.
// Единственный способ «записать» или «создать» что-то: оформить данные блоком
// в ответе, а сервер проверит их по белым спискам (поля, типы, длины,
// перечисления, количество) и только потом сохранит/покажет. Всё, что не
// прошло проверку, молча отбрасывается — сломать сайт или базу через эти блоки
// невозможно: значения обрезаются, типы клампятся, сторонние поля игнорируются.
//
// Блоки отображения (ai-card / ai-report / ai-links) — виджеты «для удобства
// человека»: карточки, отчёты и ссылки на разделы платформы прямо в чате.
// Разбор устойчив к «человеческому» поведению модели: внутри блока после JSON
// может идти пояснительный текст, карточка может быть одна (без массива),
// вокруг JSON может быть вводная фраза. Блоки удаляются из показываемого
// текста всегда — человек видит только очищенный ответ и виджеты.

import { aiNavLink } from './nav-catalog'

export type AiContactKind = 'carrier' | 'shipper' | 'driver' | 'other'
export type AiRecordFormat = 'card' | 'list' | 'table' | 'text'

export interface AiContactCard {
  name: string
  company: string
  kind: AiContactKind
  phone: string
  email: string
  atiFirmId: string
  atiRef: string
  rating: number
  notes: string
  format: AiRecordFormat
}

export interface AiBestOffer {
  rank: number
  title: string
  route: string
  rate: string
  /** дата/срок варианта («27.11», «с 1 декабря») */
  date: string
  /** фирма или имя по варианту */
  company: string
  /** кто отвечает и телефон — только если сообщил человек (телефоны модель не знает) */
  contact: string
  note: string
}

/** Тип карточки-виджета (ai-card): для иконки и акцентов в интерфейсе */
export type AiCardKind = 'profile' | 'vehicle' | 'route' | 'market' | 'analysis' | 'notice' | 'checklist'

export interface AiCardField {
  label: string
  value: string
}

/** Карточка фактов (ai-card): профиль перевозчика, характеристики машины, памятка, сравнение */
export interface AiCard {
  kind: string
  title: string
  /** короткие метки-фильтры («тент», «20 т») */
  badges: string[]
  /** пары «параметр — значение» */
  fields: AiCardField[]
  note: string
}

export interface AiReportKpi {
  label: string
  value: string
  note: string
}

export interface AiReportTable {
  columns: string[]
  rows: string[][]
}

export interface AiReportSection {
  heading: string
  /** текстовые абзацы раздела */
  paragraphs: string[]
  /** таблица раздела (у одного раздела не больше одной) */
  table: AiReportTable | null
}

/** Отчёт (ai-report): красивый отчёт в чате с показателями, разделами и таблицами; скачивается Word'ом */
export interface AiReport {
  title: string
  period: string
  summary: string
  kpis: AiReportKpi[]
  sections: AiReportSection[]
}

/** Ссылка на раздел платформы (ai-links): кнопка-переход в чате; ключ проверяется по каталогу */
export interface AiLinkRef {
  tab: string
  label: string
}

export interface AiToolParseResult {
  /** Ответ модели без служебных блоков — то, что показывается человеку */
  cleaned: string
  contacts: AiContactCard[]
  best: AiBestOffer[]
  /** карточки-виджеты (ai-card) */
  cards: AiCard[]
  /** отчёт (ai-report) — не больше одного на ответ */
  report: AiReport | null
  /** ссылки на разделы платформы (ai-links) */
  links: AiLinkRef[]
}

const CONTACT_BLOCK = /```ai-contact[^\n]*\n?([\s\S]*?)```/g
const BEST_BLOCK = /```ai-best[^\n]*\n?([\s\S]*?)```/g
const CARD_BLOCK = /```ai-card[^\n]*\n?([\s\S]*?)```/g
const REPORT_BLOCK = /```ai-report[^\n]*\n?([\s\S]*?)```/g
const LINKS_BLOCK = /```ai-links[^\n]*\n?([\s\S]*?)```/g

const MAX_CONTACTS = 10
const MAX_BEST = 8
const MAX_CARDS = 6
const MAX_LINKS = 5
const MAX_CARD_FIELDS = 12
const MAX_CARD_BADGES = 6
const MAX_KPI = 6
const MAX_SECTIONS = 8
const MAX_PARAGRAPHS = 6
const MAX_TABLE_COLUMNS = 10
const MAX_TABLE_ROWS = 30

const clampStr = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.slice(0, max)
}

const clampRating = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(5, Math.round(n)))
}

/** JSON целиком; одиночный объект тоже принимаем как массив из одного */
function tryParseArray(raw: string): unknown[] | null {
  const t = raw.trim()
  if (!t.startsWith('[') && !t.startsWith('{')) return null
  try {
    const v: unknown = JSON.parse(t)
    if (Array.isArray(v)) return v
    if (v !== null && typeof v === 'object') return [v]
    return null
  } catch {
    return null
  }
}

/**
 * Достать массив(ы) JSON из «грязного» содержимого блока: модель может
 * дописать текст после JSON, обернуть карточку без массива или добавить
 * вводную фразу. Пробуем: целиком → первая '[' .. последняя ']' →
 * первая '[' .. первый ']' → то же для одиночного объекта '{'.
 */
function arraysFromBlock(raw: string): unknown[][] {
  const whole = tryParseArray(raw)
  if (whole) return [whole]
  const firstArr = raw.indexOf('[')
  if (firstArr !== -1) {
    const lastClose = raw.lastIndexOf(']')
    if (lastClose > firstArr) {
      const a = tryParseArray(raw.slice(firstArr, lastClose + 1))
      if (a) return [a]
    }
    const firstClose = raw.indexOf(']', firstArr)
    if (firstClose !== -1) {
      const a = tryParseArray(raw.slice(firstArr, firstClose + 1))
      if (a) return [a]
    }
  }
  const firstObj = raw.indexOf('{')
  if (firstObj !== -1) {
    const lastObjClose = raw.lastIndexOf('}')
    if (lastObjClose > firstObj) {
      const a = tryParseArray(raw.slice(firstObj, lastObjClose + 1))
      if (a) return [a]
    }
  }
  return []
}

/** Карточка перевозчика/контакта из блока модели — с жёсткой валидацией полей */
function toContactCard(v: unknown): AiContactCard | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = clampStr(o.name, 200)
  if (!name) return null
  const kindRaw = clampStr(o.kind ?? o.type, 20)
  const kind: AiContactKind =
    kindRaw === 'shipper' || kindRaw === 'driver' || kindRaw === 'other' ? kindRaw : 'carrier'
  const formatRaw = clampStr(o.format ?? o.recordFormat, 10)
  const format: AiRecordFormat =
    formatRaw === 'list' || formatRaw === 'table' || formatRaw === 'text' ? formatRaw : 'card'
  // ID фирмы ATI.SU — только цифры (до 12), иначе пусто: ссылку платформа соберёт сама
  const atiFirmIdRaw = clampStr(o.atiFirmId ?? o.firmId, 12)
  const atiFirmId = /^\d{1,12}$/.test(atiFirmIdRaw) ? atiFirmIdRaw : ''
  return {
    name,
    company: clampStr(o.company, 200),
    kind,
    phone: clampStr(o.phone, 40),
    email: clampStr(o.email, 120),
    atiFirmId,
    atiRef: clampStr(o.atiRef ?? o.ref, 100),
    rating: clampRating(o.rating),
    notes: clampStr(o.notes ?? o.note, 2000),
    format,
  }
}

/** Лучшее предложение подбора из блока модели */
function toBestOffer(v: unknown): AiBestOffer | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const title = clampStr(o.title ?? o.name, 200)
  const rankRaw = typeof o.rank === 'number' ? o.rank : Number(o.rank)
  const rank = Number.isFinite(rankRaw) ? Math.max(1, Math.min(99, Math.round(rankRaw))) : 1
  if (!title) return null
  return {
    rank,
    title,
    route: clampStr(o.route ?? o.road, 120),
    rate: clampStr(o.rate ?? o.price, 80),
    date: clampStr(o.date ?? o.term ?? o.when, 60),
    company: clampStr(o.company ?? o.firm, 160),
    contact: clampStr(o.contact ?? o.person, 160),
    note: clampStr(o.note ?? o.why ?? o.reason, 400),
  }
}

const CARD_KINDS: AiCardKind[] = ['profile', 'vehicle', 'route', 'market', 'analysis', 'notice', 'checklist']

/** Карточка фактов (ai-card) — с жёсткой валидацией полей */
function toCard(v: unknown): AiCard | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const title = clampStr(o.title ?? o.name, 160)
  if (!title) return null
  const kindRaw = clampStr(o.kind ?? o.type, 20)
  const kind = (CARD_KINDS as string[]).includes(kindRaw) ? kindRaw : 'analysis'
  const fields: AiCardField[] = []
  const rawFields = Array.isArray(o.fields) ? o.fields : []
  for (const f of rawFields) {
    if (fields.length >= MAX_CARD_FIELDS) break
    if (!f || typeof f !== 'object') continue
    const fo = f as Record<string, unknown>
    const label = clampStr(fo.label ?? fo.name ?? fo.key, 60)
    const value = clampStr(fo.value, 160)
    if (label || value) fields.push({ label, value })
  }
  const badges = (Array.isArray(o.badges) ? o.badges : [])
    .map((b) => clampStr(b, 24))
    .filter(Boolean)
    .slice(0, MAX_CARD_BADGES)
  return {
    kind,
    title,
    badges,
    fields,
    note: clampStr(o.note ?? o.summary, 600),
  }
}

/** Показатель отчёта (KPI) */
function toKpi(v: unknown): AiReportKpi | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const label = clampStr(o.label ?? o.name, 60)
  const value = clampStr(o.value, 80)
  if (!label || !value) return null
  return { label, value, note: clampStr(o.note, 120) }
}

/** Таблица раздела отчёта: колонки фиксированы, строки — массивы строк */
function toReportTable(v: unknown): AiReportTable | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const columns = (Array.isArray(o.columns) ? o.columns : []).map((c) => clampStr(c, 60)).filter(Boolean).slice(0, MAX_TABLE_COLUMNS)
  if (columns.length < 2) return null
  const rows: string[][] = []
  for (const r of Array.isArray(o.rows) ? o.rows : []) {
    if (rows.length >= MAX_TABLE_ROWS) break
    if (!Array.isArray(r)) continue
    rows.push(r.map((c) => clampStr(c, 100)).slice(0, columns.length))
  }
  return { columns, rows }
}

function toReportSection(v: unknown): AiReportSection | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const heading = clampStr(o.heading ?? o.title, 120)
  if (!heading) return null
  const paragraphs = (Array.isArray(o.paragraphs) ? o.paragraphs : [])
    .map((p) => clampStr(p, 500))
    .filter(Boolean)
    .slice(0, MAX_PARAGRAPHS)
  const table = toReportTable(o.table)
  if (paragraphs.length === 0 && !table) return null
  return { heading, paragraphs, table }
}

/** Отчёт (ai-report) — из блока модели; экспортирован для роута скачивания Word */
export function toAiReport(v: unknown): AiReport | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const title = clampStr(o.title ?? o.name, 140)
  if (!title) return null
  const kpis = (Array.isArray(o.kpis) ? o.kpis : []).map(toKpi).filter((v): v is AiReportKpi => v !== null).slice(0, MAX_KPI)
  const sections = (Array.isArray(o.sections) ? o.sections : []).map(toReportSection).filter((v): v is AiReportSection => v !== null).slice(0, MAX_SECTIONS)
  if (kpis.length === 0 && sections.length === 0) return null
  return {
    title,
    period: clampStr(o.period, 60),
    summary: clampStr(o.summary ?? o.conclusion, 800),
    kpis,
    sections,
  }
}

/** Ссылка на раздел платформы (ai-links): ключ проверяется по каталогу, ярлык подставляется при пустом */
function toLinkRef(v: unknown): AiLinkRef | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const tab = clampStr(o.tab ?? o.section ?? o.key, 30)
  const meta = aiNavLink(tab)
  if (!meta) return null // раздела с таким ключом на платформе нет — ссылка отбрасывается
  const label = clampStr(o.label ?? o.text, 90) || meta.label
  return { tab, label }
}

/** Похоже ли на карточку фактов (для встроенных в текст массивов) */
function looksLikeCard(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.title === 'string' && o.title.trim().length > 0 && (Array.isArray(o.fields) || Array.isArray(o.badges) || typeof o.note === 'string')
}

/** Похоже ли на ссылку на раздел (для встроенных в текст массивов) */
function looksLikeLink(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.tab === 'string' && aiNavLink(o.tab.trim()) !== undefined
}

/** Похоже ли на карточку перевозщика (для встроенных в текст массивов) */
function looksLikeContact(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const hasName = typeof o.name === 'string' && o.name.trim().length > 0
  const hasMore = ['phone', 'company', 'kind', 'atiFirmId', 'atiRef', 'notes', 'rating', 'format'].some(
    (k) => o[k] !== undefined && o[k] !== null && o[k] !== '',
  )
  return hasName && hasMore
}

/** Похоже ли на лучшее предложение подбора (для встроенных в текст массивов) */
function looksLikeBest(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.title === 'string' && o.title.trim().length > 0 && (o.rank !== undefined || o.rate !== undefined || o.route !== undefined)
}

/** Все сбалансированные верхнеуровневые [ ... ] сегменты в тексте (вне строк JSON) */
function allBalancedArrays(text: string): Array<{ start: number; end: number; items: unknown[] }> {
  const out: Array<{ start: number; end: number; items: unknown[] }> = []
  const stack: number[] = []
  let inString = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '[') stack.push(i)
    else if (ch === ']' && stack.length > 0) {
      const start = stack.pop()
      if (start !== undefined && stack.length === 0) {
        const seg = text.slice(start, i + 1)
        const items = tryParseArray(seg)
        if (items && items.length > 0) out.push({ start, end: i + 1, items })
      }
    }
  }
  return out
}

/**
 * Разбор ответа модели: вынуть блоки инструментов (карточки перевозчиков,
 * лучшие предложения, карточки фактов, отчёт, ссылки на разделы), вычистить
 * их из текста, который показывается человеку.
 * Блоки удаляются всегда — служебный JSON человеку не показывается.
 * Fallback: если модель положила JSON прямо в текст (без ограждения ```),
 * распознаём встроенные массивы по форме карточек/предложений/ссылок и вырезаем их.
 */
export function extractAiTools(answer: string): AiToolParseResult {
  const contacts: AiContactCard[] = []
  const best: AiBestOffer[] = []
  const cards: AiCard[] = []
  const links: AiLinkRef[] = []
  let report: AiReport | null = null
  const spans: Array<[number, number]> = []

  for (const m of answer.matchAll(CONTACT_BLOCK)) {
    const start = m.index ?? 0
    spans.push([start, start + m[0].length])
    for (const arr of arraysFromBlock(m[1])) {
      for (const v of arr) {
        const card = toContactCard(v)
        if (card && contacts.length < MAX_CONTACTS) contacts.push(card)
      }
    }
  }
  for (const m of answer.matchAll(BEST_BLOCK)) {
    const start = m.index ?? 0
    spans.push([start, start + m[0].length])
    for (const arr of arraysFromBlock(m[1])) {
      for (const v of arr) {
        const offer = toBestOffer(v)
        if (offer && best.length < MAX_BEST) best.push(offer)
      }
    }
  }
  for (const m of answer.matchAll(CARD_BLOCK)) {
    const start = m.index ?? 0
    spans.push([start, start + m[0].length])
    for (const arr of arraysFromBlock(m[1])) {
      for (const v of arr) {
        const card = toCard(v)
        if (card && cards.length < MAX_CARDS) cards.push(card)
      }
    }
  }
  for (const m of answer.matchAll(REPORT_BLOCK)) {
    const start = m.index ?? 0
    spans.push([start, start + m[0].length])
    for (const arr of arraysFromBlock(m[1])) {
      for (const v of arr) {
        if (!report) report = toAiReport(v)
      }
    }
  }
  for (const m of answer.matchAll(LINKS_BLOCK)) {
    const start = m.index ?? 0
    spans.push([start, start + m[0].length])
    for (const arr of arraysFromBlock(m[1])) {
      for (const v of arr) {
        const link = toLinkRef(v)
        if (link && links.length < MAX_LINKS) links.push(link)
      }
    }
  }

  // встроенные в текст массивы (модель иногда не оформляет ограждение ```)
  for (const seg of allBalancedArrays(answer)) {
    if (spans.some(([s, e]) => seg.start >= s && seg.start < e)) continue
    let used = false
    for (const v of seg.items) {
      if (looksLikeContact(v)) {
        const card = toContactCard(v)
        if (card && contacts.length < MAX_CONTACTS) {
          contacts.push(card)
          used = true
        }
      } else if (looksLikeBest(v)) {
        const offer = toBestOffer(v)
        if (offer && best.length < MAX_BEST) {
          best.push(offer)
          used = true
        }
      } else if (looksLikeLink(v)) {
        const link = toLinkRef(v)
        if (link && links.length < MAX_LINKS) {
          links.push(link)
          used = true
        }
      } else if (looksLikeCard(v)) {
        const card = toCard(v)
        if (card && cards.length < MAX_CARDS) {
          cards.push(card)
          used = true
        }
      }
    }
    if (used) spans.push([seg.start, seg.end])
  }

  let cleaned = answer
  if (spans.length > 0) {
    // вырезаем блоки от конца к началу, чтобы индексы не поехали
    spans.sort((a, b) => b[0] - a[0])
    for (const [s, e] of spans) cleaned = cleaned.slice(0, s) + cleaned.slice(e)
    cleaned = cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  return { cleaned, contacts, best, cards, report, links }
}

/** Разбор bestJson, сохранённого в списке ИИ (для показа в интерфейсе) */
export function parseBestJson(raw: string | null | undefined): AiBestOffer[] {
  if (!raw) return []
  const out: AiBestOffer[] = []
  for (const arr of arraysFromBlock(raw)) {
    for (const v of arr) {
      const offer = toBestOffer(v)
      if (offer && out.length < MAX_BEST) out.push(offer)
    }
  }
  return out
}

/** Разбор cardsJson, сохранённого в списке ИИ */
export function parseCardsJson(raw: string | null | undefined): AiCard[] {
  if (!raw) return []
  const out: AiCard[] = []
  for (const arr of arraysFromBlock(raw)) {
    for (const v of arr) {
      const card = toCard(v)
      if (card && out.length < MAX_CARDS) out.push(card)
    }
  }
  return out
}

/** Разбор linksJson, сохранённого в списке ИИ */
export function parseLinksJson(raw: string | null | undefined): AiLinkRef[] {
  if (!raw) return []
  const out: AiLinkRef[] = []
  for (const arr of arraysFromBlock(raw)) {
    for (const v of arr) {
      const link = toLinkRef(v)
      if (link && out.length < MAX_LINKS) out.push(link)
    }
  }
  return out
}

/** Разбор reportJson, сохранённого в списке ИИ (отчёт — один объект, не массив) */
export function parseReportJson(raw: string | null | undefined): AiReport | null {
  if (!raw) return null
  for (const arr of arraysFromBlock(raw)) {
    for (const v of arr) {
      const report = toAiReport(v)
      if (report) return report
    }
  }
  return null
}

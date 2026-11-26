/**
 * Нейросеть: настройки пропуска документов + параметры движка PaddleOCR
 * (конструктор администратора в разделе «Управление → PaddleOCR»).
 *
 * Фото и файлы хранятся на серверах АЭМЗ, распознавание работает на серверах АЭМЗ —
 * сейчас показательно на отдельном GPU-ПК (временный стенд). Значения хранятся в таблице Setting
 * (prisma/schema.prisma) и читаются общей очередью распознавания
 * (src/lib/ocr-service.ts) перед каждым документом — кэш на 5 секунд,
 * поэтому сохранённые значения применяются сразу, без перезапуска.
 *
 * Что реально меняют настройки:
 *   nnParallel   — «максимум фото в обработке»: сколько фото машина нейросети берёт в работу
 *                  одновременно (подбирается под объём VRAM); остальные фото
 *                  автоматически ждут в общей очереди — независимо от того,
 *                  сколько перевозчиков загружают одновременно;
 *   nnTimeoutSec — сколько ждать распознавание одного документа, прежде чем вернуть «сервис недоступен»;
 *   nnCacheMin   — повторный тот же скан (по хэшу содержимого) отдаётся из кэша мгновенно;
 *   nnMaxSide    — платформа уменьшает длинную сторону фото (sharp) перед отправкой
 *                  в нейросеть — меньше мегабайт и пикселей → быстрее распознавание.
 *
 * Параметры движка (конструктор — «как нейросеть работает, на что и как смотрит»):
 *   nnDetConf    — порог уверенности детекции текста: ниже — фрагмент не считается текстом;
 *   nnRecConf    — порог уверенности чтения поля: ниже — значение уходит «на проверку» человеку;
 *   nnAutoRotate — авто-поворот/выравнивание документа перед распознаванием;
 *   nnLang       — язык модели чтения (ru | en | ch) — выбирает recognition-модель;
 *   nnModelSet   — набор моделей детекции: server (точность) | mobile (скорость).
 */
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'

export interface NnSettings {
  /** 1–8: «максимум фото в обработке» — сколько фото машина нейросети берёт одновременно, остальные ждут в очереди */
  parallel: number
  /** 30–300 сек: таймаут одного документа */
  timeoutSec: number
  /** 0 = выкл, 5–1440 мин: кэш повторных сканов */
  cacheMin: number
  /** 0 = как есть, 1200–3000 px: длинная сторона фото после сжатия */
  maxSide: number
  /** 0.2–0.9: порог уверенности детекции текста — ниже фрагмент не считается текстом */
  detConf: number
  /** 0.3–0.99: порог уверенности чтения поля — ниже значение уходит «на проверку» человеку */
  recConf: number
  /** авто-поворот/выравнивание документа перед распознаванием */
  autoRotate: boolean
  /** язык модели чтения: ru | en | ch — выбирает recognition-модель движка */
  lang: string
  /** набор моделей детекции: server (точность) | mobile (скорость) */
  modelSet: string
}

export const DEFAULT_NN: NnSettings = {
  parallel: 2, timeoutSec: 180, cacheMin: 30, maxSide: 0,
  detConf: 0.3, recConf: 0.75, autoRotate: true, lang: 'ru', modelSet: 'server',
}

/** Лимит фото на разовую загрузку комплекта документов перевозчиком (далее — общая очередь) */
export const MAX_PHOTOS_PER_SUBMIT = 20

const clampInt = (v: number, min: number, max: number) => Math.min(Math.max(Math.round(v), min), max)
const clampF = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/** Границы настроек — общие для API и интерфейса */
export const NN_LIMITS = {
  parallel: { min: 1, max: 8 },
  timeoutSec: { min: 30, max: 300 },
  cacheMin: { min: 0, max: 1440 },
  maxSide: { min: 1200, max: 3000 },
  detConf: { min: 0.2, max: 0.9 },
  recConf: { min: 0.3, max: 0.99 },
  lang: ['ru', 'en', 'ch'],
  modelSet: ['server', 'mobile'],
} as const

const NN_LANGS = ['ru', 'en', 'ch'] as const
const NN_MODEL_SETS = ['server', 'mobile'] as const

/** Привести произвольные значения к допустимым границам */
export function sanitizeNn(raw: Partial<Record<keyof NnSettings, unknown>>, current: NnSettings): NnSettings {
  const num = (v: unknown): number | null => {
    const n = Number(v)
    return v == null || v === '' || !Number.isFinite(n) ? null : n
  }
  const p = num(raw.parallel)
  const t = num(raw.timeoutSec)
  const c = num(raw.cacheMin)
  const m = num(raw.maxSide)
  const d = num(raw.detConf)
  const r = num(raw.recConf)
  const rot = typeof raw.autoRotate === 'boolean' ? raw.autoRotate : null
  const lang = typeof raw.lang === 'string' && (NN_LANGS as readonly string[]).includes(raw.lang) ? raw.lang : null
  const set = typeof raw.modelSet === 'string' && (NN_MODEL_SETS as readonly string[]).includes(raw.modelSet) ? raw.modelSet : null
  return {
    parallel: p != null ? clampInt(p, NN_LIMITS.parallel.min, NN_LIMITS.parallel.max) : current.parallel,
    timeoutSec: t != null ? clampInt(t, NN_LIMITS.timeoutSec.min, NN_LIMITS.timeoutSec.max) : current.timeoutSec,
    cacheMin: c != null ? clampInt(c, NN_LIMITS.cacheMin.min, NN_LIMITS.cacheMin.max) : current.cacheMin,
    maxSide: m != null ? (m <= 0 ? 0 : clampInt(m, NN_LIMITS.maxSide.min, NN_LIMITS.maxSide.max)) : current.maxSide,
    detConf: d != null ? clampF(d, NN_LIMITS.detConf.min, NN_LIMITS.detConf.max) : current.detConf,
    recConf: r != null ? clampF(r, NN_LIMITS.recConf.min, NN_LIMITS.recConf.max) : current.recConf,
    autoRotate: rot != null ? rot : current.autoRotate,
    lang: lang ?? current.lang,
    modelSet: set ?? current.modelSet,
  }
}

type NnRow = {
  nnParallel: number
  nnTimeoutSec: number
  nnCacheMin: number
  nnMaxSide: number
  nnDetConf: number | null
  nnRecConf: number | null
  nnAutoRotate: boolean | null
  nnLang: string | null
  nnModelSet: string | null
} | null

export const rowToNn = (row: NnRow): NnSettings => ({
  parallel: row?.nnParallel ?? DEFAULT_NN.parallel,
  timeoutSec: row?.nnTimeoutSec ?? DEFAULT_NN.timeoutSec,
  cacheMin: row?.nnCacheMin ?? DEFAULT_NN.cacheMin,
  maxSide: row?.nnMaxSide ?? DEFAULT_NN.maxSide,
  detConf: row?.nnDetConf ?? DEFAULT_NN.detConf,
  recConf: row?.nnRecConf ?? DEFAULT_NN.recConf,
  autoRotate: row?.nnAutoRotate ?? DEFAULT_NN.autoRotate,
  lang: row?.nnLang ?? DEFAULT_NN.lang,
  modelSet: row?.nnModelSet ?? DEFAULT_NN.modelSet,
})

// --- чтение с коротким кэшем: очередь обращается часто, БД не должна упираться в лимиты SQLite ---

let cache: { at: number; value: NnSettings } | null = null
const CACHE_MS = 5_000

/** Действующие настройки нейросети (кэш 5 секунд) */
export async function nnSettings(): Promise<NnSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const row = await db.setting.findUnique({
    where: { id: 'main' },
    select: {
      nnParallel: true, nnTimeoutSec: true, nnCacheMin: true, nnMaxSide: true,
      nnDetConf: true, nnRecConf: true, nnAutoRotate: true, nnLang: true, nnModelSet: true,
    },
  })
  const value = rowToNn(row)
  cache = { at: Date.now(), value }
  return value
}

/** Сбросить кэш настроек — вызывается после сохранения в админке */
export function invalidateNnSettings(): void {
  cache = null
}

/** Хэш содержимого для кэша повторных сканов (тип документа входит в ключ) */
export function scanKey(dataUri: string, type: string): string {
  return createHash('sha256').update(type).update('|').update(dataUri).digest('hex')
}

// --- сжатие изображения перед отправкой в нейросеть (sharp уже в зависимостях платформы) ---

let sharpMod: typeof import('sharp') | null | undefined

/** Ленивый импорт sharp: если модуль недоступен — работаем без сжатия (fallback) */
async function getSharp(): Promise<typeof import('sharp') | null> {
  if (sharpMod !== undefined) return sharpMod
  try {
    sharpMod = (await import('sharp')).default
  } catch {
    sharpMod = null
  }
  return sharpMod
}

const IMG_RE = /^data:image\/(jpeg|jpg|png|webp);base64,/i

/**
 * Уменьшить длинную сторону изображения до maxSide px (без увеличения, JPEG q85).
 * Не изображение (PDF) или сбой sharp → исходный dataUri без изменений.
 */
export async function shrinkImage(dataUri: string, maxSide: number): Promise<string> {
  if (!maxSide || maxSide <= 0 || !IMG_RE.test(dataUri)) return dataUri
  const sharp = await getSharp()
  if (!sharp) return dataUri
  try {
    const base64 = dataUri.slice(dataUri.indexOf(',') + 1)
    const input = Buffer.from(base64, 'base64')
    const out = await sharp(input)
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer()
    return `data:image/jpeg;base64,${out.toString('base64')}`
  } catch {
    return dataUri
  }
}

/** Пороги проверки документов: чтение из базы с безопасными значениями по умолчанию */
import { db } from '@/lib/db'
import type { SettingsDTO } from '@/lib/types'
import type { VerifySettings } from '@/lib/verify'

export const DEFAULT_SETTINGS = { confReupload: 0.6, confReject: 0.6, confAuto: 0.95, minQuality: 60 }

type SettingRow = { confReupload: number; confReject: number; confAuto: number; minQuality: number; rules: string } | null

export function toSettingsDTO(row: SettingRow): SettingsDTO {
  let rules: Record<string, string> = {}
  try { rules = row ? JSON.parse(row.rules) : {} } catch { rules = {} }
  return {
    confReupload: row?.confReupload ?? DEFAULT_SETTINGS.confReupload,
    confReject: row?.confReject ?? DEFAULT_SETTINGS.confReject,
    confAuto: row?.confAuto ?? DEFAULT_SETTINGS.confAuto,
    minQuality: row?.minQuality ?? DEFAULT_SETTINGS.minQuality,
    rules,
  }
}

export async function loadVerifySettings(): Promise<VerifySettings> {
  const s = toSettingsDTO(await db.setting.findUnique({ where: { id: 'main' } }))
  return { confReupload: s.confReupload, confReject: s.confReject, confAuto: s.confAuto, minQuality: s.minQuality }
}

/** Демо-образцы (SVG-заглушки) распознаются имитацией только при явном DEMO_SAMPLES=1 — на рабочем стенде выключено */
export const demoSamplesEnabled = (): boolean => process.env.DEMO_SAMPLES === '1'

const PDF_PREFIX = 'data:application/pdf;base64,'

/** dataUri — PDF-файл (проверяем и тип, и сигнатуру «%PDF-» в начале содержимого) */
export const isPdfDataUri = (dataUri: string): boolean =>
  dataUri.startsWith(PDF_PREFIX) && dataUri.slice(PDF_PREFIX.length, PDF_PREFIX.length + 7) === 'JVBERi0'

/**
 * Допустимые файлы документов: фото с телефона/сканера; SVG — только демо-образцы;
 * PDF (opts.pdf) — сканы и доверенности, распознаётся первая страница.
 */
export function imageDataUriError(dataUri: unknown, opts: { pdf?: boolean; maxLen?: number } = {}): string | null {
  const { pdf = false, maxLen = 12_000_000 } = opts
  if (typeof dataUri !== 'string' || !dataUri) return 'Нужно изображение документа'
  if (dataUri.length > maxLen) return 'Файл слишком большой (до ~8 МБ)'
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(dataUri)) return null
  if (pdf && isPdfDataUri(dataUri)) return null
  if (/^data:image\/svg\+xml[;,]/i.test(dataUri)) {
    return demoSamplesEnabled() ? null : 'Нужна фотография документа (JPG, PNG или WebP) — демо-образцы на этом стенде отключены'
  }
  return pdf ? 'Поддерживаются фото JPG, PNG, WebP или PDF' : 'Поддерживаются фото JPG, PNG или WebP'
}

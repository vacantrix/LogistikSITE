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

/** Облачная VLM как резерв распознавания — только при явном OCR_CLOUD_FALLBACK=1 (паспорта уходят во внешний сервис) */
export const cloudOcrEnabled = (): boolean => process.env.OCR_CLOUD_FALLBACK === '1'

/** Допустимые изображения документов: фото с телефона/сканера; SVG — только демо-образцы */
export function imageDataUriError(dataUri: unknown, maxLen = 12_000_000): string | null {
  if (typeof dataUri !== 'string' || !dataUri) return 'Нужно изображение документа'
  if (dataUri.length > maxLen) return 'Файл слишком большой (до ~8 МБ)'
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(dataUri)) return null
  if (/^data:image\/svg\+xml[;,]/i.test(dataUri)) {
    return demoSamplesEnabled() ? null : 'Нужна фотография документа (JPG, PNG или WebP) — демо-образцы на этом стенде отключены'
  }
  return 'Поддерживаются фото JPG, PNG или WebP'
}

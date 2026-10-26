/**
 * Быстрая проверка качества фото документа в браузере — до нейросети, сразу после загрузки.
 * Пороги подобраны на реальных сканах и фото с телефона (тест Z.ai, 34 документа):
 *   размер — меньшая сторона от 700 px (меньше нейросеть не читает подписи бланка);
 *   резкость — дисперсия лапласиана на кадре до 1000 px от 50 (чёткие фото 370–3100, размытые 3–20);
 *   яркость — средняя от 70 (тёмные фото с бликом нейросеть не узнаёт).
 * Пересвет по доле белого не проверяется: белый лист А4 у скана даёт те же 80 % белого.
 */

export interface PhotoQuality {
  width: number
  height: number
  /** что не так с фото — пусто, если всё в порядке */
  issues: string[]
}

const MIN_SIDE = 700
const MIN_SHARPNESS = 50
const MIN_BRIGHTNESS = 70

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

/** Оценка фото; null — не картинка (PDF) или браузер не смог её разобрать */
export async function assessPhoto(dataUri: string): Promise<PhotoQuality | null> {
  if (!dataUri.startsWith('data:image/') || dataUri.startsWith('data:image/svg')) return null
  const img = await loadImage(dataUri)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const k = Math.min(1, 1000 / Math.max(w, h, 1))
  const cw = Math.max(3, Math.round(w * k))
  const ch = Math.max(3, Math.round(h * k))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, cw, ch)
  const { data } = ctx.getImageData(0, 0, cw, ch)

  const gray = new Float32Array(cw * ch)
  let sum = 0
  for (let i = 0; i < gray.length; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    gray[i] = v
    sum += v
  }
  const mean = sum / gray.length

  // резкость: дисперсия лапласиана (4 соседа) по внутренним пикселям
  let lsum = 0
  let lsq = 0
  let n = 0
  for (let y = 1; y < ch - 1; y++) {
    for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x
      const lap = gray[i - cw] + gray[i + cw] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
      lsum += lap
      lsq += lap * lap
      n++
    }
  }
  const sharpness = n > 0 ? lsq / n - (lsum / n) ** 2 : 0

  const issues: string[] = []
  if (Math.min(w, h) < MIN_SIDE) issues.push(`мелкое фото ${w}×${h} — нужно от 1200 px по меньшей стороне`)
  if (sharpness < MIN_SHARPNESS) issues.push('размыто — текст нечёткий')
  if (mean < MIN_BRIGHTNESS) issues.push('слишком темно')
  return { width: w, height: h, issues }
}

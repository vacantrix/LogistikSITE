/**
 * Бейдж непрочитанных уведомлений на иконке вкладки (favicon).
 * Заголовок вкладки браузера — простой текст, цветной кружок в него не вставить,
 * поэтому цифра рисуется на canvas поверх логотипа: синий кружок с белой обводкой
 * и белой цифрой (как делают Gmail/WhatsApp), готовый PNG подставляется в
 * <link rel="icon">. При обнулении счётчика исходные иконки восстанавливаются.
 *
 * Клиентская утилита — вызывает только notification-bell в useEffect.
 */

const SIZE = 64
const BADGE_BLUE = '#2563eb' // синий кружок
const RING = '#ffffff' // белая обводка, чтобы бейдж отделялся от логотипа

/** исходные <link rel="icon"> до первой перерисовки — чтобы вернуть как было */
let originals: { link: HTMLLinkElement; href: string; type: string | null }[] | null = null
let lastDrawn: number | null = null
/** кэш загруженной базовой картинки по её URL */
let baseImage: HTMLImageElement | null = null
let baseImageHref: string | null = null
let baseImagePromise: Promise<HTMLImageElement | null> | null = null

function iconLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'))
}

/** запомнить исходные ссылки на иконку один раз, до любых изменений */
function captureOriginals(): { link: HTMLLinkElement; href: string; type: string | null }[] {
  if (!originals) {
    originals = iconLinks().map((link) => ({
      link,
      href: link.getAttribute('href') ?? '/logo-mark.svg',
      type: link.getAttribute('type'),
    }))
  }
  return originals
}

/** базовая иконка для рисования: предпочитаем SVG (чётче), затем любые icon-ссылки */
function baseHrefs(): string[] {
  const saved = captureOriginals()
  if (saved.length === 0) return [`${window.location.origin}/logo-mark.svg`]
  const ordered = [
    ...saved.filter((s) => s.type === 'image/svg+xml'),
    ...saved.filter((s) => s.type !== 'image/svg+xml'),
  ]
  return ordered.map((s) => s.link.href || s.href)
}

function loadBaseImage(): Promise<HTMLImageElement | null> {
  const hrefs = baseHrefs()
  if (baseImagePromise && baseImageHref && hrefs.includes(baseImageHref)) return baseImagePromise
  baseImageHref = hrefs[0] ?? null
  baseImagePromise = new Promise((resolve) => {
    if (!baseImageHref) return resolve(null)
    const tryLoad = (i: number) => {
      if (i >= hrefs.length) return resolve(null)
      const img = new Image()
      img.onload = () => { baseImage = img; resolve(img) }
      img.onerror = () => tryLoad(i + 1)
      img.src = hrefs[i]
    }
    tryLoad(0)
  })
  return baseImagePromise
}

/** нарисовать логотип с синим кружком и белой цифрой; вернуть PNG data-URL */
async function drawBadge(count: number): Promise<string | null> {
  const img = await loadBaseImage()
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, SIZE, SIZE)
  if (img) ctx.drawImage(img, 0, 0, SIZE, SIZE)

  // кружок в правом верхнем углу: синяя заливка + белая обводка-кольцо.
  // Крупный бейдж (Task 104): радиус 17 при 64px холста — заметен даже в 16px вкладке
  const cx = 44
  const cy = 20
  const r = 17
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = BADGE_BLUE
  ctx.fill()
  ctx.lineWidth = 3.5
  ctx.strokeStyle = RING
  ctx.stroke()

  // белая цифра по центру кружка; больше девяти — компактное «9+»
  const label = count > 9 ? '9+' : String(count)
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${label.length > 1 ? 17 : 23}px -apple-system, 'Segoe UI', system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, cx, cy + 1)
  return canvas.toDataURL('image/png')
}

/**
 * Показать счётчик непрочитанных на иконке вкладки.
 * count <= 0 — вернуть исходные иконки. Повторные вызовы с тем же числом — no-op.
 */
export function setFaviconBadge(count: number): void {
  if (typeof document === 'undefined') return
  if (lastDrawn === count) return
  lastDrawn = count
  const saved = captureOriginals()
  if (saved.length === 0) return

  if (count <= 0) {
    for (const s of saved) {
      s.link.href = s.href
      if (s.type) s.link.type = s.type
      else s.link.removeAttribute('type')
    }
    return
  }

  void drawBadge(count).then((dataUrl) => {
    if (!dataUrl || lastDrawn !== count) return
    for (const s of saved) {
      s.link.href = dataUrl
      s.link.type = 'image/png'
    }
  })
}

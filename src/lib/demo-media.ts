/** Клиентские хелперы работы с изображениями и демо-образцами документов */

/** Читает файл и сжимает до dataUri JPEG (max 1280px, качество 0.8) */
export async function fileToCompressedDataUri(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.readAsDataURL(file)
  })
  try {
    const img = document.createElement('img')
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('image'))
      img.src = dataUrl
    })
    const max = 1280
    const scale = Math.min(1, max / Math.max(img.width, img.height, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return dataUrl
  }
}

/** Демо-образец документа: SVG → dataUri (текст реально читается «OCR» на сервере) */
export function sampleSvg(title: string, lines: string[], accent: string): string {
  const rows = lines
    .map((l, i) => `<text x="40" y="${150 + i * 44}" font-family="Arial" font-size="24" fill="#1f2937">${l}</text>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" rx="14" fill="#f8fafc" stroke="#cbd5e1"/><rect width="640" height="64" rx="14" fill="${accent}"/><text x="40" y="42" font-family="Arial" font-size="24" font-weight="bold" fill="#fff">${title}</text>${rows}</svg>`
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

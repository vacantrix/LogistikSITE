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

// ---------------- Демо-образцы документов (SVG с читаемым текстом) ----------------

export interface DemoDocSample {
  type: 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'LICENSE' | 'STS' | 'REQUEST_DOC' | 'POA'
  fileName: string
  title: string
  lines: string[]
  accent: string
}

/** Образцы водителя Петрова П.С.: текст реально читается «OCR» на сервере */
export const DEMO_DOC_SAMPLES: DemoDocSample[] = [
  { type: 'PASSPORT_PHOTO', fileName: 'passport_demo.jpg', title: 'ПАСПОРТ РФ · СТР. С ФОТО', lines: ['ПЕТРОВ ПЕТР СЕРГЕЕВИЧ', '02.02.1988', '52 07 987654', '10.04.2024', '230-014'], accent: '#0f3b66' },
  { type: 'PASSPORT_REG', fileName: 'passport_reg_demo.jpg', title: 'ПАСПОРТ РФ · РЕГИСТРАЦИЯ', lines: ['11.11.2023  230-014', 'Г. КРАСНОДАР, УЛ. СЕВЕРНАЯ', 'Д. 45, КВ. 12'], accent: '#0f3b66' },
  { type: 'LICENSE', fileName: 'license_demo.jpg', title: 'ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ', lines: ['ПЕТРОВ ПЕТР СЕРГЕЕВИЧ', '02.02.1988', '52 10 555444', 'C, CE', '14.02.2022', '14.02.2032'], accent: '#5b3413' },
  { type: 'STS', fileName: 'sts_demo.jpg', title: 'СТС ТЯГАЧА', lines: ['Е456КХ123', 'Z942AB76HKB220001', '99 00 654321', 'SCANIA R450', 'ООО «Перевозчик Б»'], accent: '#14532d' },
  { type: 'REQUEST_DOC', fileName: 'zayavka_demo.jpg', title: 'ЗАЯВКА НА ПЕРЕВОЗКУ', lines: ['№ Z-1042', '21.10.2026', 'ГРУЗ: МЕТАЛЛОКОНСТРУКЦИИ, 20 Т', 'МАРШРУТ: ЗАВОД → ПОРТ', 'СТАВКА: 7 900 РУБ/Т'], accent: '#9a3412' },
  { type: 'POA', fileName: 'doverennost_demo.jpg', title: 'ДОВЕРЕННОСТЬ № 47', lines: ['№ 47', '20.10.2026', 'ООО «ПЕРЕВОЗЧИК Б»', 'ПЕТРОВ ПЕТР СЕРГЕЕВИЧ', '31.12.2026'], accent: '#3f6212' },
]

/** dataUri демо-образца по виду документа */
export function demoSampleUri(type: DemoDocSample['type']): string {
  const s = DEMO_DOC_SAMPLES.find((d) => d.type === type)!
  return sampleSvg(s.title, s.lines, s.accent)
}

/** fileName демо-образца по виду документа */
export function demoSampleName(type: DemoDocSample['type']): string {
  return DEMO_DOC_SAMPLES.find((d) => d.type === type)!.fileName
}

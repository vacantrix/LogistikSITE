/**
 * АЭМЗ Логистика — OCR-микросервис (self-hosted, порт 3020).
 *
 * Развёрнут на нашем сервере как отдельный сервис: платформа вызывает его
 * по HTTP. Единственный движок — PaddleOCR (self-hosted Python, mini-services/paddle-ocr):
 *
 *   PADDLE_OCR_URL, по умолчанию http://127.0.0.1:3031/ocr
 *      (контракт: POST { image, docType, fields[], mode? } → { quality, fields, confidences, docType, side?, confirmations, engineMode })
 *      Принимает изображения и PDF (первая страница); 422 — вид документа не распознаётся автоматически.
 *      mode (Task 83): "fast" — лёгкая нейросеть (PP-OCRv5_mobile_det) для «Автозаполнения»,
 *      "accurate" — точная (PP-OCRv5_server_det) для «Проверить»; без mode — авто-подбор.
 *      Облачный резерв (GLM-4.6V) удалён (Task 79): фото документов не покидают наш сервер.
 *
 * Сервис слушает только 127.0.0.1 — снаружи он недоступен.
 *
 * Контракт ответа зеркалит OcrOutput из src/lib/verify.ts платформы:
 *   { engine, quality, fields, confidences, detectedType?, engineMode? }
 *
 * Эндпоинты:
 *   GET  /health — статус сервиса и движка
 *   POST /ocr    — { type, dataUri, intake?, mode? } → { ok, ocr, chain }; 422 — вид документа без шаблона
 *
 * Распознавание одного документа занимает 5–40 с, PaddleOCR обрабатывает их по одному,
 * поэтому таймауты здесь длинные, а очередь держит сама платформа (src/lib/ocr-service.ts).
 */

const PORT = Number(process.env.OCR_PORT ?? 3020)
const PADDLE_URL = process.env.PADDLE_OCR_URL ?? 'http://127.0.0.1:3031/ocr'
const TOKEN = process.env.OCR_SERVICE_TOKEN ?? ''
const VERSION = '1.2.0'
// один документ — до ~40 с (с повторным точным проходом — до ~90 с); Bun допускает idleTimeout до 255 с
const PADDLE_TIMEOUT_MS = 170_000
const STARTED_AT = Date.now()

export type DocType = 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'LICENSE' | 'STS' | 'REQUEST_DOC' | 'POA'

const DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']

/** Списки полей — зеркалят DOC_FIELDS платформы (держим синхронно) */
const DOC_FIELDS: Record<DocType, string[]> = {
  PASSPORT_PHOTO: ['Фамилия', 'Имя', 'Отчество', 'Дата рождения', 'Серия и номер', 'Дата выдачи', 'Код подразделения', 'Место рождения'],
  PASSPORT_REG: ['Дата регистрации', 'Код подразделения', 'Адрес регистрации'],
  LICENSE: ['ФИО', 'Дата рождения', 'Номер ВУ', 'Категории', 'Дата выдачи', 'Действует до'],
  STS: ['Госномер', 'VIN', 'Номер СТС', 'Марка', 'Владелец'],
  REQUEST_DOC: ['Номер заявки', 'Дата заявки', 'Груз', 'Ставка'],
  POA: ['Номер доверенности', 'Дата выдачи', 'Действительна до', 'Кем выдана (перевозчик)', 'Представитель (ФИО)', 'Паспорт представителя'],
}

interface OcrOutput {
  engine: string
  quality: number
  fields: Record<string, string>
  confidences: Record<string, number>
  detectedType?: DocType | 'UNKNOWN'
  /** СТС: какая сторона на фото */
  side?: 'front' | 'back'
  /** какая нейросеть читала: fast (лёгкая) / accurate (точная) — Task 83 */
  engineMode?: 'fast' | 'accurate'
  confirmations?: Record<string, string[]>
}

/** Ответ PaddleOCR: распознано или вид документа без шаблона (422); недоступен — null */
type PaddleResult = { kind: 'ok'; ocr: OcrOutput } | { kind: 'unsupported' } | null

interface OcrRequestBody {
  type?: string
  dataUri?: string
  intake?: boolean
  /** Task 83: "fast" — лёгкая модель («Автозаполнение»), "accurate" — точная («Проверить») */
  mode?: string
}

// ---------------- утилиты ----------------

// сервис вызывается только сервером платформы — CORS для браузеров не нужен
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })

const DOC_TYPE_VALUES = DOC_TYPES

// ---------------- движок 1: PaddleOCR (self-hosted Python) ----------------

/**
 * Реальный PaddleOCR разворачивается отдельным Python-процессом
 * (paddleocr + paddlepaddle) и подключается сюда переменной окружения:
 *   PADDLE_OCR_URL=http://127.0.0.1:3031/ocr
 * Контракт: POST { image (dataUri), docType, fields[] } → { quality, fields, confidences, docType?, side? }
 */
async function paddleOcr(dataUri: string, type: DocType, mode?: string): Promise<PaddleResult> {
  const url = PADDLE_URL
  if (!url) return null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-OCR-Token': TOKEN } : {}) },
      body: JSON.stringify({ image: dataUri, docType: type, fields: DOC_FIELDS[type], ...(mode ? { mode } : {}) }),
      signal: AbortSignal.timeout(PADDLE_TIMEOUT_MS),
    })
    if (res.status === 422) return { kind: 'unsupported' }
    if (!res.ok) return null
    const j = (await res.json()) as {
      quality?: number
      fields?: Record<string, string>
      confidences?: Record<string, number>
      docType?: string
      side?: string
      engineMode?: string
      confirmations?: Record<string, string[]>
    }
    if (typeof j.quality !== 'number' || !j.fields) return null
    const rawType = typeof j.docType === 'string' ? j.docType.trim().toUpperCase() : ''
    const detectedType = DOC_TYPE_VALUES.includes(rawType as DocType)
      ? (rawType as DocType)
      : rawType === 'UNKNOWN' ? 'UNKNOWN' as const : undefined
    const engineMode = j.engineMode === 'accurate' ? 'accurate' as const : j.engineMode === 'fast' ? 'fast' as const : undefined
    return {
      kind: 'ok',
      ocr: {
        engine: 'PaddleOCR (self-hosted)',
        quality: Math.round(j.quality),
        fields: j.fields,
        confidences: j.confidences ?? {},
        ...(detectedType ? { detectedType } : {}),
        ...(j.side === 'front' || j.side === 'back' ? { side: j.side } : {}),
        ...(engineMode ? { engineMode } : {}),
        ...(j.confirmations ? { confirmations: j.confirmations } : {}),
      },
    }
  } catch {
    return null
  }
}

// ---------------- сервер ----------------

let lastEngine: string | null = null
let processed = 0

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  idleTimeout: 200,
  async fetch(req) {
    const url = new URL(req.url)
    if (TOKEN && req.headers.get('x-ocr-token') !== TOKEN) return json({ ok: false, error: 'forbidden' }, 403)

    // ——— статус сервиса ———
    if (url.pathname === '/health' && req.method === 'GET') {
      return json({
        ok: true,
        service: 'aemz-ocr-service',
        description: 'Self-hosted OCR-микросервис проверки документов АЭМЗ Логистика',
        version: VERSION,
        engines: {
          paddle: { configured: Boolean(PADDLE_URL), engine: 'PaddleOCR (self-hosted)', modes: ['fast', 'accurate'] },
        },
        activeEngine: lastEngine,
        processed,
        uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
        time: new Date().toISOString(),
      })
    }

    // ——— распознавание документа ———
    if (url.pathname === '/ocr' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as OcrRequestBody | null
      const type = body?.type as DocType
      const dataUri = body?.dataUri

      if (!type || !DOC_TYPES.includes(type)) {
        return json({ ok: false, error: `Неизвестный тип документа: ${body?.type ?? '—'}` }, 400)
      }
      const isPdf = Boolean(dataUri?.startsWith('data:application/pdf;'))
      if (!dataUri || !(dataUri.startsWith('data:image/') || isPdf)) {
        return json({ ok: false, error: 'Ожидается изображение или PDF в dataUri (data:image/… или data:application/pdf)' }, 400)
      }

      const chain: string[] = []

      // PaddleOCR: mode — какая нейросеть читает (fast — лёгкая, accurate — точная; Task 83)
      const mode = body?.mode === 'fast' || body?.mode === 'accurate' ? body.mode : undefined
      const paddle = await paddleOcr(dataUri, type, mode)
      if (paddle?.kind === 'ok') {
        chain.push(mode ? `paddleocr:${mode}` : 'paddleocr')
        lastEngine = paddle.ocr.engine
        processed += 1
        return json({ ok: true, ocr: paddle.ocr, chain })
      }
      if (paddle?.kind === 'unsupported') {
        chain.push('paddleocr:unsupported')
        return json({ ok: false, error: `Вид документа ${type} автоматически не распознаётся`, chain }, 422)
      }
      chain.push('paddleocr:fail')

      // Облачного резерва больше нет (Task 79): фото документов не покидают наш сервер
      return json({ ok: false, error: 'Сервис распознавания недоступен', chain }, 503)
    }

    return json({ ok: false, error: 'Not found. Смотри GET /health и POST /ocr' }, 404)
  },
})

console.log(`[aemz-ocr-service] запущен на http://127.0.0.1:${PORT} — движок: PaddleOCR(${PADDLE_URL})`,
  '— нейросети: fast (лёгкая) / accurate (точная) по кнопкам платформы')

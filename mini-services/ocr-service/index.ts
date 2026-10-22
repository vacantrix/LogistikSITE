/**
 * АЭМЗ Логистика — OCR-микросервис (self-hosted, порт 3020).
 *
 * Развёрнут на нашем сервере как отдельный сервис: платформа вызывает его
 * по HTTP до того, как обратиться к резервным движкам. Цепочка движков:
 *
 *   1. PaddleOCR (self-hosted Python, mini-services/paddle-ocr) — PADDLE_OCR_URL,
 *      по умолчанию http://127.0.0.1:3031/ocr
 *      (контракт: POST { image, docType, fields[] } → { quality, fields, confidences, docType, side?, confirmations })
 *      Принимает изображения и PDF (первая страница); 422 — вид документа не распознаётся автоматически.
 *   2. GLM-4.6V (облачная VLM) — ТОЛЬКО при OCR_CLOUD_FALLBACK=1: фото паспортов уходят во внешний сервис.
 *      По умолчанию выключено; если PaddleOCR не ответил — 503, платформа отправит документ на ручную проверку.
 *
 * Сервис слушает только 127.0.0.1 — снаружи он недоступен.
 *
 * Контракт ответа зеркалит OcrOutput из src/lib/verify.ts платформы:
 *   { engine, quality, fields, confidences, detectedType? }
 *
 * Эндпоинты:
 *   GET  /health — статус сервиса и цепочки движков
 *   POST /ocr    — { type, dataUri, intake? } → { ok, ocr, chain }; 422 — вид документа без шаблона
 *
 * Распознавание одного документа занимает 5–40 с, PaddleOCR обрабатывает их по одному,
 * поэтому таймауты здесь длинные, а очередь держит сама платформа (src/lib/ocr-service.ts).
 */

import ZAI from 'z-ai-web-dev-sdk'

const PORT = Number(process.env.OCR_PORT ?? 3020)
const PADDLE_URL = process.env.PADDLE_OCR_URL ?? 'http://127.0.0.1:3031/ocr'
const CLOUD_FALLBACK = process.env.OCR_CLOUD_FALLBACK === '1'
const TOKEN = process.env.OCR_SERVICE_TOKEN ?? ''
const VERSION = '1.1.0'
// один документ — до ~40 с (с повторным точным проходом — до ~90 с); Bun допускает idleTimeout до 255 с
const PADDLE_TIMEOUT_MS = 170_000
const STARTED_AT = Date.now()

export type DocType = 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'LICENSE' | 'STS' | 'REQUEST_DOC' | 'POA'

const DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']

const DOC_TYPE_LABEL: Record<DocType, string> = {
  PASSPORT_PHOTO: 'Паспорт: страница с фото',
  PASSPORT_REG: 'Паспорт: страница регистрации',
  LICENSE: 'Водительское удостоверение',
  STS: 'СТС (лицевая сторона или оборот)',
  REQUEST_DOC: 'Заявка на перевозку (скан)',
  POA: 'Доверенность',
}

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
  confirmations?: Record<string, string[]>
}

/** Ответ PaddleOCR: распознано, вид документа без шаблона (422) или сервис недоступен (null) */
type PaddleResult = { kind: 'ok'; ocr: OcrOutput } | { kind: 'unsupported' } | null

interface OcrRequestBody {
  type?: string
  dataUri?: string
  intake?: boolean
}

// ---------------- утилиты ----------------

// сервис вызывается только сервером платформы — CORS для браузеров не нужен
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

const DOC_TYPE_VALUES = DOC_TYPES

// ---------------- движок 1: PaddleOCR (self-hosted Python) ----------------

/**
 * Реальный PaddleOCR разворачивается отдельным Python-процессом
 * (paddleocr + paddlepaddle) и подключается сюда переменной окружения:
 *   PADDLE_OCR_URL=http://127.0.0.1:3031/ocr
 * Контракт: POST { image (dataUri), docType, fields[] } → { quality, fields, confidences, docType?, side? }
 */
async function paddleOcr(dataUri: string, type: DocType): Promise<PaddleResult> {
  const url = PADDLE_URL
  if (!url) return null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUri, docType: type, fields: DOC_FIELDS[type] }),
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
      confirmations?: Record<string, string[]>
    }
    if (typeof j.quality !== 'number' || !j.fields) return null
    const rawType = typeof j.docType === 'string' ? j.docType.trim().toUpperCase() : ''
    const detectedType = DOC_TYPE_VALUES.includes(rawType as DocType)
      ? (rawType as DocType)
      : rawType === 'UNKNOWN' ? 'UNKNOWN' as const : undefined
    return {
      kind: 'ok',
      ocr: {
        engine: 'PaddleOCR (self-hosted)',
        quality: Math.round(j.quality),
        fields: j.fields,
        confidences: j.confidences ?? {},
        ...(detectedType ? { detectedType } : {}),
        ...(j.side === 'front' || j.side === 'back' ? { side: j.side } : {}),
        ...(j.confirmations ? { confirmations: j.confirmations } : {}),
      },
    }
  } catch {
    return null
  }
}

// ---------------- движок 2: GLM-4.6V (резерв, вызывается с нашего сервера) ----------------

/** Облачная VLM. Ожидаемые данные заявки в модель не передаются — она только читает фото. */
async function glmOcr(dataUri: string, type: DocType): Promise<OcrOutput | null> {
  const fieldList = DOC_FIELDS[type].map((f) => `«${f}»`).join(', ')
  const prompt = [
    `Ты — OCR-модуль проверки транспортных документов (аналог PaddleOCR). Тип документа: ${DOC_TYPE_LABEL[type]}.`,
    `Прочитай изображение и верни СТРОГО JSON без пояснений:`,
    `{"quality": <0..100, качество фото: резкость, свет, документ целиком в кадре>,`,
    `"fields": {${fieldList}: <прочитанное значение, "" если не найдено>},`,
    `"confidences": {<поле>: <0..1 уверенность в прочитанном>},`,
    `"docType": <фактический вид документа на фото — один из PASSPORT_PHOTO | PASSPORT_REG | LICENSE | STS | REQUEST_DOC | POA | UNKNOWN>}`,
    `Заполняй ТОЛЬКО реально прочитанные с изображения значения, ничего не выдумывай и не дополняй.`,
  ].join('\n')

  try {
    const zai = await Promise.race([
      ZAI.create(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('init-timeout')), 8000)),
    ])
    const response = await Promise.race([
      zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUri } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('vlm-timeout')), 30_000)),
    ])
    const content = response.choices[0]?.message?.content
    if (!content) return null
    const j = extractJson(content)
    if (!j || typeof j.quality !== 'number') return null
    const fields = (j.fields ?? {}) as Record<string, string>
    const confidences = (j.confidences ?? {}) as Record<string, number>
    const rawType = typeof j.docType === 'string' ? (j.docType as string).trim().toUpperCase() : ''
    const detectedType = DOC_TYPE_VALUES.includes(rawType as DocType)
      ? (rawType as DocType)
      : rawType === 'UNKNOWN' ? 'UNKNOWN' as const : undefined
    return {
      engine: 'GLM-4.6V (облако)',
      quality: Math.round(j.quality as number),
      fields,
      confidences,
      detectedType: detectedType ?? 'UNKNOWN',
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
          paddle: { configured: Boolean(PADDLE_URL), engine: 'PaddleOCR (self-hosted)' },
          glm: { configured: CLOUD_FALLBACK, engine: 'GLM-4.6V (облако, только OCR_CLOUD_FALLBACK=1)' },
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

      // 1. PaddleOCR (если подключён)
      const paddle = await paddleOcr(dataUri, type)
      if (paddle?.kind === 'ok') {
        chain.push('paddleocr')
        lastEngine = paddle.ocr.engine
        processed += 1
        return json({ ok: true, ocr: paddle.ocr, chain })
      }
      if (paddle?.kind === 'unsupported') {
        chain.push('paddleocr:unsupported')
        return json({ ok: false, error: `Вид документа ${type} автоматически не распознаётся`, chain }, 422)
      }
      chain.push('paddleocr:fail')

      // 2. GLM-4.6V — только если облачный резерв явно включён (PDF модель не принимает)
      const glm = CLOUD_FALLBACK && !isPdf ? await glmOcr(dataUri, type) : null
      if (glm) {
        chain.push('glm-4.6v')
        lastEngine = glm.engine
        processed += 1
        return json({ ok: true, ocr: glm, chain })
      }
      chain.push(CLOUD_FALLBACK ? 'glm-4.6v:fail' : 'glm-4.6v:off')

      return json({ ok: false, error: 'Все движки распознавания недоступны', chain }, 503)
    }

    return json({ ok: false, error: 'Not found. Смотри GET /health и POST /ocr' }, 404)
  },
})

console.log(`[aemz-ocr-service] запущен на http://127.0.0.1:${PORT} — движки: PaddleOCR(${PADDLE_URL}) → облако(${CLOUD_FALLBACK ? 'включено' : 'выключено'})`)

/**
 * АЭМЗ Логистика — OCR-микросервис (self-hosted, порт 3020).
 *
 * Развёрнут на нашем сервере как отдельный сервис: платформа вызывает его
 * по HTTP до того, как обратиться к резервным движкам. Цепочка движков:
 *
 *   1. PaddleOCR (self-hosted Python) — если задан PADDLE_OCR_URL
 *      (контракт: POST { image, docType, fields[] } → { quality, fields, confidences })
 *   2. GLM-4.6V (облачная VLM, вызывается отсюда — с нашего сервера)
 *
 * Контракт ответа зеркалит OcrOutput из src/lib/verify.ts платформы:
 *   { engine, quality, fields, confidences, detectedType? }
 *
 * Эндпоинты:
 *   GET  /health — статус сервиса и цепочки движков
 *   POST /ocr    — { type, dataUri, expected?, intake? } → { ok, ocr, chain }
 */

import ZAI from 'z-ai-web-dev-sdk'

const PORT = 3020
const VERSION = '1.0.0'
const STARTED_AT = Date.now()

export type DocType = 'PASSPORT_PHOTO' | 'PASSPORT_REG' | 'LICENSE' | 'STS' | 'REQUEST_DOC' | 'POA'

const DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']

const DOC_TYPE_LABEL: Record<DocType, string> = {
  PASSPORT_PHOTO: 'Паспорт: страница с фото',
  PASSPORT_REG: 'Паспорт: страница регистрации',
  LICENSE: 'Водительское удостоверение',
  STS: 'СТС (лицевая сторона)',
  REQUEST_DOC: 'Заявка на перевозку (скан)',
  POA: 'Доверенность',
}

/** Списки полей — зеркалят DOC_FIELDS платформы (держим синхронно) */
const DOC_FIELDS: Record<DocType, string[]> = {
  PASSPORT_PHOTO: ['Фамилия', 'Имя', 'Отчество', 'Дата рождения', 'Серия и номер', 'Дата выдачи', 'Код подразделения'],
  PASSPORT_REG: ['Дата регистрации', 'Код подразделения', 'Адрес регистрации'],
  LICENSE: ['ФИО', 'Дата рождения', 'Номер ВУ', 'Категории', 'Дата выдачи', 'Действует до'],
  STS: ['Госномер', 'VIN', 'Номер СТС', 'Марка', 'Владелец'],
  REQUEST_DOC: ['Номер заявки', 'Дата заявки', 'Груз', 'Ставка'],
  POA: ['Номер доверенности', 'Дата выдачи', 'Действительна до', 'Кем выдана (перевозчик)', 'Представитель (ФИО)'],
}

interface OcrOutput {
  engine: string
  quality: number
  fields: Record<string, string>
  confidences: Record<string, number>
  detectedType?: DocType | 'UNKNOWN'
}

interface OcrRequestBody {
  type?: string
  dataUri?: string
  expected?: Record<string, string> | null
  intake?: boolean
}

// ---------------- утилиты ----------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
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
 * Контракт: POST { image (dataUri), docType, fields[] } → { quality, fields, confidences, docType? }
 */
async function paddleOcr(dataUri: string, type: DocType): Promise<OcrOutput | null> {
  const url = process.env.PADDLE_OCR_URL
  if (!url) return null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUri, docType: type, fields: DOC_FIELDS[type] }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      quality?: number
      fields?: Record<string, string>
      confidences?: Record<string, number>
      docType?: string
    }
    if (typeof j.quality !== 'number' || !j.fields) return null
    const rawType = typeof j.docType === 'string' ? j.docType.trim().toUpperCase() : ''
    const detectedType = DOC_TYPE_VALUES.includes(rawType as DocType)
      ? (rawType as DocType)
      : rawType === 'UNKNOWN' ? 'UNKNOWN' as const : undefined
    return {
      engine: 'PaddleOCR (self-hosted)',
      quality: Math.round(j.quality),
      fields: j.fields,
      confidences: j.confidences ?? {},
      ...(detectedType ? { detectedType } : {}),
    }
  } catch {
    return null
  }
}

// ---------------- движок 2: GLM-4.6V (резерв, вызывается с нашего сервера) ----------------

async function glmOcr(
  dataUri: string,
  type: DocType,
  expected: Record<string, string> | null,
  intake: boolean,
): Promise<OcrOutput | null> {
  const fieldList = DOC_FIELDS[type].map((f) => `«${f}»`).join(', ')
  const prompt = [
    `Ты — OCR-модуль проверки транспортных документов (аналог PaddleOCR). Тип документа: ${DOC_TYPE_LABEL[type]}.`,
    `Прочитай изображение и верни СТРОГО JSON без пояснений:`,
    `{"quality": <0..100, качество фото: резкость, свет, документ целиком в кадре>,`,
    `"fields": {${fieldList}: <прочитанное значение, "" если не найдено>},`,
    `"confidences": {<поле>: <0..1 уверенность в прочитанном>},`,
    ...(intake
      ? [`"docType": <фактический вид документа на фото — один из PASSPORT_PHOTO | PASSPORT_REG | LICENSE | STS | REQUEST_DOC | POA | UNKNOWN>}`]
      : [`"docOk": <true, если это действительно ${DOC_TYPE_LABEL[type]}>}`]),
    ...(expected && Object.keys(expected).length
      ? [`Для справки, ожидаемые значения: ${JSON.stringify(expected)}. Не подставляй их автоматически — читай только с фото.`]
      : [`Значений для сверки нет — это первичный ввод водителя: заполняй ТОЛЬКО реально прочитанные с изображения значения, ничего не выдумывай.`]),
    ...(intake
      ? [`Определи, какой документ реально изображён: страница паспорта с фото, страница регистрации паспорта, водительское удостоверение, СТС, заявка на перевозку или доверенность.`]
      : []),
    ...(intake
      ? [`Если изображение не является документом заявленного типа — укажи фактический docType.`]
      : [`Если изображение не является документом этого типа — поставь quality < 25 и docOk=false.`]),
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
    if (!intake && !j.docOk && (j.quality as number) >= 25) return null
    return {
      engine: 'GLM-4.6V · OCR-сервис',
      quality: Math.round(j.quality as number),
      fields,
      confidences,
      ...(intake ? { detectedType: detectedType ?? 'UNKNOWN' as const } : detectedType ? { detectedType } : {}),
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
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

    // ——— статус сервиса ———
    if (url.pathname === '/health' && req.method === 'GET') {
      return json({
        ok: true,
        service: 'aemz-ocr-service',
        description: 'Self-hosted OCR-микросервис проверки документов АЭМЗ Логистика',
        version: VERSION,
        engines: {
          paddle: { configured: Boolean(process.env.PADDLE_OCR_URL), engine: 'PaddleOCR (self-hosted)' },
          glm: { configured: true, engine: 'GLM-4.6V · OCR-сервис' },
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
      if (!dataUri || !dataUri.startsWith('data:image/')) {
        return json({ ok: false, error: 'Ожидается изображение в dataUri (data:image/…)' }, 400)
      }

      const chain: string[] = []

      // 1. PaddleOCR (если подключён)
      const paddle = await paddleOcr(dataUri, type)
      if (paddle) {
        chain.push('paddleocr')
        lastEngine = paddle.engine
        processed += 1
        return json({ ok: true, ocr: paddle, chain })
      }
      if (process.env.PADDLE_OCR_URL) chain.push('paddleocr:fail')

      // 2. GLM-4.6V (резервный VLM-движок с нашего сервера)
      const glm = await glmOcr(dataUri, type, body?.expected ?? null, Boolean(body?.intake))
      if (glm) {
        chain.push('glm-4.6v')
        lastEngine = glm.engine
        processed += 1
        return json({ ok: true, ocr: glm, chain })
      }
      chain.push('glm-4.6v:fail')

      return json({ ok: false, error: 'Все движки распознавания недоступны', chain }, 503)
    }

    return json({ ok: false, error: 'Not found. Смотри GET /health и POST /ocr' }, 404)
  },
})

console.log(`[aemz-ocr-service] запущен на http://127.0.0.1:${PORT} — движки: PaddleOCR(${process.env.PADDLE_OCR_URL ? 'подключён' : 'не подключён'}) → GLM-4.6V`)

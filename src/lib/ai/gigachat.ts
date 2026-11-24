// Клиент GigaChat (Сбер) — ТОЛЬКО серверный модуль; единственный ИИ-движок
// платформы (GLM отключена по требованию владельца). Подключение по личному
// ключу (scope GIGACHAT_API_PERS). Модель — GIGACHAT_MODEL, по умолчанию
// GigaChat-2-Max (флагманский уровень; список моделей виден в ЛК Сбера).
// Особенности:
//  • авторизация — POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth
//    (заголовки Authorization: Bearer <base64(ClientID:ClientSecret)> и RqUID;
//    старый путь /v1/oauth закрыт и отвечает 404);
//  • токен кэшируется до истечения (не дольше 30 минут), при 401 — разовое
//    перевыпускание и повтор запроса;
//  • сертификат Сбера выпущен «Минцифры России» и не входит в стандартный
//    trust store Node.js, поэтому запросы идут с rejectUnauthorized:false —
//    ровно как в официальных SDK (gigachat-js, gigachat-node);
//  • таймауты на каждый вызов — модель не может «подвесить» платформу.
import https from 'node:https'
import crypto from 'node:crypto'
import { DEFAULT_GIGA_MODEL } from './models'

const CLIENT_ID = process.env.GIGACHAT_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.GIGACHAT_CLIENT_SECRET ?? ''
const SCOPE = process.env.GIGACHAT_SCOPE ?? 'GIGACHAT_API_PERS'
const MODEL = process.env.GIGACHAT_MODEL ?? DEFAULT_GIGA_MODEL
const AUTH_URL = process.env.GIGACHAT_AUTH_URL ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
const BASE_URL = process.env.GIGACHAT_BASE_URL ?? 'https://gigachat.devices.sberbank.ru/api/v1'

export interface GigaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GigaResult {
  content: string
  model: string
  latencyMs: number
}

/** Личный ключ задан? Если нет — ИИ работает на резервном движке платформы. */
export function isGigaChatConfigured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0
}

/** Название модели из настроек (для отображения в интерфейсе). */
export function gigachatModelName(): string {
  return MODEL
}

/** Параметры подключения — для диагностики (секреты не раскрываются). */
export function gigachatConnectionInfo(): { configured: boolean; model: string; scope: string } {
  return { configured: isGigaChatConfigured(), model: MODEL, scope: SCOPE }
}

function httpsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
  timeoutMs = 20000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('timeout', () => req.destroy(new Error(`GigaChat: таймаут запроса (${timeoutMs} мс)`)))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ——— токен доступа (кэш) ———

interface TokenCache {
  token: string
  expiresAt: number
}
let tokenCache: TokenCache | null = null

async function fetchAccessToken(force: boolean): Promise<string> {
  if (!force && tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.token
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString()
  const r = await httpsRequest('POST', AUTH_URL, {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    RqUID: crypto.randomUUID(),
    'Rq-Id': crypto.randomUUID(),
    Authorization: `Bearer ${basic}`,
  }, body, 20000)
  if (r.status !== 200) throw new Error(`GigaChat: авторизация не прошла (HTTP ${r.status})`)
  const json = JSON.parse(r.body) as { access_token?: string; expires_at?: number }
  if (!json.access_token) throw new Error('GigaChat: сервер не выдал токен')
  const expiresAt =
    typeof json.expires_at === 'number' && json.expires_at > Date.now()
      ? json.expires_at
      : Date.now() + 25 * 60_000
  // живём не дольше 30 минут — даже если сервер сообщил большее время жизни токена
  tokenCache = { token: json.access_token, expiresAt: Math.min(expiresAt, Date.now() + 30 * 60_000) }
  return tokenCache.token
}

export interface GigaChatCallOptions {
  temperature?: number
  timeoutMs?: number
  /** уровень модели, выбранный человеком в чате (каталог — lib/ai/models.ts);
   *  не задан — уровень из GIGACHAT_MODEL (по умолчанию GigaChat-2-Max) */
  model?: string
}

/** Вызов модели. При 401 токен перевыпускается и запрос повторяется один раз. */
export async function gigachatComplete(messages: GigaMessage[], opts: GigaChatCallOptions = {}): Promise<GigaResult> {
  const t0 = Date.now()
  const call = async (token: string): Promise<GigaResult> => {
    const payload = JSON.stringify({
      model: opts.model ?? MODEL,
      messages,
      temperature: opts.temperature ?? 0.3,
      stream: false,
    })
    const r = await httpsRequest('POST', `${BASE_URL}/chat/completions`, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Rq-Id': crypto.randomUUID(),
      Authorization: `Bearer ${token}`,
    }, payload, opts.timeoutMs ?? 100_000)
    if (r.status === 401) {
      const err = new Error('GigaChat: токен истёк') as Error & { code?: string }
      err.code = 'GIGA401'
      throw err
    }
    if (r.status !== 200) throw new Error(`GigaChat: HTTP ${r.status} — ${r.body.slice(0, 200)}`)
    const json = JSON.parse(r.body) as { model?: string; choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) throw new Error('GigaChat: пустой ответ модели')
    return { content, model: json.model ?? MODEL, latencyMs: Date.now() - t0 }
  }
  const token = await fetchAccessToken(false)
  try {
    return await call(token)
  } catch (e) {
    if ((e as { code?: string }).code === 'GIGA401') {
      const fresh = await fetchAccessToken(true)
      return await call(fresh)
    }
    throw e
  }
}

/** Вызов модели в потоковом режиме (SSE): текст приходит чанками — чат печатает
 *  ответ по мере генерации, как живой диалог. onDelta получает каждый кусок;
 *  результат — полный текст (совпадает с суммой кусков). При 401 — перевыпуск
 *  токена и один повтор. Пустой поток/сбой отдаётся ошибкой — роут имеет право
 *  переключиться на обычный (не потоковый) вызов: это тот же движок и уровень. */
export async function gigachatStreamComplete(
  messages: GigaMessage[],
  opts: GigaChatCallOptions & { onDelta: (chunk: string) => void },
): Promise<GigaResult> {
  const t0 = Date.now()
  const call = async (token: string): Promise<GigaResult> => {
    const payload = JSON.stringify({
      model: opts.model ?? MODEL,
      messages,
      temperature: opts.temperature ?? 0.3,
      stream: true,
    })
    const timeoutMs = opts.timeoutMs ?? 110_000
    return await new Promise<GigaResult>((resolve, reject) => {
      const u = new URL(`${BASE_URL}/chat/completions`)
      const req = https.request(
        {
          method: 'POST',
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'Rq-Id': crypto.randomUUID(),
            Authorization: `Bearer ${token}`,
          },
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode !== 200) {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () => {
              const err = new Error(`GigaChat: HTTP ${res.statusCode ?? 0} — ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`) as Error & { code?: string }
              if (res.statusCode === 401) err.code = 'GIGA401'
              reject(err)
            })
            return
          }
          res.setEncoding('utf8')
          let buf = ''
          let content = ''
          let modelName = opts.model ?? MODEL
          const feedLine = (raw: string) => {
            const line = raw.trim()
            if (!line.startsWith('data:')) return
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') return
            try {
              const ev = JSON.parse(data) as {
                model?: string
                choices?: { delta?: { content?: string }; message?: { content?: string } }[]
              }
              if (ev.model) modelName = ev.model
              const piece = ev.choices?.[0]?.delta?.content ?? ev.choices?.[0]?.message?.content ?? ''
              if (piece) {
                content += piece
                opts.onDelta(piece)
              }
            } catch {
              /* строка между SSE-чанками не распарсилась — пропускаем, поток не ломаем */
            }
          }
          res.on('data', (chunk: string) => {
            buf += chunk
            let nl = buf.indexOf('\n')
            while (nl !== -1) {
              feedLine(buf.slice(0, nl))
              buf = buf.slice(nl + 1)
              nl = buf.indexOf('\n')
            }
          })
          res.on('end', () => {
            if (buf) feedLine(buf)
            if (!content.trim()) reject(new Error('GigaChat: пустой поток ответа'))
            else resolve({ content, model: modelName, latencyMs: Date.now() - t0 })
          })
        },
      )
      req.on('timeout', () => req.destroy(new Error(`GigaChat: таймаут потокового запроса (${timeoutMs} мс)`)))
      req.on('error', reject)
      req.write(payload)
      req.end()
    })
  }
  const token = await fetchAccessToken(false)
  try {
    return await call(token)
  } catch (e) {
    if ((e as { code?: string }).code === 'GIGA401') {
      const fresh = await fetchAccessToken(true)
      return await call(fresh)
    }
    throw e
  }
}

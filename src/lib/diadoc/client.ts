/**
 * HTTP-клиент API Диадока (JSON).
 *
 * Авторизация — OpenID Connect, Refresh Token Flow: access_token (живёт ~24 ч)
 * получаем по client_id + client_secret + refresh_token на identity.kontur.ru.
 * При каждом обмене Контур выдаёт НОВЫЙ refresh_token — сохраняем его в DiadocState,
 * иначе следующий обмен не пройдёт (https://developer.kontur.ru/docs/diadoc-api/authentication.html).
 *
 * Ограничения API: не больше 4 потоков и 100 RPS — платформа шлёт запросы по одному.
 */
import { db } from '@/lib/db'
import { diadocConfig, diadocEnabled } from '@/lib/diadoc/config'

export class DiadocError extends Error {
  constructor(message: string, readonly status: number, readonly details?: string) {
    super(message)
  }
}

const STATE_ID = 'main'
// обновляем токен заранее: за 10 минут до истечения
const TOKEN_MARGIN_MS = 10 * 60_000

let cachedToken: { token: string; expiresAt: number } | null = null
let refreshing: Promise<string> | null = null

/** BoxId в виде GUID: API отдаёт и «hex@diadoc.ru», а методы с boxId ждут GUID */
export function boxGuid(boxId: string): string {
  const m = boxId.trim().match(/^([0-9a-f]{32})@/i)
  if (!m) return boxId.trim()
  const h = m[1].toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

async function exchangeRefreshToken(refreshToken: string): Promise<Response> {
  const c = diadocConfig()
  return fetch(`${c.oidcUrl}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(30_000),
  })
}

async function refreshAccessToken(force: boolean): Promise<string> {
  const c = diadocConfig()
  const state = await db.diadocState.findUnique({ where: { id: STATE_ID } })
  // токен мог обновить другой процесс платформы — берём из базы, если ещё живой
  if (!force && state?.accessToken && state.accessTokenExpiresAt
    && state.accessTokenExpiresAt.getTime() - Date.now() > TOKEN_MARGIN_MS) {
    cachedToken = { token: state.accessToken, expiresAt: state.accessTokenExpiresAt.getTime() }
    return state.accessToken
  }

  // сначала сохранённый (ротированный) токен, затем токен из переменной — на случай перевыпуска в Кабинете
  const candidates = [...new Set([state?.refreshToken, c.refreshToken].filter((t): t is string => Boolean(t)))]
  if (candidates.length === 0) {
    throw new DiadocError('Нет refresh-токена Диадока: выпустите его в Кабинете интегратора и задайте DIADOC_REFRESH_TOKEN', 0)
  }
  let lastError = ''
  for (const rt of candidates) {
    const res = await exchangeRefreshToken(rt)
    if (!res.ok) {
      lastError = `${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`
      continue
    }
    const j = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string }
    if (!j.access_token) {
      lastError = 'в ответе нет access_token'
      continue
    }
    const expiresAt = new Date(Date.now() + (j.expires_in ?? 3600) * 1000)
    await db.diadocState.upsert({
      where: { id: STATE_ID },
      create: { id: STATE_ID, accessToken: j.access_token, accessTokenExpiresAt: expiresAt, refreshToken: j.refresh_token ?? rt },
      update: { accessToken: j.access_token, accessTokenExpiresAt: expiresAt, refreshToken: j.refresh_token ?? rt },
    })
    cachedToken = { token: j.access_token, expiresAt: expiresAt.getTime() }
    return j.access_token
  }
  throw new DiadocError(
    'Диадок не выдал токен доступа: проверьте client_id, client_secret и refresh-токен (выпустите новый в Кабинете интегратора)',
    401,
    lastError,
  )
}

/** Актуальный access_token; параллельные запросы ждут одного обмена */
export async function accessToken(force = false): Promise<string> {
  if (!diadocEnabled()) throw new DiadocError('Интеграция с Диадоком не настроена (DIADOC_CLIENT_ID)', 0)
  if (!force && cachedToken && cachedToken.expiresAt - Date.now() > TOKEN_MARGIN_MS) return cachedToken.token
  refreshing ??= refreshAccessToken(force).finally(() => { refreshing = null })
  return refreshing
}

/** Понятный текст ошибки по коду ответа API (коды — из документации методов) */
function errorText(status: number, body: string): string {
  const tail = body ? `: ${body.slice(0, 400)}` : ''
  switch (status) {
    case 400: return `Диадок не принял данные${tail}`
    case 401: return 'Диадок отклонил токен доступа — проверьте настройки интеграции'
    case 402: return 'У ящика закончилась подписка на API Диадока'
    case 403: return `Нет доступа к ящику или типу документа — проверьте права сервисной учётной записи${tail}`
    case 404: return `Диадок не нашёл объект${tail}`
    case 409: return `Диадок отклонил повторную отправку или контрагент не принимает документы${tail}`
    default: return status >= 500 ? `Сбой на стороне Диадока (${status}) — повторите позже` : `Ошибка Диадока ${status}${tail}`
  }
}

interface CallOptions {
  method?: 'GET' | 'POST'
  query?: Record<string, string | number | boolean | undefined>
  json?: unknown
  xml?: string
  accept?: string
}

/** Вызов метода API: токен, повтор при истёкшем токене, ожидание по Retry-After (204) */
async function call(path: string, opts: CallOptions = {}): Promise<Response> {
  const c = diadocConfig()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v))
  const query = qs.toString()
  const url = `${c.apiUrl}${path}${query ? `?${query}` : ''}`

  let forceRefresh = false
  let refreshedAfter401 = false
  for (let attempt = 0; attempt < 6; attempt++) {
    const token = await accessToken(forceRefresh)
    forceRefresh = false
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: opts.accept ?? 'application/json' }
    let body: string | undefined
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8'
      body = JSON.stringify(opts.json)
    } else if (opts.xml !== undefined) {
      headers['Content-Type'] = 'application/xml; charset=utf-8'
      body = opts.xml
    }
    const res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: AbortSignal.timeout(60_000) })
    // токен отозван или истёк раньше срока — один раз обновляем принудительно
    if (res.status === 401 && !refreshedAfter401) {
      refreshedAfter401 = true
      forceRefresh = true
      continue
    }
    // операция ещё выполняется (PostMessage) — повторить через Retry-After секунд
    if (res.status === 204 && res.headers.get('Retry-After')) {
      const wait = Math.min(30, Number(res.headers.get('Retry-After')) || 2)
      await new Promise((r) => setTimeout(r, wait * 1000))
      continue
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new DiadocError(errorText(res.status, text), res.status, text.slice(0, 2000))
    }
    return res
  }
  throw new DiadocError('Диадок не завершил операцию — повторите позже', 504)
}

// ——— структуры ответов (только используемые поля) ———

export interface DdBox { BoxId: string; BoxIdGuid?: string; Title?: string }
export interface DdOrganization { OrgId?: string; Inn?: string; Kpp?: string; ShortName?: string; FullName?: string; Boxes?: DdBox[] }

export interface DdCustomData { Key: string; Value: string }
export interface DdOuterDocflow {
  DocflowNamedId?: string
  DocflowFriendlyName?: string
  Status?: { NamedId?: string; FriendlyName?: string; Type?: string; Description?: string; Details?: { Code?: string; Text?: string }[] }
}
export interface DdEntity {
  EntityType?: string
  EntityId?: string
  ParentEntityId?: string
  AttachmentType?: string
  ContentTypeId?: string
  Version?: string
  FileName?: string
  OuterDocflow?: DdOuterDocflow
  DocumentInfo?: {
    MessageId?: string
    EntityId?: string
    TypeNamedId?: string
    Function?: string
    Version?: string
    DocumentDirection?: string
    CustomData?: DdCustomData[]
    InitialDocumentIds?: { MessageId?: string; EntityId?: string }[]
  }
}
export interface DdMessage { MessageId: string; FromBoxId?: string; ToBoxId?: string; Entities?: DdEntity[] }
export interface DdBoxEvent { EventId?: string; IndexKey?: string; Message?: DdMessage; Patch?: { MessageId: string; Entities?: DdEntity[] } }

// ——— методы ———

export async function getMyOrganizations(): Promise<DdOrganization[]> {
  const res = await call('/GetMyOrganizations')
  const j = (await res.json()) as { Organizations?: DdOrganization[] }
  return j.Organizations ?? []
}

/** Ящик АЭМЗ: из настроек или первый ящик своей организации */
export async function myBox(): Promise<{ boxId: string; title: string }> {
  const c = diadocConfig()
  if (c.boxId) return { boxId: boxGuid(c.boxId), title: '' }
  const orgs = await getMyOrganizations()
  const box = orgs.flatMap((o) => o.Boxes ?? [])[0]
  if (!box) throw new DiadocError('У сервисной учётной записи нет доступа ни к одному ящику Диадока', 403)
  return { boxId: box.BoxIdGuid ?? boxGuid(box.BoxId), title: box.Title ?? '' }
}

/** Ящик контрагента по ИНН (+КПП). null — организация не подключена к Диадоку */
export async function findBoxByInn(inn: string, kpp?: string): Promise<{ boxId: string; title: string } | null> {
  const res = await call('/GetOrganizationsByInnKpp', { query: { inn: inn.trim(), kpp: kpp?.trim() || undefined } })
  const j = (await res.json()) as { Organizations?: DdOrganization[] }
  for (const org of j.Organizations ?? []) {
    const box = org.Boxes?.[0]
    if (box) return { boxId: box.BoxIdGuid ?? boxGuid(box.BoxId), title: box.Title ?? org.ShortName ?? org.FullName ?? '' }
  }
  return null
}

/** Генерация титула по упрощённому XML (UserDataXml) — ответ: XML по формату ФНС (windows-1251) */
export async function generateTitleXml(params: {
  boxId: string
  typeNamedId: string
  func: string
  version: string
  titleIndex: number
  userXml: string
}): Promise<{ content: Buffer; fileName: string | null }> {
  const res = await call('/GenerateTitleXml', {
    method: 'POST',
    query: {
      boxId: params.boxId,
      documentTypeNamedId: params.typeNamedId,
      documentFunction: params.func,
      documentVersion: params.version,
      titleIndex: params.titleIndex,
    },
    xml: params.userXml,
    accept: 'application/xml',
  })
  const cd = res.headers.get('Content-Disposition') ?? ''
  const fileName = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? null
  return { content: Buffer.from(await res.arrayBuffer()), fileName: fileName ? decodeURIComponent(fileName) : null }
}

export interface DocumentToPost {
  typeNamedId: string
  func: string
  version: string
  content: Buffer
  /** подпись CAdES (base64-байты) или тестовая подпись Диадока */
  signature?: Buffer
  testSignature?: boolean
  /** отложенное подписание: документ ждёт подписи в исходящих ящика, подписывают в веб-интерфейсе Диадока */
  delaySend?: boolean
  customDocumentId?: string
}

/** Отправка сообщения (V3). operationId — идемпотентность: повтор с тем же id вернёт тот же результат */
export async function postMessage(fromBoxId: string, toBoxId: string, doc: DocumentToPost, operationId: string): Promise<DdMessage> {
  const res = await call('/V3/PostMessage', {
    method: 'POST',
    query: { operationId },
    json: {
      FromBoxId: fromBoxId,
      ToBoxId: toBoxId,
      ...(doc.delaySend ? { DelaySend: true } : {}),
      DocumentAttachments: [{
        TypeNamedId: doc.typeNamedId,
        Function: doc.func,
        Version: doc.version,
        CustomDocumentId: doc.customDocumentId,
        SignedContent: {
          Content: doc.content.toString('base64'),
          ...(doc.signature ? { Signature: doc.signature.toString('base64') } : {}),
          ...(doc.testSignature ? { SignWithTestSignature: true } : {}),
        },
      }],
    },
  })
  return (await res.json()) as DdMessage
}

export async function getMessage(boxId: string, messageId: string): Promise<DdMessage> {
  const res = await call('/V6/GetMessage', { query: { boxId, messageId } })
  return (await res.json()) as DdMessage
}

/** Лента событий ящика после afterIndexKey (до 500 событий за вызов) */
export async function getNewEvents(boxId: string, afterIndexKey: string | null, typeNamedId?: string): Promise<{ events: DdBoxEvent[]; total: number }> {
  const res = await call('/V8/GetNewEvents', {
    query: { boxId, afterIndexKey: afterIndexKey ?? undefined, typeNamedId, limit: 500 },
  })
  const j = (await res.json()) as { Events?: DdBoxEvent[]; TotalCount?: number }
  return { events: j.Events ?? [], total: j.TotalCount ?? 0 }
}

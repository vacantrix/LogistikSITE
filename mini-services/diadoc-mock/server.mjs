/**
 * Имитация API Диадока для разработки — ТОЛЬКО локально, без ключей Контура.
 *
 * Повторяет методы, которыми пользуется платформа (src/lib/diadoc), и проигрывает
 * документооборот ЭТрН по времени: Т1 → УИД ГИС ЭПД → Т2 перевозчика → Т3/Т4 → завершено.
 * Шаг сценария — MOCK_STEP_SEC секунд (по умолчанию 15).
 *
 * Запуск:  node mini-services/diadoc-mock/server.mjs        (слушает 127.0.0.1:3040)
 * Платформа (.env.local):
 *   DIADOC_API_URL=http://127.0.0.1:3040
 *   DIADOC_OIDC_URL=http://127.0.0.1:3040
 *   DIADOC_CLIENT_ID=mock  DIADOC_CLIENT_SECRET=mock  DIADOC_REFRESH_TOKEN=mock
 *
 * Сценарии ошибок: ИНН, начинающийся с 0000, — «организация не найдена»;
 * ИНН грузополучателя 9999000000 — ГИС ЭПД отклоняет накладную.
 */
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'

const PORT = Number(process.env.MOCK_PORT ?? 3040)
const STEP_MS = Number(process.env.MOCK_STEP_SEC ?? 15) * 1000
const AEMZ_BOX = 'a0e0a0e0-0000-4000-8000-00000000a3e3'
const tokens = new Set()
let tokenSeq = 0
/** messageId → { created, testSigned, consigneeInn, t1, mtId, fromBoxId, toBoxId } */
const messages = new Map()

const guidFrom = (s) => {
  const h = createHash('md5').update(s).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
const readBody = (req) => new Promise((resolve) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
})
const tag = (Key, Value) => ({ Key, Value })

/** Этап сценария для сообщения: 0 — Т1 подписан, 1 — УИД, 2 — Т2, 3 — Т3, 4 — завершено */
function stepOf(m) {
  return Math.floor((Date.now() - m.created) / STEP_MS)
}

function messageEntities(m) {
  const k = stepOf(m)
  // при отложенной подписи Т1 «подписывают в веб-интерфейсе» через один шаг — сценарий сдвигается
  const shift = m.testSigned ? 0 : 1
  const signed = k >= shift
  const step = k - shift
  const status = !signed ? 'r-wait-consignor-sign'
    : step < 1 ? 'r-consignor-signed'
      : step < 2 ? 'r-wait-carrier-sign'
        : step < 3 ? 'on-the-way'
          : step < 4 ? 'd-wait-carrier-sign' : 'completed'
  const custom = [tag('kl-id', m.messageId), tag('kl-type', 'LogisticsWaybill'), tag('kl-func', 'reception'), tag('kl-status', status)]
  if (signed && step >= 1) custom.push(tag('mt-id', m.mtId))
  const entities = [{
    EntityType: 'Attachment', EntityId: m.t1, ParentEntityId: '', AttachmentType: 'Title',
    ContentTypeId: 'kl_trn_ot_t1_mt_05_01_v1', Version: 'kl_trn_mt_05_01',
    DocumentInfo: { MessageId: m.messageId, EntityId: m.t1, TypeNamedId: 'LogisticsWaybill', Function: 'reception', Version: 'kl_trn_mt_05_01', DocumentDirection: 'Outbound', CustomData: custom },
  }]
  if (signed) entities.push({ EntityType: 'Signature', EntityId: randomUUID(), ParentEntityId: m.t1 })
  if (signed && step >= 1) {
    const rejected = m.consigneeInn.startsWith('9999')
    entities.push({
      EntityType: 'Attachment', EntityId: randomUUID(), ParentEntityId: m.t1, AttachmentType: 'OuterDocflow',
      OuterDocflow: {
        DocflowNamedId: 'KlMt', DocflowFriendlyName: 'ГИС ЭПД',
        Status: rejected
          ? { NamedId: '2000411000', FriendlyName: 'Документ не прошёл проверку', Type: 'Error', Details: [{ Code: 'mt-id', Text: m.mtId }, { Code: 'error', Text: 'Грузополучатель не зарегистрирован в ГИС ЭПД (имитация)' }] }
          : { NamedId: '4000211000', FriendlyName: 'Принят новый перевозочный документ', Type: 'Success', Details: [{ Code: 'mt-id', Text: m.mtId }] },
      },
    })
  }
  if (signed && step >= 2) {
    entities.push({ EntityType: 'Attachment', EntityId: m.t2, ParentEntityId: m.t1, AttachmentType: 'Title', Version: 'kl_trn_mt_05_01', ContentTypeId: 'kl_trn_ot_t2_mt_05_01_v1' })
    entities.push({ EntityType: 'Signature', EntityId: randomUUID(), ParentEntityId: m.t2 })
  }
  return entities
}

/** Лента: пересланные Т3/Т4 (Function = fwd, kl-func = delivery, тот же mt-id) */
function deliveryEvents() {
  const events = []
  for (const m of messages.values()) {
    const step = stepOf(m) - (m.testSigned ? 0 : 1)
    for (const [s, status] of [[3, 'd-wait-carrier-sign'], [4, 'completed']]) {
      if (step < s) continue
      events.push({
        EventId: `${m.messageId}-${s}`,
        IndexKey: String(m.created + s * STEP_MS).padStart(16, '0'),
        Message: {
          MessageId: m.fwdId, FromBoxId: m.toBoxId, ToBoxId: m.fromBoxId,
          Entities: [{
            EntityType: 'Attachment', EntityId: randomUUID(), AttachmentType: 'Title', ContentTypeId: 'kl_trn_fwd',
            DocumentInfo: {
              TypeNamedId: 'LogisticsWaybill', Function: 'fwd', Version: 'kl_trn_fwd', DocumentDirection: 'Inbound',
              InitialDocumentIds: [{ MessageId: m.messageId, EntityId: m.t1 }],
              CustomData: [tag('kl-func', 'delivery'), tag('mt-id', m.mtId), tag('kl-status', status)],
            },
          }],
        },
      })
    }
  }
  return events.sort((a, b) => a.IndexKey.localeCompare(b.IndexKey))
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const q = Object.fromEntries(url.searchParams)
  const path = url.pathname
  console.log(`[diadoc-mock] ${req.method} ${path}`)

  if (path === '/connect/token' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req))
    if (form.get('grant_type') !== 'refresh_token' || !form.get('client_id') || !form.get('refresh_token')) {
      return json(res, 400, { error: 'invalid_grant' })
    }
    const access = `mock-access-${++tokenSeq}`
    tokens.add(access)
    return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 86400, refresh_token: `mock-refresh-${tokenSeq}` })
  }

  const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!tokens.has(auth)) return json(res, 401, { error: 'unauthorized' })

  if (path === '/GetMyOrganizations') {
    return json(res, 200, { Organizations: [{ OrgId: guidFrom('aemz'), Inn: '2323000000', Kpp: '232301001', ShortName: 'АО «АЭМЗ» (тестовый ящик)', Boxes: [{ BoxId: `${AEMZ_BOX.replace(/-/g, '')}@diadoc.ru`, BoxIdGuid: AEMZ_BOX, Title: 'АО «АЭМЗ» (тестовый ящик)' }] }] })
  }
  if (path === '/GetOrganizationsByInnKpp') {
    if (!q.inn || q.inn.startsWith('0000')) return json(res, 200, { Organizations: [] })
    const box = guidFrom(`box-${q.inn}`)
    return json(res, 200, { Organizations: [{ Inn: q.inn, Kpp: q.kpp ?? '', ShortName: `Организация ИНН ${q.inn}`, Boxes: [{ BoxId: `${box.replace(/-/g, '')}@diadoc.ru`, BoxIdGuid: box, Title: `Организация ИНН ${q.inn}` }] }] })
  }
  if (path === '/GenerateTitleXml' && req.method === 'POST') {
    const xml = await readBody(req)
    if (q.documentTypeNamedId !== 'LogisticsWaybill' || q.documentFunction !== 'reception' || q.documentVersion !== 'kl_trn_mt_05_01' || q.titleIndex !== '0') {
      return json(res, 400, { error: 'Неверные параметры типа документа' })
    }
    if (!/<LogisticsWaybillConsignorTitle[\s>]/.test(xml) || !/<\/LogisticsWaybillConsignorTitle>\s*$/.test(xml)) {
      return json(res, 400, { error: 'UserDataXml не соответствует схеме ON_TRNACLGROT_MT_05_01_UserContract' })
    }
    res.writeHead(200, { 'Content-Type': 'application/xml', 'Content-Disposition': 'attachment; filename="ON_TRNACLGROT_mock.xml"' })
    return res.end(`<?xml version="1.0" encoding="utf-8"?><Файл ИдФайл="ON_TRNACLGROT_mock" ВерсФорм="5.01"><Исходные>${Buffer.from(xml).toString('base64')}</Исходные></Файл>`)
  }
  if (path === '/V3/PostMessage' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const att = body.DocumentAttachments?.[0]
    if (!att || att.TypeNamedId !== 'LogisticsWaybill' || !att.SignedContent?.Content) return json(res, 400, { error: 'Нет документа' })
    const testSigned = Boolean(att.SignedContent.SignWithTestSignature)
    if (!testSigned && !att.SignedContent.Signature && !body.DelaySend) return json(res, 400, { error: 'Документ без подписи' })
    // имитация кладёт исходный UserDataXml в «титул» — по нему узнаём ящик грузополучателя
    const generated = Buffer.from(att.SignedContent.Content, 'base64').toString('utf8')
    const userXml = Buffer.from(generated.match(/<Исходные>([^<]+)</)?.[1] ?? '', 'base64').toString('utf8')
    const consigneeBox = userXml.match(/<ConsigneeInfo>[\s\S]*?BoxId="([^"]+)"/)?.[1] ?? ''
    const consigneeInn = consigneeBox === guidFrom('box-9999000000') ? '9999000000' : ''
    const existing = [...messages.values()].find((m) => m.operationId === q.operationId)
    const m = existing ?? {
      messageId: randomUUID(), operationId: q.operationId, created: Date.now(), testSigned, consigneeInn,
      t1: randomUUID(), t2: randomUUID(), fwdId: randomUUID(), mtId: randomUUID(), fromBoxId: body.FromBoxId, toBoxId: body.ToBoxId,
    }
    messages.set(m.messageId, m)
    return json(res, 200, { MessageId: m.messageId, FromBoxId: m.fromBoxId, ToBoxId: m.toBoxId, Entities: messageEntities(m) })
  }
  if (path === '/V6/GetMessage') {
    const m = messages.get(q.messageId)
    if (!m) return json(res, 404, { error: 'Сообщение не найдено' })
    return json(res, 200, { MessageId: m.messageId, FromBoxId: m.fromBoxId, ToBoxId: m.toBoxId, Entities: messageEntities(m) })
  }
  if (path === '/V8/GetNewEvents') {
    const after = q.afterIndexKey ?? ''
    const events = deliveryEvents().filter((e) => e.IndexKey > after)
    return json(res, 200, { Events: events.slice(0, 500), TotalCount: events.length })
  }
  return json(res, 404, { error: `Метод ${path} в имитации не реализован` })
}).listen(PORT, '127.0.0.1', () => console.log(`[diadoc-mock] слушает http://127.0.0.1:${PORT}, шаг сценария ${STEP_MS / 1000} с`))

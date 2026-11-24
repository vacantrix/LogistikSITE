// Ядро ИИ-помощника — ТОЛЬКО для серверного кода: z-ai-web-dev-sdk запрещено
// импортировать на клиенте. Здесь создаётся клиент SDK, собирается жёстко
// ограниченный контекст (частичное чтение) и пишется журнал нейросети.

import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { AI_RIGHTS } from './rights'

type ZaiInstance = Awaited<ReturnType<typeof ZAI.create>>
let zaiInstance: ZaiInstance | null = null

/** Клиент нейросети (один на процесс — переиспользуем) */
export async function getZai(): Promise<ZaiInstance> {
  zaiInstance ??= await ZAI.create()
  return zaiInstance
}

/** Запись в журнал нейросети — не должна ломать основной запрос */
export async function aiLog(level: 'info' | 'warn' | 'error', action: string, message: string, details?: unknown): Promise<void> {
  try {
    await db.aiLog.create({
      data: {
        level,
        action,
        message: message.slice(0, 2000),
        details: details === undefined || details === null ? null : JSON.stringify(details).slice(0, 4000),
      },
    })
  } catch {
    /* журнал не должен валить основной поток */
  }
}

const CONTACT_KIND_LABELS: Record<string, string> = { carrier: 'перевозчик', shipper: 'грузовладелец', driver: 'водитель', other: 'другое' }
const DEAL_STATUS_LABELS: Record<string, string> = { talks: 'переговоры', done: 'заключена', refuse: 'отказ', lost: 'не вышло' }
const DEAL_DIRECTION_LABELS: Record<string, string> = { load: 'груз', truck: 'машина' }

/** Частичное чтение памяти контактов: имена/компании/роли/статусы — БЕЗ телефонов и почты */
async function contactsContext(): Promise<string> {
  const contacts = await db.memoryContact.findMany({
    include: { deals: { orderBy: { createdAt: 'desc' }, take: 5 } },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  })
  if (contacts.length === 0) return 'Контактов в памяти пока нет.'
  const lines = contacts.map((c) => {
    const deals = c.deals
      .map((d) => `${DEAL_STATUS_LABELS[d.status] ?? d.status} — ${DEAL_DIRECTION_LABELS[d.direction] ?? d.direction}${d.route ? `, ${d.route}` : ''}${d.amount != null ? `, ${d.amount} ₽` : ''}`)
      .join('; ')
    return `- ${c.name}${c.company ? `, ${c.company}` : ''} — ${CONTACT_KIND_LABELS[c.kind] ?? c.kind}, рейтинг ${c.rating}/5${deals ? `, сделки: ${deals}` : ', сделок не было'}`
  })
  return lines.join('\n')
}

/** Свой список — последние записи (то, что нейросеть уже разбирала) */
async function ownListContext(): Promise<string> {
  const items = await db.aiListItem.findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
  if (items.length === 0) return ''
  return items
    .map((i) => `- ${new Date(i.createdAt).toLocaleString('ru-RU')} · ${i.kind}: «${i.query}»`)
    .join('\n')
}

export interface AiContextParts {
  contacts: string
  ownList: string
  /** витрина ATI.SU (демо-выдача грузов, машины фирмы) — только для поиска */
  market?: string
}

/** Сборка частичного read-only контекста: контакты без телефонов + свой список */
export async function buildRestrictedContext(): Promise<{ contacts: string; ownList: string }> {
  const [contacts, ownList] = await Promise.all([contactsContext(), ownListContext()])
  return { contacts, ownList }
}

/** Системный промпт: роль, жёсткие права, стиль и частичный контекст */
export function buildSystemPrompt(parts: AiContextParts): string {
  const rightsBlock = AI_RIGHTS.map((r) => `- ${r.title}: ${r.detail}`).join('\n')
  const market = parts.market?.trim()
  const blocks = [
    'Ты — ИИ-помощник-консультант платформы «АЭМЗ Поток». Помогаешь логисту и экспедитору:',
    'основная работа — подбор грузов и перевозчиков на бирже ATI.SU, ведение переговоров и оценка сделок.',
    '',
    'ЖЁСТКИЕ ПРАВА — никогда не выходи за них и не обещай действий, которых не можешь выполнить:',
    rightsBlock,
    '',
    'Стиль ответа:',
    '- по-русски, кратко и по делу; структура — markdown (заголовки и списки); суммы в рублях;',
    '- будь честным: если данных мало — скажи прямо; предупреждай о рисках (предоплата, «прямые» сделки в обход, ставки сильно ниже рынка);',
    '- не выдумывай номера грузов, фирмы и факты: работай только с данными контекста ниже и знаниями рынка;',
    '- ориентиры рынка помечай как оценку.',
    '',
    '### Контекст: память контактов (частичное чтение — телефоны и почта скрыты)',
    parts.contacts,
  ]
  if (parts.ownList) {
    blocks.push('', '### Контекст: собственный список нейросети — последние разборы', parts.ownList)
  }
  if (market) {
    blocks.push('', '### Контекст: витрина биржи ATI.SU (демо-режим, реальных запросов нет)', market)
  }
  return blocks.join('\n')
}

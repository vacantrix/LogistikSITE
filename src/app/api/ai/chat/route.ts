import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { plog } from '@/lib/platform-log'
import {
  aiChatComplete, aiChatStreamComplete, aiLog, aiRightMode,
  buildRestrictedContext, buildSystemPrompt, getAiRights,
  type EngineMessage,
} from '@/lib/ai/core'
import { extractAiTools } from '@/lib/ai/tools'
import { validGigaModel, DEFAULT_GIGA_MODEL } from '@/lib/ai/models'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/chat — вопрос нейросети в чат (потоковый ответ).
 *
 * Ответ — NDJSON-стрим (строки JSON через \n), чтобы в окне чата отражалось
 * ВСЁ, что делает нейросеть, по мере того как она это делает (как в harness):
 *   {"type":"step","at":1732512000000,"text":"GigaChat · запрос…"}   — ход работы: только факт действия;
 *   {"type":"delta","text":"…"}                                    — ответ печатается чанками;
 *   {"type":"done",…}                                              — итог: виджеты, метаданные, id записи;
 *   {"type":"error","error":"…"}                                   — честная ошибка движка.
 *
 * Возможности:
 *  • выбор уровня модели GigaChat в запросе (model) — каталог lib/ai/models.ts;
 *  • прикреплённые файлы (files) — текст читается и попадает в контекст;
 *  • история чата берётся из БД (AiChatMessage) — сервер источник правды;
 *  • оба сообщения сохраняются в историю: чат не теряется при перезагрузке;
 *  • права ИИ действуют по матрице администратора (getAiRights): контактный
 *    контекст, запись перевозчиков, свой список и журнал — по режимам прав.
 *
 * Единственная модель — GigaChat (Сбер); сбои не переключают движок.
 * При сбое потока делается один повтор обычным (не потоковым) вызовом —
 * это тот же движок и уровень, человек не замечает подмены.
 */

// ограничение темпа: не чаще 30 вопросов в минуту на пользователя (in-memory)
const rateBuckets = new Map<string, number[]>()
function allowRate(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) {
    rateBuckets.set(key, arr)
    return false
  }
  arr.push(now)
  rateBuckets.set(key, arr)
  return true
}

interface ChatFile {
  name: string
  type: string
  size: number
  text: string
}

/** Прикреплённые файлы: до 3, каждый до 8 000 символов, суммарно до 16 000. */
function sanitizeFiles(raw: unknown): ChatFile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((f): f is { name?: unknown; type?: unknown; size?: unknown; text?: unknown } =>
      !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string')
    .slice(0, 3)
    .map((f) => ({
      name: String(f.name).slice(0, 200),
      type: typeof f.type === 'string' ? f.type.slice(0, 100) : '',
      size: typeof f.size === 'number' && Number.isFinite(f.size) ? Math.max(0, Math.min(f.size, 99_999_999)) : 0,
      text: typeof f.text === 'string' ? f.text.slice(0, 8_000) : '',
    }))
    .filter((f) => f.text.trim().length > 0)
}

export async function POST(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as
    | { message?: unknown; history?: unknown; model?: unknown; files?: unknown; sessionId?: unknown }
    | null
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 4000) : ''
  if (!message) return NextResponse.json({ error: 'Пустой вопрос' }, { status: 400 })
  const files = sanitizeFiles(body?.files)
  const modelKey = validGigaModel(body?.model)
  // чат (диалог), в который пишем: свой sessionId из запроса, иначе самый свежий
  const wantedSessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const filesChars = files.reduce((s, f) => s + f.text.length, 0)
  if (filesChars > 16_000) {
    return NextResponse.json({ error: 'Файлы слишком большие: суммарно до 16 000 символов' }, { status: 413 })
  }

  if (!allowRate(`chat:${auth.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Слишком много вопросов подряд — подождите минуту' }, { status: 429 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const emit = (obj: unknown): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        } catch {
          closed = true
        }
      }
      const steps: { at: number; text: string }[] = []
      const step = (text: string): void => {
        const at = Date.now()
        steps.push({ at, text })
        emit({ type: 'step', at, text })
      }

      void (async () => {
        let answer = ''
        let engine = 'gigachat'
        let model = modelKey
        let latencyMs = 0
        let userMessageId: string | undefined
        try {
          step(`вопрос принят · ${message.length} симв · ${modelKey}`)
          if (files.length > 0) {
            step(files.map((f) => `файл прочитан · ${f.name} · ${f.text.length} симв`).join(' · '))
          }

          // действующая матрица прав — администратор правит её в разделе «Права»
          const rights = await getAiRights()
          const carriersWrite = aiRightMode(rights, 'carriers-write') === 'write'
          const ownListOn = aiRightMode(rights, 'own-list') === 'write'
          const ownLogOn = aiRightMode(rights, 'own-log') === 'write'
          const log = ownLogOn ? aiLog : null
          step(`права загружены · ${rights.length}`)

          // чат-диалог, в который пишется переписка: свой sessionId или самый свежий
          // (его создаёт «Новый чат» / первое открытие /api/ai/messages)
          let session = wantedSessionId
            ? await db.aiChatSession.findFirst({ where: { id: wantedSessionId, userId: auth.id } })
            : null
          if (!session) {
            session = await db.aiChatSession.findFirst({
              where: { userId: auth.id },
              orderBy: { updatedAt: 'desc' },
            })
          }
          if (!session) session = await db.aiChatSession.create({ data: { userId: auth.id } })

          // история чата из БД: сервер — источник правды, клиент ничего не пересылает;
          // контекст модели — только текущий диалог, без других чатов
          const historyRows = await db.aiChatMessage.findMany({
            where: { userId: auth.id, sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            take: 8,
          })
          const history: EngineMessage[] = historyRows
            .slice()
            .reverse()
            .map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content.slice(0, 4_000) }))

          const filesBlock =
            files.length > 0
              ? `\n\n### Файлы, прикреплённые человеком (прочитай и используй)\n${files
                  .map((f) => `--- файл: ${f.name} (${f.size} Б) ---\n${f.text}`)
                  .join('\n\n')}`
              : ''

          const userMsg = await db.aiChatMessage.create({
            data: {
              userId: auth.id,
              sessionId: session.id,
              role: 'user',
              content: message,
              filesJson:
                files.length > 0
                  ? JSON.stringify(files.map((f) => ({ name: f.name, size: f.size, excerpt: f.text.slice(0, 200) })))
                  : null,
            },
          })
          userMessageId = userMsg.id
          // чат поднимается наверх списка: первый вопрос становится названием,
          // каждое сообщение обновляет updatedAt (порядок «Прошлых чатов»)
          await db.aiChatSession.update({
            where: { id: session.id },
            data: {
              title: !session.title || session.title === 'Новый чат'
                ? message.replace(/\s+/g, ' ').trim().slice(0, 60)
                : session.title,
            },
          })
          step(`история чата · ${history.length} сообщ · вопрос записан`)

          await plog({
            type: 'AI_QUERY', source: 'api/ai/chat',
            actor: { login: auth.login, name: auth.name, role: auth.role },
            message: `Запрос к ИИ-помощнику: «${message.slice(0, 80)}»`,
            objectType: 'ai_session', objectId: session.id,
            meta: { sessionId: session.id, model: modelKey, files: files.length, historyMessages: history.length },
          })

          const ctx = await buildRestrictedContext(rights)
          const system = buildSystemPrompt(ctx, rights)
          const contactsMode = aiRightMode(rights, 'contacts-read')
          const ownCount = ctx.ownList ? ctx.ownList.split('\n').length : 0
          step(`контекст собран · контакты: ${
            contactsMode === 'denied' ? 'закрыты' : contactsMode === 'write' ? 'полные' : 'частичные'
          } · свой список: ${ownCount} записей · платформа: ${ctx.platformSummary}`)

          const messages: EngineMessage[] = [
            { role: 'system', content: system },
            ...history,
            { role: 'user', content: message + filesBlock },
          ]

          await log?.('info', 'chat_start', `Вопрос (${auth.login}): ${message.slice(0, 300)}`, {
            model: modelKey,
            files: files.map((f) => f.name),
            historyMessages: history.length,
          })

          step(`GigaChat · запрос (${modelKey})`)
          let completion
          try {
            completion = await aiChatStreamComplete(messages, {
              temperature: 0.4,
              timeoutMs: 110_000,
              model: modelKey,
              onDelta: (chunk) => emit({ type: 'delta', text: chunk }),
            })
          } catch (streamErr) {
            step('стрим не пошёл · повтор обычным вызовом')
            await log?.('warn', 'chat_stream_fallback', `Поток ответа не пошёл — отвечено обычным вызовом: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`)
            completion = await aiChatComplete(messages, { temperature: 0.4, timeoutMs: 110_000, model: modelKey })
            emit({ type: 'delta', text: completion.answer })
          }
          answer = completion.answer
          engine = completion.engine
          model = completion.model
          latencyMs = completion.latencyMs
          // инструменты модели: ai-contact, ai-best, ai-card, ai-report, ai-links (с фильтрами)
          const { cleaned, contacts, best, cards, report, links } = extractAiTools(answer)
          step(`GigaChat · ${(latencyMs / 1000).toFixed(1)} с · ${answer.length} симв · разбор: карточки ${cards.length} · подбор ${best.length} · отчёт ${report ? 'есть' : 'нет'} · ссылки ${links.length} · перевозчики ${contacts.length}`)

          const savedContacts: { id: string; name: string; company: string; kind: string }[] = []
          if (carriersWrite) {
            for (const card of contacts) {
              try {
                const contact = await db.memoryContact.create({
                  data: {
                    name: card.name,
                    company: card.company,
                    kind: card.kind,
                    phone: card.phone,
                    email: card.email,
                    source: 'ai',
                    atiRef: card.atiRef || null,
                    atiFirmId: card.atiFirmId || null,
                    rating: card.rating,
                    notes: card.notes,
                    recordFormat: card.format,
                  },
                })
                savedContacts.push({ id: contact.id, name: contact.name, company: contact.company, kind: contact.kind })
                step(`память контактов · записан ${card.name}${card.company ? ` (${card.company})` : ''}`)
                await log?.('info', 'contact_write', `Нейросеть записала в память: ${card.name}${card.company ? ` (${card.company})` : ''} — формат: ${card.format}`)
              } catch (e) {
                await log?.('warn', 'contact_write_error', `Не удалось записать карточку «${card.name}»: ${e instanceof Error ? e.message : String(e)}`)
              }
            }
          } else if (contacts.length > 0) {
            step(`память контактов · запись закрыта правом · ${contacts.length} карточк${contacts.length === 1 ? 'а' : 'и'} не сохранены`)
          }

          const finalAnswer =
            savedContacts.length > 0
              ? `${cleaned}\n\n**Записано в «Память контактов»:** ${savedContacts
                  .map((c) => `${c.name}${c.company ? ` (${c.company})` : ''}`)
                  .join(', ')} — проверьте и при необходимости поправьте.`
              : cleaned

          // свой список: каждая консультация сохраняется — человек видит в любой момент
          let itemId: string | undefined
          if (ownListOn) {
            const item = await db.aiListItem.create({
              data: {
                kind: 'chat',
                query: message.slice(0, 120),
                answer: finalAnswer.slice(0, 12_000),
                bestJson: best.length > 0 ? JSON.stringify(best) : null,
                cardsJson: cards.length > 0 ? JSON.stringify(cards) : null,
                reportJson: report ? JSON.stringify(report) : null,
                linksJson: links.length > 0 ? JSON.stringify(links) : null,
                engine,
                status: 'done',
              },
            })
            itemId = item.id
            step('список ИИ · разбор записан')
          } else {
            step('список ИИ · закрыт правом · разбор только в чате')
          }

          const assistantMsg = await db.aiChatMessage.create({
            data: {
              userId: auth.id,
              sessionId: session.id,
              role: 'assistant',
              content: finalAnswer.slice(0, 12_000),
              modelKey,
              engine,
              stepsJson: JSON.stringify(steps),
              widgetsJson: JSON.stringify({
                best: best.slice(0, 8),
                cards: cards.slice(0, 6),
                report: report ?? null,
                links: links.slice(0, 5),
                saved: savedContacts.map((c) => `${c.name}${c.company ? `, ${c.company}` : ''}`),
              }),
            },
          })
          step('журнал · ответ записан')

          await log?.('info', 'chat_done', `Ответ выдан (${answer.length} симв.), движок: ${engine}`, {
            engine,
            model,
            latencyMs,
            savedContacts: savedContacts.length,
          })

          emit({
            type: 'done',
            answer: finalAnswer,
            engine,
            model,
            modelKey,
            latencyMs,
            sessionId: session.id,
            savedContacts,
            itemId,
            userMessageId,
            assistantMessageId: assistantMsg.id,
            steps,
            best: best.map((b) => ({ ...b, query: message.slice(0, 200) })),
            cards,
            report,
            links,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          step(`ошибка · ${msg.slice(0, 160)}`)
          await aiLog('error', 'chat_error', `Ошибка ответа: ${msg}`)
          emit({ type: 'error', error: `Нейросеть не ответила: ${msg}` })
        } finally {
          if (!closed) {
            closed = true
            try {
              controller.close()
            } catch {
              /* стрим уже закрыт */
            }
          }
        }
      })()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

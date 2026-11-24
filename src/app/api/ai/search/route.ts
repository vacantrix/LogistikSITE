import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { aiLog, buildRestrictedContext, buildSystemPrompt, getZai } from '@/lib/ai/core'
import { generateMarketPage, type MarketQuery } from '@/lib/kontur/atisu/market-stubs'
import { getTrucks } from '@/lib/kontur/atisu/free'
import { AI_KIND_LABELS } from '@/lib/ai/rights'

export const dynamic = 'force-dynamic'

type SearchMode = 'load' | 'truck' | 'both'
const MODES: SearchMode[] = ['load', 'truck', 'both']

/**
 * POST /api/ai/search — «что найти» по бирже ATI.SU: грузы, машины или и то и другое.
 * Нейросеть ВИДИТ оба вида поиска: демо-выдачу грузов витрины и (при подключённом
 * ATI.SU) машины фирмы. Разбор сохраняется в её собственный список — человек может
 * посмотреть список в любой момент, а последний разбор выводится сразу после
 * выполнения запроса. Больше нейросеть ничего писать не может (жёсткие права).
 */
export async function POST(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  const body = (await req.json().catch(() => null)) as { mode?: unknown; query?: unknown; from?: unknown; to?: unknown; budget?: unknown } | null
  const rawMode = typeof body?.mode === 'string' ? body.mode : ''
  const mode: SearchMode = (MODES as string[]).includes(rawMode) ? rawMode as SearchMode : 'both'
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  const from = typeof body?.from === 'string' ? body.from.trim() : ''
  const to = typeof body?.to === 'string' ? body.to.trim() : ''
  const budget = typeof body?.budget === 'string' ? body.budget.trim() : ''
  if (!query) return NextResponse.json({ error: 'Опишите, что найти' }, { status: 400 })
  const queryLine = [from && to ? `${from} → ${to}` : (from || to || null), query].filter(Boolean).join(' · ')

  await aiLog('info', 'search_start', `Поиск (${AI_KIND_LABELS[mode] ?? mode}): ${queryLine}`, { mode, from, to, budget })

  // — витрина грузов (демо-режим): то, что нейросеть видит по грузам —
  let marketCtx = ''
  if (mode !== 'truck') {
    try {
      const q: MarketQuery = {
        from,
        to,
        weight: 21,
        volume: 83,
        dateFromToday: true,
        bodies: [],
        payments: [],
        minRate: null,
        minRatePerKm: false,
        hideRegulars: false,
        hideAtd: false,
        showContests: true,
        showAds: false,
        sort: 'updated',
        take: 12,
        fixed: true,
        basePerKm: 42,
        guaranteedShare: 0.35,
        page: 0,
      }
      const page = generateMarketPage(q)
      const lines = page.loads.map((l) =>
        `№${l.code} (ati ${l.ati_id}): ${l.from} → ${l.to}, ${l.km} км; ${l.cargo}, ${l.weight_t} т / ${l.volume_m3} м³; кузов: ${l.bodies.join('/')}; погрузка ${l.date_from}–${l.date_to}; ставка ${l.rate.toLocaleString('ru-RU')} ₽ (${l.per_km} ₽/км без НДС); оплата ${l.payment}`,
      )
      marketCtx = `Выдача витрины грузов по фильтру (демо-режим; всего ${page.total}, показаны ${page.loads.length}):\n${lines.join('\n')}`
    } catch {
      marketCtx = 'Витрина грузов сейчас недоступна — разбор по описанию запроса.'
    }
  }

  // — машины фирмы на бирже: реальный API, доступен только при подключённом ATI.SU —
  let trucksCtx = ''
  if (mode !== 'load') {
    try {
      const trucks = await getTrucks()
      const sample = trucks
        .slice(0, 10)
        .map((t) => JSON.stringify(t))
        .join('; ')
        .slice(0, 3000)
      trucksCtx = `Машины фирмы на бирже (реальный API ATI.SU, всего ${trucks.length}):\n${sample || '—'}`
    } catch {
      trucksCtx = 'Подключения к ATI.SU нет (демо-режим): список машин фирмы недоступен — разбирай запрос по описанию и подскажи человеку, где и как искать машины на бирже.'
    }
  }

  try {
    const ctx = await buildRestrictedContext()
    const market = [marketCtx, trucksCtx].filter(Boolean).join('\n\n')
    const system = buildSystemPrompt({ ...ctx, market })
    const userMsg = [
      `Задача: подобрать ${mode === 'load' ? 'грузы' : mode === 'truck' ? 'перевозчиков (машины)' : 'и грузы, и машины'} на ATI.SU по запросу.`,
      `Запрос: ${query}`,
      from && `Откуда: ${from}`,
      to && `Куда: ${to}`,
      budget && `Бюджет / ориентир ставки: ${budget}`,
      '',
      'Дай разбор по схеме:',
      '1) что ищем — параметры поиска биржи (маршрут, кузов, вес, даты);',
      '2) что видно в витрине по этому запросу (если приложена) — лучшие варианты и на что смотреть;',
      '3) ориентиры по ставке (оценка: ₽ и ₽/км без НДС);',
      '4) риски и красные флаги;',
      '5) план действий и вопросов для звонка;',
      '6) черновик короткого сообщения грузовладельцу/перевозчику.',
    ]
      .filter(Boolean)
      .join('\n')

    const zai = await getZai()
    const completion = await zai.chat.completions.create({
      messages: [{ role: 'assistant', content: system }, { role: 'user', content: userMsg }],
      thinking: { type: 'disabled' },
    })
    const answer = completion.choices[0]?.message?.content ?? ''
    if (!answer.trim()) throw new Error('пустой ответ модели')

    const item = await db.aiListItem.create({
      data: { kind: mode, query: queryLine, answer, status: 'done' },
    })
    await aiLog('info', 'list_write', `Разбор сохранён в список ИИ: ${queryLine}`)
    await aiLog('info', 'search_done', `Разбор выдан (${answer.length} симв.)`)
    return NextResponse.json({ item, answer })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await aiLog('error', 'search_error', `Ошибка поиска: ${msg}`)
    return NextResponse.json({ error: `Нейросеть не справилась с запросом: ${msg}` }, { status: 502 })
  }
}

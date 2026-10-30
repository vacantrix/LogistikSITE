/**
 * GET /api/architecture/status — живые статусы всех контуров платформы
 * для раздела «Архитектура». Только администратор.
 *
 * Каждый сервис опрашивается сервер-сайд с коротким таймаутом (2.5–8 с):
 * статус раздела не должен тормозить интерфейс. Один вызов — один опрос
 * всех сервисов параллельно; фронт повторяет его по кнопке и по таймеру.
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { onecApiKey } from '@/lib/onec'

export const dynamic = 'force-dynamic'

const OCR_BASE = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:3020'
const OCR_TOKEN = process.env.OCR_SERVICE_TOKEN

export interface ServiceStatusItem {
  id: string
  ok: boolean
  /** время ответа, мс (0 — не измерялось) */
  ms: number
  /** человекочитаемая деталь: версия, счётчик, причина отказа */
  detail: string
}

/** Обёртка: замер времени + безопасный перехват */
async function probe(id: string, fn: () => Promise<Omit<ServiceStatusItem, 'ms'>>): Promise<ServiceStatusItem> {
  const t0 = Date.now()
  try {
    const r = await fn()
    return { id, ms: Date.now() - t0, ...r }
  } catch (e) {
    return { id, ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : 'не ответил' }
  }
}

const withTimeout = (ms: number) => AbortSignal.timeout(ms)

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  if (auth.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Раздел доступен только администратору' }, { status: 403 })
  }

  const [web, dbSt, ws, gw, neural, onec] = await Promise.all([
    // веб-платформа: сам факт ответа этого маршрута и есть проверка
    probe('web', async () => ({ ok: true, detail: 'этот запрос обслужен платформой' })),

    // база: реальный запрос SELECT 1 через Prisma
    probe('db', async () => {
      await db.$queryRaw`SELECT 1`
      return { ok: true, detail: 'SELECT 1 выполнен' }
    }),

    // real-time шина: socket.io polling отвечает sid-кадром
    probe('ws', async () => {
      const res = await fetch('http://127.0.0.1:3003/socket.io/?EIO=4&transport=polling', { signal: withTimeout(2500), cache: 'no-store' })
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
      const text = await res.text()
      return { ok: text.includes('sid'), detail: text.includes('sid') ? 'socket.io: сессия выдана' : 'ответ без sid' }
    }),

    // OCR-шлюз: свой health + счётчик обработанных документов
    probe('ocr-gateway', async () => {
      const res = await fetch(`${OCR_BASE}/health`, {
        headers: OCR_TOKEN ? { 'X-OCR-Token': OCR_TOKEN } : {},
        signal: withTimeout(2500),
        cache: 'no-store',
      })
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
      const j = (await res.json()) as { version?: string; processed?: number; uptimeSec?: number }
      const up = j.uptimeSec ?? 0
      const upText = up >= 7200 ? `${Math.round(up / 360) / 10} ч` : `${Math.round(up / 60)} мин`
      return { ok: true, detail: `v${j.version ?? '?'} · документов: ${j.processed ?? 0} · аптайм ${upText}` }
    }),

    // нейросеть на ПК перевозчика: лёгкий health движка через шлюз (без OCR)
    probe('neural', async () => {
      const res = await fetch(`${OCR_BASE}/upstream`, {
        headers: OCR_TOKEN ? { 'X-OCR-Token': OCR_TOKEN } : {},
        signal: withTimeout(10_000),
        cache: 'no-store',
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; ms?: number; engine?: string | null; version?: string | null; error?: string } | null
      if (!res.ok || !j?.ok) return { ok: false, detail: j?.error ?? `шлюз ответил HTTP ${res.status}` }
      return { ok: true, detail: `движок ${j.engine ?? 'PaddleOCR'}${j.version ? ` v${j.version}` : ''} · ответ через туннель ${j.ms ?? '?'} мс` }
    }),

    // шина 1С: ключ задан → интеграция включена (эндпоинты в процессе платформы)
    probe('onec', async () => {
      const key = onecApiKey()
      if (!key) return { ok: false, detail: 'ONEC_API_KEY не задан — интеграция выключена' }
      return { ok: true, detail: `ключ принят (${key.slice(0, 4)}…${key.slice(-4)}) · v1.1.0` }
    }),
  ])

  const items: ServiceStatusItem[] = [web, dbSt, ws, gw, neural, onec]
  return NextResponse.json(
    { ok: true, items, checkedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

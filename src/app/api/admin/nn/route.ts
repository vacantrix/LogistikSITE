import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  NN_LIMITS, DEFAULT_NN, invalidateNnSettings, nnSettings, rowToNn, sanitizeNn,
} from '@/lib/nn'
import { db } from '@/lib/db'
import { clearNnCache, nnCacheStats, nnQueueStats, ocrServiceOcr, ocrServiceStatus } from '@/lib/ocr-service'
import type { DocType } from '@/lib/verify'

export const dynamic = 'force-dynamic'

/** GET /api/admin/nn — настройки нейросети + живая статистика пропуска документов (только админ) */
export async function GET() {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const [row, service] = await Promise.all([
    db.setting.findUnique({
      where: { id: 'main' },
      select: { nnParallel: true, nnTimeoutSec: true, nnCacheMin: true, nnMaxSide: true },
    }),
    ocrServiceStatus(),
  ])
  const saved = rowToNn(row)
  return NextResponse.json({
    settings: saved,
    defaults: DEFAULT_NN,
    limits: NN_LIMITS,
    service,
    queue: nnQueueStats(),
    cache: nnCacheStats(),
    time: new Date().toISOString(),
  })
}

/** PUT /api/admin/nn — сохранить настройки пропуска документов; применяются сразу (кэш 5 с) */
export async function PUT(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })

  const current = await nnSettings()
  const next = sanitizeNn(body, current)

  const data = {
    nnParallel: next.parallel,
    nnTimeoutSec: next.timeoutSec,
    nnCacheMin: next.cacheMin,
    nnMaxSide: next.maxSide,
  }
  const saved = await db.setting.upsert({ where: { id: 'main' }, update: data, create: { id: 'main', ...data } })
  invalidateNnSettings()
  if (next.cacheMin === 0) clearNnCache()

  return NextResponse.json({ settings: rowToNn(saved), limits: NN_LIMITS })
}

/** Демо-сканы платформы для тестового прогона реального пайплайна */
const TEST_DOCS: Record<string, { file: string; label: string }> = {
  PASSPORT_PHOTO: { file: 'passport-photo.jpg', label: 'Паспорт: страница с фото' },
  PASSPORT_REG: { file: 'passport-registration.jpg', label: 'Паспорт: регистрация' },
  STS: { file: 'sts-truck.jpg', label: 'СТС тягача' },
}

/**
 * POST /api/admin/nn — действия:
 *   { action: 'upstream' } — живая проверка ПК нейросети (лёгкий запрос через шлюз, без OCR);
 *   { action: 'test', docType } — реальный прогон демо-скана: платформа → шлюз → GPU-ПК нейросети АЭМЗ;
 *   { action: 'clear-cache' } — сбросить кэш повторных сканов.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as { action?: string; docType?: string; fresh?: boolean } | null
  const action = body?.action

  if (action === 'clear-cache') {
    clearNnCache()
    return NextResponse.json({ ok: true, cache: nnCacheStats() })
  }

  if (action === 'upstream') {
    // тот же запрос делает /api/architecture/status — здесь он нужен по кнопке, без общего опроса
    const BASE = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:3020'
    const TOKEN = process.env.OCR_SERVICE_TOKEN
    if (BASE === '') return NextResponse.json({ ok: false, error: 'OCR-интеграция отключена (OCR_SERVICE_URL=)' })
    const t0 = Date.now()
    try {
      const res = await fetch(`${BASE}/upstream`, {
        headers: TOKEN ? { 'X-OCR-Token': TOKEN } : undefined,
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      })
      const j = (await res.json().catch(() => null)) as {
        ok?: boolean; ms?: number; status?: number; engine?: string | null; version?: string | null; gpu?: string | null; error?: string
      } | null
      return NextResponse.json({
        ok: Boolean(j?.ok),
        ms: j?.ms ?? Date.now() - t0,
        status: j?.status ?? res.status,
        engine: j?.engine ?? null,
        version: j?.version ?? null,
        gpu: j?.gpu ?? null,
        error: j?.error ?? null,
      })
    } catch (e) {
      return NextResponse.json({ ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : 'движок не ответил' })
    }
  }

  if (action === 'test') {
    const docType = (body?.docType && body.docType in TEST_DOCS ? body.docType : 'PASSPORT_PHOTO') as DocType
    const demo = TEST_DOCS[docType]
    const file = path.join(process.cwd(), 'public', 'examples', demo.file)
    let dataUri: string
    try {
      const buf = await readFile(file)
      dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`
    } catch {
      return NextResponse.json({ ok: false, error: `Демо-скан не найден: ${demo.file}` }, { status: 500 })
    }
    const settings = await nnSettings()
    const t0 = Date.now()
    const result = await ocrServiceOcr(dataUri, docType, false, { freshCache: body?.fresh !== false })
    const ms = Date.now() - t0
    if (result.kind === 'ok') {
      const fieldsCount = Object.values(result.ocr.fields).filter((v) => v.trim() !== '').length
      return NextResponse.json({
        ok: true, ms, docType, label: demo.label,
        quality: result.ocr.quality, engine: result.ocr.engine,
        detectedType: result.ocr.detectedType ?? null,
        fieldsCount, fieldsTotal: Object.keys(result.ocr.fields).length,
        settings: { parallel: settings.parallel, timeoutSec: settings.timeoutSec, cacheMin: settings.cacheMin, maxSide: settings.maxSide },
      })
    }
    return NextResponse.json({
      ok: false, ms, docType, label: demo.label,
      error: result.kind === 'unsupported'
        ? 'Вид документа не распознаётся движком (422)'
        : 'Нейросеть не ответила — проверьте ПК нейросети и связь с ним',
      settings: { parallel: settings.parallel, timeoutSec: settings.timeoutSec, cacheMin: settings.cacheMin, maxSide: settings.maxSide },
    })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

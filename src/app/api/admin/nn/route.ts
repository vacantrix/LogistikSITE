import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  NN_LIMITS, DEFAULT_NN, invalidateNnSettings, nnSettings, rowToNn, sanitizeNn,
} from '@/lib/nn'
import { db } from '@/lib/db'
import { ocrTemplates } from '@/lib/ocr-templates'
import { clearNnCache, nnCacheStats, nnQueueStats, ocrServiceOcr, ocrServiceStatus } from '@/lib/ocr-service'
import { plog } from '@/lib/platform-log'
import type { DocType } from '@/lib/verify'

export const dynamic = 'force-dynamic'

/** Ключи и человекочитаемые названия настроек нейросети для журнала событий */
const NN_KEYS = ['parallel', 'timeoutSec', 'cacheMin', 'maxSide', 'detConf', 'recConf', 'autoRotate', 'lang', 'modelSet'] as const
const NN_LABEL: Record<string, string> = {
  parallel: 'параллельная обработка',
  timeoutSec: 'таймаут, с',
  cacheMin: 'кэш повторных сканов, мин',
  maxSide: 'длинная сторона фото, px',
  detConf: 'порог детекции текста',
  recConf: 'порог чтения полей',
  autoRotate: 'автоповорот',
  lang: 'язык модели',
  modelSet: 'набор моделей',
}

/** GET /api/admin/nn — настройки нейросети + живая статистика пропуска документов (только админ) */
export async function GET() {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const [row, service, templates] = await Promise.all([
    db.setting.findUnique({
      where: { id: 'main' },
      select: {
        nnParallel: true, nnTimeoutSec: true, nnCacheMin: true, nnMaxSide: true,
        nnDetConf: true, nnRecConf: true, nnAutoRotate: true, nnLang: true, nnModelSet: true,
      },
    }),
    ocrServiceStatus(),
    ocrTemplates().catch(() => []),
  ])
  const saved = rowToNn(row)
  return NextResponse.json({
    settings: saved,
    defaults: DEFAULT_NN,
    limits: NN_LIMITS,
    templates,
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
    nnDetConf: next.detConf,
    nnRecConf: next.recConf,
    nnAutoRotate: next.autoRotate,
    nnLang: next.lang,
    nnModelSet: next.modelSet,
  }
  const saved = await db.setting.upsert({ where: { id: 'main' }, update: data, create: { id: 'main', ...data } })
  invalidateNnSettings()
  if (next.cacheMin === 0) clearNnCache()

  // журнал: какие настройки нейросети изменились и значения до/после
  const keys: string[] = []
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  const parts: string[] = []
  for (const k of NN_KEYS) {
    if (next[k] !== current[k]) {
      keys.push(k)
      before[k] = current[k]
      after[k] = next[k]
      parts.push(`${NN_LABEL[k]} ${current[k]} → ${next[k]}`)
    }
  }
  await plog({
    type: 'NN_SETTINGS_CHANGED', source: 'api/admin/nn',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: keys.length > 0
      ? `Настройки нейросети изменены: ${parts.join(', ')}`
      : 'Настройки нейросети сохранены без изменений',
    meta: { keys, before, after },
  })

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
 *   { action: 'upstream' } — живая проверка узла нейросети (лёгкий запрос через шлюз, без OCR);
 *   { action: 'test', docType } — реальный прогон демо-скана: платформа → шлюз → нейросеть на серверах АЭМЗ;
 *   { action: 'clear-cache' } — сбросить кэш повторных сканов.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as { action?: string; docType?: string; fresh?: boolean } | null
  const action = body?.action

  if (action === 'clear-cache') {
    clearNnCache()
    await plog({
      type: 'NN_ACTION', source: 'api/admin/nn',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: 'Действие в разделе «Нейросеть»: сброшен кэш повторных сканов',
      meta: { action: 'clear-cache' },
    })
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
      // журнал: живая проверка узла нейросети с результатом (успех/сбой, версия)
      await plog({
        type: 'NN_ACTION', source: 'api/admin/nn',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        message: `Действие в разделе «Нейросеть»: проверка узла нейросети — ${j?.ok ? 'успех' : 'сбой'}${j?.version ? `, версия ${j.version}` : ''} (${j?.ms ?? Date.now() - t0} мс)`,
        meta: {
          action: 'upstream',
          ok: Boolean(j?.ok),
          ms: j?.ms ?? Date.now() - t0,
          status: j?.status ?? res.status,
          engine: j?.engine ?? null,
          version: j?.version ?? null,
          gpu: j?.gpu ?? null,
          error: j?.error ?? null,
        },
      })
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
      // журнал: узел нейросети не ответил
      await plog({
        type: 'NN_ACTION', source: 'api/admin/nn',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        message: `Действие в разделе «Нейросеть»: проверка узла нейросети — сбой (${e instanceof Error ? e.message : 'движок не ответил'})`,
        meta: { action: 'upstream', ok: false, ms: Date.now() - t0 },
      })
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
      // журнал: тестовый прогон демо-скана прошёл реальный пайплайн
      await plog({
        type: 'NN_ACTION', source: 'api/admin/nn',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        message: `Действие в разделе «Нейросеть»: тестовый прогон «${demo.label}» — успех (качество ${result.ocr.quality}, полей распознано ${fieldsCount} из ${Object.keys(result.ocr.fields).length}, ${ms} мс)`,
        meta: {
          action: 'test',
          docType,
          label: demo.label,
          ok: true,
          ms,
          quality: result.ocr.quality,
          engine: result.ocr.engine,
          detectedType: result.ocr.detectedType ?? null,
          fieldsCount,
        },
      })
      return NextResponse.json({
        ok: true, ms, docType, label: demo.label,
        quality: result.ocr.quality, engine: result.ocr.engine,
        detectedType: result.ocr.detectedType ?? null,
        fieldsCount, fieldsTotal: Object.keys(result.ocr.fields).length,
        settings: {
            parallel: settings.parallel, timeoutSec: settings.timeoutSec, cacheMin: settings.cacheMin, maxSide: settings.maxSide,
            detConf: settings.detConf, recConf: settings.recConf, autoRotate: settings.autoRotate,
            lang: settings.lang, modelSet: settings.modelSet,
          },
      })
    }
    const failReason = result.kind === 'unsupported'
      ? 'Вид документа не распознаётся движком (шаблон отключён или вид незнаком)'
      : 'PaddleOCR не ответил — проверьте узел распознавания и связь с ним'
    // журнал: тестовый прогон не удался
    await plog({
      type: 'NN_ACTION', source: 'api/admin/nn',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Действие в разделе «Нейросеть»: тестовый прогон «${demo.label}» — сбой (${failReason})`,
      meta: { action: 'test', docType, label: demo.label, ok: false, ms },
    })
    return NextResponse.json({
      ok: false, ms, docType, label: demo.label,
      error: failReason,
      settings: {
            parallel: settings.parallel, timeoutSec: settings.timeoutSec, cacheMin: settings.cacheMin, maxSide: settings.maxSide,
            detConf: settings.detConf, recConf: settings.recConf, autoRotate: settings.autoRotate,
            lang: settings.lang, modelSet: settings.modelSet,
          },
    })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

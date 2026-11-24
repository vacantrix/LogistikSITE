import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  AI_RIGHTS_LOCKED, aiLog, getAiRights, invalidateAiRightsCache,
} from '@/lib/ai/core'
import { AI_RIGHT_MODE_LABELS } from '@/lib/ai/rights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ai/rights — действующая матрица прав ИИ (значения по умолчанию
 * + переопределения администратора). Читают все: в разделе «Права» чата
 * видно, что нейросети сейчас разрешено.
 *
 * PUT /api/ai/rights — изменить режим права. Только АДМИНИСТРАТОР.
 * Тело: {key: 'contacts-read', mode: 'read-partial'}.
 * Право применяется к следующим вопросам сразу (промпт и контекст собираются
 * по новой матрице); смена фиксируется в журнале нейросети.
 * Права platform-write и personal зашиты в платформу — редактирование
 * отклоняется (безопасность: персональные данные и изменения платформы
 * недоступны модели всегда).
 */

export async function GET() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const rights = await getAiRights()
  return NextResponse.json({
    rights: rights.map((r) => ({ ...r })),
    locked: [...AI_RIGHTS_LOCKED],
    editable: auth.role === 'admin',
  })
}

export async function PUT(req: Request) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as { key?: unknown; mode?: unknown } | null
  const key = typeof body?.key === 'string' ? body.key : ''
  const mode = typeof body?.mode === 'string' ? body.mode : ''
  if (!AI_RIGHT_MODE_LABELS[mode as keyof typeof AI_RIGHT_MODE_LABELS]) {
    return NextResponse.json({ error: 'Неизвестный режим права' }, { status: 400 })
  }

  const rights = await getAiRights()
  const target = rights.find((r) => r.key === key)
  if (!target) return NextResponse.json({ error: 'Неизвестное право' }, { status: 404 })
  if (AI_RIGHTS_LOCKED.has(key)) {
    return NextResponse.json({ error: 'Право зашито в платформу и не редактируется' }, { status: 403 })
  }
  if (target.mode === mode) {
    return NextResponse.json({ rights })
  }

  try {
    await db.aiRight.upsert({
      where: { key },
      update: { mode, updatedBy: auth.login },
      create: { key, mode, updatedBy: auth.login },
    })
    invalidateAiRightsCache()
    await aiLog('info', 'rights_update', `Администратор ${auth.login} изменил право «${target.title}»: ${AI_RIGHT_MODE_LABELS[target.mode]} → ${AI_RIGHT_MODE_LABELS[mode as keyof typeof AI_RIGHT_MODE_LABELS]}`)
    const fresh = await getAiRights()
    return NextResponse.json({ rights: fresh.map((r) => ({ ...r })) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось сохранить право' }, { status: 500 })
  }
}

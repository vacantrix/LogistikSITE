import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { toSettingsDTO } from '@/lib/settings'

export const dynamic = 'force-dynamic'

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
const num = (v: unknown): number | null => {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? null : n
}

/** GET /api/settings — пороги уверенности и правила проверки (только логист) */
export async function GET() {
  const auth = await requireUser('logist')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(toSettingsDTO(await db.setting.findUnique({ where: { id: 'main' } })))
}

/** PUT /api/settings — обновить пороги и правила (только логист) */
export async function PUT(req: NextRequest) {
  const auth = await requireUser('logist')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })
  const current = toSettingsDTO(await db.setting.findUnique({ where: { id: 'main' } }))

  const cr = num(body.confReupload)
  const cj = num(body.confReject)
  const ca = num(body.confAuto)
  const mq = num(body.minQuality)
  const confReupload = cr != null ? clamp(cr, 0.3, 0.9) : current.confReupload
  // порог отказа — отдельная настройка: не ниже порога перезагрузки, не выше 0.999
  const confReject = cj != null ? clamp(cj, confReupload, 0.999) : Math.max(current.confReject, confReupload)
  const confAuto = ca != null ? clamp(ca, confReupload + 0.01, 0.999) : current.confAuto
  const minQuality = mq != null ? clamp(Math.round(mq), 10, 95) : current.minQuality
  const rules: Record<string, string> = { ...current.rules }
  if (body.rules && typeof body.rules === 'object' && !Array.isArray(body.rules)) {
    for (const [k, v] of Object.entries(body.rules as Record<string, unknown>).slice(0, 50)) {
      if (typeof v === 'string') rules[k.slice(0, 64)] = v.slice(0, 500)
    }
  }

  const data = { confReupload, confReject, confAuto, minQuality, rules: JSON.stringify(rules) }
  const saved = await db.setting.upsert({ where: { id: 'main' }, update: data, create: { id: 'main', ...data } })
  return NextResponse.json(toSettingsDTO(saved))
}

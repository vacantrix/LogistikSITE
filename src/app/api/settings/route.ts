import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { SettingsDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

function parse(row: { confReupload: number; confAuto: number; minQuality: number; rules: string } | null): SettingsDTO {
  return {
    confReupload: row?.confReupload ?? 0.6,
    confAuto: row?.confAuto ?? 0.95,
    minQuality: row?.minQuality ?? 60,
    rules: row ? JSON.parse(row.rules) : {},
  }
}

/** GET /api/settings — пороги уверенности и правила проверки */
export async function GET() {
  const row = await db.setting.findUnique({ where: { id: 'main' } })
  return NextResponse.json(parse(row))
}

/** PUT /api/settings — обновить пороги и правила */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })
  const current = parse(await db.setting.findUnique({ where: { id: 'main' } }))

  const confReupload = body.confReupload != null ? Math.min(Math.max(Number(body.confReupload), 0.3), 0.9) : current.confReupload
  const confAuto = body.confAuto != null ? Math.min(Math.max(Number(body.confAuto), confReupload + 0.01), 0.999) : current.confAuto
  const minQuality = body.minQuality != null ? Math.min(Math.max(Math.round(Number(body.minQuality)), 10), 95) : current.minQuality
  const rules = body.rules && typeof body.rules === 'object' ? { ...current.rules, ...body.rules } : current.rules

  const saved = await db.setting.upsert({
    where: { id: 'main' },
    update: { confReupload, confAuto, minQuality, rules: JSON.stringify(rules) },
    create: { id: 'main', confReupload, confAuto, minQuality, rules: JSON.stringify(rules) },
  })
  return NextResponse.json(parse(saved))
}

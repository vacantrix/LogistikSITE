import { NextResponse } from 'next/server'
import { AtiError } from '@/lib/kontur/atisu/client'
import { DICTIONARIES, getDictionary, type DictionaryName } from '@/lib/kontur/atisu/free'

export const dynamic = 'force-dynamic'

// Словарь ATI.SU: GET /api/atisu/dictionaries?name=cargoTypes
// name валидируется по белому списку, всё остальное — 400.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name') ?? ''
  if (!(DICTIONARIES as readonly string[]).includes(name)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: `name должен быть одним из: ${DICTIONARIES.join(', ')}` } },
      { status: 400 }
    )
  }
  try {
    const items = await getDictionary(name as DictionaryName)
    return NextResponse.json({ name, count: items.length, items })
  } catch (e) {
    const message = e instanceof AtiError ? `${e.status}: ${e.message}` : 'Сервис ATI.SU недоступен'
    return NextResponse.json({ error: { code: 'ATISU', message } }, { status: 502 })
  }
}

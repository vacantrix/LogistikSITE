import { NextRequest, NextResponse } from 'next/server'
import { ONEC_VERSION, onecAuthorized, onecUnauthorized } from '@/lib/onec'

export const dynamic = 'force-dynamic'

/** GET /api/integration/1c/ping — проверка связи и API-ключа из 1С */
export async function GET(req: NextRequest) {
  if (!onecAuthorized(req)) return onecUnauthorized()
  return NextResponse.json({
    ok: true,
    service: 'АЭМЗ Логистика — шина интеграции 1С',
    version: ONEC_VERSION,
    time: new Date().toISOString(),
    queue: ['справочники', 'заявки/рейсы + статусы', 'ЭТрН'],
  })
}

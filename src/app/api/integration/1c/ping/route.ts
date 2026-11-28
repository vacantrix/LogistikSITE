import { NextRequest, NextResponse } from 'next/server'
import { ONEC_VERSION, onecAuthorized, onecPreflight, onecUnauthorized, withOnecCors } from '@/lib/onec'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/** GET /api/integration/1c/ping — проверка связи и API-ключа из 1С */
export async function GET(req: NextRequest) {
  return withOnecCors(req, await ping(req))
}

export function OPTIONS(req: NextRequest) {
  return onecPreflight(req, 'GET')
}

async function ping(req: NextRequest): Promise<NextResponse> {
  if (!onecAuthorized(req)) {
    // в журнал: попытка проверки связи с неверным или отсутствующим API-ключом
    await plog({
      level: 'WARN', type: '1C_PING_DENIED', source: 'api/integration/1c/ping',
      message: 'Проверка связи с 1С отклонена: неверный или отсутствующий API-ключ',
      meta: { ok: false, version: ONEC_VERSION },
    })
    return onecUnauthorized()
  }
  // в журнал: ручная проверка связи с 1С прошла успешно
  await plog({
    type: '1C_PING', source: 'api/integration/1c/ping',
    message: `Проверка связи с 1С: успех (версия шины ${ONEC_VERSION})`,
    meta: { ok: true, version: ONEC_VERSION },
  })
  return NextResponse.json({
    ok: true,
    service: 'АЭМЗ Поток — шина интеграции 1С',
    version: ONEC_VERSION,
    time: new Date().toISOString(),
    queue: ['справочники', 'заявки/рейсы + статусы', 'ЭТрН'],
  })
}

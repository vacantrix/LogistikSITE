import { NextRequest, NextResponse } from 'next/server'
import { ONEC_API_KEY, ONEC_ETRN_RU, ONEC_VERSION } from '@/lib/onec'

export const dynamic = 'force-dynamic'

/** GET /api/integration/1c/info — параметры подключения для карточки «Интеграция с 1С» (Настройки) */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  return NextResponse.json({
    ok: true,
    version: ONEC_VERSION,
    apiKey: ONEC_API_KEY,
    baseUrl: `${origin}/api/integration/1c`,
    authHeader: 'X-API-Key',
    etrnValues: Object.entries(ONEC_ETRN_RU).map(([value, label]) => ({ value, label })),
    endpoints: [
      { method: 'GET', path: '/ping', summary: 'Проверка связи и API-ключа' },
      { method: 'GET', path: '/dictionaries?since=ISO', summary: 'Справочники: перевозчики, водители, тягачи, прицепы (since — инкрементально)' },
      { method: 'GET', path: '/requests?status=&since=&limit=', summary: 'Заявки/рейсы со статусами, экипажами и ставками' },
      { method: 'GET', path: '/etrn?number=&since=', summary: 'Данные ЭТрН по рейсам с экипажем' },
      { method: 'POST', path: '/etrn', summary: 'Подтверждение ЭТрН из 1С: { number, etrnStatus: SENT | SIGNED }' },
    ],
  })
}

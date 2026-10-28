import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { ONEC_ETRN_RU, ONEC_VERSION, onecKeyMasked } from '@/lib/onec'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integration/1c/info — параметры подключения для карточки «Интеграция с 1С» (Настройки).
 * Внутренний контур (логист и администрация); сам ключ не отдаётся — лишь маска
 * (полный ключ хранится в настройках сервера).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const origin = req.nextUrl.origin
  const masked = onecKeyMasked()
  return NextResponse.json({
    ok: true,
    version: ONEC_VERSION,
    configured: masked !== null,
    apiKeyMasked: masked,
    baseUrl: `${origin}/api/integration/1c`,
    authHeader: 'X-API-Key',
    etrnValues: Object.entries(ONEC_ETRN_RU).map(([value, label]) => ({ value, label })),
    endpoints: [
      { method: 'GET', path: '/ping', summary: 'Проверка связи и API-ключа' },
      { method: 'GET', path: '/dictionaries?since=ISO', summary: 'Справочники: перевозчики, водители, тягачи, прицепы (since — новые и изменённые)' },
      { method: 'GET', path: '/requests?status=&since=&limit=&onecRef=', summary: 'Заявки/рейсы со статусами, экипажами и ставками (onecRef — по документу 1С)' },
      { method: 'POST', path: '/requests', summary: 'Черновик заявки из 1С: { oneC_number, fromPoint, toPoint, cargo, loadDate, tonnage, truckType, startRate ₽/т } — повтор по oneC_number не создаёт дубль' },
      { method: 'GET', path: '/etrn?number=&since=', summary: 'Данные ЭТрН по рейсам с экипажем' },
      { method: 'POST', path: '/etrn', summary: 'Подтверждение ЭТрН из 1С: { number, etrnStatus: SENT | SIGNED }' },
    ],
  })
}

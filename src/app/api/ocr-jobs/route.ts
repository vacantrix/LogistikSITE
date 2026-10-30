import { NextRequest, NextResponse } from 'next/server'
import { isStaff, requireUser } from '@/lib/auth'
import { getOcrJob } from '@/lib/ocr-jobs'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ocr-jobs?id=… — статус фоновой задачи распознавания.
 * Долгие нейрооперации (водители, техника, проверка документов) выполняются в фоне:
 * POST-маршруты возвращают { jobId }, клиент короткими запросами опрашивает этот
 * маршрут, пока статус не станет done/error — длинные ответы шлюз не успевает оборвать.
 * Аудит №4: не-staff видит только свои задачи (результат содержит персональные данные).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'Не указан id задачи' }, { status: 400 })

  const job = getOcrJob(id, { login: auth.login, staff: isStaff(auth.role) })
  if (!job) {
    // рестарт сервера или прошло больше 15 минут — просим клиента повторить операцию
    return NextResponse.json({ error: 'Задача распознавания истекла — повторите операцию' }, { status: 404 })
  }
  return NextResponse.json({
    status: job.status,
    result: job.result ?? null,
    error: job.error ?? null,
  })
}

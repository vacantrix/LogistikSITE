import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/kontur/auth'
import { buildVehicleHint, type VehicleHintInput } from '@/lib/kontur/atisu/vehicle-hint'

export const dynamic = 'force-dynamic'

// Подсказка «кому из парка отдать груз с ATI.SU» (обратные рейсы).
// POST — расчёт выполняется ТОЛЬКО по этой команде: кнопка «Подбор водителя» на
// карточке груза/заявки. Для выдачи грузов и листания биржи сервер ничего не
// считает — один клик = один расчёт по базе парка.
//
// Тело — параметры груза, которые клиент уже знает из карточки:
//   { from, to, dateFrom, dateTo, weightT, volumeM3, rate, perKm, km, cargo }
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Требуется вход в кабинет' } }, { status: 401 })
  }
  try {
    const body = (await req.json()) as VehicleHintInput
    const result = await buildVehicleHint(body ?? {})
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'HINT', message: e instanceof Error ? e.message : 'Не удалось посчитать подбор' } },
      { status: 400 },
    )
  }
}

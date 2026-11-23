import { NextResponse } from 'next/server'
import { runStub, type PaidServiceId } from '@/lib/kontur/atisu/paid-stubs'

export const dynamic = 'force-dynamic'

const SERVICES: PaidServiceId[] = ['truck_search', 'active_carriers', 'avg_rates', 'distance', 'geocoding', 'nearest_cities']

// Платные сервисы ATI.SU — ЗАГЛУШКА: GET /api/atisu/stub?service=avg_rates&from=...&to=...
// Реальные запросы к api.ati.su НЕ отправляются — только правдоподобные демо-данные
// с метаданными сервиса (цена, назначение). Активация — после оплаты подписки.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const service = searchParams.get('service') ?? ''
  if (!SERVICES.includes(service as PaidServiceId)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: `service должен быть одним из: ${SERVICES.join(', ')}` } },
      { status: 400 }
    )
  }
  const result = runStub(service as PaidServiceId, {
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    weight: searchParams.get('weight') ? Number(searchParams.get('weight')) : undefined,
    km: searchParams.get('km') ? Number(searchParams.get('km')) : undefined,
    address: searchParams.get('address') ?? undefined,
    city: searchParams.get('city') ?? undefined,
    radiusKm: searchParams.get('radiusKm') ? Number(searchParams.get('radiusKm')) : undefined,
  })
  return NextResponse.json(result)
}

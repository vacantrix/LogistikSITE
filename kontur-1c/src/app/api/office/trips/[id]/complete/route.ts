// Принудительное завершение рейса диспетчером — закрытие «зависшего» рейса,
// когда водитель не завершил его в приложении (в т.ч. тестовые данные).
// После завершения водитель освобождается и может получить новую заявку.
import { jsonOffice } from '@/lib/cors'
import { forceCompleteTrip } from '@/lib/1c/forceComplete'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { actor?: string }
  try {
    body = (await req.json()) as { actor?: string }
  } catch {
    body = {}
  }
  const result = await forceCompleteTrip(id, body?.actor ?? 'Диспетчер')
  if (!result.ok) return jsonOffice(result, 400)
  return jsonOffice(result)
}

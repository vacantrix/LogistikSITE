// Демо-панель: случайная заявка, автопрогон сквозного сценария, сброс и пересев
import { jsonOffice } from '@/lib/cors'
import { createRandomRequest, autoflow, resetAndSeed, type AutoflowStep } from '@/lib/1c/demos'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  switch (body.action) {
    case 'random-request': {
      const r = await createRandomRequest()
      return jsonOffice({ ok: true, message: `Создана заявка ${r.number} (DISPATCH)`, number: r.number })
    }
    case 'autoflow': {
      const log: AutoflowStep[] = await autoflow()
      const failed = log.filter((l) => !l.ok)
      return jsonOffice({ ok: failed.length === 0, log })
    }
    case 'reset': {
      await resetAndSeed()
      return jsonOffice({ ok: true, message: 'База сброшена и пересеяна демо-данными' })
    }
    default:
      return jsonOffice({ ok: false, error: 'Действие: random-request | autoflow | reset' }, 400)
  }
}

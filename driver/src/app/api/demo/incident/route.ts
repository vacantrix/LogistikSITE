import { NextResponse } from 'next/server'
import { runOfficeIncident } from '@/lib/server/appliers'
import { ensureSeeded } from '@/lib/server/seed'

/**
 * POST /api/demo/incident — демо-кнопка «офис меняет выгрузку»:
 * правка точки + сообщение диспетчера + системное уведомление,
 * всё — через sync_journal, к водителю придёт по pull с курсором.
 * В проде то же делает веб-часть платформы через SyncJournalWriter
 * (интеграционные точки №1–3 в README каркаса).
 */
export async function POST() {
  await ensureSeeded()
  const result = await runOfficeIncident()
  return NextResponse.json({ ok: true, ...result })
}

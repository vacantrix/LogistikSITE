// Отдача фото предрейсового осмотра. Каждый просмотр фиксируется в журнале регистрации
// (PHOTO_VIEW) — 152-ФЗ, ст. 18.1 и 19 (организационные и технические меры).
import { readFile } from 'fs/promises'
import { db } from '@/lib/db'
import { logEvent } from '@/lib/1c/journal'
import { photoPath } from '@/lib/photos'

export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const filePath = photoPath(name)
  if (!filePath) return new Response('Not found', { status: 404 })
  try {
    const data = await readFile(filePath)
    await logEvent(db, { user: 'Диспетчер', action: 'PHOTO_VIEW', entity: 'PreTripStep', entityId: name })
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

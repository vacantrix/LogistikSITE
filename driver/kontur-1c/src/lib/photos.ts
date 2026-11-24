// Хранение фото предрейсового осмотра: локальные файлы в uploads/, отдача через /api/office/files/…
// В журнал регистрации пишется только факт (PHOTO_VIEW), не содержимое (152-ФЗ, минимизация).
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const UPLOAD_DIR = process.env.AZMZ_UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')

export async function savePhotoDataUrl(dataUrl: string): Promise<string | null> {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg')
  const name = `${randomUUID()}.${ext}`
  try {
    await mkdir(UPLOAD_DIR, { recursive: true })
    await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'))
    return `/api/office/files/${name}`
  } catch {
    return null
  }
}

export function photoPath(name: string): string | null {
  if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)) return null
  return path.join(UPLOAD_DIR, name)
}

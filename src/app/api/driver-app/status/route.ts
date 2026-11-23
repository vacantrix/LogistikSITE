import { NextResponse } from 'next/server'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { requireUser } from '@/lib/auth'

/**
 * GET /api/driver-app/status — состояние модуля водителя для панели
 * «Приложение водителя». Панель не ходит в сервис водителя напрямую:
 * платформа проверяет его сама (localhost), поэтому наружу не нужен
 * отдельный порт и лишняя авторизация.
 */
export const dynamic = 'force-dynamic'

// Next-модуль водителя живёт с basePath /driver — его API тоже под префиксом.
const DRIVER_API = (process.env.DRIVER_API_URL ?? 'http://127.0.0.1:3102/driver/api/driver/v1').replace(/\/$/, '')

type DriverStatus = {
  ok?: boolean
  service?: string
  version?: string
  driverId?: string
  trips?: number
  activeTrips?: number
  events?: number
  journalSeq?: number
  pendingOutbox?: number
  position?: { lat: number; lon: number; speedKmh?: number; heading?: number; tripCode?: string; ts?: number; receivedAt?: number } | null
  now?: number
}

export async function GET() {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  let status: DriverStatus | null = null
  let error = ''
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3500)
    const res = await fetch(`${DRIVER_API}/status`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    status = (await res.json()) as DriverStatus
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  let apk: { url: string; size: number; updatedAt: number | null } = {
    url: '/dl/Drivemobile.apk',
    size: 0,
    updatedAt: null,
  }
  try {
    const info = await stat(path.join(process.cwd(), 'publish', 'portal', 'dl', 'Drivemobile.apk'))
    apk = { ...apk, size: info.size, updatedAt: info.mtimeMs }
  } catch {
    // файл ещё не опубликован — панель покажет «скачать» и честный 404
  }

  return NextResponse.json(
    {
      service: status ? 'online' : 'offline',
      error: status ? '' : error || 'Сервис водителя не отвечает',
      status,
      links: {
        web: '/driver',
        api: '/api/driver/v1/',
        apk: apk.url,
      },
      apk,
      now: Date.now(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

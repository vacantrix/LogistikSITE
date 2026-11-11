import { NextResponse } from 'next/server'

/**
 * GET /api/2gis/mapkey — отдаёт ключ MapGL JS API клиенту в рантайме.
 *
 * Почему так, а не NEXT_PUBLIC_2GIS_KEY в бандле:
 *  1. Ключ меняется в .env без перекомпиляции клиента (инлайн NEXT_PUBLIC_*
 *     «запекается» при первом билде модуля и устаревает).
 *  2. Один источник истины: 2GIS_API_KEY — и для серверного прокси Routing API,
 *     и для клиентской карты. Ключ MapGL всё равно публичный (браузерный),
 *     ограничение — по доменам в Platform Manager.
 */
export function GET() {
  const key = process.env['2GIS_API_KEY'] || process.env.NEXT_PUBLIC_2GIS_KEY || ''
  return NextResponse.json(
    { key },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// CORS для интеграционных слоёв /api/1c/* и /api/driver/v1/*.
// Разрешённый источник приложения водителя — env DRIVER_APP_ORIGIN (в демо '*').
const allowOrigin =
  process.env.DRIVER_APP_ORIGIN && process.env.DRIVER_APP_ORIGIN.length > 0
    ? process.env.DRIVER_APP_ORIGIN
    : '*'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': allowOrigin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Driver-Id',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders, ...headers },
  })
}

export function optionsOk(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

export const jsonOfficeHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

export function jsonOffice(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonOfficeHeaders })
}

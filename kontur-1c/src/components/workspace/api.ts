'use client'

// Клиентские хелперы UI рабочих мест
export async function apiGet<T>(url: string, init?: { headers?: Record<string, string> }): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', headers: init?.headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function apiPost<T>(url: string, body?: unknown, init?: { headers?: Record<string, string> }, method = 'POST'): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; errors?: string[] }
  if (!res.ok) throw new Error(json.errors?.join('; ') || json.error || `HTTP ${res.status}`)
  return json
}

export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export const fmtTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const fmtInterval = (fromIso: string, toIso: string | null): string => {
  const from = new Date(fromIso).getTime()
  const to = toIso ? new Date(toIso).getTime() : Date.now()
  const min = Math.max(0, Math.round((to - from) / 60000))
  const h = Math.floor(min / 60)
  return h > 0 ? `${h} ч ${min % 60} мин` : `${min} мин`
}

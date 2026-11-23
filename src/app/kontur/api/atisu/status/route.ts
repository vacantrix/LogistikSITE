import { NextResponse } from 'next/server'
import { AtiError, atisuConfigured, atisuTokenMeta } from '@/lib/kontur/atisu/client'
import { getBalance, getTrucksCount } from '@/lib/kontur/atisu/free'

export const dynamic = 'force-dynamic'

// Статус интеграции: конфигурация токена + живая проверка (баланс, счётчик машин).
// Сам токен в ответ не попадает (только префикс client_id и срок действия).
export async function GET() {
  const token = atisuTokenMeta()
  if (!atisuConfigured()) {
    return NextResponse.json({ configured: false, token, balance: null, trucksCount: null, live: { ok: false, error: 'ATISU_TOKEN не задан' } })
  }

  const [balanceRes, trucksRes] = await Promise.all([
    getBalance().then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e instanceof AtiError ? `${e.status}: ${e.message}` : String(e) })
    ),
    getTrucksCount().then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e instanceof AtiError ? `${e.status}: ${e.message}` : String(e) })
    ),
  ])

  return NextResponse.json({
    configured: true,
    token,
    balance: balanceRes.ok ? balanceRes.value : null,
    trucksCount: trucksRes.ok ? trucksRes.value : null,
    live: {
      ok: balanceRes.ok,
      error: balanceRes.ok ? null : balanceRes.error,
    },
    trucksError: trucksRes.ok ? null : trucksRes.error,
  })
}

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { notifyCarrier } from '@/lib/notify-users'
import { plog } from '@/lib/platform-log'
import { expiryInfo } from '@/lib/expiry'
import { allowedFor, permDenied } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/notifications/doc-expiry — кнопка «Уведомить агента» в блоке
 * «Сроки документов» (Справочники). Берёт ту же выборку, что показывает блок
 * (техосмотр тягачей и прицепов: истёк или истекает ≤ 30 дней — пороги lib/expiry),
 * и рассылает каждому затронутому перевозчику уведомление в личный кабинет.
 * Повторная отправка одному перевозчику в тот же день не дублируется.
 * Уведомления создаются вне транзакции (правило P1008 — здесь транзакции нет вовсе).
 */
export async function POST() {
  const user = await requireUser()
  if (user instanceof NextResponse) return user
  // права (Task 111): рассылка — право notify:agent (по умолчанию только логист)
  if (!(await allowedFor(user, 'notify:agent'))) {
    return NextResponse.json({ error: permDenied('notify:agent') }, { status: 403 })
  }

  const [trucks, trailers] = await Promise.all([
    db.truck.findMany({ select: { brand: true, plate: true, techTill: true, carrierId: true } }),
    db.trailer.findMany({ select: { type: true, plate: true, techTill: true, carrierId: true } }),
  ])

  const bad = (date?: string | null) => {
    const info = expiryInfo(date)
    return info.state === 'expired' || info.state === 'warn' ? info : null
  }
  const byCarrier = new Map<string, string[]>()
  const push = (carrierId: string | null, line: string) => {
    if (!carrierId || !line) return
    const list = byCarrier.get(carrierId) ?? []
    list.push(line)
    byCarrier.set(carrierId, list)
  }
  for (const t of trucks) {
    const info = bad(t.techTill)
    if (info) push(t.carrierId, `${t.brand} · ${t.plate} — техосмотр: ${info.label}`)
  }
  for (const z of trailers) {
    const info = bad(z.techTill)
    if (info) push(z.carrierId, `${z.type} · ${z.plate} — техосмотр: ${info.label}`)
  }

  if (byCarrier.size === 0) {
    return NextResponse.json({ notified: [], skipped: [] })
  }

  const carrierIds = [...byCarrier.keys()]
  const [carriers, users] = await Promise.all([
    db.carrier.findMany({ where: { id: { in: carrierIds } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { carrierId: { in: carrierIds }, role: 'carrier' }, select: { id: true, carrierId: true } }),
  ])
  const nameOf = new Map(carriers.map((c) => [c.id, c.name]))

  // дедуп на день: кому уведомление этого типа уже уходило сегодня — пропускаем
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const recent = await db.notification.findMany({
    where: { userId: { in: users.map((u) => u.id) }, type: 'DOC_EXPIRY', createdAt: { gte: todayStart } },
    select: { userId: true },
  })
  const alreadyToday = new Set(recent.map((r) => r.userId))

  const notified: string[] = []
  const skipped: string[] = []
  for (const [carrierId, lines] of byCarrier) {
    const name = nameOf.get(carrierId) ?? 'Перевозчик'
    const targets = users.filter((u) => u.carrierId === carrierId)
    if (targets.length === 0 || targets.every((u) => alreadyToday.has(u.id))) {
      skipped.push(name)
      continue
    }
    await notifyCarrier(carrierId, {
      type: 'DOC_EXPIRY',
      title: 'Проверьте документы техники',
      body: `Сроки документов истекли или истекают в ближайшие 30 дней: ${lines.join('; ')}. Свежие документы загрузите в разделе «Справочники».`,
    })
    notified.push(name)
  }

  await plog({
    type: 'DOC_EXPIRY_NOTIFIED',
    source: 'api/notifications/doc-expiry',
    actor: { login: user.login, name: user.name, role: user.role },
    message: notified.length > 0
      ? `Рассылка о сроках документов отправлена: ${notified.join(', ')}${skipped.length > 0 ? ` (уже уведомлены сегодня: ${skipped.join(', ')})` : ''}`
      : `Рассылка о сроках документов: получателей нет${skipped.length > 0 ? ` (уже уведомлены сегодня: ${skipped.join(', ')})` : ''}`,
  })

  return NextResponse.json({ notified, skipped })
}

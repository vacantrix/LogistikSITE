import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireUser, viewerOf } from '@/lib/auth'
import { REQUEST_INCLUDE, toRequestDTO } from '@/lib/serialize'
import { finalizeExpired, money, parseRuDate, requestWhereFor } from '@/lib/requests'
import { notifyLive } from '@/lib/notify'
import { plog, plogError } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

const STATUSES = ['PUBLISHED', 'AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED', 'DELETED']
const MODES = ['AUCTION', 'CLOSED']
const MAX_DEADLINE_HOURS = 30 * 24

/** GET /api/requests — список заявок (фильтры: status, mode, q; includeDeleted=1 — только для логиста).
 *  Удалённые заявки (Task 65) по умолчанию скрыты от всех — их показывает только «Реестр заявок». */
export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const viewer = viewerOf(auth)

  await finalizeExpired()

  const sp = req.nextUrl.searchParams
  const where: Prisma.RequestWhereInput[] = [requestWhereFor(viewer)]
  const status = sp.get('status')
  const mode = sp.get('mode')
  const q = sp.get('q')?.trim().slice(0, 100)
  const includeDeleted = sp.get('includeDeleted') === '1' && viewer.role === 'logist'
  if (!includeDeleted) where.push({ status: { not: 'DELETED' } })
  if (status && STATUSES.includes(status)) where.push({ status })
  if (mode && MODES.includes(mode)) where.push({ mode })
  if (q) {
    where.push({
      OR: [
        { number: { contains: q } },
        { cargo: { contains: q } },
        { fromPoint: { contains: q } },
        { toPoint: { contains: q } },
      ],
    })
  }
  const requests = await db.request.findMany({
    where: { AND: where },
    include: REQUEST_INCLUDE,
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ requests: requests.map((r) => toRequestDTO(r, viewer)) })
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Следующий номер заявки: максимум по числовой части (строковое сравнение ломалось после Z-9999) */
async function nextNumber(): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint | number | null }[]>`
    SELECT MAX(CAST(SUBSTR(number, 3) AS INTEGER)) AS n FROM "Request" WHERE number LIKE 'Z-%'`
  const max = Number(rows[0]?.n ?? 1000)
  return (Number.isFinite(max) ? Math.max(max, 1000) : 1000) + 1
}

/** POST /api/requests — логист публикует заявку */
export async function POST(req: NextRequest) {
  const auth = await requireUser('logist')
  if (auth instanceof NextResponse) return auth
  const viewer = viewerOf(auth)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })

  const fromPoint = str(body.fromPoint, 300)
  const toPoint = str(body.toPoint, 300)
  const cargoTypeId = str(body.cargoTypeId, 64) || null
  const truckType = str(body.truckType, 40) || 'Тент'
  const loadWindow = str(body.loadWindow, 40) || '08:00–12:00'
  const loadDateRaw = str(body.loadDate, 20)
  const mode = body.mode == null || body.mode === '' ? 'AUCTION' : body.mode
  const startRate = Number(body.startRate)
  const tonnage = body.tonnage == null || body.tonnage === '' ? 20 : Number(body.tonnage)
  // комментарий для исполнителя (Task 64)
  const comment = str(body.comment, 1000)

  // груз берём из справочника (единое имя) — свободный текст больше не источник
  let cargoName: string | null = null
  if (cargoTypeId) {
    const cargoType = await db.cargoType.findUnique({ where: { id: cargoTypeId } })
    if (!cargoType) return NextResponse.json({ error: 'Выбранный груз не найден в справочнике' }, { status: 400 })
    cargoName = cargoType.name
  } else if (str(body.cargo, 200)) {
    cargoName = str(body.cargo, 200) // обратная совместимость (старые клиенты)
  }

  if (!fromPoint || !toPoint || !cargoName) {
    return NextResponse.json({ error: 'Заполните направление, груз и стартовую ставку' }, { status: 400 })
  }
  if (!MODES.includes(mode)) return NextResponse.json({ error: 'Вид тендера: AUCTION или CLOSED' }, { status: 400 })
  if (!Number.isFinite(startRate) || startRate <= 0 || startRate > 10_000_000) {
    return NextResponse.json({ error: 'Стартовая ставка — положительное число, ₽/т' }, { status: 400 })
  }
  if (!Number.isFinite(tonnage) || tonnage <= 0 || tonnage > 200) {
    return NextResponse.json({ error: 'Тоннаж — число от 0 до 200 т' }, { status: 400 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let loadDate = '—'
  if (loadDateRaw && loadDateRaw !== '—') {
    const d = parseRuDate(loadDateRaw)
    if (!d) return NextResponse.json({ error: 'Дата погрузки — в формате ДД.ММ.ГГГГ' }, { status: 400 })
    if (d < today) return NextResponse.json({ error: 'Дата погрузки уже прошла' }, { status: 400 })
    loadDate = loadDateRaw
  }

  // срок приёма ставок обязателен: по нему автоматически определяется победитель.
  // Принимаем deadlineHours (часы) или deadline (ISO) — интерфейс отправлял второе, а сервер читал только первое
  let deadline: Date | null = null
  if (body.deadlineHours != null && body.deadlineHours !== '') {
    const h = Number(body.deadlineHours)
    if (!Number.isFinite(h) || h <= 0 || h > MAX_DEADLINE_HOURS) {
      return NextResponse.json({ error: `Срок приёма ставок — от 1 часа до ${MAX_DEADLINE_HOURS / 24} дней` }, { status: 400 })
    }
    deadline = new Date(Date.now() + h * 3600_000)
  } else if (typeof body.deadline === 'string' && body.deadline) {
    const d = new Date(body.deadline)
    const ms = d.getTime() - Date.now()
    if (Number.isNaN(ms) || ms <= 0 || ms > MAX_DEADLINE_HOURS * 3600_000) {
      return NextResponse.json({ error: `Срок приёма ставок — в будущем, не дальше ${MAX_DEADLINE_HOURS / 24} дней` }, { status: 400 })
    }
    deadline = d
  }
  if (!deadline) return NextResponse.json({ error: 'Укажите срок приёма ставок' }, { status: 400 })

  // номер: максимум + 1; при одновременной публикации уникальный индекс не даст дубль — пробуем следующий
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = (await nextNumber()) + attempt
    try {
      const request = await db.request.create({
        data: {
          number: `Z-${n}`,
          fromPoint, toPoint, cargo: cargoName, cargoTypeId,
          comment,
          createdBy: auth.name || '—',
          tonnage, truckType, mode,
          startRate: Math.round(startRate),
          loadDate, loadWindow, deadline,
          status: 'PUBLISHED',
          events: { create: { type: 'REQUEST_PUBLISHED', message: `Заявка опубликована логистом: стартовая ставка ${money(startRate)}` } },
        },
        include: REQUEST_INCLUDE,
      })
      notifyLive({ type: 'REQUEST_PUBLISHED', requestId: request.id })
      // журнал событий платформы (Task 76): опубликована заявка
      await plog({
        type: 'REQUEST_CREATED', source: 'api/requests',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        requestId: request.id, requestNumber: request.number,
        message: `Опубликована заявка №${request.number}: ${request.fromPoint} → ${request.toPoint}, ${request.cargo}, стартовая ставка ${money(startRate)}`,
      })
      return NextResponse.json({ request: toRequestDTO(request, viewer) }, { status: 201 })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
      console.error('request create error', e)
      await plogError('api/requests', e, {
        type: 'REQUEST_CREATE_FAILED',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        message: 'Сбой публикации заявки',
      })
      return NextResponse.json({ error: 'Не удалось опубликовать заявку' }, { status: 500 })
    }
  }
  return NextResponse.json({ error: 'Не удалось выдать номер заявки — повторите' }, { status: 409 })
}

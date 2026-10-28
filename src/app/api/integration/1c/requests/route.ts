import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ONEC_ETRN_RU, ONEC_STATUS_RU, onecAuthorized, onecBadRequest, onecMeta, onecPreflight, onecUnauthorized, withOnecCors } from '@/lib/onec'
import { notifyLive } from '@/lib/notify'
import { plog, plogError } from '@/lib/platform-log'
import { finalizeExpired, inTx, money, parseRuDate } from '@/lib/requests'
import type { RequestStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STATUSES = Object.keys(ONEC_STATUS_RU) as RequestStatus[]

/**
 * GET  /api/integration/1c/requests?status=&since=&limit=&onecRef= — заявки/рейсы со статусами.
 *      Реестр рейсов для 1С:ERP: маршрут, груз, ставки, перевозчик-победитель, экипаж, ЭТрН;
 *      onecRef — судьба одного документа 1С (черновик → торги → победитель → рейс).
 * POST /api/integration/1c/requests — черновик заявки из 1С (логист публикует его на площадке).
 * Оба метода доступны и браузеру (HTML-симулятор 1С) — CORS по ONEC_CORS_ORIGINS.
 */
export async function GET(req: NextRequest) {
  return withOnecCors(req, await listRequests(req))
}

export async function POST(req: NextRequest) {
  return withOnecCors(req, await createDraft(req))
}

export function OPTIONS(req: NextRequest) {
  return onecPreflight(req, 'GET, POST')
}

async function listRequests(req: NextRequest): Promise<NextResponse> {
  if (!onecAuthorized(req)) return onecUnauthorized()
  await finalizeExpired() // статусы торгов, у которых истёк срок, — уже с победителем

  const sp = req.nextUrl.searchParams

  const statusRaw = sp.get('status')
  if (statusRaw && !STATUSES.includes(statusRaw as RequestStatus)) {
    return NextResponse.json(
      { ok: false, error: `Некорректный status: ${statusRaw}. Допустимо: ${STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const sinceRaw = sp.get('since')
  let since: Date | null = null
  if (sinceRaw) {
    since = new Date(sinceRaw)
    if (Number.isNaN(since.getTime())) {
      return NextResponse.json({ ok: false, error: `Некорректный since: ${sinceRaw}` }, { status: 400 })
    }
  }

  const limitRaw = sp.get('limit')
  let limit = 100
  if (limitRaw) {
    limit = Number(limitRaw)
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      return NextResponse.json({ ok: false, error: 'limit должен быть числом 1…500' }, { status: 400 })
    }
  }

  const onecRef = sp.get('onecRef')?.trim() || null

  const requests = await db.request.findMany({
    where: {
      ...(statusRaw ? { status: statusRaw } : {}),
      ...(since ? { updatedAt: { gt: since } } : {}),
      ...(onecRef ? { onecRef } : {}),
    },
    include: { winner: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })

  // у Request связи экипажа хранятся как ID (driverId/truckId/trailerId) —
  // резолвим карточки вручную через справочники
  const [drivers, trucks, trailers] = await Promise.all([
    db.driver.findMany(),
    db.truck.findMany(),
    db.trailer.findMany(),
  ])
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const truckById = new Map(trucks.map((t) => [t.id, t]))
  const trailerById = new Map(trailers.map((t) => [t.id, t]))

  return NextResponse.json({
    ok: true,
    meta: onecMeta(requests.length, { since: since?.toISOString() ?? null, limit, onecRef }),
    data: requests.map((r) => ({
      id: r.id,
      number: r.number,
      onecRef: r.onecRef,
      route: { from: r.fromPoint, to: r.toPoint },
      cargo: r.cargo,
      tonnage: r.tonnage,
      truckType: r.truckType,
      mode: r.mode,
      rates: { start: r.startRate, best: r.bestRate },
      status: r.status,
      statusRu: ONEC_STATUS_RU[r.status as RequestStatus] ?? r.status,
      loadDate: r.loadDate,
      loadWindow: r.loadWindow,
      winner: r.winner ? { id: r.winner.id, name: r.winner.name, inn: r.winner.inn } : null,
      crew: (() => {
        const d = r.driverId ? driverById.get(r.driverId) : undefined
        if (!d) return null
        const t = r.truckId ? truckById.get(r.truckId) : undefined
        const tr = r.trailerId ? trailerById.get(r.trailerId) : undefined
        return {
          driver: {
            fullName: d.fullName,
            phone: d.phone,
          },
          truck: t
            ? { brand: t.brand, plate: t.plate, vin: t.vin, sts: t.sts }
            : null,
          trailer: tr
            ? { type: tr.type, plate: tr.plate, sts: tr.sts }
            : null,
        }
      })(),
      passPackage: r.passPackage,
      etrn: { status: r.etrnStatus, statusRu: ONEC_ETRN_RU[r.etrnStatus] ?? r.etrnStatus },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  })
}

const MODES = ['AUCTION', 'CLOSED']
/** Типы кузова площадки: только тент и борт */
const TRUCK_TYPES = ['Тент', 'Борт']
const MAX_RATE = 10_000_000
const ONEC_AUTHOR = '1С (интеграция)'

/** Строка из JSON 1С; число (номер документа без префикса) тоже принимаем */
const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''

/** Ключ сравнения имени груза: регистр, «ё», пробелы и тире не важны */
const cargoKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s\-–—]+/g, ' ').trim()

/**
 * Дата погрузки из 1С → ДД.ММ.ГГГГ (формат платформы).
 * Принимаем ГГГГ-ММ-ДД (Формат(..., "ДФ=yyyy-MM-dd")), ГГГГ-ММ-ДДTчч:мм:сс
 * (ЗаписатьJSON для значения типа Дата) и ДД.ММ.ГГГГ; «31.02» и подобные — отказ.
 */
function ruDateFrom1c(raw: string): string | null {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/)
  const ru = iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : raw
  const d = parseRuDate(ru)
  return d && d.getDate() === Number(ru.slice(0, 2)) ? ru : null
}

/** Следующий номер заявки — то же правило, что у логиста в POST /api/requests (максимум по числовой части + 1) */
async function nextNumber(): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint | number | null }[]>`
    SELECT MAX(CAST(SUBSTR(number, 3) AS INTEGER)) AS n FROM "Request" WHERE number LIKE 'Z-%'`
  const max = Number(rows[0]?.n ?? 1000)
  return (Number.isFinite(max) ? Math.max(max, 1000) : 1000) + 1
}

type DraftRow = { id: string; number: string; status: string; onecRef: string | null; cargo: string; createdAt: Date }

function draftResponse(r: DraftRow, extra: { duplicate: boolean; cargoCreated: boolean }, status: number) {
  return NextResponse.json({
    ok: true,
    data: {
      id: r.id,
      number: r.number,
      onecRef: r.onecRef,
      status: r.status,
      statusRu: ONEC_STATUS_RU[r.status as RequestStatus] ?? r.status,
      cargo: r.cargo,
      createdAt: r.createdAt,
      ...extra,
    },
  }, { status })
}

/**
 * POST /api/integration/1c/requests — 1С создаёт черновик заявки на платформе.
 * Тело: { oneC_number, fromPoint, toPoint, cargo, loadDate, tonnage?, truckType?,
 *         loadWindow?, startRate? (₽/т), mode? (AUCTION | CLOSED), comment? }.
 * Заявка попадает в «Черновики заявок» логиста (status DRAFT): срок торгов и, при
 * необходимости, ставку логист задаёт при публикации.
 * Идемпотентность по oneC_number: повторная отправка того же документа отдаёт
 * уже созданный черновик (200, duplicate: true), новый создаётся с кодом 201.
 */
async function createDraft(req: NextRequest): Promise<NextResponse> {
  if (!onecAuthorized(req)) return onecUnauthorized()

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return onecBadRequest('Тело запроса — JSON-объект')

  const onecRef = str(body.oneC_number, 100)
  // адреса — как прислала 1С: справочник точек сводит адрес к городу, а улица и дом нужны логисту
  const fromPoint = str(body.fromPoint, 300)
  const toPoint = str(body.toPoint, 300)
  const cargoName = str(body.cargo, 200)
  const loadDateRaw = str(body.loadDate, 40)
  const loadWindow = str(body.loadWindow, 40) || '08:00–12:00'
  const comment = str(body.comment, 1000)
  const mode = str(body.mode, 20).toUpperCase() || 'AUCTION'
  const tonnage = body.tonnage == null || body.tonnage === '' ? 20 : Number(body.tonnage)
  const startRate = body.startRate == null || body.startRate === '' ? 0 : Number(body.startRate)
  const truckRaw = str(body.truckType, 40)

  if (!onecRef) return onecBadRequest('Укажите oneC_number — номер документа в 1С (по нему отсекаются повторы)')
  if (!fromPoint || !toPoint) return onecBadRequest('Укажите fromPoint и toPoint — адреса погрузки и выгрузки')
  if (!cargoName) return onecBadRequest('Укажите cargo — наименование груза')
  if (!loadDateRaw) return onecBadRequest('Укажите loadDate — дату погрузки (ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)')
  const loadDate = ruDateFrom1c(loadDateRaw)
  if (!loadDate) return onecBadRequest(`Некорректная loadDate: ${loadDateRaw}. Формат ГГГГ-ММ-ДД или ДД.ММ.ГГГГ`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (parseRuDate(loadDate)! < today) return onecBadRequest(`Дата погрузки ${loadDate} уже прошла`)
  if (!MODES.includes(mode)) return onecBadRequest('mode — AUCTION (аукцион) или CLOSED (закрытый тендер)')
  if (!Number.isFinite(tonnage) || tonnage <= 0 || tonnage > 200) return onecBadRequest('tonnage — число от 0 до 200 т')
  // ставка у черновика необязательна (0 — «не задана»): логист укажет её при публикации
  if (!Number.isFinite(startRate) || startRate < 0 || startRate > MAX_RATE) {
    return onecBadRequest('startRate — стартовая ставка в ₽ за тонну (0 или не передавать — задаст логист)')
  }
  const truckType = truckRaw ? TRUCK_TYPES.find((t) => t.toLowerCase() === truckRaw.toLowerCase()) : null
  if (truckRaw && !truckType) return onecBadRequest(`truckType — один из: ${TRUCK_TYPES.join(', ')}`)

  // повторная отправка документа (двойное нажатие кнопки, повтор после таймаута) — отдаём созданный черновик
  const existing = await db.request.findUnique({ where: { onecRef } })
  if (existing) return draftResponse(existing, { duplicate: true, cargoCreated: false }, 200)

  // номер: максимум + 1; при одновременном создании уникальный индекс не даст дубль — пробуем следующий
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = (await nextNumber()) + attempt
    try {
      const { request, cargoCreated } = await inTx(async (tx) => {
        // груз — из справочника грузов; нового наименования там ещё нет — заводим запись
        const cargoTypes = await tx.cargoType.findMany({ select: { id: true, name: true, truckType: true } })
        let cargoType = cargoTypes.find((c) => cargoKey(c.name) === cargoKey(cargoName)) ?? null
        const created = !cargoType
        if (!cargoType) {
          cargoType = await tx.cargoType.create({
            data: { name: cargoName, truckType: truckType ?? 'Тент' },
            select: { id: true, name: true, truckType: true },
          })
        }
        const request = await tx.request.create({
          data: {
            number: `Z-${n}`,
            onecRef,
            fromPoint, toPoint, cargo: cargoType.name, cargoTypeId: cargoType.id,
            comment,
            createdBy: ONEC_AUTHOR,
            tonnage,
            truckType: truckType ?? (TRUCK_TYPES.includes(cargoType.truckType) ? cargoType.truckType : 'Тент'),
            mode,
            startRate: Math.round(startRate),
            loadDate, loadWindow, deadline: null,
            status: 'DRAFT',
            events: {
              create: {
                type: 'REQUEST_DRAFTED',
                message: `Черновик создан из 1С по документу «${onecRef}» — на площадку не опубликован`,
              },
            },
          },
        })
        return { request, cargoCreated: created }
      })
      notifyLive({ type: 'REQUEST_DRAFTED', requestId: request.id })
      // журнал событий платформы (Task 76): черновик из 1С
      await plog({
        type: 'REQUEST_DRAFTED', source: '1c/requests',
        requestId: request.id, requestNumber: request.number,
        message: `Черновик заявки №${request.number} из 1С (документ «${onecRef}»): ${request.fromPoint} → ${request.toPoint}, ${request.cargo}`
          + (request.startRate > 0 ? `, стартовая ставка ${money(request.startRate)}` : '')
          + (cargoCreated ? ` · груз «${request.cargo}» добавлен в справочник` : ''),
        meta: { onecRef, cargoCreated },
      })
      return draftResponse(request, { duplicate: false, cargoCreated }, 201)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // тот же документ 1С пришёл параллельно — отдаём черновик, созданный соседним запросом
        const dup = await db.request.findUnique({ where: { onecRef } })
        if (dup) return draftResponse(dup, { duplicate: true, cargoCreated: false }, 200)
        continue // занят номер заявки (или имя груза) — следующая попытка
      }
      console.error('1c request create error', e)
      await plogError('1c/requests', e, {
        type: 'REQUEST_CREATE_FAILED',
        message: `Сбой создания черновика из 1С (документ «${onecRef}»)`,
      })
      return NextResponse.json({ ok: false, error: 'Не удалось создать черновик заявки' }, { status: 500 })
    }
  }
  return NextResponse.json({ ok: false, error: 'Не удалось выдать номер заявки — повторите' }, { status: 409 })
}

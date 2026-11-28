import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { audit } from '@/lib/kontur/audit'
import { requireKonturPerm } from '@/lib/kontur/access'
import { shortName } from '@/lib/kontur/auth'
import {
  coordsFromGeoJson,
  fetchRoadRoute,
  fetchYandexRoadRoute,
  geoJsonFromCoords,
  isYandexMapsLink,
  parseYandexRouteLink,
  pointsLabel,
  waypointsFromJson,
} from '@/lib/kontur/yandex-route'
import { pushRouteToDriverApp } from '@/lib/kontur/driver-bridge'

export const dynamic = 'force-dynamic'

type Body = { legId?: string; link?: string; build?: boolean }

/**
 * PUT /api/trip/[id]/route-link — офис вставляет ссылку Яндекс.Карт.
 *
 * Точки маршрута сохраняются на плечо в порядке ссылки; дорожная линия
 * строится через все точки (OSRM) и кладётся в БД. Водитель получает
 * готовый маршрут в ближайшем обновлении ленты, без ручных действий.
 *
 * DELETE /api/trip/[id]/route-link?legId=… — очистить маршрут плеча.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireKonturPerm('own:process')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = (await req.json().catch(() => null)) as Body | null
  const legId = body?.legId?.trim()
  if (!legId) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Не указано плечо рейса' } }, { status: 400 })
  }

  const trip = await db.trip.findUnique({ where: { id } })
  if (!trip) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Рейс не найден' } }, { status: 404 })
  const leg = await db.leg.findFirst({ where: { id: legId, tripId: id } })
  if (!leg) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Плечо не найдено в этом рейсе' } }, { status: 404 })

  const rawLink = body?.link?.trim() ?? ''
  let parsed = parseYandexRouteLink(rawLink)
  const mayFetch = body?.build !== false

  // Сначала берём точную линию со страницы Яндекс.Карт — ту же, что видит
  // офис. Короткая ссылка «Поделиться» может не содержать rtext в адресе:
  // страница после редиректа отдаёт и полный адрес, и геометрию.
  const yandexRoad = mayFetch && isYandexMapsLink(rawLink) ? await fetchYandexRoadRoute(rawLink) : null

  if (!parsed.ok) {
    if (yandexRoad?.finalUrl) parsed = parseYandexRouteLink(yandexRoad.finalUrl)
    // Короткая ссылка без rtext: сохраняем хотя бы начало и конец, а точная
    // геометрия всё равно придёт из routerResponse.
    if (!parsed.ok && yandexRoad && yandexRoad.coords.length >= 2) {
      const first = yandexRoad.coords[0]
      const last = yandexRoad.coords[yandexRoad.coords.length - 1]
      parsed = {
        ok: true,
        link: rawLink,
        waypoints: [
          { lat: first[1], lng: first[0] },
          { lat: last[1], lng: last[0] },
        ],
        rtt: 'auto',
      }
    }
    if (!parsed.ok) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: parsed.error } }, { status: 400 })
    }
  }

  // Если Яндекс не отдал геометрию, строим дорожную линию OSRM через все
  // точки. Если недоступно и это — маршрут всё равно сохраняем: точки уйдут
  // водителю, а линию приложение построит само.
  const road = yandexRoad ?? (mayFetch ? await fetchRoadRoute(parsed.waypoints) : null)
  const source = yandexRoad ? 'yandex' : road ? 'osrm' : null

  const updated = await db.leg.update({
    where: { id: leg.id },
    data: {
      routeLink: parsed.link,
      routeWaypoints: JSON.stringify(parsed.waypoints.map((p) => [p.lat, p.lng])),
      routeGeometry: road ? geoJsonFromCoords(road.coords) : null,
      routeSource: source,
      routeDistanceM: road?.distanceM ?? null,
      routeDurationS: road?.durationS ?? null,
      routeUpdatedAt: new Date(),
      // План километража не перетираем: его мог согласовать логист.
      ...(leg.kmPlan == null && road ? { kmPlan: Math.max(1, Math.round(road.distanceM / 1000)) } : {}),
    },
  })

  await db.tripEvent.create({
    data: {
      tripId: trip.id,
      type: 'route_set',
      actorId: shortName(auth.user.fullName),
      payload: JSON.stringify({
        legId: leg.id,
        link: parsed.link,
        points: parsed.waypoints.length,
        distanceM: road?.distanceM ?? null,
        source,
      }),
    },
  })
  await audit({
      actorRole: auth.user.role === 'admin' ? 'admin' : 'logist',
      actorName: shortName(auth.user.fullName),
      object: 'leg',
      objectId: leg.id,
      field: 'routeLink',
      was: leg.routeLink ?? null,
      became: parsed.link,
      comment: `Маршрут Яндекс.Карт: ${pointsLabel(parsed.waypoints.length)}${
        road
          ? `, ${Math.round(road.distanceM / 1000)} км (${source === 'yandex' ? 'геометрия Яндекса' : 'линия по точкам'})`
          : ', линия будет построена в приложении'
      }`,
    })

  // Мост в приложение водителя (APK): обновляем активный рейс в журнале
  // синхронизации, чтобы маршрут пришёл мгновенно. Ошибка моста не отменяет
  // сохранение в офисе — PWA получает маршрут из ленты заявок.
  const order = await (leg.orderId
    ? db.order.findUnique({ where: { id: leg.orderId }, select: { number: true } })
    : Promise.resolve(null))
  const bridge = await pushRouteToDriverApp({
    trip,
    leg: updated,
    waypoints: parsed.waypoints,
    link: parsed.link,
    tripCode: order?.number,
  }).catch((e: unknown) => ({ sent: false, error: e instanceof Error ? e.message : String(e) }))

  return NextResponse.json({
    ok: true,
    route: {
      link: parsed.link,
      waypoints: parsed.waypoints,
      distanceM: road?.distanceM ?? null,
      durationS: road?.durationS ?? null,
      coords: coordsFromGeoJson(updated.routeGeometry).length,
      points: parsed.waypoints.length,
      source,
    },
    driverApp: bridge,
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireKonturPerm('own:process')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const legId = new URL(req.url).searchParams.get('legId')?.trim()
  if (!legId) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Не указано плечо рейса' } }, { status: 400 })
  }
  const leg = await db.leg.findFirst({ where: { id: legId, tripId: id } })
  if (!leg) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Плечо не найдено в этом рейсе' } }, { status: 404 })

  await db.leg.update({
    where: { id: leg.id },
    data: {
      routeLink: null,
      routeWaypoints: null,
      routeGeometry: null,
      routeSource: null,
      routeDistanceM: null,
      routeDurationS: null,
      routeUpdatedAt: null,
    },
  })
  await db.tripEvent.create({
    data: {
      tripId: id,
      type: 'route_cleared',
      actorId: shortName(auth.user.fullName),
      payload: JSON.stringify({ legId: leg.id }),
    },
  })
  await audit({
      actorRole: auth.user.role === 'admin' ? 'admin' : 'logist',
      actorName: shortName(auth.user.fullName),
      object: 'leg',
      objectId: leg.id,
      field: 'routeLink',
      was: leg.routeLink ?? null,
      became: null,
      comment: 'Маршрут Яндекс.Карт удалён из плеча',
    })

  // Пустая точка назначения в APK не нужна: оставляем прежнюю геометрию
  // до следующего назначения, чтобы навигация не пропала на ходу.
  return NextResponse.json({ ok: true, route: null })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const legs = await db.leg.findMany({ where: { tripId: id }, orderBy: { seq: 'asc' } })
  return NextResponse.json({
    ok: true,
    routes: legs.map((leg) => ({
      legId: leg.id,
      seq: leg.seq,
      link: leg.routeLink,
      waypoints: waypointsFromJson(leg.routeWaypoints),
      source: leg.routeSource,
      distanceM: leg.routeDistanceM,
      durationS: leg.routeDurationS,
      updatedAt: leg.routeUpdatedAt,
    })),
  })
}

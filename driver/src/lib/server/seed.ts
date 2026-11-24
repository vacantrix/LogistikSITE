/**
 * Демо-сид: рейс Z-1067 «Абинск → Новороссийск» в статусе «В пути».
 * Вызывается лениво при первом обращении к API — данные всегда согласованы
 * по времени (все метки относительно момента первого запуска).
 * Зеркало DemoDataRunner.kt каркаса, но со сценарием из мокапов.
 */

import { db } from '@/lib/db'
import {
  DRIVER_ID,
  DEVICE_ID,
  LOADING_POINT,
  MANEUVERS,
  ROUTE_LNGLAT,
  START_F,
  TRIP_ID,
  UNLOADING_POINT,
  VEHICLE_ID,
  toGeoJSON,
} from '@/lib/demo/route-data'
import {
  buildChatSnapshot,
  buildNoteSnapshot,
  buildTripEventSnapshot,
  buildTripPointSnapshot,
  buildTripSnapshot,
} from './snapshots'

const MIN = 60_000
const HOUR = 3_600_000

const E_DEPARTURE = 'e1-departure-4000-8000-000000000001'
const E_ARRIVAL_LOADING = 'e2-arrival-loading-4000-8000-0000002'
const E_LOADING_DONE = 'e3-loading-done-4000-8000-00000000003'
const E_REST_START = 'e4-rest-start-4000-8000-000000000004'
const E_REST_END = 'e5-rest-end-4000-8000-0000000000005'

const NOTE_1 = 'n1-trip-updated-4000-8000-00000000000001'
const M_DRIVER_1 = 'm1-driver-4000-8000-000000000000000001'
const M_DRIVER_2 = 'm2-driver-4000-8000-000000000000000002'

const MARK_1 = 'mk1-pothole-4000-8000-00000000000000001'
const MARK_2 = 'mk2-roadworks-4000-8000-0000000000000002'
const MARK_3 = 'mk3-police-4000-8000-000000000000000003'
const MARK_4 = 'mk4-closed-4000-8000-0000000000000000004'

function line(a: number, b: number): string {
  return JSON.stringify({ type: 'LineString', coordinates: [[a, b], [a + 0.0006, b + 0.0004]] })
}

function bboxOf(geometry: string) {
  const coords = (JSON.parse(geometry) as { coordinates: [number, number][] }).coordinates
  const lons = coords.map((c) => c[0])
  const lats = coords.map((c) => c[1])
  return { minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats) }
}

export async function ensureSeeded(): Promise<void> {
  const count = await db.trip.count()
  if (count > 0) return

  const now = Date.now()
  const d = (offsetMs: number) => new Date(now + offsetMs)

  const routeGeoJson = toGeoJSON(ROUTE_LNGLAT)
  const routeStepsJson = JSON.stringify(MANEUVERS)
  const lons = ROUTE_LNGLAT.map((c) => c[0])
  const lats = ROUTE_LNGLAT.map((c) => c[1])

  // --- рейс Z-1067: в пути, стоянка завершена 1 ч 40 мин назад -------------
  await db.trip.create({
    data: {
      id: TRIP_ID,
      tripCode: 'Z-1067',
      status: 'in_progress',
      driverId: DRIVER_ID,
      vehicleId: VEHICLE_ID,
      plannedStartAt: d(-4 * HOUR - 55 * MIN),
      plannedFinishAt: d(85 * MIN),
      routeGeoJson,
      routeStepsJson,
      routeDistanceM: 200_000,
      routeDurationS: 9_000,
      routeMinLat: Math.min(...lats),
      routeMinLon: Math.min(...lons),
      routeMaxLat: Math.max(...lats),
      routeMaxLon: Math.max(...lons),
      lastEventType: 'REST_END',
      lastEventAt: d(-100 * MIN),
    },
  })

  const loading = await db.tripPoint.create({
    data: {
      id: LOADING_POINT.id,
      tripId: TRIP_ID,
      seqNo: 1,
      kind: 'loading',
      name: LOADING_POINT.name,
      address: LOADING_POINT.address,
      lat: LOADING_POINT.lat,
      lon: LOADING_POINT.lon,
      geofenceRadiusM: 300,
      plannedArrivalAt: d(-3 * HOUR - 35 * MIN),
      plannedDepartureAt: d(-2 * HOUR - 25 * MIN),
    },
  })
  const unloading = await db.tripPoint.create({
    data: {
      id: UNLOADING_POINT.id,
      tripId: TRIP_ID,
      seqNo: 2,
      kind: 'unloading',
      name: UNLOADING_POINT.name,
      address: UNLOADING_POINT.address,
      lat: UNLOADING_POINT.lat,
      lon: UNLOADING_POINT.lon,
      geofenceRadiusM: 300,
      plannedArrivalAt: d(85 * MIN),
    },
  })

  // --- события: выезд → погрузка 1 ч 10 мин → стоянка 45 мин ---------------
  const evDeparture = await db.tripEvent.create({
    data: {
      id: E_DEPARTURE,
      tripId: TRIP_ID,
      driverId: DRIVER_ID,
      vehicleId: VEHICLE_ID,
      deviceId: DEVICE_ID,
      type: 'DEPARTURE',
      occurredAt: d(-4 * HOUR - 50 * MIN),
      source: 'MANUAL',
      lat: 44.8682,
      lon: 38.157,
      note: 'Выезд с базы, весы пустые',
      createdAt: d(-4 * HOUR - 50 * MIN),
    },
  })
  const evArrivalLoading = await db.tripEvent.create({
    data: {
      id: E_ARRIVAL_LOADING,
      tripId: TRIP_ID,
      tripPointId: loading.id,
      driverId: DRIVER_ID,
      vehicleId: VEHICLE_ID,
      deviceId: DEVICE_ID,
      type: 'ARRIVAL_LOADING',
      occurredAt: d(-3 * HOUR - 35 * MIN),
      source: 'GEOFENCE',
      lat: LOADING_POINT.lat,
      lon: LOADING_POINT.lon,
      intervalClosedAt: d(-2 * HOUR - 25 * MIN),
      intervalClosedBy: E_LOADING_DONE,
      intervalAutoClosed: false,
      createdAt: d(-3 * HOUR - 35 * MIN),
    },
  })
  const evLoadingDone = await db.tripEvent.create({
    data: {
      id: E_LOADING_DONE,
      tripId: TRIP_ID,
      tripPointId: loading.id,
      driverId: DRIVER_ID,
      vehicleId: VEHICLE_ID,
      deviceId: DEVICE_ID,
      type: 'LOADING_DONE',
      occurredAt: d(-2 * HOUR - 25 * MIN),
      source: 'MANUAL_BACKDATED',
      note: 'Отметка задним числом: весы выдали накладную позже',
      createdAt: d(-2 * HOUR - 10 * MIN),
    },
  })
  const evRestStart = await db.tripEvent.create({
    data: {
      id: E_REST_START,
      tripId: TRIP_ID,
      driverId: DRIVER_ID,
      vehicleId: VEHICLE_ID,
      deviceId: DEVICE_ID,
      type: 'REST_START',
      occurredAt: d(-2 * HOUR - 25 * MIN),
      source: 'MANUAL',
      intervalClosedAt: d(-1 * HOUR - 40 * MIN),
      intervalClosedBy: E_REST_END,
      intervalAutoClosed: false,
      createdAt: d(-2 * HOUR - 25 * MIN),
    },
  })
  const evRestEnd = await db.tripEvent.create({
    data: {
      id: E_REST_END,
      tripId: TRIP_ID,
      driverId: DRIVER_ID,
      vehicleId: VEHICLE_ID,
      deviceId: DEVICE_ID,
      type: 'REST_END',
      occurredAt: d(-1 * HOUR - 40 * MIN),
      source: 'MANUAL',
      createdAt: d(-1 * HOUR - 40 * MIN),
    },
  })

  // --- чат с офисом + системное уведомление (как в мокапе) -----------------
  const note1 = await db.systemNote.create({
    data: {
      id: NOTE_1,
      driverId: DRIVER_ID,
      kind: 'TRIP_UPDATED',
      body: 'Заявка Z-1067 изменена офисом',
      ref: TRIP_ID,
      createdAt: d(-52 * MIN),
    },
  })
  const chat1 = await db.chatMessage.create({
    data: {
      id: M_DRIVER_1 + '0',
      driverId: DRIVER_ID,
      tripId: TRIP_ID,
      sender: 'DISPATCHER',
      body: 'Выгрузка изменена: Новороссийск, ул. Дорожная, 15',
      createdAt: d(-50 * MIN),
    },
  })
  const chat2 = await db.chatMessage.create({
    data: {
      id: M_DRIVER_1 + '1',
      driverId: DRIVER_ID,
      tripId: TRIP_ID,
      sender: 'DISPATCHER',
      body: 'Подтвердите: комплект бумажных документов у вас?',
      createdAt: d(-48 * MIN),
    },
  })
  const chat3 = await db.chatMessage.create({
    data: {
      id: M_DRIVER_2 + '0',
      driverId: DRIVER_ID,
      tripId: TRIP_ID,
      sender: 'DRIVER',
      body: 'Принял',
      createdAt: d(-46 * MIN),
    },
  })
  const chat4 = await db.chatMessage.create({
    data: {
      id: M_DRIVER_2 + '1',
      driverId: DRIVER_ID,
      tripId: TRIP_ID,
      sender: 'DRIVER',
      body: 'Да, документы при мне, буду до 14:30',
      createdAt: d(-45 * MIN),
    },
  })

  // --- активные пометки водителей (слой 2) ---------------------------------
  const markDefs = [
    {
      id: MARK_1,
      category: 'POTHOLE',
      geometry: line(37.902, 44.795),
      comment: 'Яма перед переездом, правая полоса',
      ttlHours: 6,
      confirmCount: 3,
      outdatedCount: 1,
      createdAt: d(-2 * HOUR),
    },
    {
      id: MARK_2,
      category: 'ROADWORKS',
      geometry: line(37.975, 44.846),
      comment: 'Ремонт у Гайдука, сужение в одну полосу',
      ttlHours: 12,
      confirmCount: 5,
      outdatedCount: 0,
      createdAt: d(-3 * HOUR),
    },
    {
      id: MARK_3,
      category: 'POLICE',
      geometry: line(37.868, 44.78),
      comment: 'ДПС у Верхнебаканского, контроль скорости',
      ttlHours: 6,
      confirmCount: 2,
      outdatedCount: 0,
      createdAt: d(-40 * MIN),
    },
    {
      id: MARK_4,
      category: 'CLOSED',
      geometry: line(37.825, 44.755),
      comment: 'Перекрыт съезд на промзону, объезд по знакам',
      ttlHours: 720,
      confirmCount: 1,
      outdatedCount: 0,
      createdAt: d(-5 * HOUR),
    },
  ]
  for (const m of markDefs) {
    await db.roadMark.create({
      data: {
        id: m.id,
        category: m.category,
        polylineGeoJson: m.geometry,
        comment: m.comment,
        ttlHours: m.ttlHours,
        confirmCount: m.confirmCount,
        outdatedCount: m.outdatedCount,
        createdAt: m.createdAt,
        expiresAt: new Date(now + m.ttlHours * HOUR),
        ...bboxOf(m.geometry),
      },
    })
  }

  // --- личный журнал (канал 1): стартовый снимок для нового курсора 0 ------
  const journalRows: { entity: string; payload: unknown }[] = [
    { entity: 'TRIP', payload: buildTripSnapshot(await db.trip.findUniqueOrThrow({ where: { id: TRIP_ID } })) },
    { entity: 'TRIP_POINT', payload: buildTripPointSnapshot(loading) },
    { entity: 'TRIP_POINT', payload: buildTripPointSnapshot(unloading) },
    { entity: 'TRIP_EVENT', payload: buildTripEventSnapshot(evDeparture) },
    { entity: 'TRIP_EVENT', payload: buildTripEventSnapshot(evArrivalLoading) },
    { entity: 'TRIP_EVENT', payload: buildTripEventSnapshot(evLoadingDone) },
    { entity: 'TRIP_EVENT', payload: buildTripEventSnapshot(evRestStart) },
    { entity: 'TRIP_EVENT', payload: buildTripEventSnapshot(evRestEnd) },
    { entity: 'SYSTEM_NOTE', payload: buildNoteSnapshot(note1) },
    { entity: 'CHAT_MESSAGE', payload: buildChatSnapshot(chat1) },
    { entity: 'CHAT_MESSAGE', payload: buildChatSnapshot(chat2) },
    { entity: 'CHAT_MESSAGE', payload: buildChatSnapshot(chat3) },
    { entity: 'CHAT_MESSAGE', payload: buildChatSnapshot(chat4) },
  ]
  for (const row of journalRows) {
    await db.syncJournal.create({
      data: { driverId: DRIVER_ID, entity: row.entity, op: 'UPSERT', payload: JSON.stringify(row.payload) },
    })
  }

  void START_F
}

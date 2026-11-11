/**
 * Сид демо-данных «Контур 1С» (раздел 8 ТЗ). Общий модуль:
 * используется и при запуске prisma/seed.ts, и демо-панелью («Сброс и пересев»).
 */
import type { PrismaClient } from '@prisma/client'

const toMillis = (d: Date | null | undefined): number | null => (d ? d.getTime() : null)

function tripSnapshot(t: {
  id: string; tripCode: string; status: string; driverId: string | null; vehicleId: string | null
  plannedStartAt: Date | null; plannedFinishAt: Date | null
  routeGeoJson: string | null; routeStepsJson: string | null
  routeDistanceM: number | null; routeDurationS: number | null
  routeMinLat: number | null; routeMinLon: number | null
  routeMaxLat: number | null; routeMaxLon: number | null
  lastEventType: string | null; lastEventAt: Date | null
}) {
  return {
    id: t.id, tripCode: t.tripCode, status: t.status,
    driverId: t.driverId, vehicleId: t.vehicleId,
    plannedStartAt: toMillis(t.plannedStartAt), plannedFinishAt: toMillis(t.plannedFinishAt),
    routeGeoJson: t.routeGeoJson, routeStepsJson: t.routeStepsJson,
    routeDistanceM: t.routeDistanceM, routeDurationS: t.routeDurationS,
    routeMinLat: t.routeMinLat, routeMinLon: t.routeMinLon,
    routeMaxLat: t.routeMaxLat, routeMaxLon: t.routeMaxLon,
    lastEventType: t.lastEventType, lastEventAt: toMillis(t.lastEventAt),
  }
}

function tripPointSnapshot(p: {
  id: string; tripId: string; seqNo: number; kind: string; name: string | null; address: string | null
  lat: number; lon: number; geofenceRadiusM: number
  plannedArrivalAt: Date | null; plannedDepartureAt: Date | null
}) {
  return {
    id: p.id, tripId: p.tripId, seqNo: p.seqNo, kind: p.kind, name: p.name, address: p.address,
    lat: p.lat, lon: p.lon, geofenceRadiusM: p.geofenceRadiusM,
    plannedArrivalAt: toMillis(p.plannedArrivalAt), plannedDepartureAt: toMillis(p.plannedDepartureAt),
  }
}

function systemNoteSnapshot(n: {
  id: string; driverId: string; kind: string; body: string; ref: string | null
  createdAt: Date; readAt: Date | null
}) {
  return { id: n.id, driverId: n.driverId, kind: n.kind, body: n.body, ref: n.ref, createdAt: n.createdAt.getTime(), readAt: toMillis(n.readAt) }
}

function chatMessageSnapshot(m: { id: string; driverId: string; tripId: string | null; sender: string; body: string; createdAt: Date }) {
  return { id: m.id, driverId: m.driverId, tripId: m.tripId, sender: m.sender, body: m.body, createdAt: m.createdAt.getTime() }
}

function stubRoute(a: { lat: number; lon: number }, b: { lat: number; lon: number }, distanceM: number, durationMin: number) {
  const line = {
    type: 'LineString',
    coordinates: [0, 1, 2, 3, 4, 5].map((i) => {
      const k = i / 5
      return [+(a.lon + (b.lon - a.lon) * k).toFixed(6), +(a.lat + (b.lat - a.lat) * k).toFixed(6)]
    }),
  }
  return {
    routeGeoJson: JSON.stringify(line),
    routeDistanceM: distanceM,
    routeDurationS: durationMin * 60,
    routeMinLat: Math.min(a.lat, b.lat), routeMinLon: Math.min(a.lon, b.lon),
    routeMaxLat: Math.max(a.lat, b.lat), routeMaxLon: Math.max(a.lon, b.lon),
  }
}

export async function seedAll(db: PrismaClient) {
  console.log('Сид «Контур 1С»: очистка…')
  await db.$transaction([
    db.syncJournal.deleteMany(), db.syncOperation.deleteMany(), db.registrationLog.deleteMany(),
    db.statusHistory.deleteMany(), db.preTripStep.deleteMany(), db.preTripInspection.deleteMany(),
    db.tripEvent.deleteMany(), db.tripPoint.deleteMany(), db.waybill.deleteMany(), db.trip.deleteMany(),
    db.chatMessage.deleteMany(), db.systemNote.deleteMany(),
    db.roadMark.deleteMany(), db.markVote.deleteMany(), db.markPublicationLog.deleteMany(),
    db.trafficSegment.deleteMany(), db.transportRequest.deleteMany(),
    db.vehicle.deleteMany(), db.trailer.deleteMany(), db.driver.deleteMany(),
    db.contractor.deleteMany(), db.location.deleteMany(), db.numberCounter.deleteMany(),
  ])

  // ─── Нумератор: год закрыт на 1074, следующая — ЗК-2026/1075 ───
  await db.numberCounter.create({ data: { year: '2026', last: 1074 } })

  // ─── Контрагенты ───
  const contractorRows = [
    { name: 'ООО «Новороссийский терминал»', inn: '2315066431', kind: 'customer' },
    { name: 'ООО «Кубань Агро»', inn: '2366001023', kind: 'customer' },
    { name: 'ООО «Донсталь»', inn: '6163120045', kind: 'customer' },
    { name: 'АО «Абинский электрометаллургический завод»', inn: '2301003210', kind: 'shipper' },
  ]
  const contractors: Record<string, { id: string }> = {}
  for (const c of contractorRows) contractors[c.name] = await db.contractor.create({ data: c })

  // ─── Пункты погрузки и выгрузки ───
  const locRows = [
    { key: 'abinsk', name: 'Абинск, пл. АЗМЗ', address: 'г. Абинск, промплощадка АЭМЗ', lat: 44.868, lon: 38.158 },
    { key: 'timashevsk', name: 'Тимашевск, элеватор', address: 'г. Тимашевск, ул. Гибридная, 2', lat: 45.617, lon: 38.936 },
    { key: 'krasnodar', name: 'Краснодар, РЦ «Прогресс»', address: 'г. Краснодар, ул. Тополиная, 12', lat: 45.035, lon: 38.975 },
    { key: 'novoross', name: 'Новороссийск, причал 27', address: 'г. Новороссийск, грузовой терминал, причал 27', lat: 44.685, lon: 37.775 },
    { key: 'rostov', name: 'Ростов-на-Дону, склад №4', address: 'г. Ростов-на-Дону, ул. Доватора, 150', lat: 47.235, lon: 39.701 },
  ]
  const loc: Record<string, { id: string; lat: number; lon: number; name: string; address: string }> = {}
  for (const l of locRows) loc[l.key] = await db.location.create({ data: { name: l.name, address: l.address, lat: l.lat, lon: l.lon } })

  // ─── ТС (15, часть в maintenance/repair — для проверки правил назначения) ───
  const vehRows = [
    { plate: 'А 123 БС 23', model: 'МАЗ 5440', kind: 'tractor', bodyType: 'tarp', capacityT: 20, volumeM3: 90, readiness: 'ready' },
    { plate: 'К 456 МН 23', model: 'КАМАЗ 5490', kind: 'tractor', bodyType: 'tarp', capacityT: 19, volumeM3: 88, readiness: 'ready' },
    { plate: 'В 789 СА 23', model: 'МАЗ 6312', kind: 'tipper', bodyType: 'flatbed', capacityT: 21, volumeM3: 60, readiness: 'ready' },
    { plate: 'О 345 РТ 23', model: 'Volvo FH 460', kind: 'tractor', bodyType: 'tarp', capacityT: 21, volumeM3: 92, readiness: 'ready' },
    { plate: 'Е 901 ХК 23', model: 'Scania R450', kind: 'tractor', bodyType: 'tarp', capacityT: 20.5, volumeM3: 90, readiness: 'maintenance' },
    { plate: 'М 234 УК 23', model: 'МАЗ 4371', kind: 'van', bodyType: 'tarp', capacityT: 10, volumeM3: 45, readiness: 'ready' },
    { plate: 'Т 567 ОР 23', model: 'КАМАЗ 6520', kind: 'tipper', bodyType: 'flatbed', capacityT: 20, volumeM3: 40, readiness: 'repair' },
    { plate: 'Н 678 ВЕ 23', model: 'ГАЗ Валдай', kind: 'van', bodyType: 'tarp', capacityT: 4, volumeM3: 20, readiness: 'ready' },
    { plate: 'С 890 НМ 23', model: 'MAN TGX', kind: 'tractor', bodyType: 'fridge', capacityT: 19, volumeM3: 85, readiness: 'ready' },
    { plate: 'Р 012 АС 23', model: 'КАМАЗ 54115', kind: 'tractor', bodyType: 'tarp', capacityT: 18, volumeM3: 82, readiness: 'ready' },
    { plate: 'У 123 КЛ 23', model: 'Volvo FM 13', kind: 'tractor', bodyType: 'fridge', capacityT: 20, volumeM3: 86, readiness: 'ready' },
    { plate: 'К 234 МН 23', model: 'Scania P410', kind: 'tractor', bodyType: 'flatbed', capacityT: 19.5, volumeM3: 70, readiness: 'ready' },
    { plate: 'А 567 БВ 23', model: 'МАЗ 5440 Е5', kind: 'tractor', bodyType: 'tarp', capacityT: 20, volumeM3: 90, readiness: 'ready' },
    { plate: 'Х 890 ЕК 23', model: 'КАМАЗ 65117', kind: 'van', bodyType: 'tarp', capacityT: 15, volumeM3: 70, readiness: 'maintenance' },
    { plate: 'В 345 ТА 23', model: 'ГАЗель NEXT', kind: 'van', bodyType: 'tarp', capacityT: 1.5, volumeM3: 9, readiness: 'ready' },
  ]
  const veh: Record<string, { id: string }> = {}
  for (const v of vehRows) veh[v.plate] = await db.vehicle.create({ data: v })

  // ─── Прицепы (8) ───
  const trailerRows = [
    { plate: 'АВ 456 23', model: 'НЕФАЗ 93341', type: 'tarp' },
    { plate: 'МЕ 789 23', model: 'Schmitz SCS 24', type: 'tarp' },
    { plate: 'РУ 012 23', model: 'Schmitz SKO 24 (реф)', type: 'fridge' },
    { plate: 'СН 345 23', model: 'Коггел СК-3 (реф)', type: 'fridge' },
    { plate: 'ВК 678 23', model: 'НЕФАЗ 8560 (борт)', type: 'flatbed' },
    { plate: 'АХ 901 23', model: 'ТСМ 9384 (штора)', type: 'tarp' },
    { plate: 'ЕТ 234 23', model: 'Krone Profi Liner', type: 'tarp' },
    { plate: 'УМ 567 23', model: 'НЕФАЗ 93342 (борт)', type: 'flatbed' },
  ]
  const tr: Record<string, { id: string }> = {}
  for (const t of trailerRows) tr[t.plate] = await db.trailer.create({ data: t })

  // ─── Водители (12, у первого — appId демо-водителя приложения) ───
  const driverRows = [
    { fullName: 'Иванов Сергей Петрович', phone: '+7 (918) 201-15-32', licenseNo: '5412 889012', appId: 'd1111111-1111-4111-8111-111111111111' },
    { fullName: 'Петров Андрей Николаевич', phone: '+7 (918) 345-67-89', licenseNo: '5413 124578' },
    { fullName: 'Сидоров Алексей Викторович', phone: '+7 (903) 442-11-08', licenseNo: '5414 552310' },
    { fullName: 'Кузнецов Дмитрий Олегович', phone: '+7 (918) 677-23-41', licenseNo: '5415 781204' },
    { fullName: 'Смирнов Игорь Валерьевич', phone: '+7 (961) 118-90-76', licenseNo: '5416 330459' },
    { fullName: 'Волков Максим Сергеевич', phone: '+7 (918) 552-88-10', licenseNo: '5417 905613' },
    { fullName: 'Морозов Павел Андреевич', phone: '+7 (909) 701-45-23', licenseNo: '5418 217860' },
    { fullName: 'Егоров Станислав Львович', phone: '+7 (918) 099-31-64', licenseNo: '5419 664108' },
    { fullName: 'Захаров Виктор Иванович', phone: '+7 (961) 234-77-05', licenseNo: '5420 110925' },
    { fullName: 'Орлов Геннадий Павлович', phone: '+7 (918) 466-52-90', licenseNo: '5421 883741' },
    { fullName: 'Богданов Роман Юрьевич', phone: '+7 (903) 590-18-47', licenseNo: '5422 557602' },
    { fullName: 'Фёдоров Артём Владимирович', phone: '+7 (961) 808-26-39', licenseNo: '5423 309184' },
  ]
  const drv: { id: string; fullName: string }[] = []
  for (const d of driverRows) drv.push(await db.driver.create({ data: d }))

  console.log('Сид: справочники созданы (15 ТС, 8 прицепов, 12 водителей, 4 контрагента, 5 пунктов)')

  const now = new Date()
  const dayMs = 24 * 3600 * 1000
  const journal: { driverId: string; entity: string; op: string; payload: string }[] = []
  const regLog: { user: string; action: string; entity: string; entityId: string | null; level?: string }[] = []

  // ─── Выполненные заявки (история): ЗК-2026/1063, /1059, /1052 ───
  const doneDefs = [
    { number: 'ЗК-2026/1063', cargo: 'Трубы стальные, 12 м', weightT: 15, contractor: 'ООО «Донсталь»', from: 'abinsk', to: 'krasnodar', vehicle: 'О 345 РТ 23', trailer: 'АВ 456 23', driverIdx: 3, km: 210, min: 240, daysAgo: 3, docs: ['ТТН (2 экз.)', 'Паспорт груза'] },
    { number: 'ЗК-2026/1059', cargo: 'Мука пшеничная в мешках', weightT: 16, contractor: 'ООО «Кубань Агро»', from: 'timashevsk', to: 'rostov', vehicle: 'Р 012 АС 23', trailer: 'МЕ 789 23', driverIdx: 4, km: 380, min: 420, daysAgo: 5, docs: ['ТТН', 'Качественное удостоверение'] },
    { number: 'ЗК-2026/1052', cargo: 'Пиломатериалы обрезные', weightT: 12, contractor: 'ООО «Новороссийский терминал»', from: 'abinsk', to: 'novoross', vehicle: 'К 234 МН 23', trailer: 'ВК 678 23', driverIdx: 5, km: 118, min: 155, daysAgo: 7, docs: ['ТТН (2 экз.)'] },
  ]
  for (const d of doneDefs) {
    const daysAgo = (n: number) => new Date(now.getTime() - n * dayMs)
    const req = await db.transportRequest.create({
      data: {
        number: d.number, status: 'DONE', contractorId: contractors[d.contractor].id,
        cargo: d.cargo, weightT: d.weightT, fromLocationId: loc[d.from].id, toLocationId: loc[d.to].id,
        loadingAt: daysAgo(d.daysAgo), unloadingWindow: '—', docs: JSON.stringify(d.docs),
        vehicleId: veh[d.vehicle].id, trailerId: tr[d.trailer].id, driverId: drv[d.driverIdx].id,
        assignedBy: 'Диспетчер Е. Крылова', assignedAt: daysAgo(d.daysAgo),
        createdAt: daysAgo(d.daysAgo + 1),
      },
    })
    const route = stubRoute(loc[d.from], loc[d.to], d.km * 1000, d.min)
    const trip = await db.trip.create({
      data: {
        tripCode: d.number, status: 'completed', driverId: drv[d.driverIdx].id, vehicleId: veh[d.vehicle].id,
        plannedStartAt: daysAgo(d.daysAgo), plannedFinishAt: new Date(daysAgo(d.daysAgo).getTime() + d.min * 60000),
        ...route, lastEventType: 'TRIP_DONE', lastEventAt: new Date(daysAgo(d.daysAgo).getTime() + d.min * 60000),
      },
    })
    await db.tripPoint.createMany({
      data: [
        { tripId: trip.id, seqNo: 1, kind: 'loading', name: loc[d.from].name, address: loc[d.from].address, lat: loc[d.from].lat, lon: loc[d.from].lon, plannedArrivalAt: daysAgo(d.daysAgo), plannedDepartureAt: new Date(daysAgo(d.daysAgo).getTime() + 40 * 60000) },
        { tripId: trip.id, seqNo: 2, kind: 'unloading', name: loc[d.to].name, address: loc[d.to].address, lat: loc[d.to].lat, lon: loc[d.to].lon, plannedArrivalAt: new Date(daysAgo(d.daysAgo).getTime() + d.min * 60000) },
      ],
    })
    await db.tripEvent.createMany({
      data: [
        { tripId: trip.id, driverId: drv[d.driverIdx].id, vehicleId: veh[d.vehicle].id, type: 'DEPARTURE', occurredAt: daysAgo(d.daysAgo), source: 'MANUAL' },
        { tripId: trip.id, driverId: drv[d.driverIdx].id, vehicleId: veh[d.vehicle].id, type: 'TRIP_DONE', occurredAt: new Date(daysAgo(d.daysAgo).getTime() + d.min * 60000), source: 'MANUAL' },
      ],
    })
    await db.transportRequest.update({ where: { id: req.id }, data: { tripId: trip.id } })
    const chain = [
      ['NEW', 'DISPATCH'], ['DISPATCH', 'ASSIGNED'], ['ASSIGNED', 'ACCEPTED'],
      ['ACCEPTED', 'PRETRIP'], ['PRETRIP', 'IN_PROGRESS'], ['IN_PROGRESS', 'DONE'],
    ]
    await db.statusHistory.createMany({
      data: chain.map(([from, to], i) => ({
        requestId: req.id, fromStatus: from, toStatus: to,
        actor: to === 'ASSIGNED' ? 'Диспетчер Е. Крылова' : to === 'NEW' || to === 'DISPATCH' ? 'Авто' : `driver:${drv[d.driverIdx].id}`,
        at: new Date(daysAgo(d.daysAgo + 1).getTime() + i * 3600 * 1000),
      })),
    })
    regLog.push({ user: 'Логист', action: 'REQUEST_CREATE', entity: 'TransportRequest', entityId: d.number })
    regLog.push({ user: 'Диспетчер Е. Крылова', action: 'ASSIGN', entity: 'TransportRequest', entityId: d.number })
    regLog.push({ user: `driver:${drv[d.driverIdx].id}`, action: 'DRIVER_ACTION', entity: 'TransportRequest', entityId: d.number })
  }

  // ─── ЗК-2026/1071 — Сахар-песок (DISPATCH) ───
  const r1071 = await db.transportRequest.create({
    data: {
      number: 'ЗК-2026/1071', status: 'DISPATCH',
      contractorId: contractors['ООО «Кубань Агро»'].id,
      cargo: 'Сахар-песок в мешках, 40 паллет', weightT: 17,
      fromLocationId: loc['timashevsk'].id, toLocationId: loc['krasnodar'].id,
      loadingAt: new Date(now.getTime() + dayMs), unloadingWindow: 'завтра 12:00–14:00',
      docs: JSON.stringify(['ТТН', 'Качественное удостоверение', 'Счёт-фактура']),
    },
  })
  await db.statusHistory.createMany({
    data: [
      { requestId: r1071.id, fromStatus: null, toStatus: 'NEW', actor: 'Логист' },
      { requestId: r1071.id, fromStatus: 'NEW', toStatus: 'DISPATCH', actor: 'Авто' },
    ],
  })
  regLog.push({ user: 'Логист', action: 'REQUEST_CREATE', entity: 'TransportRequest', entityId: 'ЗК-2026/1071' })

  // ─── ЗК-2026/1074 — Металлопрокат листовой (DISPATCH) ───
  const r1074 = await db.transportRequest.create({
    data: {
      number: 'ЗК-2026/1074', status: 'DISPATCH',
      contractorId: contractors['ООО «Донсталь»'].id,
      cargo: 'Металлопрокат листовой, 2 шт.', weightT: 20.2,
      fromLocationId: loc['abinsk'].id, toLocationId: loc['rostov'].id,
      loadingAt: new Date(now.getTime() + 2 * dayMs), unloadingWindow: 'послезавтра 09:00–11:00',
      docs: JSON.stringify(['ТТН (2 экз.)', 'Паспорт груза']),
    },
  })
  await db.statusHistory.createMany({
    data: [
      { requestId: r1074.id, fromStatus: null, toStatus: 'NEW', actor: 'Логист' },
      { requestId: r1074.id, fromStatus: 'NEW', toStatus: 'DISPATCH', actor: 'Авто' },
    ],
  })
  regLog.push({ user: 'Логист', action: 'REQUEST_CREATE', entity: 'TransportRequest', entityId: 'ЗК-2026/1074' })

  // ─── ЗК-2026/1067 — назначена: рождение рейса уже произошло (как после работы диспетчера) ───
  const loadingAt = new Date('2026-11-12T06:30:00.000Z')
  const r1067 = await db.transportRequest.create({
    data: {
      number: 'ЗК-2026/1067', status: 'ASSIGNED',
      contractorId: contractors['ООО «Новороссийский терминал»'].id,
      cargo: 'Металлоконструкции (фермы), штучные', weightT: 18.5,
      fromLocationId: loc['abinsk'].id, toLocationId: loc['novoross'].id,
      loadingAt, unloadingWindow: 'сегодня 14:00–16:00',
      docs: JSON.stringify(['ТТН (2 экз.)', 'Паспорт груза', 'Пропуск на терминал', 'Акт допуска ТС']),
      vehicleId: veh['А 123 БС 23'].id, trailerId: tr['АВ 456 23'].id,
      driverId: drv[0].id, assignedBy: 'Диспетчер Е. Крылова', assignedAt: new Date(now.getTime() - 3600 * 1000),
    },
  })
  const route1067 = stubRoute(loc['abinsk'], loc['novoross'], 115000, 150)
  const trip1067 = await db.trip.create({
    data: {
      tripCode: 'ЗК-2026/1067', status: 'assigned',
      driverId: drv[0].id, vehicleId: veh['А 123 БС 23'].id,
      plannedStartAt: loadingAt, plannedFinishAt: new Date(loadingAt.getTime() + 150 * 60000),
      ...route1067,
    },
  })
  const pt1067: { id: string; tripId: string; seqNo: number; kind: string; name: string | null; address: string | null; lat: number; lon: number; geofenceRadiusM: number; plannedArrivalAt: Date | null; plannedDepartureAt: Date | null }[] = []
  pt1067.push(await db.tripPoint.create({
    data: { tripId: trip1067.id, seqNo: 1, kind: 'loading', name: loc['abinsk'].name, address: loc['abinsk'].address, lat: loc['abinsk'].lat, lon: loc['abinsk'].lon, plannedArrivalAt: loadingAt, plannedDepartureAt: new Date(loadingAt.getTime() + 40 * 60000) },
  }))
  pt1067.push(await db.tripPoint.create({
    data: { tripId: trip1067.id, seqNo: 2, kind: 'unloading', name: loc['novoross'].name, address: loc['novoross'].address, lat: loc['novoross'].lat, lon: loc['novoross'].lon, plannedArrivalAt: new Date(loadingAt.getTime() + 150 * 60000) },
  }))
  await db.transportRequest.update({ where: { id: r1067.id }, data: { tripId: trip1067.id } })
  await db.statusHistory.createMany({
    data: [
      { requestId: r1067.id, fromStatus: null, toStatus: 'NEW', actor: 'Логист' },
      { requestId: r1067.id, fromStatus: 'NEW', toStatus: 'DISPATCH', actor: 'Авто' },
      { requestId: r1067.id, fromStatus: 'DISPATCH', toStatus: 'ASSIGNED', actor: 'Диспетчер Е. Крылова', comment: 'МАЗ 5440 · А 123 БС 23 + НЕФАЗ 93341 · АВ 456 23' },
    ],
  })
  const note1067 = await db.systemNote.create({
    data: {
      driverId: drv[0].id, kind: 'ORDER_ASSIGNED',
      body: 'Вам назначена заявка ЗК-2026/1067: Металлоконструкции (фермы), штучные, Абинск, пл. АЗМЗ → Новороссийск, причал 27. Погрузка 12.11 06:30.',
      ref: JSON.stringify({ requestId: r1067.id, tripId: trip1067.id }),
    },
  })
  journal.push(
    { driverId: drv[0].id, entity: 'TRIP', op: 'UPSERT', payload: JSON.stringify(tripSnapshot({ ...trip1067 })) },
    ...pt1067.map((p) => ({ driverId: drv[0].id, entity: 'TRIP_POINT', op: 'UPSERT', payload: JSON.stringify(tripPointSnapshot(p)) })),
    { driverId: drv[0].id, entity: 'SYSTEM_NOTE', op: 'UPSERT', payload: JSON.stringify(systemNoteSnapshot(note1067)) },
  )
  regLog.push({ user: 'Логист', action: 'REQUEST_CREATE', entity: 'TransportRequest', entityId: 'ЗК-2026/1067' })
  regLog.push({ user: 'Диспетчер Е. Крылова', action: 'ASSIGN', entity: 'TransportRequest', entityId: 'ЗК-2026/1067' })

  // ─── Чат: пара сообщений диспетчера и водителя-демо ───
  const chat1 = await db.chatMessage.create({
    data: { driverId: drv[0].id, tripId: trip1067.id, sender: 'DISPATCHER', body: 'Добрый день, Сергей! Перед выездом проверьте крепление ферм и наличие пропуска на терминал.' },
  })
  const chat2 = await db.chatMessage.create({
    data: { driverId: drv[0].id, tripId: trip1067.id, sender: 'DRIVER', body: 'Принял, добрый день. Пропуск на руках, осмотр пройду утром.' },
  })
  journal.push(
    { driverId: drv[0].id, entity: 'CHAT_MESSAGE', op: 'UPSERT', payload: JSON.stringify(chatMessageSnapshot(chat1)) },
    { driverId: drv[0].id, entity: 'CHAT_MESSAGE', op: 'UPSERT', payload: JSON.stringify(chatMessageSnapshot(chat2)) },
  )
  regLog.push({ user: 'Диспетчер Е. Крылова', action: 'CHAT_SEND', entity: 'ChatMessage', entityId: chat1.id })

  await db.syncJournal.createMany({ data: journal })
  await db.registrationLog.createMany({
    data: regLog.map((r) => ({ user: r.user, action: r.action, entity: r.entity, entityId: r.entityId, level: r.level ?? 'info' })),
  })

  console.log('Сид готов: 6 заявок (1067 ASSIGNED, 1071/1074 DISPATCH, 3 DONE), нумератор на ЗК-2026/1075')
  console.log('Демо-водитель приложения: d1111111-1111-4111-8111-111111111111 (Иванов С.П.)')
}

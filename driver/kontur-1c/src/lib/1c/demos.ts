// Демо-сервисы (демо-панель): случайная заявка, автопрогон сквозного сценария, сброс и пересев.
import { db, withWriteLock } from '../db'
import { seedAll } from '../seedAll'
import { createRequest } from './requests'
import { assignRequest } from './assign'
import { driverAction } from './driverActions'
import { journalWrite } from '../bus/syncWriter'
import { chatMessageSnapshot } from '../bus/snapshots'
import { logEvent } from './journal'

const CARGOS = [
  { name: 'Металлоконструкции (фермы), штучные', weight: 18.5, docs: ['ТТН (2 экз.)', 'Паспорт груза', 'Пропуск на терминал'] },
  { name: 'Сахар-песок в мешках, 40 паллет', weight: 17, docs: ['ТТН', 'Качественное удостоверение', 'Счёт-фактура'] },
  { name: 'Металлопрокат листовой, 2 шт.', weight: 20.2, docs: ['ТТН (2 экз.)', 'Паспорт груза'] },
  { name: 'Трубы стальные, 12 м', weight: 15, docs: ['ТТН (2 экз.)'] },
  { name: 'Пиломатериалы обрезные', weight: 12, docs: ['ТТН', 'Счёт-фактура'] },
  { name: 'Кирпич керамический, паллеты', weight: 19, docs: ['ТТН', 'Качественное удостоверение'] },
  { name: 'Оборудование промышленное, ящики', weight: 9.5, docs: ['ТТН (2 экз.)', 'Паспорт груза'] },
]

export async function createRandomRequest(actor = 'Демо-панель') {
  const contractors = await db.contractor.findMany()
  const locations = await db.location.findMany()
  const cargo = CARGOS[Math.floor(Math.random() * CARGOS.length)]
  const contractor = contractors[Math.floor(Math.random() * contractors.length)]
  let from = locations[Math.floor(Math.random() * locations.length)]
  let to = locations[Math.floor(Math.random() * locations.length)]
  while (to.id === from.id) to = locations[Math.floor(Math.random() * locations.length)]

  const loadingAt = new Date(Date.now() + (12 + Math.floor(Math.random() * 36)) * 3600 * 1000)
  const req = await createRequest({
    contractorId: contractor.id,
    cargo: cargo.name,
    weightT: cargo.weight,
    fromLocationId: from.id,
    toLocationId: to.id,
    loadingAt,
    unloadingWindow: 'на следующий день 09:00–12:00',
    docs: cargo.docs,
    actor,
  })
  return req
}

export type AutoflowStep = { step: string; ok: boolean; detail: string }

// Автопрогон сквозного сценария 10.1: заявка → назначение → ACCEPT → осмотр (6) → старт → завершение → чат
export async function autoflow(actor = 'Демо-панель'): Promise<AutoflowStep[]> {
  const log: AutoflowStep[] = []
  const push = (step: string, ok: boolean, detail: string) => log.push({ step, ok, detail })

  // Находим ЗК-2026/1071 либо создаём случайную
  let request = await db.transportRequest.findUnique({ where: { number: 'ЗК-2026/1071' }, include: { fromLocation: true, toLocation: true } })
  if (!request || request.status !== 'DISPATCH') {
    const created = await createRandomRequest(actor)
    request = await db.transportRequest.findUniqueOrThrow({ where: { id: created.id }, include: { fromLocation: true, toLocation: true } })
  }
  push('Заявка', true, `${request.number} в статусе DISPATCH`)

  // Назначение: КАМАЗ 5490 + свободный водитель (№2 по сценарию, если не занят в другом рейсе)
  const vehicle = await db.vehicle.findFirst({ where: { model: { startsWith: 'КАМАЗ 5490' }, readiness: 'ready' } })
  const allDrivers = await db.driver.findMany({ orderBy: { createdAt: 'asc' } })
  const busyIds = new Set((await db.trip.findMany({ where: { status: { in: ['assigned', 'in_progress'] } }, select: { driverId: true } })).map((t) => t.driverId))
  const driver2 = allDrivers.find((d, i) => i === 1 && !busyIds.has(d.id)) ?? allDrivers.find((d) => d.isActive && !busyIds.has(d.id))
  if (!vehicle || !driver2) {
    push('Назначение', false, 'Нет кандидатов (запустите пересев базы)')
    return log
  }
  const assign = await assignRequest(request.id, { vehicleId: vehicle!.id, driverId: driver2!.id }, 'Диспетчер Е. Крылова')
  push('Назначение', assign.ok, assign.ok ? `${request.number} → ${vehicle!.model} · ${vehicle!.plate}, ${driver2!.fullName}` : (assign.errors.join('; ') || 'отказ'))
  if (!assign.ok) return log

  // ACCEPT
  const accept = await driverAction({ orderId: request.number, action: 'ACCEPT' }, driver2!)
  push('Водитель: ACCEPT', accept.ok, accept.ok ? 'статус ACCEPTED' : accept.error)

  // 6 шагов фотофиксации
  const steps = ['veh_side', 'veh_front', 'veh_rear', 'order_docs', 'lic', 'passport']
  for (const s of steps) {
    const r = await driverAction({ orderId: request.number, action: 'PRETRIP_STEP', stepId: s }, driver2!)
    if (!r.ok) { push('Фотофиксация', false, `${s}: ${r.error}`); return log }
  }
  push('Фотофиксация', true, '6 из 6 шагов записаны')

  // START_ROUTE до осмотра → должен быть отклонён (на второй заявке не проверяем здесь;
  // проверка отказа выполняется сценарием приёмки вручную/через curl)
  const start = await driverAction({ orderId: request.number, action: 'START_ROUTE' }, driver2!)
  push('Старт маршрута', start.ok, start.ok ? 'TripEvent DEPARTURE, статус IN_PROGRESS' : start.error)
  if (!start.ok) return log

  // COMPLETE_TRIP
  const done = await driverAction({ orderId: request.number, action: 'COMPLETE_TRIP' }, driver2!)
  push('Завершение рейса', done.ok, done.ok ? 'TripEvent TRIP_DONE, интервалы закрыты, заявка DONE' : done.error)

  // Чат диспетчера
  if (done.ok) {
    const trip = await db.trip.findUnique({ where: { tripCode: request.number } })
    const msg = await withWriteLock(() =>
      db.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: { driverId: driver2.id, tripId: trip?.id ?? null, sender: 'DISPATCHER', body: `Рейс ${request!.number} принят. Сформируйте закрывающие документы на выгрузке.` },
      })
      await journalWrite(tx, driver2.id, 'CHAT_MESSAGE', 'UPSERT', chatMessageSnapshot(m))
        await logEvent(tx, { user: 'Диспетчер Е. Крылова', action: 'CHAT_SEND', entity: 'ChatMessage', entityId: m.id })
        return m
      }, { timeout: 15000 }),
    )
    push('Чат', true, `Сообщение диспетчера в плане обмена (seq SyncJournal обновлён, id ${msg.id.slice(0, 8)}…)`)
  }
  return log
}

export async function resetAndSeed() {
  await seedAll(db)
}

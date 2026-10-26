/**
 * Демо-рейс для показа ЭТрН через Диадок.
 *
 * Создаёт рейс «в работе» с вымышленным экипажем перевозчика из демо-данных
 * (ООО «Перевозчик А», логин carrier-a) и транспортной накладной, в которой уже
 * заполнены все данные для титула Т1: грузополучатель, адрес доставки с индексом,
 * груз, грузоподъёмность и вместимость ТС, телефоны. На показе остаётся открыть
 * «Подписать ЭДО» → «Отправить ЭТрН в Диадок» → «Отправить» и смотреть статусы.
 *
 * Каждый запуск — новый рейс (после показа накладная уже отправлена).
 *   npm run demo:etrn            — создать демо-рейс
 *   npm run demo:etrn -- --clean — удалить все демо-рейсы
 *
 * Без ключей Контура запускайте вместе с имитацией Диадока:
 *   node mini-services/diadoc-mock/server.mjs   (настройки — в её заголовке)
 * Все данные вымышленные.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const MARK = 'Демо-рейс для показа ЭТрН'

const pad = (n) => String(n).padStart(2, '0')
/** дата по Москве: ДД.ММ.ГГГГ */
const mskDate = (d) => {
  const m = new Date(d.getTime() + 3 * 3600_000)
  return `${pad(m.getUTCDate())}.${pad(m.getUTCMonth() + 1)}.${m.getUTCFullYear()}`
}

async function clean() {
  const demo = await db.request.findMany({ where: { comment: { startsWith: MARK } }, select: { id: true, number: true } })
  const ids = demo.map((r) => r.id)
  if (ids.length === 0) return console.log('Демо-рейсов нет')
  await db.edoDocument.deleteMany({ where: { requestId: { in: ids } } })
  await db.event.deleteMany({ where: { requestId: { in: ids } } })
  await db.notification.deleteMany({ where: { requestId: { in: ids } } })
  await db.document.deleteMany({ where: { requestId: { in: ids } } })
  await db.bid.deleteMany({ where: { requestId: { in: ids } } })
  await db.request.deleteMany({ where: { id: { in: ids } } })
  console.log(`Удалено демо-рейсов: ${ids.length} (${demo.map((r) => r.number).join(', ')})`)
}

async function create() {
  const carrier = (await db.user.findFirst({ where: { login: 'carrier-a' }, include: { carrier: true } }))?.carrier
    ?? await db.carrier.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!carrier) throw new Error('В базе нет перевозчиков — сначала заполните демо-данные (prisma db seed)')
  if (!carrier.phone) await db.carrier.update({ where: { id: carrier.id }, data: { phone: '+78610000001' } })

  // вымышленный экипаж — создаётся один раз и переиспользуется
  const driver = await db.driver.findFirst({ where: { carrierId: carrier.id, passport: '03 00 000001' } })
    ?? await db.driver.create({
      data: {
        carrierId: carrier.id, fullName: 'Петров Алексей Сергеевич', birthDate: '12.05.1985', passport: '03 00 000001',
        phone: '+79000000001',
        citizenship: 'РФ', position: 'Водитель-экспедитор', ownershipType: 'OWNED',
      },
    })
  const truck = await db.truck.findFirst({ where: { carrierId: carrier.id, plate: 'А001АА23' } })
    ?? await db.truck.create({
      data: {
        carrierId: carrier.id, brand: 'SITRAK C7H', plate: 'А001АА23', vin: 'LZZ7CCWD0PC000001', sts: '99 00 000001',
        owner: carrier.name, color: 'белый', ownershipType: 'LEASE', leaseContract: 'Демо-договор лизинга №1',
      },
    })
  const trailer = await db.trailer.findFirst({ where: { carrierId: carrier.id, plate: 'АА000123' } })
    ?? await db.trailer.create({
      data: {
        carrierId: carrier.id, plate: 'АА000123', sts: '99 00 000002', type: 'Полуприцеп тентованный',
        color: 'синий', owner: carrier.name, ownershipType: 'LEASE', leaseContract: 'Демо-договор лизинга №2',
      },
    })

  const last = await db.request.findMany({ select: { number: true } })
  const n = Math.max(1000, ...last.map((r) => Number(r.number.replace(/^Z-/, '')) || 0)) + 1
  const number = `Z-${n}`
  const now = new Date()
  const loadDate = mskDate(now)
  const cargo = 'Перевозка готовой продукции - арматура'
  const cargoType = await db.cargoType.findFirst({ where: { name: cargo } })

  const request = await db.request.create({
    data: {
      number, fromPoint: 'Абинск', toPoint: 'Новороссийск', cargo, cargoTypeId: cargoType?.id ?? null,
      comment: `${MARK} через Диадок (scripts/demo-etrn.mjs)`, createdBy: 'Демо',
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 3000, bestRate: 2850,
      status: 'CONFIRMED', loadDate, loadWindow: '08:00–12:00', deadline: new Date(now.getTime() - 3600_000),
      winnerId: carrier.id, driverId: driver.id, truckId: truck.id, trailerId: trailer.id,
    },
  })

  const seq = String(n)
  const truckLabel = `${truck.brand} · ${truck.plate}`
  // реквизиты для скана документа — как у накладной, которую платформа создаёт сама (src/lib/edo.ts)
  const payload = {
    title: 'Транспортная накладная (ЭТрН)', dateRu: loadDate, org: 'ООО «АЭМЗ» (грузоотправитель)',
    lines: [
      `Перевозчик: ${carrier.name}`, `Водитель: ${driver.fullName}`, `ТС: ${truckLabel}`,
      'Груз: Перевозка готовой продукции - арматура, 20 т', 'Маршрут: Абинск → Новороссийск', `Дата погрузки: ${loadDate}`,
      'ЭТП: ГИС ЭПД · оператор ЭДО · подписи КЭП сторон',
    ],
    driverName: driver.fullName, carrierName: carrier.name, accent: '#9a3412',
  }
  // данные титула Т1 (EtrnT1Input, src/lib/diadoc/waybill.ts) — заполнены полностью
  const etrnInput = {
    number: `ЭТрН ${seq}`, date: loadDate, orderNumber: number, orderDate: loadDate,
    consignee: { inn: '2315000001', kpp: '231501001', name: 'ООО «Демо-Терминал Новороссийск»', phone: '+78617000001' },
    delivery: { zip: '353900', region: '23', city: 'Новороссийск', street: 'Портовая', building: '7' },
    cargo: {
      name: 'Арматура А500С d12', condition: 'Без повреждений', packageMethod: 'Пачки', containerType: '00',
      places: '10', grossWeightKg: '20000', marks: 'Бирки завода на каждой пачке',
    },
    carrierPhone: '+78610000001',
    driver: { lastName: 'Петров', firstName: 'Алексей', middleName: 'Сергеевич', phone: '+79000000001' },
    vehicle: { number: 'А001АА23', ownership: '4', type: 'Тягач седельный', model: 'SITRAK C7H', maxWeight: '20', capacity: '82', sts: '9900000001', vin: 'LZZ7CCWD0PC000001' },
    trailer: { number: 'АА000123', ownership: '4', type: 'Полуприцеп тентованный', model: 'KRONE SD', maxWeight: '25', capacity: '90', sts: '9900000002', vin: '' },
    loading: {
      statedArrival: `${loadDate}T08:00:00+03:00`, actualArrival: `${loadDate}T08:20:00+03:00`,
      actualDeparture: `${loadDate}T10:45:00+03:00`, weighingMethod: '01',
    },
  }
  await db.edoDocument.create({
    data: {
      requestId: request.id, kind: 'ETRN', party: 'CARRIER', number: `ЭТрН ${seq}`,
      payload: JSON.stringify(payload), etrnInput: JSON.stringify(etrnInput),
    },
  })
  await db.event.create({ data: { requestId: request.id, type: 'TRIP_CONFIRMED', message: `${MARK}: рейс в работе, накладная готова к отправке в Диадок` } })

  console.log(`Демо-рейс ${number} создан: Абинск → Новороссийск, ${carrier.name}, ${truckLabel} + ${trailer.plate}`)
  console.log('Показ: вход логистом → «Подписать ЭДО» → рейс', number, '→ «Отправить ЭТрН в Диадок (Т1)» → «Отправить»;')
  console.log('статусы Т1 → Т2 → УИД ГИС ЭПД → Т3/Т4 → «Перевозка завершена» — кнопкой «Обновить статусы» или сами раз в DIADOC_SYNC_INTERVAL_SEC.')
}

try {
  if (process.argv.includes('--clean')) await clean()
  else await create()
} finally {
  await db.$disconnect()
}

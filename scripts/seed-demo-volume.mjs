/**
 * Наполнение демо-платформы АЭМЗ (презентация 20.11.2026).
 *
 * Детерминированно добавляет рейсы, заявки, черновики, ставки, документы,
 * события, уведомления, обращения и экипажи. Скрипт идемпотентен: повторный
 * запуск ничего не дублирует (маркер — onecRef «demo-vol-*»).
 *
 * Запуск: node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/seed-demo-volume.mjs
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

const MARK = 'demo-vol-'
const START_NUMBER = 1100
const DAY = 86_400_000
/** 1 сентября 2026, 09:00 МСК */
const BASE = Date.UTC(2026, 8, 1, 6, 0, 0)

const d = (offset, hourMsk = 9, minute = 0) => new Date(BASE + offset * DAY + ((hourMsk - 9) * 60 + minute) * 60_000)
const ruDate = (date) => {
  const p = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const g = (t) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('day')}.${g('month')}.${g('year')}`
}
const isoDay = (date) => {
  const p = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const g = (t) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
const round100 = (v) => Math.max(100, Math.round(v / 100) * 100)
const nf = new Intl.NumberFormat('ru-RU')

/** Детерминированный генератор, чтобы демо выглядело одинаково при пересборке */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length]
const int = (r, min, max) => min + Math.floor(r() * (max - min + 1))

const CITIES = [
  ['Москва', 1500, 4200], ['Санкт-Петербург', 2100, 5600], ['Казань', 1750, 4700],
  ['Екатеринбург', 2450, 6200], ['Нижний Новгород', 1550, 4300], ['Ростов-на-Дону', 280, 1500],
  ['Воронеж', 950, 2900], ['Самара', 1650, 4500], ['Уфа', 2050, 5200], ['Челябинск', 2350, 5900],
  ['Волгоград', 700, 2300], ['Новосибирск', 3900, 8800], ['Краснодар', 90, 900], ['Сочи', 250, 1800],
  ['Новороссийск', 150, 1400], ['Тула', 1350, 3900], ['Ярославль', 1650, 4600], ['Липецк', 1050, 3200],
  ['Белгород', 850, 2700], ['Саратов', 1150, 3400], ['Тольятти', 1550, 4300], ['Набережные Челны', 1850, 4900],
  ['Пермь', 2350, 6100], ['Тюмень', 2950, 7200], ['Омск', 3550, 8100], ['Красноярск', 4550, 9800],
  ['Иркутск', 5550, 11200], ['Владимир', 1450, 4100], ['Рязань', 1400, 4000], ['Тверь', 1800, 4900],
  ['Калуга', 1450, 4100], ['Брянск', 1250, 3600], ['Орёл', 1150, 3400], ['Курск', 950, 3000],
  ['Тамбов', 1050, 3200], ['Пенза', 1250, 3700], ['Ульяновск', 1650, 4500], ['Ижевск', 2050, 5300],
  ['Киров', 2250, 5800], ['Череповец', 2000, 5300], ['Вологда', 1900, 5100], ['Архангельск', 2600, 6600],
  ['Мурманск', 3300, 7900], ['Калининград', 2400, 6400], ['Смоленск', 1650, 4600], ['Псков', 1950, 5200],
  ['Великий Новгород', 2000, 5300], ['Петрозаводск', 2350, 6100],
]

const DRIVER_NAMES = [
  'Иванов Алексей Петрович', 'Смирнов Дмитрий Андреевич', 'Кузнецов Сергей Николаевич',
  'Попов Андрей Викторович', 'Васильев Михаил Юрьевич', 'Петров Николай Александрович',
  'Соколов Владимир Игоревич', 'Михайлов Роман Сергеевич', 'Новиков Павел Олегович',
  'Фёдоров Артём Денисович', 'Морозов Виктор Павлович', 'Волков Илья Максимович',
  'Алексеев Григорий Степанович', 'Лебедев Олег Валерьевич', 'Семёнов Антон Русланович',
  'Егоров Вадим Ильич', 'Павлов Константин Эдуардович', 'Козлов Денис Вячеславович',
  'Степанов Игорь Анатольевич', 'Николаев Максим Артурович', 'Орлов Евгений Тимурович',
  'Андреев Вячеслав Юрьевич', 'Макаров Борис Леонидович', 'Никитин Станислав Игоревич',
  'Захаров Руслан Маратович', 'Зайцев Кирилл Вадимович', 'Соловьёв Тарас Валерьевич',
  'Борисов Аркадий Фёдорович', 'Яковлев Пётр Семёнович', 'Григорьев Юрий Данилович',
  'Романов Анатолий Борисович', 'Воробьёв Иван Захарович', 'Сергеев Дмитрий Львович',
  'Кузьмин Валентин Олегович', 'Фролов Матвей Андреевич', 'Александров Лев Константинович',
  'Белов Егор Владиславович', 'Мухин Савелий Дмитриевич', 'Крылов Никита Александрович',
  'Титов Арсений Романович',
]

const TRUCK_MODELS = [
  ['КАМАЗ 5490', 'Синий'], ['Volvo FH 460', 'Белый'], ['Scania R440', 'Красный'],
  ['MAN TGX 18.440', 'Серебристый'], ['DAF XF 105', 'Синий'], ['Mercedes-Benz Actros', 'Белый'],
  ['КАМАЗ 65115', 'Оранжевый'], ['Renault Premium', 'Серый'],
]
const TRAILER_MODELS = ['п/п Kogel SN24', 'п/п Schmitz Cargobull', 'п/п Krone Profi Liner', 'п/п Wielton NW-3', 'п/п Тонар-9744']

const DOC_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYQ5SAAAAABJRU5ErkJggg=='

async function chunks(model, rows, size) {
  for (let i = 0; i < rows.length; i += size) {
    await model.createMany({ data: rows.slice(i, i + size) })
  }
}

async function main() {
  const seeded = await prisma.request.findFirst({ where: { onecRef: { startsWith: MARK } }, select: { id: true } })
  if (seeded) {
    console.log('Демо-данные уже добавлены — пропускаем.')
    return
  }

  const carriers = await prisma.carrier.findMany({ orderBy: { name: 'asc' } })
  if (carriers.length === 0) throw new Error('Нет перевозчиков — сначала выполните prisma/seed.ts')

  /* ——— 1. Экипажи: доводим справочник до «живого» объёма ——— */
  const driverRows = []
  const truckRows = []
  const trailerRows = []
  let nameIdx = 0
  const plateLetters = 'АВЕКМНОРСТУХ'
  const plate = (r, region) => {
    const l = () => plateLetters[Math.floor(r() * plateLetters.length)]
    return `${l()}${int(r, 100, 999)}${l()}${l()} ${region}`
  }
  for (let ci = 0; ci < carriers.length; ci++) {
    const c = carriers[ci]
    const [drivers, trucks, trailers] = await Promise.all([
      prisma.driver.count({ where: { carrierId: c.id } }),
      prisma.truck.count({ where: { carrierId: c.id } }),
      prisma.trailer.count({ where: { carrierId: c.id } }),
    ])
    const r = rng(1000 + ci * 37)
    for (let i = drivers; i < 15; i++) {
      const name = DRIVER_NAMES[nameIdx++ % DRIVER_NAMES.length]
      driverRows.push({
        id: randomUUID(), carrierId: c.id, fullName: name,
        birthDate: `${int(r, 1, 28)}.${String(int(r, 1, 12)).padStart(2, '0')}.${int(r, 1972, 1992)}`,
        passport: `${int(r, 40, 49)} ${int(r, 10, 19)} ${int(r, 100000, 999999)}`,
        phone: `+7 (9${int(r, 10, 99)}) ${int(r, 100, 999)}-${int(r, 10, 99)}-${int(r, 10, 99)}`,
        birthPlace: pick(r, ['г. Абинск', 'г. Краснодар', 'ст. Холмская', 'г. Славянск-на-Кубани', 'г. Крымск']),
        address: `Краснодарский край, ${pick(r, ['г. Абинск', 'г. Крымск', 'г. Славянск-на-Кубани'])}, ул. ${pick(r, ['Мира', 'Садовая', 'Заводская', 'Ленина'])}, д. ${int(r, 1, 80)}`,
        citizenship: 'РФ', passportIssuedBy: 'ОВД Абинского района Краснодарского края',
        passportIssuedDate: `${int(r, 1, 28)}.${String(int(r, 1, 12)).padStart(2, '0')}.${int(r, 2010, 2018)}`,
        position: 'Водитель', ownershipType: pick(r, ['OWNED', 'HIRED', 'LEASE']),
        ownerName: pick(r, ['', c.name, 'ИП Смирнов А. В.']),
        leaseContract: pick(r, ['', `Л-${int(r, 10, 99)}/2026`]),
        createdAt: d(-10), updatedAt: d(-1),
      })
    }
    for (let i = trucks; i < 9; i++) {
      const [brand, color] = TRUCK_MODELS[(ci * 3 + i) % TRUCK_MODELS.length]
      truckRows.push({
        id: randomUUID(), carrierId: c.id, brand, plate: plate(r, pick(r, ['23', '34', '61', '93', '123'])),
        vin: `X${int(r, 1000000, 9999999)}${int(r, 1000000, 9999999)}`,
        sts: `${int(r, 10, 99)} ${int(r, 10, 99)} ${int(r, 100000, 999999)}`,
        techTill: `${int(r, 1, 28)}.${String(int(r, 1, 12)).padStart(2, '0')}.2027`,
        owner: pick(r, [c.name, 'ООО «АЭМЗ-Транс»']), color,
        ownershipType: pick(r, ['OWNED', 'HIRED', 'LEASE']),
        leaseContract: pick(r, ['', `Л-${int(r, 10, 99)}/2026`]),
        createdAt: d(-10), updatedAt: d(-1),
      })
    }
    for (let i = trailers; i < 7; i++) {
      trailerRows.push({
        id: randomUUID(), carrierId: c.id, plate: plate(r, pick(r, ['23', '34', '61', '93'])),
        sts: `${int(r, 10, 99)} ${int(r, 10, 99)} ${int(r, 100000, 999999)}`,
        type: pick(r, TRAILER_MODELS),
        techTill: `${int(r, 1, 28)}.${String(int(r, 1, 12)).padStart(2, '0')}.2027`,
        color: pick(r, ['Серый', 'Синий', 'Белый']), owner: c.name,
        ownershipType: pick(r, ['OWNED', 'HIRED', 'LEASE']), leaseContract: '',
        createdAt: d(-10), updatedAt: d(-1),
      })
    }
  }
  await chunks(prisma.driver, driverRows, 25)
  await chunks(prisma.truck, truckRows, 25)
  await chunks(prisma.trailer, trailerRows, 25)
  console.log(`Справочник: +${driverRows.length} водителей, +${truckRows.length} машин, +${trailerRows.length} прицепов`)

  const allDrivers = await prisma.driver.findMany()
  const allTrucks = await prisma.truck.findMany()
  const allTrailers = await prisma.trailer.findMany()
  const driversOf = (carrierId) => allDrivers.filter((x) => x.carrierId === carrierId)
  const trucksOf = (carrierId) => allTrucks.filter((x) => x.carrierId === carrierId)
  const trailersOf = (carrierId) => allTrailers.filter((x) => x.carrierId === carrierId)

  const cargoTypes = await prisma.cargoType.findMany()
  if (cargoTypes.length === 0) throw new Error('Нет типов груза — сначала выполните prisma/seed.ts')
  const cargoByName = new Map(cargoTypes.map((c) => [c.name, c]))
  const cargoNames = cargoTypes.map((c) => c.name)

  /* ——— 2. Заявки и рейсы ——— */
  const plan = [
    { status: 'CLOSED', count: 52, offset: (i, n) => 2 + Math.floor((i * 74) / Math.max(1, n - 1)) },
    { status: 'CONFIRMED', count: 16, offset: (i) => (i < 8 ? 77 + (i % 3) : 80 + (i % 8)) },
    { status: 'AT_LOGIST', count: 6, offset: (i) => 80 + (i % 6) },
    { status: 'DOCS_REVIEW', count: 6, offset: (i) => 81 + (i % 6) },
    { status: 'AWARDED', count: 10, offset: (i) => 83 + (i % 8) },
    { status: 'PUBLISHED', count: 14, offset: (i, n) => 91 + Math.floor((i * 20) / Math.max(1, n - 1)) },
    { status: 'DRAFT', count: 20, offset: (i, n) => 91 + Math.floor((i * 25) / Math.max(1, n - 1)) },
    { status: 'DELETED', count: 6, offset: (i) => 20 + i * 10 },
  ]

  const requestRows = []
  const bidSpecs = []
  const docSpecs = []
  const eventSpecs = []
  const requestMeta = []
  let number = START_NUMBER
  const logistNames = ['Соколов Дмитрий Алексеевич', 'Морозова Анна Сергеевна']

  for (const part of plan) {
    for (let i = 0; i < part.count; i++) {
      const r = rng(number * 7919 + 13)
      const loadOffset = part.offset(i, part.count)
      const loadAt = d(loadOffset, int(r, 8, 15))
      const createdOffset = Math.max(0, loadOffset - int(r, 3, 7))
      const createdAt = d(createdOffset, int(r, 7, 17), int(r, 0, 59))
      const [city, km, baseRate] = CITIES[(number * 11 + i * 3) % CITIES.length]
      const cargoName = cargoNames[(number + i * 5) % cargoNames.length]
      const cargoType = cargoByName.get(cargoName)
      const truckType = cargoType?.truckType ?? 'Тент'
      const tonnage = truckType === 'Тент' ? 20 : int(r, 21, 24)
      const mode = r() < 0.72 ? 'AUCTION' : 'CLOSED'
      const startRate = round100(baseRate * (0.92 + r() * 0.22))
      const isWinnerStatus = ['AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(part.status)
      const carrier = carriers[(number + i) % carriers.length]
      const bestRate = part.status === 'DRAFT'
        ? null
        : round100(startRate * (0.83 + r() * 0.11))
      const id = randomUUID()
      const fromPoint = r() < 0.09 ? city : 'Абинск'
      const toPoint = fromPoint === 'Абинск' ? city : 'Абинск'
      const crewCarrier = isWinnerStatus ? carrier : null
      const ds = crewCarrier ? driversOf(crewCarrier.id) : []
      const ts = crewCarrier ? trucksOf(crewCarrier.id) : []
      const zs = crewCarrier ? trailersOf(crewCarrier.id) : []
      const driver = ds.length ? ds[(number + i) % ds.length] : null
      const truck = ts.length ? ts[(number + i * 3) % ts.length] : null
      const trailer = zs.length ? zs[(number + i * 5) % zs.length] : null
      const loadDate = ruDate(loadAt)

      requestRows.push({
        id, number: `Z-${number}`, onecRef: `${MARK}${number}`,
        fromPoint,
        toPoint: fromPoint === 'Абинск'
          ? `${city}${r() < 0.4 ? `, ${pick(r, ['ул. Заводская, д. 12', 'ул. Промышленная, д. 4', 'Портовая ул. 1', 'ш. Московское, 15'])}` : ''}`
          : 'Краснодарский край, г. Абинск, ул. Промышленная, д. 4',
        cargo: cargoName, cargoTypeId: cargoType?.id ?? null,
        comment: r() < 0.18 ? pick(r, [
          'Погрузка через весовую, нужен пропуск на территорию завода.',
          'Водителю связаться с диспетчером за 2 часа до прибытия.',
          'Тент обязателен: продукция не должна намокнуть.',
          'Разгрузка по предварительной записи, окно согласовано.',
        ]) : '',
        createdBy: r() < 0.5 ? logistNames[(number + i) % logistNames.length] : '—',
        tonnage, truckType, mode, startRate, bestRate,
        status: part.status,
        loadDate,
        loadWindow: pick(r, ['08:00–12:00', '09:00–13:00', '10:00–15:00', '07:00–11:00', '13:00–17:00']),
        deadline: part.status === 'PUBLISHED'
          ? new Date(Date.UTC(2026, 11, 1 + int(r, 0, 13), 9, 0, 0))
          : createdAt,
        winnerId: isWinnerStatus ? carrier.id : null,
        driverId: isWinnerStatus && driver ? driver.id : null,
        truckId: isWinnerStatus && truck ? truck.id : null,
        trailerId: isWinnerStatus && trailer ? trailer.id : null,
        executorRole: isWinnerStatus && carrier.role === 'FORWARDER' ? 'FORWARDER' : null,
        transportOwnership: pick(r, ['OWNED', 'OWNED', 'HIRED', 'LEASE']),
        passPackage: ['AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(part.status) && r() < 0.9,
        etrnStatus: part.status === 'CLOSED' ? 'SIGNED' : ['CONFIRMED', 'AT_LOGIST'].includes(part.status) ? 'SENT' : 'NONE',
        verifyComment: part.status === 'CONFIRMED' || part.status === 'CLOSED' ? 'Документы и экипаж сверены, рейс допущен.' : null,
        createdAt, updatedAt: loadAt,
      })

      requestMeta.push({ id, number: `Z-${number}`, status: part.status, createdAt, loadAt, carrier, driver, truck, trailer, city, tonnage, startRate, bestRate, km })

      /* ——— ставки ——— */
      if (part.status !== 'DRAFT' && part.status !== 'DELETED') {
        const participants = new Set()
        if (isWinnerStatus) participants.add(carrier.id)
        const need = int(r, 2, 5)
        while (participants.size < Math.min(need, carriers.length)) participants.add(carriers[int(r, 0, carriers.length - 1)].id)
        const list = [...participants]
        let amount = Math.max(500, bestRate ?? startRate)
        for (let bi = 0; bi < list.length; bi++) {
          const cid = list[bi]
          const isWinner = isWinnerStatus && cid === carrier.id
          const bidAmount = isWinner ? amount : round100(amount + int(r, 1, 9) * 100)
          bidSpecs.push({
            id: randomUUID(), requestId: id, carrierId: cid,
            amount: Math.min(bidAmount, startRate),
            isWinner,
            withdrawn: !isWinner && r() < 0.08,
            createdAt: new Date(createdAt.getTime() + (8 + bi * 5) * 3_600_000 + int(r, 0, 50) * 60_000),
          })
          amount = bidAmount
        }
      }

      /* ——— документы ——— */
      if (isWinnerStatus) {
        const docTypes = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'STS']
        for (let di = 0; di < docTypes.length; di++) {
          const type = docTypes[di]
          let status = 'PENDING'
          if (['AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(part.status)) status = 'PASSED'
          else if (part.status === 'DOCS_REVIEW') status = pick(r, ['PASSED', 'PENDING', 'PENDING', 'REUPLOAD'])
          else if (part.status === 'AWARDED') status = 'PENDING'
          docSpecs.push({
            id: randomUUID(), requestId: id, type,
            fileName: `${type.toLowerCase()}_${number}_${di + 1}.jpg`,
            dataUri: DOC_PNG, status,
            quality: status === 'PENDING' ? null : 82 + Math.round(r() * 17),
            engine: status === 'PENDING' ? null : 'ocr-v2',
            fields: status === 'PENDING' ? null : JSON.stringify({ number: `${int(r, 4000, 4999)} ${int(r, 100000, 999999)}`, fio: driver?.fullName ?? '—' }),
            confidence: status === 'PENDING' ? null : JSON.stringify({ number: 0.93, fio: 0.9 }),
            issues: status === 'REUPLOAD' ? JSON.stringify(['Не читается серия документа']) : null,
            message: status === 'REUPLOAD' ? 'Загрузите более чёткое фото страницы' : null,
            createdAt: new Date(createdAt.getTime() + (12 + di) * 3_600_000),
            updatedAt: new Date(createdAt.getTime() + (24 + di) * 3_600_000),
          })
        }
      }

      /* ——— события ——— */
      const ev = (type, message, at) => eventSpecs.push({ id: randomUUID(), requestId: id, carrierId: isWinnerStatus ? carrier.id : null, type, message, createdAt: at })
      ev('REQUEST_CREATED', `Заявка №Z-${number} создана: ${fromPoint} → ${city}, ${cargoName}, ${tonnage} т`, createdAt)
      if (part.status !== 'DRAFT') ev('REQUEST_CREATED', `Заявка №Z-${number} опубликована на площадке, стартовая ставка ${nf.format(startRate)} ₽/т`, new Date(createdAt.getTime() + 3_600_000))
      if (isWinnerStatus && bestRate != null) ev('BID_PLACED', `${carrier.name}: ставка ${nf.format(bestRate)} ₽/т — лучшая по заявке №Z-${number}`, new Date(createdAt.getTime() + 28 * 3_600_000))
      if (isWinnerStatus) ev('CREW_ASSIGNED', `Экипаж назначен: ${driver?.fullName ?? 'водитель'}, ${truck ? `${truck.brand} · ${truck.plate}` : 'ТС'}`, new Date(createdAt.getTime() + 40 * 3_600_000))
      if (['AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(part.status)) ev('DOCS_VERIFIED', `Документы по заявке №Z-${number} проверены, пакет принят`, new Date(createdAt.getTime() + 52 * 3_600_000))
      if (part.status === 'CONFIRMED' || part.status === 'CLOSED') ev('TRIP_CONFIRMED', `Рейс №Z-${number} подтверждён, пропуск оформлен`, new Date(loadAt.getTime() - 12 * 3_600_000))
      if (part.status === 'CLOSED') ev('TRIP_CLOSED', `Рейс №Z-${number} закрыт, документы приняты бухгалтерией`, new Date(loadAt.getTime() + 30 * 3_600_000))

      number++
    }
  }

  await chunks(prisma.request, requestRows, 25)
  await chunks(prisma.bid, bidSpecs, 120)
  await chunks(prisma.document, docSpecs, 60)
  await chunks(prisma.event, eventSpecs, 100)
  const statusCount = requestRows.reduce((acc, x) => { acc[x.status] = (acc[x.status] ?? 0) + 1; return acc }, {})
  console.log(`Заявки: +${requestRows.length}`, statusCount, `ставок +${bidSpecs.length}, документов +${docSpecs.length}, событий +${eventSpecs.length}`)

  /* ——— 3. Уведомления ——— */
  const users = await prisma.user.findMany({ include: { carrier: true } })
  const logists = users.filter((u) => u.role === 'logist' || u.role === 'admin')
  const carrierUsers = new Map(users.filter((u) => u.role === 'carrier' && u.carrierId).map((u) => [u.carrierId, u]))
  const notifyRows = []
  const recent = requestMeta.filter((x) => x.createdAt >= d(55, 0))
  for (const x of recent) {
    const logist = logists[x.number.length % logists.length]
    if (x.bestRate != null && x.status !== 'DRAFT') {
      notifyRows.push({
        id: randomUUID(), userId: logist.id, type: 'BID_PLACED',
        title: `Новая ставка по заявке №${x.number}`,
        body: `${x.carrier.name} предложил ${nf.format(x.bestRate)} ₽/т на маршруте Абинск → ${x.city}.`,
        requestId: x.id, read: true, createdAt: new Date(x.createdAt.getTime() + 6 * 3_600_000),
      })
    }
    const cu = carrierUsers.get(x.carrier.id)
    if (cu && ['AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(x.status)) {
      notifyRows.push({
        id: randomUUID(), userId: cu.id, type: 'WINNER_AWARDED',
        title: `Вы выбраны по заявке №${x.number}`,
        body: `Маршрут Абинск → ${x.city}, ${x.tonnage} т. Назначьте экипаж и загрузите документы.`,
        requestId: x.id, read: x.status === 'CLOSED' || Math.random() < 0.35, createdAt: new Date(x.createdAt.getTime() + 30 * 3_600_000),
      })
    }
    if (x.status === 'CLOSED') {
      notifyRows.push({
        id: randomUUID(), userId: logist.id, type: 'TRIP_CLOSED',
        title: `Рейс №${x.number} закрыт`,
        body: `${x.carrier.name}: ${x.tonnage} т, ${nf.format((x.bestRate ?? x.startRate) * x.tonnage)} ₽. Данные ушли в отчёты.`,
        requestId: x.id, read: true, createdAt: new Date(x.loadAt.getTime() + 32 * 3_600_000),
      })
    }
  }
  await chunks(prisma.notification, notifyRows, 80)
  console.log(`Уведомления: +${notifyRows.length}`)

  /* ——— 4. Обращения ——— */
  const maxTicket = await prisma.ticket.aggregate({ _max: { number: true } })
  let ticketNumber = (maxTicket._max.number ?? 0) + 1
  const ticketPlan = [
    ['docs', 'OPEN', 'Не приходит доверенность по заявке', 'По заявке водитель ждёт доверенность на погрузку, в разделе «Документы» файл не появился. Подскажите, когда будет?'],
    ['auction', 'ANSWERED', 'Не получается подать ставку', 'При подаче ставки по заявке площадка показывает ошибку. Ставка не сохраняется, пробовали дважды.'],
    ['payment', 'CLOSED', 'Оплата по закрытому рейсу', 'Рейс закрыт 12.11, акт подписан. Когда ожидать оплату на расчётный счёт?'],
    ['docs', 'ANSWERED', 'СТС на прицеп не читается', 'Загрузили скан СТС на прицеп, но система пишет «перезагрузить». Фото чёткое, проверьте, пожалуйста.'],
    ['tech', 'OPEN', 'Не открывается карточка рейса', 'В реестре рейсов при нажатии на номер карточка не открывается, страница зависает.'],
    ['other', 'CLOSED', 'Добавить водителя в справочник', 'Просим добавить нового водителя в справочник нашей компании — документы прикладываем в обращении.'],
    ['docs', 'OPEN', 'Нужен пропуск на второй заезд', 'Водитель уже был на погрузке, нужен повторный пропуск на территорию завода.'],
    ['auction', 'CLOSED', 'Продлить срок подачи ставок', 'Просим продлить приём ставок по заявке на 2 часа: не успеваем согласовать с собственником.'],
    ['payment', 'ANSWERED', 'Сверка по закрытым рейсам', 'Просим прислать акт сверки за октябрь — расходится сумма по одному рейсу.'],
    ['tech', 'ANSWERED', 'Мобильное приложение не синхронизируется', 'Водитель не видит новый рейс в приложении, статус «На связи» есть. Что проверить?'],
    ['other', 'OPEN', 'Изменить контакт диспетчера', 'Сменился телефон диспетчера, просим обновить контакт в справочнике.'],
    ['docs', 'ANSWERED', 'Доверенность на выгрузку', 'Нужна доверенность на получение груза, водитель едет на выгрузку впервые.'],
    ['auction', 'OPEN', 'Закрытые ставки: как узнать итог', 'Подали ставку в закрытом режиме. Где увидеть итоговую ставку и результат?'],
    ['payment', 'OPEN', 'Акт оказанных услуг', 'Когда будет сформирован акт за ноябрь и куда его подписать?'],
    ['other', 'CLOSED', 'Благодарность диспетчеру', 'Оперативно помогли с пропуском, водитель заехал вовремя. Спасибо!'],
  ]
  const ticketRows = []
  const messageRows = []
  for (const [category, status, subject, firstBody] of ticketPlan) {
    const carrier = carriers[(ticketNumber * 3) % carriers.length]
    const author = carrierUsers.get(carrier.id) ?? users.find((u) => u.role === 'carrier')
    if (!author) continue
    const createdAt = new Date(Date.UTC(2026, 10, 6 + (ticketNumber % 12), 6 + (ticketNumber % 8), 10, 0))
    const id = randomUUID()
    const messages = [{ role: 'carrier', author, body: firstBody, at: createdAt }]
    if (status !== 'OPEN') {
      const logist = logists[ticketNumber % logists.length]
      messages.push({
        role: logist.role, author: logist, at: new Date(createdAt.getTime() + 45 * 60_000),
        body: category === 'payment'
          ? 'Проверили: платёжное поручение в обработке банка, ожидаемый срок зачисления — 2 рабочих дня. Держим вопрос на контроле.'
          : category === 'docs'
            ? 'Проверили пакет: документ перевыпущен и доступен в карточке заявки. Если не отображается — обновите страницу.'
            : category === 'tech'
              ? 'Передали разработчикам, проблему воспроизвели. Временное решение — обновить страницу и открыть карточку из реестра рейсов.'
              : 'Приняли в работу, уточнили данные у профильного отдела. Вернёмся с ответом в этом обращении.',
      })
    }
    if (status === 'CLOSED') {
      messages.push({
        role: 'carrier', author, at: new Date(createdAt.getTime() + 95 * 60_000),
        body: 'Спасибо, вопрос решён. Обращение можно закрывать.',
      })
      const logist = logists[ticketNumber % logists.length]
      messages.push({ role: logist.role, author: logist, at: new Date(createdAt.getTime() + 110 * 60_000), body: 'Отлично. Закрываем обращение, если понадобится — напишите здесь же.' })
    }
    const last = messages[messages.length - 1]
    ticketRows.push({
      id, number: ticketNumber, subject, category, status,
      authorId: author.id, authorName: author.name,
      carrierId: carrier.id, carrierName: carrier.name,
      sizeTotal: category === 'docs' ? 240_000 : 0,
      lastMessageAt: last.at, createdAt, updatedAt: last.at,
    })
    for (const m of messages) {
      messageRows.push({
        id: randomUUID(), ticketId: id, authorId: m.author.id, authorName: m.author.name,
        authorRole: m.role, staff: m.role !== 'carrier', body: m.body, createdAt: m.at,
      })
    }
    ticketNumber++
  }
  await chunks(prisma.ticket, ticketRows, 10)
  await chunks(prisma.ticketMessage, messageRows, 80)
  console.log(`Обращения: +${ticketRows.length}, сообщений +${messageRows.length}`)

  console.log('ГОТОВО: демо-данные добавлены.')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())

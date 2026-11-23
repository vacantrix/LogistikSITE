// Демо-данные (выбор пользователя: демо-парк) — масштаб реального парка АЭМЗ:
// 150 водителей, 160 тягачей, 140 прицепов (300 единиц техники), 30 заявок во
// всех стадиях жизненного цикла (новые, к планированию, запланированные,
// в рейсе, выполненные, карантин) и 14 рейсов (активные + завершённые).
// Парк — собственный АЭМЗ (ownership "own"); назначение — из своего парка.
// Поля справочника (паспорт, ВУ, VIN, СТС, техосмотр) — с реалистичным
// распределением сроков: часть истекла, часть истекает (контроль в «Справочниках»).
import { db } from '@/lib/kontur/db'
import { hashPassword, DEMO_PASSWORD } from '@/lib/kontur/auth'
import type { Prisma } from '@/generated/kontur-client'

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * 60000)
}
function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 86400000)
}

// —— детерминированный генератор (демо воспроизводимо от запуска к запуску) ——
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20261118)
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
const int = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1))
const pad2 = (n: number): string => String(n).padStart(2, '0')
/** Дата в формате ДД.ММ.ГГГГ со сдвигом в днях от сегодня (может быть отрицательным) */
function dateStr(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86400000)
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
}

// —— фамилии/имена/отчества для генерации штатных водителей ——
const MALE_SURNAMES = ['Иванов', 'Кузнецов', 'Сидоров', 'Морозов', 'Волков', 'Зайцев', 'Павлов', 'Семёнов', 'Голубев', 'Виноградов', 'Богданов', 'Воробьёв', 'Фёдоров', 'Михайлов', 'Беляев', 'Тарасов', 'Белов', 'Комаров', 'Орлов', 'Киселёв', 'Лебедев', 'Ковалёв', 'Кузьмин', 'Гусев', 'Коновалов', 'Лазарев', 'Бирюков', 'Соколов', 'Жуков', 'Дроздов', 'Никифоров', 'Прохоров', 'Наумов', 'Щербаков', 'Егоров', 'Фролов', 'Макаров', 'Черкасов', 'Мартынов', 'Николаев', 'Захаров', 'Зыков', 'Миронов', 'Тихонов', 'Колесников', 'Карпов', 'Акимов', 'Блинов', 'Громов', 'Трофимов']
const MALE_NAMES = ['Пётр', 'Олег', 'Андрей', 'Виктор', 'Сергей', 'Николай', 'Иван', 'Александр', 'Михаил', 'Дмитрий', 'Юрий', 'Владимир', 'Анатолий', 'Алексей', 'Василий', 'Роман', 'Евгений', 'Константин', 'Валерий', 'Геннадий', 'Станислав', 'Григорий', 'Виталий', 'Эдуард', 'Тарас', 'Руслан', 'Денис', 'Артём']
const PATRONYMICS = ['Сергеевич', 'Викторович', 'Николаевич', 'Павлович', 'Иванович', 'Петрович', 'Александрович', 'Михайлович', 'Дмитриевич', 'Юрьевич', 'Владимирович', 'Анатольевич', 'Алексеевич', 'Васильевич', 'Романович', 'Евгеньевич', 'Константинович', 'Валерьевич', 'Григорьевич', 'Фёдорович', 'Степанович', 'Олегович']
const FEMALE_SURNAMES = ['Смирнова', 'Кузнецова', 'Морозова', 'Волкова', 'Павлова', 'Попова', 'Соколова', 'Лебедева', 'Козлова', 'Новикова']
const FEMALE_NAMES = ['Ольга', 'Марина', 'Елена', 'Наталья', 'Татьяна', 'Ирина', 'Светлана', 'Анна', 'Галина', 'Вера']

// —— техника: марки и параметры ——
const TRACTOR_BRANDS = ['КАМАЗ 5490 НЕО', 'КАМАЗ 6520', 'Scania R450', 'Scania R400', 'Volvo FH 460', 'Volvo FM 13', 'MAN TGS 33.400', 'MAN TGX 18.440', 'SITRAK C7H', 'Shacman X3000', 'Howo T7H', 'Mercedes-Benz Actros 1845', 'МАЗ 5440', 'Iveco Stralis 460', 'DAF XF 480', 'ГАЗ Валдай NEXT']
const TRAILER_BRANDS = ['Тонар 9678', 'МАЗ 9758', 'СЗАП 9327', 'NEFAZ 9334', 'Schmitz S.KO', 'Krone Profi Liner', 'Kögel Cargo', 'Grunwald 9597']
const TRAILER_TYPES = ['шторный', 'бортовой', 'рефрижераторный', 'контейнеровоз']
const PLATE_PAIRS = ['АЕ', 'АВ', 'ВЕ', 'ЕК', 'КМ', 'МН', 'НО', 'ОР', 'РС', 'СТ', 'ТУ', 'УХ', 'ХА', 'АО', 'ОА', 'ВМ', 'КА', 'МА', 'НА', 'РА', 'СА', 'ТА', 'ВА', 'ЕА', 'ОМ', 'АМ', 'ВХ', 'КХ']
const VIN_PREFIX: Record<string, string> = { 'КАМАЗ 5490 НЕО': 'XTC', 'КАМАЗ 6520': 'XTC', 'МАЗ 5440': 'Y3M', 'ГАЗ Валдай NEXT': 'X96', 'SITRAK C7H': 'LSH', 'Shacman X3000': 'LSJ', 'Howo T7H': 'LZZ' }
const VIN_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

/** Госномер формата «АЕ 12345 23» без повторов */
function makePlateFactory(taken: Set<string>) {
  let n = 10001
  return () => {
    for (;;) {
      const pair = PLATE_PAIRS[Math.floor(n / 300) % PLATE_PAIRS.length]
      const plate = `${pair} ${n % 100000} 23`
      n += 7
      if (!taken.has(plate)) { taken.add(plate); return plate }
    }
  }
}

/** VIN из 17 символов (префикс WMI по марке + детерминированный хвост) */
function makeVin(brand: string): string {
  const prefix = VIN_PREFIX[brand] ?? 'W' + pick(['DB', 'V1', 'F3', 'AU'])
  let s = ''
  for (let i = 0; i < 17 - prefix.length; i++) {
    s += VIN_ALPHABET[Math.floor(rnd() * VIN_ALPHABET.length)]
  }
  return (prefix + s).slice(0, 17)
}

/** СТС вида «23 25 123456» */
let stsCounter = 123001
const nextSts = (): string => {
  stsCounter += Math.floor(rnd() * 3) + 1
  const c = String(stsCounter)
  return `23 ${pad2(int(1, 49))} ${c}`
}

/** Гарантирует наличие учётных записей контура (дёшево: один count при уже засеянной базе) */
export async function ensureUsers(): Promise<void> {
  if (await db.user.count()) return
  const passHash = hashPassword(DEMO_PASSWORD)
  await db.user.upsert({
    where: { login: 'admin' },
    update: {},
    create: {
      login: 'admin', fullName: 'Кузьмина Ирина Валерьевна', position: 'Администратор системы', role: 'admin',
      phone: '+7 861 17 02 11', email: 'kuzmina@aemz.ru', passwordHash: passHash,
    },
  })
  await db.user.upsert({
    where: { login: 'logist1' },
    update: {},
    create: {
      login: 'logist1', fullName: 'Ефремов Павел Николаевич', position: 'Ведущий специалист по логистике', role: 'logist',
      phone: '+7 861 17 02 21', email: 'efremov@aemz.ru', passwordHash: passHash,
    },
  })
  await db.user.upsert({
    where: { login: 'logist2' },
    update: {},
    create: {
      login: 'logist2', fullName: 'Тарасова Марина Львовна', position: 'Специалист по логистике', role: 'logist',
      phone: '+7 861 17 02 22', email: 'tarasova@aemz.ru', passwordHash: passHash,
    },
  })
}

export async function seedDemo() {
  await db.statusEvent.deleteMany()
  await db.tripEvent.deleteMany()
  await db.fileRec.deleteMany()
  await db.outbox1c.deleteMany()
  await db.auditLog.deleteMany()
  await db.leg.deleteMany()
  await db.trip.deleteMany()
  await db.order.deleteMany()
  await db.atiDeal.deleteMany()
  await db.device.deleteMany()
  await db.driver.deleteMany()
  await db.vehicle.deleteMany()
  await db.trailer.deleteMany()

  // --- Пользователи кабинета (логисты + администрация) ---
  const passHash = hashPassword(DEMO_PASSWORD)
  await db.user.upsert({
    where: { login: 'admin' },
    update: { fullName: 'Кузьмина Ирина Валерьевна', position: 'Администратор системы', role: 'admin', passwordHash: passHash },
    create: {
      login: 'admin', fullName: 'Кузьмина Ирина Валерьевна', position: 'Администратор системы', role: 'admin',
      phone: '+7 861 17 02 11', email: 'kuzmina@aemz.ru', passwordHash: passHash,
    },
  })
  await db.user.upsert({
    where: { login: 'logist1' },
    update: { fullName: 'Ефремов Павел Николаевич', position: 'Ведущий специалист по логистике', role: 'logist', passwordHash: passHash },
    create: {
      login: 'logist1', fullName: 'Ефремов Павел Николаевич', position: 'Ведущий специалист по логистике', role: 'logist',
      phone: '+7 861 17 02 21', email: 'efremov@aemz.ru', passwordHash: passHash,
    },
  })
  await db.user.upsert({
    where: { login: 'logist2' },
    update: { fullName: 'Тарасова Марина Львовна', position: 'Специалист по логистике', role: 'logist', passwordHash: passHash },
    create: {
      login: 'logist2', fullName: 'Тарасова Марина Львовна', position: 'Специалист по логистике', role: 'logist',
      phone: '+7 861 17 02 22', email: 'tarasova@aemz.ru', passwordHash: passHash,
    },
  })

  // --- Справочники (масштаб реального парка: 150 водителей, 160 тягачей, 140 прицепов) ---
  // Первые записи — «герои демо»: на них назначены рейсы и устройства,
  // у части намеренно истекают/истекли документы для блока «Сроки документов».
  const CORE_DRIVERS = [
    { fullName: 'Иванов Пётр Сергеевич', phone: '+79181234501', status: 'active', birthDate: '12.05.1985', passport: '23 07 123456', licenseUntil: dateStr(430), createdAt: daysAgo(3) },
    { fullName: 'Кузнецов Олег Викторович', phone: '+79181234502', status: 'active', birthDate: '03.11.1990', passport: '23 11 234567', licenseUntil: dateStr(24), createdAt: daysAgo(5) },
    { fullName: 'Сидоров Андрей Николаевич', phone: '+79181234503', status: 'active', birthDate: '27.02.1982', passport: '23 09 345678', licenseUntil: dateStr(720), createdAt: daysAgo(8) },
    { fullName: 'Морозов Виктор Павлович', phone: '+79181234504', status: 'active', birthDate: '18.07.1978', passport: '23 05 456789', licenseUntil: dateStr(-12), createdAt: daysAgo(11) },
    { fullName: 'Волков Сергей Иванович', phone: '+79181234505', status: 'vacation', statusComment: 'Отпуск до 30 числа', birthDate: '09.09.1988', passport: '23 04 567890', licenseUntil: dateStr(365), createdAt: daysAgo(14) },
    { fullName: 'Зайцев Николай Фёдорович', phone: '+79181234506', status: 'active', birthDate: '22.01.1980', passport: '23 12 678901', licenseUntil: dateStr(600), createdAt: daysAgo(17) },
  ]
  const drivers = await Promise.all(
    CORE_DRIVERS.map((d) => db.driver.create({ data: d })),
  )

  const plateTaken = new Set<string>()
  const nextPlate = makePlateFactory(plateTaken)
  const CORE_VEHICLES = [
    { brand: 'КАМАЗ 6520', plate: 'АЕ 12345 23', capacityT: 20, volumeM3: 86, ownership: 'own', vin: makeVin('КАМАЗ 6520'), sts: nextSts(), techTill: dateStr(210), createdAt: daysAgo(4) },
    { brand: 'Scania R450', plate: 'АЕ 23456 23', capacityT: 22, volumeM3: 92, ownership: 'own', vin: makeVin('Scania R450'), sts: nextSts(), techTill: dateStr(-9), createdAt: daysAgo(7) },
    { brand: 'MAN TGS 33.400', plate: 'АЕ 34567 23', capacityT: 20, volumeM3: 88, ownership: 'own', vin: makeVin('MAN TGS 33.400'), sts: nextSts(), techTill: dateStr(18), createdAt: daysAgo(9) },
    { brand: 'Volvo FH 460', plate: 'АЕ 45678 23', capacityT: 21, volumeM3: 90, ownership: 'own', isRepair: true, vin: makeVin('Volvo FH 460'), sts: nextSts(), techTill: dateStr(64), createdAt: daysAgo(12) },
  ]
  const vehicles = await Promise.all(
    CORE_VEHICLES.map((v) => db.vehicle.create({ data: v })),
  )
  CORE_VEHICLES.forEach((v) => plateTaken.add(v.plate))

  const CORE_TRAILERS = [
    { brand: 'Тонар 9678', plate: 'АК 11112 23', type: 'шторный', volumeM3: 92, sideLoadHeightM: 1.2, beltsCount: 12, workingBoards: true, sts: nextSts(), techTill: dateStr(150), createdAt: daysAgo(6) },
    { brand: 'МАЗ 9758', plate: 'АК 22223 23', type: 'шторный', volumeM3: 88, sideLoadHeightM: 1.1, beltsCount: 10, workingBoards: true, sts: nextSts(), techTill: dateStr(-21), createdAt: daysAgo(10) },
    { brand: 'СЗАП 9327', plate: 'АК 33334 23', type: 'бортовой', volumeM3: 60, sideLoadHeightM: 1.4, beltsCount: 8, workingBoards: false, sts: nextSts(), techTill: dateStr(45), createdAt: daysAgo(13) },
  ]
  const trailers = await Promise.all(
    CORE_TRAILERS.map((t) => db.trailer.create({ data: t })),
  )
  CORE_TRAILERS.forEach((t) => plateTaken.add(t.plate))

  // --- Остальной парк: детерминированная генерация до целевого объёма ---
  const TARGET_DRIVERS = 150
  const TARGET_VEHICLES = 160
  const TARGET_TRAILERS = 140

  const usedNames = new Set(CORE_DRIVERS.map((d) => d.fullName))
  const driverRows: Prisma.DriverCreateManyInput[] = []
  while (driverRows.length < TARGET_DRIVERS - CORE_DRIVERS.length) {
    const female = rnd() < 0.12
    const surname = female ? pick(FEMALE_SURNAMES) : pick(MALE_SURNAMES)
    const name = female ? pick(FEMALE_NAMES) : pick(MALE_NAMES)
    // отчество: мужское «Сергеевич» → женское «Сергеевна»
    const patronymic = female ? pick(PATRONYMICS).replace('ич', 'на') : pick(PATRONYMICS)
    const fullName = `${surname} ${name} ${patronymic}`
    if (usedNames.has(fullName)) continue
    usedNames.add(fullName)
    // сроки ВУ: ~1% истекло, ~2% истекает, остальное — в норме
    const roll = rnd()
    const licenseUntil = roll < 0.01 ? dateStr(-int(3, 40)) : roll < 0.03 ? dateStr(int(4, 27)) : dateStr(int(120, 900))
    const statusRoll = rnd()
    const status = statusRoll < 0.06 ? 'vacation' : statusRoll < 0.09 ? 'sick' : statusRoll < 0.11 ? 'other' : 'active'
    driverRows.push({
      fullName,
      phone: `+7${pick(['918', '961', '962', '988', '999'])}${String(int(1000000, 9999999))}`,
      birthDate: dateStr(-int(7500, 20000)),
      passport: `23 ${pad2(int(1, 20))} ${String(int(100000, 999999))}`,
      licenseUntil,
      status,
      statusComment: status === 'vacation' ? 'Отпуск' : status === 'sick' ? 'Больничный' : status === 'other' ? 'Отгул' : null,
      createdAt: daysAgo(int(1, 180)),
    })
  }
  await db.driver.createMany({ data: driverRows })

  const vehicleRows: Prisma.VehicleCreateManyInput[] = []
  for (let i = 0; i < TARGET_VEHICLES - CORE_VEHICLES.length; i++) {
    const brand = pick(TRACTOR_BRANDS)
    // сроки техосмотра: ~2 истекло, ~3 истекает, ~8 скоро, остальное — в норме
    const roll = rnd()
    const techTill = i === 0 ? dateStr(-int(5, 30)) : i === 1 ? dateStr(-int(2, 60))
      : i < 4 ? dateStr(int(5, 28)) : roll < 0.06 ? dateStr(int(31, 88)) : dateStr(int(120, 420))
    vehicleRows.push({
      brand,
      plate: nextPlate(),
      vin: makeVin(brand),
      sts: nextSts(),
      techTill,
      capacityT: int(18, 25),
      volumeM3: int(80, 96),
      ownership: 'own',
      isRepair: rnd() < 0.05,
      createdAt: daysAgo(int(2, 180)),
    })
  }
  await db.vehicle.createMany({ data: vehicleRows })

  const trailerRows: Prisma.TrailerCreateManyInput[] = []
  for (let i = 0; i < TARGET_TRAILERS - CORE_TRAILERS.length; i++) {
    const type = pick(TRAILER_TYPES)
    // сроки техосмотра прицепов: 1 истекло, 1 истекает, ~6 скоро, остальное — в норме
    const roll = rnd()
    const techTill = i === 0 ? dateStr(-int(4, 40)) : i === 1 ? dateStr(int(6, 25))
      : roll < 0.06 ? dateStr(int(31, 88)) : dateStr(int(120, 420))
    trailerRows.push({
      brand: pick(TRAILER_BRANDS),
      plate: nextPlate(),
      type,
      sts: nextSts(),
      techTill,
      volumeM3: type === 'шторный' ? int(86, 96) : type === 'бортовой' ? int(45, 62) : type === 'рефрижераторный' ? int(78, 92) : null,
      beltsCount: int(6, 12),
      workingBoards: type === 'бортовой' ? rnd() < 0.8 : rnd() < 0.2,
      ownership: 'own',
      isRepair: rnd() < 0.04,
      createdAt: daysAgo(int(2, 180)),
    })
  }
  await db.trailer.createMany({ data: trailerRows })

  // --- Заявки (P1): 30 документов 1С во всех стадиях контура ---
  const ordersData = [
    {
      externalId: '1C-2026-0041', number: 'ЗК-1041', customer: 'ООО «СтройДом»',
      product: 'Арматура А500С 12 мм', loadPoint: 'Абинск (АЭМЗ)', unloadPoint: 'Краснодар, ул. Тополиная, 8',
      loadDatePlan: daysAgo(-1), unloadDatePlan: daysAgo(0), tariff: 1450, kp: 'КП-88',
      status: 'planned', // по заявке уже идёт рейс 1 (Иванов, en_route)
    },
    {
      externalId: '1C-2026-0042', number: 'ЗК-1042', customer: 'ООО «МеталлТорг»',
      product: 'Катанка К6,5', loadPoint: 'Абинск (АЭМЗ)', unloadPoint: 'Краснодар, Ростовское ш., 14',
      loadDatePlan: daysAgo(0), unloadDatePlan: daysAgo(-1), tariff: 1320, kp: null,
      status: 'planned', // рейс 2 (Кузнецов, ack pending)
    },
    {
      externalId: '1C-2026-0043', number: 'ЗК-1043', customer: 'АО «Кубань ЖБИ»',
      product: 'Уголок 100×100×8', loadPoint: 'Абинск (АЭМЗ)', unloadPoint: 'Славянск-на-Кубани, ул. Промышленная, 3',
      loadDatePlan: daysAgo(0), unloadDatePlan: daysAgo(-2), tariff: 2100, kp: 'КП-91',
      status: 'planned', // рейс 3 завершён (история): состав Сидорова
    },
    {
      externalId: '1C-2026-0044', number: 'ЗК-1044', customer: 'ООО «АгроТехМонтаж»',
      product: 'Швеллер 16П', loadPoint: 'Абинск (АЭМЗ)', unloadPoint: 'Крымск, ул. Механизаторов, 2',
      loadDatePlan: daysAgo(-2), unloadDatePlan: daysAgo(-1), tariff: 1780, kp: null,
      status: 'ready_to_plan',
    },
    {
      externalId: '1C-2026-0045', number: 'ЗК-1045', customer: 'ООО «База №7»',
      product: 'Проволока ВР-1', loadPoint: 'Абинск (АЭМЗ)', unloadPoint: '',
      loadDatePlan: daysAgo(0), unloadDatePlan: null, tariff: 1200, kp: null,
      status: 'quarantine', quarantineReason: 'Не заполнен пункт выгрузки (unload_point пуст)',
    },
    {
      externalId: '1C-2026-0046', number: 'ЗК-1046', customer: 'ООО «ЮгСтройКомплект»',
      product: 'Моток 10-А240С', loadPoint: 'Абинск (АЭМЗ)', unloadPoint: 'Динская ст., ул. Промышленная, 5',
      loadDatePlan: daysAgo(-1), unloadDatePlan: daysAgo(-1), tariff: 1350, kp: 'Спец. ТК-7457 от 15.10.2026',
      // статус new — новая заявка из 1С: пришла сегодня, ждёт проверки логиста
    },
  ]
  const orders = await Promise.all(ordersData.map((o) => db.order.create({ data: { ...o, source: '1c' } })))

  // --- Сгенерированный объём реестра: 24 заявки ЗК-1047…ЗК-1070 ---
  // (клиенты, продукция и пункты выгрузки юга России; детерминированный выбор)
  const GEN_CUSTOMERS = [
    'ООО «Кубань Метиз»', 'ЗАО «Югметалл»', 'ООО «ДонСтройМатериалы»', 'АО «Новороссийский СЗ»',
    'ООО «Причерноморье»', 'ООО «Армавирский МЗ»', 'ООО «ЕйскПортСтрой»', 'ООО «КраснодарМетиз»',
    'ООО «СочиСтройИнвест»', 'ООО «Таганрог Металл»', 'ООО «СтавропольАгро»', 'ООО «МайкопСтрой»',
    'ООО «ТихорецкМаш»', 'ООО «ЛабинскМеталл»', 'ООО «Геленджик Порт»', 'ООО «Темрюк Агро»',
    'ООО «КореновскЗерно»', 'ООО «АбинскЭнерго»', 'ООО «Горячий Ключ Строй»', 'ООО «Усть-Лабинск Хлеб»',
  ]
  const GEN_PRODUCTS = [
    'Арматура А240 8 мм', 'Гвозди строительные 90 мм', 'Электроды УОНИ 13/55 d4', 'Канат стальной 15 мм ГОСТ 2688',
    'Сетка сварная 100×100×5', 'Круг 12 А500С', 'Труба профильная 60×60×4', 'Полоса 40×4',
    'Лист г/к 3 мм', 'Балка 20Б1', 'Катанка К8', 'Гвозди винтовые 120 мм',
    'Электроды МР-3 d3', 'Проволока СВ-08Г2С', 'Проволока ГОСТ 3282-74 т/о', 'Сетка рабица 50×50',
  ]
  const GEN_UNLOAD = [
    'Краснодар, ул. Уральская, 100', 'Новороссийск, ул. Свободы, 3', 'Анапа, ул. Крымская, 41',
    'Геленджик, ул. Островского, 15', 'Сочи, ул. Транспортная, 22', 'Армавир, ул. Кочубея, 184',
    'Тихорецк, ул. Красная, 60', 'Кропоткин, ул. Первомайская, 104', 'Темрюк, ул. Коммунаров, 45',
    'Ейск, ул. Армавирская, 70', 'Ростов-на-Дону, ул. Доватора, 150', 'Таганрог, ул. Седова, 8',
    'Ставрополь, ул. Доваторцев, 44а', 'Майкоп, ул. Промышленная, 19', 'Лабинск, ул. Победы, 67',
    'Кореновск, ул. Линейная, 33', 'Усть-Лабинск, ул. Крестьянская, 118', 'Горячий Ключ, ул. Ленина, 205',
  ]
  const GEN_KRASNODAR = 'Краснодар, ул. Тополиная, 8'

  type GenOrder = {
    externalId: string; number: string; customer: string; product: string
    loadPoint: string; unloadPoint: string; loadDatePlan: Date; unloadDatePlan: Date
    tariff: number | null; kp: string | null; status: string; quarantineReason?: string
  }
  let genIdx = 0
  const nextGen = (status: string, loadInDays: number, unloadInDays: number): GenOrder => {
    const n = 1047 + genIdx++
    return {
      externalId: `1C-2026-${String(n - 1000).padStart(4, '0')}`,
      number: `ЗК-${n}`,
      customer: GEN_CUSTOMERS[genIdx % GEN_CUSTOMERS.length],
      product: GEN_PRODUCTS[(genIdx * 3) % GEN_PRODUCTS.length],
      loadPoint: 'Абинск (АЭМЗ)',
      unloadPoint: GEN_UNLOAD[(genIdx * 7) % GEN_UNLOAD.length],
      loadDatePlan: daysAgo(-loadInDays),
      unloadDatePlan: daysAgo(-unloadInDays),
      tariff: int(12, 34) * 100,
      kp: rnd() < 0.45 ? `КП-${int(80, 130)}` : null,
      status,
    }
  }

  // 6 новых + 5 к планированию
  const newOrders: GenOrder[] = []
  for (let i = 0; i < 6; i++) newOrders.push(nextGen('new', i % 4, (i % 4) + 1))
  const readyOrders: GenOrder[] = []
  for (let i = 0; i < 5; i++) readyOrders.push(nextGen('ready_to_plan', i, i + 2))
  // 2 запланированные (состав назначен, ждём выезда) + 6 в рейсе + 3 выполненные
  const planned2: GenOrder[] = [nextGen('planned', 0, 1), nextGen('planned', 1, 2)]
  const movingOrders: GenOrder[] = [
    nextGen('planned', 0, 1), nextGen('planned', 0, 1), nextGen('planned', -1, 0),
    nextGen('planned', -1, 1), nextGen('planned', 0, 2), nextGen('planned', -1, 0),
  ]
  const doneGen: GenOrder[] = [nextGen('planned', -2, -1), nextGen('planned', -4, -3), nextGen('planned', -6, -5)]
  // 2 карантинные с разными причинами
  const quarantineGen: GenOrder[] = [
    { ...nextGen('quarantine', 0, 1), tariff: null, quarantineReason: 'Не заполнена ставка (tariff пуст)' },
    { ...nextGen('quarantine', 1, 2), product: '', quarantineReason: 'Не указана продукция (product пуст)' },
  ]

  const genAll = [...newOrders, ...readyOrders, ...planned2, ...movingOrders, ...doneGen, ...quarantineGen]
  const genCreated = await Promise.all(genAll.map((o) => db.order.create({ data: { ...o, source: '1c' } })))
  const allOrders = [...orders, ...genCreated]
  const orderByName = new Map(allOrders.map((o) => [o.number, o]))

  // --- Устройства B4.23 ---
  await db.device.createMany({
    data: [
      { id: 'DEV-001', driverId: drivers[0].id, appVersion: '2.4.1', isLegacy: false, lastSeenAt: minutesAgo(4) },
      { id: 'DEV-002', driverId: drivers[1].id, appVersion: '1.8.0', isLegacy: true, lastSeenAt: minutesAgo(35) },
      { id: 'DEV-003', driverId: drivers[2].id, appVersion: '2.3.0', isLegacy: false, lastSeenAt: minutesAgo(12) },
    ],
  })

  // --- Рейс 1 (активный): Иванов, Абинск → Краснодар, статус en_route ---
  const trip1 = await db.trip.create({
    data: {
      vehicleId: vehicles[0].id,
      trailerId: trailers[0].id,
      driverId: drivers[0].id,
      status: 'active',
      ackStatus: 'acknowledged',
      ackAt: minutesAgo(180),
      startedAt: minutesAgo(170),
    },
  })
  const leg1 = await db.leg.create({
    data: {
      tripId: trip1.id, seq: 1, type: 'main', cargoSource: '1c',
      loadPoint: 'Абинск (АЭМЗ)', unloadPoint: 'Краснодар, ул. Тополиная, 8',
      loadDatePlan: daysAgo(-1), unloadDatePlan: daysAgo(0),
      cargoDesc: 'Арматура А500С 12 мм', weightT: 21.5, volumeM3: 40,
      kmPlan: 84, odometerStart: 385210, rate: 1450, orderId: orders[0].id,
      status: 'en_route', statusSource: 'driver', statusSetAt: minutesAgo(40),
    },
  })
  // Лестница: assigned → en_route_to_loading → at_loading → loaded (фото подтверждено) → en_route
  const seqBase = 0
  await db.statusEvent.createMany({
    data: [
      { legId: leg1.id, status: 'assigned', actorRole: 'system', serverTs: minutesAgo(180), result: 'applied' },
      { legId: leg1.id, status: 'en_route_to_loading', actorRole: 'driver', actorId: drivers[0].id, deviceId: 'DEV-001', seqNo: seqBase + 1, clientTs: minutesAgo(165), serverTs: minutesAgo(164), result: 'applied' },
      { legId: leg1.id, status: 'at_loading', actorRole: 'driver', actorId: drivers[0].id, deviceId: 'DEV-001', seqNo: seqBase + 2, clientTs: minutesAgo(150), serverTs: minutesAgo(149), result: 'applied' },
      { legId: leg1.id, status: 'loaded', actorRole: 'driver', actorId: drivers[0].id, deviceId: 'DEV-001', seqNo: seqBase + 3, clientTs: minutesAgo(120), serverTs: minutesAgo(119), result: 'applied', requiredFiles: JSON.stringify([{ clientId: 'seed-file-tttn-load-1', kind: 'tttn' }]) },
      { legId: leg1.id, status: 'en_route', actorRole: 'driver', actorId: drivers[0].id, deviceId: 'DEV-001', seqNo: seqBase + 4, clientTs: minutesAgo(41), serverTs: minutesAgo(40), result: 'applied' },
    ],
  })
  await db.fileRec.create({
    data: {
      ownerType: 'leg', ownerId: leg1.id, kind: 'tttn', clientId: 'seed-file-tttn-load-1',
      state: 'confirmed', eventClientId: null, sizeBytes: 1420000, createdAt: minutesAgo(118),
    },
  })
  await db.tripEvent.create({
    data: { tripId: trip1.id, type: 'assigned', at: minutesAgo(182) },
  })
  await db.tripEvent.create({
    data: { tripId: trip1.id, type: 'ack', at: minutesAgo(180), payload: JSON.stringify({ by: 'driver' }) },
  })
  await db.outbox1c.createMany({
    data: [
      { eventType: 'trip.assigned', payload: JSON.stringify({ tripId: trip1.id, driverId: drivers[0].id }), firstSeenAt: minutesAgo(182), state: 'acked', ackedAt: minutesAgo(180), attempts: 1, lastAttemptAt: minutesAgo(181) },
      { eventType: 'leg.status_changed', payload: JSON.stringify({ legId: leg1.id, status: 'en_route' }), firstSeenAt: minutesAgo(40), attempts: 0 },
    ],
  })

  // --- Рейс 2 (активный, ack pending — SLA 30 мин): Кузнецов, назначен 10 минут назад ---
  const trip2 = await db.trip.create({
    data: {
      vehicleId: vehicles[1].id,
      trailerId: trailers[1].id,
      driverId: drivers[1].id,
      status: 'active',
      ackStatus: 'pending',
    },
  })
  const leg2 = await db.leg.create({
    data: {
      tripId: trip2.id, seq: 1, type: 'main', cargoSource: '1c',
      loadPoint: 'Абинск (АЭМЗ)', unloadPoint: 'Краснодар, Ростовское ш., 14',
      loadDatePlan: daysAgo(0), unloadDatePlan: daysAgo(-1),
      cargoDesc: 'Катанка К6,5', weightT: 20, volumeM3: 35,
      kmPlan: 86, rate: 1320, orderId: orders[1].id,
      status: 'assigned', statusSource: 'driver', statusSetAt: minutesAgo(10),
    },
  })
  await db.statusEvent.create({
    data: { legId: leg2.id, status: 'assigned', actorRole: 'system', serverTs: minutesAgo(10), result: 'applied' },
  })
  await db.tripEvent.create({ data: { tripId: trip2.id, type: 'assigned', at: minutesAgo(10) } })
  await db.outbox1c.create({
    data: { eventType: 'trip.assigned', payload: JSON.stringify({ tripId: trip2.id, driverId: drivers[1].id }), firstSeenAt: minutesAgo(10) },
  })

  // --- Рейс 3 (завершён, история): Сидоров, две плеча, docs_pending по обратке ---
  const trip3 = await db.trip.create({
    data: {
      vehicleId: vehicles[2].id, trailerId: trailers[2].id, driverId: drivers[2].id,
      status: 'completed', ackStatus: 'acknowledged', ackAt: daysAgo(4), startedAt: daysAgo(4), endedAt: daysAgo(3),
    },
  })
  const leg3 = await db.leg.create({
    data: {
      tripId: trip3.id, seq: 1, type: 'main', cargoSource: '1c',
      loadPoint: 'Абинск (АЭМЗ)', unloadPoint: 'Славянск-на-Кубани, ул. Промышленная, 3',
      loadDatePlan: daysAgo(4), unloadDatePlan: daysAgo(4), loadDateFact: daysAgo(4), unloadDateFact: daysAgo(4),
      cargoDesc: 'Уголок 100×100×8', weightT: 19, kmPlan: 120, kmFact: 118,
      odometerStart: 402100, odometerEnd: 402218, rate: 2100, orderId: orders[2].id,
      status: 'completed', statusSource: 'driver', statusSetAt: daysAgo(4),
    },
  })
  const leg4 = await db.leg.create({
    data: {
      tripId: trip3.id, seq: 2, type: 'return', cargoSource: 'ati',
      loadPoint: 'Славянск-на-Кубани', unloadPoint: 'Краснодар, База «Кубань»',
      loadDatePlan: daysAgo(3), unloadDatePlan: daysAgo(3),
      cargoDesc: 'Обратный груз: кирпич силикатный', weightT: 20, kmPlan: 130, kmFact: 132,
      odometerStart: 402218, odometerEnd: 402350, rate: 1600, paymentType: 'нал',
      status: 'completed', statusSource: 'driver', statusSetAt: daysAgo(3),
      docsPending: true, // недоставленный документ — алерт DOC_PENDING_ALERT_HOURS
    },
  })
  await db.statusEvent.createMany({
    data: [
      { legId: leg3.id, status: 'completed', actorRole: 'driver', deviceId: 'DEV-003', serverTs: daysAgo(4), result: 'applied' },
      { legId: leg4.id, status: 'loaded', actorRole: 'driver', deviceId: 'DEV-003', serverTs: daysAgo(3), result: 'applied', requiredFiles: JSON.stringify([{ clientId: 'seed-file-tttn-ret-1', kind: 'tttn' }]) },
      { legId: leg4.id, status: 'completed', actorRole: 'driver', deviceId: 'DEV-003', serverTs: daysAgo(3), result: 'applied' },
    ],
  })
  await db.fileRec.create({
    data: { ownerType: 'leg', ownerId: leg4.id, kind: 'tttn', clientId: 'seed-file-tttn-ret-1', state: 'uploaded', createdAt: daysAgo(3), sizeBytes: 980000 },
  })
  await db.outbox1c.createMany({
    data: [
      { eventType: 'leg.status_changed', payload: JSON.stringify({ legId: leg3.id, status: 'completed' }), firstSeenAt: daysAgo(4), state: 'acked', ackedAt: daysAgo(4), attempts: 2 },
      { eventType: 'leg.status_changed', payload: JSON.stringify({ legId: leg4.id, status: 'loaded' }), firstSeenAt: daysAgo(3), attempts: 1, lastAttemptAt: daysAgo(3) },
    ],
  })

  // --- Сгенерированные рейсы: 2 запланированных, 6 в пути, 3 завершённых ---
  // Пул свободной техники и водителей (герои демо заняты рейсами 1–3)
  const poolDrivers = await db.driver.findMany({ where: { status: 'active' }, orderBy: { createdAt: 'asc' }, skip: CORE_DRIVERS.length, take: 20 })
  const poolVehicles = await db.vehicle.findMany({ where: { isRepair: false }, orderBy: { createdAt: 'asc' }, skip: CORE_VEHICLES.length, take: 20 })
  const poolTrailers = await db.trailer.findMany({ where: { isRepair: false }, orderBy: { createdAt: 'asc' }, skip: CORE_TRAILERS.length, take: 20 })
  let poolIdx = 0
  let genTrips = 0

  const assignAudit = (tripId: string, driverName: string) =>
    db.auditLog.create({
      data: { actorRole: 'logist', actorName: 'Ефремов П.Н.', object: 'trip', objectId: tripId, field: 'assigned', became: driverName, comment: 'Назначение состава из собственного парка АЭМЗ' },
    })

  // Запланированные: состав назначен, ожидает подтверждения водителя и выезда
  for (const o of planned2) {
    const vehicle = poolVehicles[poolIdx]
    const trailer = poolTrailers[poolIdx]
    const driver = poolDrivers[poolIdx]
    poolIdx++; genTrips++
    const acked = genTrips % 2 === 1
    const assignedAgo = int(6, 45)
    const trip = await db.trip.create({
      data: {
        vehicleId: vehicle.id, trailerId: trailer.id, driverId: driver.id,
        status: 'active', ackStatus: acked ? 'acknowledged' : 'pending',
        ...(acked ? { ackAt: minutesAgo(assignedAgo - 3) } : {}),
      },
    })
    const leg = await db.leg.create({
      data: {
        tripId: trip.id, seq: 1, type: 'main', cargoSource: '1c',
        loadPoint: o.loadPoint, unloadPoint: o.unloadPoint,
        loadDatePlan: o.loadDatePlan, unloadDatePlan: o.unloadDatePlan,
        cargoDesc: o.product, weightT: int(17, 23), kmPlan: int(40, 260), rate: o.tariff,
        orderId: orderByName.get(o.number)?.id,
        status: 'assigned', statusSource: 'driver', statusSetAt: minutesAgo(assignedAgo),
      },
    })
    await db.statusEvent.create({ data: { legId: leg.id, status: 'assigned', actorRole: 'system', serverTs: minutesAgo(assignedAgo), result: 'applied' } })
    await db.tripEvent.create({ data: { tripId: trip.id, type: 'assigned', at: minutesAgo(assignedAgo) } })
    await db.outbox1c.create({
      data: {
        eventType: 'trip.assigned', payload: JSON.stringify({ tripId: trip.id, driverId: driver.id }),
        firstSeenAt: minutesAgo(assignedAgo),
        ...(acked ? { state: 'acked', ackedAt: minutesAgo(assignedAgo - 2), attempts: 1 } : {}),
      },
    })
    await assignAudit(trip.id, driver.fullName)
  }

  // В рейсе: плечи на разных стадиях лестницы B5.1
  const MOVING_STATUSES = ['en_route_to_loading', 'at_loading', 'loaded', 'en_route', 'at_unloading', 'en_route']
  for (let i = 0; i < movingOrders.length; i++) {
    const o = movingOrders[i]
    const vehicle = poolVehicles[poolIdx]
    const trailer = poolTrailers[poolIdx]
    const driver = poolDrivers[poolIdx]
    poolIdx++; genTrips++
    const legStatus = MOVING_STATUSES[i]
    const startedAgo = int(60, 400)
    const statusAgo = int(8, 45)
    const trip = await db.trip.create({
      data: {
        vehicleId: vehicle.id, trailerId: trailer.id, driverId: driver.id,
        status: 'active', ackStatus: 'acknowledged', ackAt: minutesAgo(startedAgo), startedAt: minutesAgo(startedAgo - 5),
      },
    })
    const leg = await db.leg.create({
      data: {
        tripId: trip.id, seq: 1, type: 'main', cargoSource: '1c',
        loadPoint: o.loadPoint, unloadPoint: o.unloadPoint,
        loadDatePlan: o.loadDatePlan, unloadDatePlan: o.unloadDatePlan,
        cargoDesc: o.product, weightT: int(17, 23), kmPlan: int(40, 260),
        odometerStart: int(300000, 500000), rate: o.tariff,
        orderId: orderByName.get(o.number)?.id,
        status: legStatus, statusSource: 'driver', statusSetAt: minutesAgo(statusAgo),
      },
    })
    await db.statusEvent.createMany({
      data: [
        { legId: leg.id, status: 'assigned', actorRole: 'system', serverTs: minutesAgo(startedAgo), result: 'applied' },
        { legId: leg.id, status: legStatus, actorRole: 'driver', actorId: driver.id, serverTs: minutesAgo(statusAgo), result: 'applied' },
      ],
    })
    await db.tripEvent.createMany({
      data: [
        { tripId: trip.id, type: 'assigned', at: minutesAgo(startedAgo) },
        { tripId: trip.id, type: 'ack', at: minutesAgo(startedAgo - 5), payload: JSON.stringify({ by: 'driver' }) },
      ],
    })
    await db.outbox1c.create({ data: { eventType: 'leg.status_changed', payload: JSON.stringify({ legId: leg.id, status: legStatus }), firstSeenAt: minutesAgo(statusAgo) } })
    await assignAudit(trip.id, driver.fullName)
  }

  // Выполненные: рейсы завершены 2–6 дней назад, у первого — обратное плечо
  for (let i = 0; i < doneGen.length; i++) {
    const o = doneGen[i]
    const vehicle = poolVehicles[poolIdx]
    const trailer = poolTrailers[poolIdx]
    const driver = poolDrivers[poolIdx]
    poolIdx++; genTrips++
    const endedAgo = 2 + i * 2
    const kmPlan = int(40, 260)
    const trip = await db.trip.create({
      data: {
        vehicleId: vehicle.id, trailerId: trailer.id, driverId: driver.id,
        status: 'completed', ackStatus: 'acknowledged',
        ackAt: daysAgo(endedAgo + 1), startedAt: daysAgo(endedAgo + 1), endedAt: daysAgo(endedAgo),
      },
    })
    const leg = await db.leg.create({
      data: {
        tripId: trip.id, seq: 1, type: 'main', cargoSource: '1c',
        loadPoint: o.loadPoint, unloadPoint: o.unloadPoint,
        loadDatePlan: daysAgo(endedAgo + 1), unloadDatePlan: daysAgo(endedAgo),
        loadDateFact: daysAgo(endedAgo + 1), unloadDateFact: daysAgo(endedAgo),
        cargoDesc: o.product, weightT: int(17, 23), kmPlan, kmFact: kmPlan + int(-5, 8),
        odometerStart: int(300000, 500000), rate: o.tariff,
        orderId: orderByName.get(o.number)?.id,
        status: 'completed', statusSource: 'driver', statusSetAt: daysAgo(endedAgo),
      },
    })
    if (i === 0) {
      await db.leg.create({
        data: {
          tripId: trip.id, seq: 2, type: 'return', cargoSource: 'ati',
          loadPoint: o.unloadPoint, unloadPoint: GEN_KRASNODAR,
          loadDatePlan: daysAgo(endedAgo), unloadDatePlan: daysAgo(endedAgo),
          loadDateFact: daysAgo(endedAgo), unloadDateFact: daysAgo(endedAgo),
          cargoDesc: 'Обратный груз: кирпич силикатный', weightT: 19,
          kmPlan: int(90, 160), rate: int(14, 18) * 100, paymentType: 'нал',
          status: 'completed', statusSource: 'driver', statusSetAt: daysAgo(endedAgo),
        },
      })
    }
    await db.statusEvent.create({ data: { legId: leg.id, status: 'completed', actorRole: 'driver', actorId: driver.id, serverTs: daysAgo(endedAgo), result: 'applied' } })
    await db.outbox1c.create({
      data: {
        eventType: 'leg.status_changed', payload: JSON.stringify({ legId: leg.id, status: 'completed' }),
        firstSeenAt: daysAgo(endedAgo), state: 'acked', ackedAt: daysAgo(endedAgo), attempts: 1,
      },
    })
    await assignAudit(trip.id, driver.fullName)
  }

  await db.auditLog.createMany({
    data: [
      { actorRole: 'logist', actorName: 'Ефремов П.Н.', object: 'trip', objectId: trip1.id, field: 'assigned', became: drivers[0].fullName, comment: 'Назначение состава из собственного парка АЭМЗ' },
      { actorRole: 'logist', actorName: 'Ефремов П.Н.', object: 'trip', objectId: trip2.id, field: 'assigned', became: drivers[1].fullName, comment: 'Назначение состава из собственного парка АЭМЗ' },
    ],
  })

  // --- Закрепления состава (водитель ↔ тягач ↔ прицеп) ---
  // Герои демо закреплены за «своими» машинами рейсов; Зайцев — за Volvo FH
  // (в ремонте: подбор покажет подсказку «обычно работает на … — в ремонте,
  // предложена замена»); часть сгенерированного парка — за составами своих
  // выполненных рейсов, чтобы список закреплений выглядел живым.
  await db.vehicleBinding.createMany({
    data: [
      { driverId: drivers[0].id, vehicleId: vehicles[0].id, trailerId: trailers[0].id, pinnedAt: daysAgo(40) },
      { driverId: drivers[1].id, vehicleId: vehicles[1].id, trailerId: trailers[1].id, pinnedAt: daysAgo(65) },
      { driverId: drivers[2].id, vehicleId: vehicles[2].id, trailerId: trailers[2].id, pinnedAt: daysAgo(120) },
      { driverId: drivers[5].id, vehicleId: vehicles[3].id, trailerId: null, pinnedAt: daysAgo(90) }, // Volvo FH — в ремонте
      { driverId: poolDrivers[0]?.id ?? drivers[3].id, vehicleId: poolVehicles[0]?.id ?? vehicles[0].id, trailerId: poolTrailers[0]?.id ?? null, pinnedAt: daysAgo(30) },
      { driverId: poolDrivers[1]?.id ?? drivers[3].id, vehicleId: poolVehicles[1]?.id ?? vehicles[0].id, trailerId: poolTrailers[1]?.id ?? null, pinnedAt: daysAgo(28) },
      { driverId: poolDrivers[2]?.id ?? drivers[3].id, vehicleId: poolVehicles[2]?.id ?? vehicles[0].id, trailerId: poolTrailers[2]?.id ?? null, pinnedAt: daysAgo(25) },
      { driverId: poolDrivers[3]?.id ?? drivers[3].id, vehicleId: poolVehicles[3]?.id ?? vehicles[0].id, trailerId: poolTrailers[3]?.id ?? null, pinnedAt: daysAgo(21) },
    ],
  })

  // --- Заявки ATI.SU (грузы, по которым договорились) ---
  // Две стадии: preliminary — предварительное согласование (документы ещё не
  // обменяны, договорились по телефону), full — документы обменяны, заявка
  // вступила в силу. Плюс одна отменённая — для примера истории. Снимки грузов
  // имитируют выдачу витрины биржи (демо-режим).
  const isoDay = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
  await db.atiDeal.createMany({
    data: [
      {
        loadId: '1911-4271', atiId: 428512,
        from: 'Москва', fromRegion: 'Москва и область', to: 'Краснодар', toRegion: 'Краснодарский край', km: 1355,
        bodies: 'тент', cargo: 'Стройматериалы (сухие смеси)', weightT: 20, volumeM3: 82,
        loadDateFrom: isoDay(1), loadDateTo: isoDay(3),
        rate: 68500, perKm: 50.6, payment: 'cashless_vat', ndsPct: 22,
        carrierFirm: 'ООО «Транс-Лайн»', carrierRating: 4.8,
        contactName: 'Мельникова Ольга Петровна', contactPhone: '+7 918 555-34-72',
        stage: 'preliminary', status: 'active',
        comment: 'Ставка 68 500 ₽, погрузка с 9:00, нужен тент 92 м³, крепление ремнями',
        agreedAt: minutesAgo(95), createdById: 'seed', createdByName: 'Ефремов П. Н.',
      },
      {
        loadId: '1911-3905', atiId: 391204,
        from: 'Новороссийск', fromRegion: 'Краснодарский край', to: 'Воронеж', toRegion: 'Воронежская область', km: 715,
        bodies: 'реф', cargo: 'Кондитерские изделия', weightT: 12, volumeM3: 60,
        loadDateFrom: isoDay(2), loadDateTo: isoDay(3),
        rate: 41500, perKm: 58, payment: 'cashless_vat', ndsPct: 22,
        carrierFirm: 'ООО «Магистраль-Кубань»', carrierRating: 4.3,
        contactName: 'Ткачёв Сергей Анатольевич', contactPhone: '+7 961 555-81-19',
        stage: 'preliminary', status: 'active',
        comment: 'Реф +2…+6 °C, выгрузка двумя точками, оплата на 3-й день',
        agreedAt: minutesAgo(40), createdById: 'seed', createdByName: 'Тарасова М. Л.',
      },
      {
        loadId: '1811-2216', atiId: 355847,
        from: 'Москва', fromRegion: 'Москва и область', to: 'Абинск', toRegion: 'Краснодарский край', km: 1360,
        bodies: 'тент', cargo: 'Автозапчасти в коробах', weightT: 14.5, volumeM3: 76,
        loadDateFrom: isoDay(0), loadDateTo: isoDay(1),
        rate: 71000, perKm: 52.2, payment: 'cashless_vat', ndsPct: 22,
        carrierFirm: 'ООО «ЛогистикПро»', carrierRating: 4.9,
        contactName: 'Ларина Наталья Викторовна', contactPhone: '+7 988 555-26-43',
        stage: 'full', status: 'active',
        comment: 'Заявка подписана через ATI.Docs, ставка 71 000 ₽, предоплата 50%',
        agreedAt: daysAgo(3), docsAt: daysAgo(2), createdById: 'seed', createdByName: 'Ефремов П. Н.',
      },
      {
        loadId: '1711-7543', atiId: 344091,
        from: 'Ростов-на-Дону', fromRegion: 'Ростовская область', to: 'Москва', toRegion: 'Москва и область', km: 1070,
        bodies: 'тент / цельнометалл.', cargo: 'Бумага в рулонах', weightT: 19, volumeM3: 70,
        loadDateFrom: isoDay(-1), loadDateTo: isoDay(0),
        rate: 52000, perKm: 48.6, payment: 'cashless_vat', ndsPct: 22,
        carrierFirm: 'ООО «Поволжье-Транс»', carrierRating: 4.6,
        contactName: 'Гареев Айрат Ринатович', contactPhone: '+7 962 555-09-58',
        stage: 'full', status: 'active',
        comment: 'Заявка в силе, документы обменяны по ЭДО, выгрузка Москва (Южные ворота)',
        agreedAt: daysAgo(4), docsAt: daysAgo(3), createdById: 'seed', createdByName: 'Тарасова М. Л.',
      },
      {
        loadId: '1611-1188', atiId: 331762,
        from: 'Казань', fromRegion: 'Татарстан', to: 'Самара', toRegion: 'Самарская область', km: 340,
        bodies: 'бортовая', cargo: 'Трубы стальные, штанги', weightT: 18, volumeM3: 40,
        loadDateFrom: isoDay(-2), loadDateTo: isoDay(-1),
        rate: 19500, perKm: 57.4, payment: 'cashless', ndsPct: 22,
        carrierFirm: 'ИП Гареев А.Р.', carrierRating: 4.1,
        contactName: 'Джабраилов Аслан Хасанович', contactPhone: '+7 999 555-47-61',
        stage: 'preliminary', status: 'cancelled',
        cancelReason: 'Грузовладелец нашёл перевозчика дешевле',
        agreedAt: daysAgo(3), createdById: 'seed', createdByName: 'Ефремов П. Н.',
      },
    ],
  })

  return {
    drivers: TARGET_DRIVERS, vehicles: TARGET_VEHICLES, trailers: TARGET_TRAILERS,
    orders: allOrders.length, trips: 3 + genTrips,
  }
}

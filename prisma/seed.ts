/**
 * Seed: демо-данные платформы «Привлечённый транспорт» (АЭМЗ)
 * Запуск: bun prisma/seed.ts  (или bun run db:seed)
 */
import { scryptSync, randomBytes } from 'crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ---------- helpers ----------
function docSvg(title: string, lines: string[], accent: string): string {
  const rows = lines
    .map((l, i) => `<text x="40" y="${150 + i * 44}" font-family="Arial" font-size="24" fill="#1f2937">${l}</text>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
  <rect width="640" height="420" rx="14" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
  <rect x="0" y="0" width="640" height="64" rx="14" fill="${accent}"/>
  <text x="40" y="42" font-family="Arial" font-size="24" font-weight="bold" fill="#ffffff">${title}</text>
  <rect x="40" y="90" width="170" height="200" fill="#e2e8f0" stroke="#94a3b8"/>
  <text x="70" y="200" font-family="Arial" font-size="18" fill="#64748b">ФОТО</text>
  ${rows}
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)
const inHours = (h: number) => new Date(Date.now() + h * 3600_000)

/** Дата через N дней (или N дней назад, если N < 0) — для сроков документов */
const dateInDays = (d: number): string => {
  const dt = new Date(Date.now() + d * 86_400_000)
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`
}

async function main() {
  // порядок важен: сначала дочерние таблицы заявок (FK), затем сами заявки
  await db.event.deleteMany()
  await db.document.deleteMany()
  await db.bid.deleteMany()
  await db.requestFile.deleteMany()
  await db.edoDocument.deleteMany()
  await db.notification.deleteMany()
  await db.request.deleteMany()
  await db.cargoType.deleteMany()
  await db.driver.deleteMany()
  await db.truck.deleteMany()
  await db.trailer.deleteMany()
  await db.carrier.deleteMany()
  await db.setting.deleteMany()

  await db.setting.create({
    data: {
      id: 'main',
      confReupload: 0.6,
      confAuto: 0.95,
      minQuality: 60,
      rules: JSON.stringify({
        passport: 'Серия — 4 цифры, номер — 6 цифр; дата выдачи позже даты рождения; серия и номер читаются с полей страницы, две копии должны совпасть',
        plate: 'Буква, 3 цифры, 2 буквы, регион 2–3 цифры; только буквы А В Е К М Н О Р С Т У Х',
        vin: '17 символов, без букв I, O, Q',
        fio: 'Совпадают с заявкой; е/ё, регистр и пробелы — не ошибка',
        stsOwner: 'Собственник по СТС может отличаться от водителя — это не ошибка',
      }),
    },
  })

  // ---------- Перевозчики ----------
  const carrierA = await db.carrier.create({
    data: {
      name: 'ООО «Перевозчик А»', inn: '2310045671', contractNo: '12-А', contractDate: '14.03.2025',
      drivers: {
        create: [
          { fullName: 'Иванов Иван Иванович', birthDate: '15.05.1990', passport: '99 12 345678', createdAt: hoursAgo(24 * 40) },
          { fullName: 'Петров Пётр Сергеевич', birthDate: '22.08.1988', passport: '03 13 992210', createdAt: hoursAgo(24 * 12) },
          { fullName: 'Ковалёв Андрей Викторович', birthDate: '12.03.1986', passport: '23 14 220018', createdAt: hoursAgo(24 * 31) },
          { fullName: 'Егоров Максим Андреевич', birthDate: '07.09.1993', passport: '23 15 771064', createdAt: hoursAgo(24 * 18) },
          { fullName: 'Тарасов Олег Дмитриевич', birthDate: '25.12.1984', passport: '52 08 330592', createdAt: hoursAgo(24 * 6) },
        ],
      },
      trucks: {
        create: [
          { brand: 'KAMAZ 5490', plate: 'А123ВС777', vin: 'X9622277XKG123456', sts: '99 00 123456', techTill: dateInDays(-5), owner: 'ООО «Перевозчик А»', createdAt: hoursAgo(24 * 40) },
          { brand: 'Scania R450', plate: 'Е456КХ777', vin: 'YS2R4X20005412345', sts: '99 00 778812', techTill: dateInDays(26), owner: 'ООО «Перевозчик А»', createdAt: hoursAgo(24 * 15) },
        ],
      },
      trailers: {
        create: [
          { plate: 'АВ124777', sts: '99 00 554411', type: 'Полуприцеп тент', techTill: dateInDays(58), createdAt: hoursAgo(24 * 40) },
          { plate: 'АВ777023', sts: '99 00 332255', type: 'Полуприцеп реф', techTill: '—', createdAt: hoursAgo(24 * 20) },
        ],
      },
    },
  })

  const carrierB = await db.carrier.create({
    data: {
      name: 'ООО «Перевозчик Б»', inn: '2310045672', contractNo: '15-Б', contractDate: '02.06.2025',
      drivers: {
        create: [
          { fullName: 'Сидоров Алексей Владимирович', birthDate: '03.02.1992', passport: '52 04 118872', createdAt: hoursAgo(24 * 33) },
          { fullName: 'Кузнецов Дмитрий Олегович', birthDate: '17.11.1985', passport: '52 05 442301', createdAt: hoursAgo(24 * 9) },
          { fullName: 'Фомин Сергей Петрович', birthDate: '30.06.1989', passport: '52 09 661427', createdAt: hoursAgo(24 * 27) },
          { fullName: 'Гусев Павел Романович', birthDate: '14.02.1995', passport: '52 10 884610', createdAt: hoursAgo(24 * 11) },
          { fullName: 'Лебедев Артём Игоревич', birthDate: '19.04.1983', passport: '61 11 553876', createdAt: hoursAgo(24 * 4) },
        ],
      },
      trucks: {
        create: [
          { brand: 'Volvo FH460', plate: 'В234МН150', vin: 'YV2RT40A8FA556789', sts: '50 01 223344', techTill: dateInDays(74), owner: 'ООО «Перевозчик Б»', createdAt: hoursAgo(24 * 33) },
        ],
      },
      trailers: { create: [{ plate: 'ВС567150', sts: '50 01 665577', type: 'Полуприцеп борт', techTill: dateInDays(11), createdAt: hoursAgo(24 * 25) }] },
    },
  })

  const carrierV = await db.carrier.create({
    data: {
      // демо-экспедитор: рейсы получают поручение экспедитору вместо заказ-заявки
      name: 'ООО «Перевозчик В»', role: 'FORWARDER', inn: '2310045673', contractNo: '18-В', contractDate: '21.08.2025',
      drivers: {
        create: [
          { fullName: 'Морозов Игорь Павлович', birthDate: '09.07.1987', passport: '77 02 551209', createdAt: hoursAgo(24 * 21) },
          { fullName: 'Сазонов Виктор Юрьевич', birthDate: '02.10.1988', passport: '77 12 994523', createdAt: hoursAgo(24 * 16) },
          { fullName: 'Носов Роман Алексеевич', birthDate: '08.06.1991', passport: '77 13 441205', createdAt: hoursAgo(24 * 8) },
        ],
      },
      trucks: {
        create: [{ brand: 'МАЗ 5440', plate: 'М345СО199', vin: 'YM3B544090G012345', sts: '77 03 998811', techTill: dateInDays(190), owner: 'ООО «Перевозчик В»', createdAt: hoursAgo(24 * 21) }],
      },
      trailers: { create: [{ plate: 'МВ890199', sts: '77 03 112233', type: 'Полуприцеп контейнеровоз', techTill: dateInDays(120), createdAt: hoursAgo(24 * 14) }] },
    },
  })

  const carrierG = await db.carrier.create({
    data: {
      name: 'ООО «Перевозчик Г»', inn: '2310045674', contractNo: '21-Г', contractDate: '05.09.2025',
      drivers: {
        create: [
          { fullName: 'Волков Сергей Николаевич', birthDate: '28.01.1991', passport: '61 06 773410', createdAt: hoursAgo(24 * 7) },
          { fullName: 'Захаров Денис Львович', birthDate: '21.11.1987', passport: '61 14 330917', createdAt: hoursAgo(24 * 10) },
          { fullName: 'Куликов Игорь Валерьевич', birthDate: '05.03.1994', passport: '23 16 225840', createdAt: hoursAgo(24 * 3) },
        ],
      },
      trucks: {
        create: [{ brand: 'MAN TGX', plate: 'Г456УА161', vin: 'WMA06XZZ7CP012345', sts: '61 02 445566', techTill: dateInDays(240), owner: 'ООО «Перевозчик Г»', createdAt: hoursAgo(24 * 7) }],
      },
      trailers: { create: [{ plate: 'ГА901161', sts: '61 02 778899', type: 'Полуприцеп тент', techTill: dateInDays(310), createdAt: hoursAgo(24 * 5) }] },
    },
  })

  // ——— Пользователи платформы (вход по логину, /api/auth/*) ———
  // Демо-контур: пароль один, логины разные. Пароль — из SEED_PASSWORD, иначе случайный
  // (печатается один раз в консоль). Учётки перевозчиков связаны со своими компаниями.
  // Task 113 — персонажи платформы: у каждой учётки есть ФИО, должность и организация —
  // они показываются в плашке аккаунта вместо логина и подписи роли.
  const FIO = {
    admin: 'Громова Елена Викторовна',
    logist1: 'Соколов Дмитрий Алексеевич',
    logist2: 'Морозова Анна Сергеевна',
    carrierA: 'Ковалёв Игорь Петрович',
    carrierB: 'Богданов Сергей Михайлович',
    carrierV: 'Литвинов Артём Владимирович',
    carrierG: 'Ткачёв Николай Андреевич',
  }
  const AEMZ = 'АО «АЭМЗ»'
  const hashPassword = (password: string): string => {
    const salt = randomBytes(16).toString('hex')
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
  }
  const userAccounts = [
    { login: 'admin', name: FIO.admin, role: 'admin', carrierId: null as string | null },
    { login: 'logist1', name: FIO.logist1, role: 'logist', carrierId: null as string | null },
    { login: 'logist2', name: FIO.logist2, role: 'logist', carrierId: null as string | null },
    { login: 'carrier-a', name: FIO.carrierA, role: 'carrier', carrierId: carrierA.id },
    { login: 'carrier-b', name: FIO.carrierB, role: 'carrier', carrierId: carrierB.id },
    { login: 'carrier-v', name: FIO.carrierV, role: 'carrier', carrierId: carrierV.id },
    { login: 'carrier-g', name: FIO.carrierG, role: 'carrier', carrierId: carrierG.id },
  ]
  const seedPassword = process.env.SEED_PASSWORD || randomBytes(9).toString('base64url')
  if (!process.env.SEED_PASSWORD) console.log(`Пароль демо-пользователей (сохраните): ${seedPassword}`)
  for (const u of userAccounts) {
    const existing = await db.user.upsert({
      where: { login: u.login },
      update: { name: u.name, role: u.role, carrierId: u.carrierId, passwordHash: hashPassword(seedPassword) },
      create: { ...u, passwordHash: hashPassword(seedPassword) },
    })
    // проформа (плашка аккаунта): ФИО, должность, организация, контакты (Task 113)
    const profileData = ({
      admin: { fullName: FIO.admin, position: 'Администратор платформы', phone: '+7 (86131) 5-02-01', email: 'e.gromova@aemz.ru', companyName: AEMZ },
      logist1: { fullName: FIO.logist1, position: 'Ведущий специалист по логистике', phone: '+7 (86131) 5-03-12', email: 'd.sokolov@aemz.ru', companyName: AEMZ },
      logist2: { fullName: FIO.logist2, position: 'Специалист по логистике', phone: '+7 (86131) 5-03-15', email: 'a.morozova@aemz.ru', companyName: AEMZ },
      'carrier-a': { fullName: FIO.carrierA, position: 'Руководитель отдела перевозок', phone: '+7 (918) 402-11-05', email: 'kovalev@perevoz-a.ru', companyName: carrierA.name, inn: carrierA.inn },
      'carrier-b': { fullName: FIO.carrierB, position: 'Директор', phone: '+7 (903) 411-22-18', email: 'bogdanov@perevoz-b.ru', companyName: carrierB.name, inn: carrierB.inn },
      'carrier-v': { fullName: FIO.carrierV, position: 'Руководитель экспедиции', phone: '+7 (495) 621-33-90', email: 'litvinov@perevoz-v.ru', companyName: carrierV.name, inn: carrierV.inn },
      'carrier-g': { fullName: FIO.carrierG, position: 'Директор по логистике', phone: '+7 (863) 250-44-27', email: 'tkachev@perevoz-g.ru', companyName: carrierG.name, inn: carrierG.inn },
    } as Record<string, { fullName: string; position: string; phone: string; email: string; companyName: string; inn?: string }>)[u.login]
    if (!profileData) continue
    const profileUpsert = {
      fullName: profileData.fullName, position: profileData.position, phone: profileData.phone,
      email: profileData.email, companyName: profileData.companyName,
      ...(profileData.inn ? { inn: profileData.inn } : {}),
    }

    await db.profile.upsert({
      where: { userId: existing.id },
      update: profileUpsert,
      create: { userId: existing.id, ...profileUpsert },
    })
  }

  // ——— Персональные права (Task 113) ———
  // logist1 — ведущий специалист: работает по роли логиста (почти все права платформы).
  // logist2 — линейный сотрудник: урезанный набор — готовит заявки и документы,
  // но без операционных решений: публикации, удалений, продлений и повышений ставок,
  // прямых предложений, решений сверки, ЭДО, рассылки агентам, закрытия рейсов и отчётов.
  const logist1User = await db.user.findUnique({ where: { login: 'logist1' } })
  const logist2User = await db.user.findUnique({ where: { login: 'logist2' } })
  if (logist1User) {
    await db.user.update({ where: { id: logist1User.id }, data: { permOverrides: null, profileEditOwn: null } })
  }
  if (logist2User) {
    await db.user.update({
      where: { id: logist2User.id },
      data: {
        permOverrides: JSON.stringify({
          'request:publish': 'deny',
          'request:delete': 'deny',
          'request:extend': 'deny',
          'request:raise': 'deny',
          'request:offer': 'deny',
          'verify:decide': 'deny',
          'edo:sync': 'deny',
          'edo:sign': 'deny',
          'edo:send': 'deny',
          'notify:agent': 'deny',
          'trip:close': 'deny',
          'reports:view': 'deny',
        } satisfies Record<string, 'allow' | 'deny'>),
      },
    })
  }

  // ---------- Справочник грузов: единые имена, группы, рекомендуемый ТС ----------
  // Эталонный пул задан номенклатурой АЭМЗ (список пользователя):
  // готовая продукция — проволока, арматура, катанка, моток, пруток,
  // плюс автоуслуги для собственных подразделений и перевозка металлолома.
  // Каждый груз из справочника используется минимум в одной заявке — экраны логиста
  // и перевозчика всегда показывают один и тот же пул.
  const cargoWire = await db.cargoType.create({ data: { name: 'Перевозка готовой продукции - проволока', category: 'Готовая продукция', truckType: 'Тент' } })
  const cargoRebar = await db.cargoType.create({ data: { name: 'Перевозка готовой продукции - арматура', category: 'Готовая продукция', truckType: 'Борт' } })
  const cargoWireRod = await db.cargoType.create({ data: { name: 'Перевозка готовой продукции - катанка', category: 'Готовая продукция', truckType: 'Борт' } })
  const cargoCoil = await db.cargoType.create({ data: { name: 'Перевозка готовой продукции - моток', category: 'Готовая продукция', truckType: 'Борт' } })
  const cargoBar = await db.cargoType.create({ data: { name: 'Перевозка готовой продукции - пруток', category: 'Готовая продукция', truckType: 'Борт' } })
  const cargoAuto = await db.cargoType.create({ data: { name: 'Автоуслуги для собственных подразделений', category: 'Услуги', truckType: 'Тент' } })
  const cargoScrap = await db.cargoType.create({ data: { name: 'Перевозка металлолома', category: 'Металлолом', truckType: 'Борт' } })

  // ---------- Активные заявки на площадке ----------
  const z1042 = await db.request.create({
    data: {
      number: 'Z-1042', fromPoint: 'Абинск', toPoint: 'Санкт-Петербург', cargo: 'Перевозка готовой продукции - арматура', cargoTypeId: cargoRebar.id,
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 8400, bestRate: 7900,
      status: 'PUBLISHED', loadDate: '20.10.2026', loadWindow: '08:00–12:00', createdBy: FIO.logist1,
      deadline: inHours(2.25),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 8 400 ₽/т, торги до срока', createdAt: hoursAgo(26) } },
    },
  })
  const bids1042 = [
    { carrier: carrierA, amount: 7900, h: 9.1 },
    { carrier: carrierB, amount: 8100, h: 9.4 },
    { carrier: carrierV, amount: 8200, h: 10.2 },
    { carrier: carrierG, amount: 8350, h: 11.9 },
  ]
  for (const b of bids1042) {
    await db.bid.create({
      data: { requestId: z1042.id, carrierId: b.carrier.id, amount: b.amount, createdAt: hoursAgo(b.h) },
    })
    await db.event.create({ data: { requestId: z1042.id, type: 'BID_PLACED', message: `${b.carrier.name}: ставка ${b.amount.toLocaleString('ru-RU')} ₽/т`, createdAt: hoursAgo(b.h) } })
  }

  await db.request.create({
    data: {
      number: 'Z-1043', fromPoint: 'Абинск', toPoint: 'Санкт-Петербург, склад «Южный»', cargo: 'Перевозка готовой продукции - пруток', cargoTypeId: cargoBar.id,
      tonnage: 18, truckType: 'Тент', mode: 'AUCTION', startRate: 6800, bestRate: null,
      status: 'PUBLISHED', loadDate: '21.10.2026', loadWindow: '09:00–13:00', createdBy: FIO.logist2,
      deadline: inHours(26),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 6 800 ₽/т', createdAt: hoursAgo(20) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1044', fromPoint: 'Абинск', toPoint: 'Санкт-Петербург', cargo: 'Перевозка готовой продукции - арматура', cargoTypeId: cargoRebar.id,
      tonnage: 20, truckType: 'Борт', mode: 'CLOSED', startRate: 11500, bestRate: null,
      status: 'PUBLISHED', loadDate: '22.10.2026', loadWindow: '08:00–11:00', createdBy: FIO.logist1,
      deadline: inHours(28),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: закрытые ставки, участники не видят цены друг друга', createdAt: hoursAgo(14) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1045', fromPoint: 'Абинск', toPoint: 'Санкт-Петербург', cargo: 'Перевозка готовой продукции - арматура', cargoTypeId: cargoRebar.id,
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 9200, bestRate: null,
      status: 'PUBLISHED', loadDate: '22.10.2026', loadWindow: '13:00–17:00', createdBy: FIO.logist2,
      deadline: inHours(5.5),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 9 200 ₽/т', createdAt: hoursAgo(6) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1046', fromPoint: 'Абинск', toPoint: 'Санкт-Петербург, склад «Южный»', cargo: 'Перевозка готовой продукции - проволока', cargoTypeId: cargoWire.id,
      tonnage: 10, truckType: 'Тент', mode: 'AUCTION', startRate: 3200, bestRate: null,
      status: 'PUBLISHED', loadDate: '23.10.2026', loadWindow: '10:00–14:00', createdBy: FIO.logist1,
      deadline: inHours(20),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 3 200 ₽/т', createdAt: hoursAgo(3) } },
    },
  })

  // ---------- Выигранные перевозчиком Б: готовятся к подаче заявки ----------
  await db.request.create({
    data: {
      number: 'Z-1047', fromPoint: 'Абинск', toPoint: 'Санкт-Петербург', cargo: 'Перевозка готовой продукции - моток', cargoTypeId: cargoCoil.id,
      tonnage: 18, truckType: 'Тент', mode: 'AUCTION', startRate: 8800, bestRate: 8200,
      status: 'AWARDED', loadDate: '24.10.2026', loadWindow: '08:00–12:00', createdBy: FIO.logist1,
      winnerId: carrierB.id,
      createdAt: hoursAgo(30), updatedAt: hoursAgo(8),
      bids: { create: [{ carrierId: carrierB.id, amount: 8200, isWinner: true, createdAt: hoursAgo(12) }] },
      events: {
        create: [
          { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 8 800 ₽/т', createdAt: hoursAgo(30) },
          { type: 'WINNER_AWARDED', message: 'Логист согласовал победителя: ООО «Перевозчик Б» — 8 200 ₽/т', createdAt: hoursAgo(8) },
        ],
      },
    },
  })
  await db.request.create({
    data: {
      number: 'Z-1048', fromPoint: 'Абинск', toPoint: 'Санкт-Петербург, склад «Южный»', cargo: 'Перевозка готовой продукции - проволока', cargoTypeId: cargoWire.id,
      tonnage: 10, truckType: 'Тент', mode: 'AUCTION', startRate: 4100, bestRate: 3850,
      status: 'AWARDED', loadDate: '25.10.2026', loadWindow: '09:00–13:00', createdBy: FIO.logist2,
      winnerId: carrierB.id,
      createdAt: hoursAgo(28), updatedAt: hoursAgo(7),
      bids: { create: [{ carrierId: carrierB.id, amount: 3850, isWinner: true, createdAt: hoursAgo(10) }] },
      events: {
        create: [
          { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 4 100 ₽/т', createdAt: hoursAgo(28) },
          { type: 'WINNER_AWARDED', message: 'Логист согласовал победителя: ООО «Перевозчик Б» — 3 850 ₽/т', createdAt: hoursAgo(7) },
        ],
      },
    },
  })

  // ---------- Z-1039: у логиста (сверка фото и полей) ----------
  const driverA = await db.driver.findFirst({ where: { carrierId: carrierA.id, fullName: 'Иванов Иван Иванович' } })
  const truckA = await db.truck.findFirst({ where: { carrierId: carrierA.id, plate: 'А123ВС777' } })
  const trailerA = await db.trailer.findFirst({ where: { carrierId: carrierA.id } })

  const z1039 = await db.request.create({
    data: {
      number: 'Z-1039', fromPoint: 'Абинск', toPoint: 'Санкт-Петербург', cargo: 'Перевозка готовой продукции - катанка', cargoTypeId: cargoWireRod.id,
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 10500, bestRate: 9800,
      status: 'AT_LOGIST', loadDate: '16.10.2026', loadWindow: '08:00–12:00', createdBy: FIO.logist1,
      winnerId: carrierA.id, driverId: driverA?.id, truckId: truckA?.id, trailerId: trailerA?.id,
      createdAt: hoursAgo(52), updatedAt: hoursAgo(4),
      bids: { create: [{ carrierId: carrierA.id, amount: 9800, isWinner: true, createdAt: hoursAgo(48) }] },
      events: {
        create: [
          { type: 'WINNER_AWARDED', message: 'Логист согласовал победителя: ООО «Перевозчик А» — 9 800 ₽/т', createdAt: hoursAgo(47) },
          { type: 'DOC_VERIFIED', message: 'Комплект документов прошёл проверку — передан логисту', createdAt: hoursAgo(4) },
        ],
      },
    },
  })

  const passFields = { 'Фамилия': 'ИВАНОВ', 'Имя': 'ИВАН', 'Отчество': 'ИВАНОВИЧ', 'Дата рождения': '15.05.1990', 'Серия и номер': '99 12 345678', 'Дата выдачи': '01.02.2020', 'Код подразделения': '770-001' }
  const passConf = { 'Фамилия': 0.989, 'Имя': 0.996, 'Отчество': 0.984, 'Дата рождения': 0.999, 'Серия и номер': 0.998, 'Дата выдачи': 0.998, 'Код подразделения': 0.999 }
  await db.document.create({
    data: {
      requestId: z1039.id, type: 'PASSPORT_PHOTO', fileName: 'passport_photo.jpg',
      dataUri: docSvg('ПАСПОРТ РФ · стр. с фото', ['ГУ МВД РОССИИ', 'ПО КРАСНОДАРСКОМУ КРАЮ', 'ИВАНОВ ИВАН ИВАНОВИЧ', '15.05.1990', '99 12 345678'], '#0f3b66'),
      status: 'PASSED', quality: 96, engine: 'PaddleOCR-демо',
      fields: JSON.stringify(passFields), confidence: JSON.stringify(passConf),
      issues: JSON.stringify(['Все оценки от 0,95 — поля приняты по уверенности; ФИО и дата совпали с заявкой']),
      createdAt: hoursAgo(30), updatedAt: hoursAgo(29.5),
    },
  })
  await db.document.create({
    data: {
      requestId: z1039.id, type: 'PASSPORT_REG', fileName: 'passport_reg.jpg',
      dataUri: docSvg('ПАСПОРТ РФ · регистрация', ['ЗАРЕГИСТРИРОВАН', 'Г. МОСКВА', 'УЛ. ПРИМЕРНАЯ', 'Д. 1', '01.02.2020  770-001'], '#0f3b66'),
      status: 'MANUAL', quality: 91, engine: 'PaddleOCR-демо',
      fields: JSON.stringify({ 'Дата регистрации': '01.02.2020', 'Код подразделения': '770-001', 'Адрес регистрации': 'г. МОСКВА, ул. ПРИМЕРНАЯ д. 1' }),
      confidence: JSON.stringify({ 'Дата регистрации': 1.0, 'Код подразделения': 0.95, 'Адрес регистрации': 0.49 }),
      issues: JSON.stringify(['Адрес на штампе прочитан с ошибками (оценка 0,49) — смотрит оператор']),
      createdAt: hoursAgo(30), updatedAt: hoursAgo(29.5),
    },
  })
  await db.document.create({
    data: {
      requestId: z1039.id, type: 'STS', fileName: 'sts_front.jpg',
      dataUri: docSvg('СТС ТЯГАЧА', ['Регистрационный знак: А123ВС777', 'VIN: X9622277XKG123456', 'Модель: КАМАЗ 5490', 'Собственник: ООО ПЕРЕВОЗЧИК А'], '#14532d'),
      status: 'PASSED', quality: 97, engine: 'PaddleOCR-демо',
      fields: JSON.stringify({ 'Госномер': 'А123ВС777', 'VIN': 'X9622277XKG123456', 'Номер СТС': '99 00 123456', 'Владелец': 'ООО ПЕРЕВОЗЧИК А' }),
      confidence: JSON.stringify({ 'Госномер': 0.99, 'VIN': 0.998, 'Номер СТС': 0.995, 'Владелец': 0.97 }),
      issues: JSON.stringify(['Госномер и VIN совпали с заявкой; собственник может отличаться от водителя — не ошибка']),
      createdAt: hoursAgo(28), updatedAt: hoursAgo(27.7),
    },
  })
  await db.document.create({
    data: {
      requestId: z1039.id, type: 'REQUEST_DOC', fileName: 'zayavka_scan.jpg',
      dataUri: docSvg('ЗАЯВКА НА ПЕРЕВОЗКУ', ['№ Z-1039', '18.10.2026', 'ГРУЗ: КАТАНКА, 20 Т', 'МАРШРУТ: ЗАВОД → ПОРТ', 'СТАВКА: 9 800 РУБ/Т'], '#9a3412'),
      status: 'PASSED', quality: 95, engine: 'PaddleOCR-демо',
      fields: JSON.stringify({ 'Номер заявки': 'Z-1039', 'Дата заявки': '18.10.2026', 'Груз': 'КАТАНКА, 20 Т', 'Ставка': '9 800 РУБ/Т' }),
      confidence: JSON.stringify({ 'Номер заявки': 0.997, 'Дата заявки': 0.99, 'Груз': 0.98, 'Ставка': 0.96 }),
      issues: JSON.stringify(['Номер заявки на скане совпал с рейсом Z-1039 — документ принят автоматически']),
      createdAt: hoursAgo(27.6), updatedAt: hoursAgo(27.3),
    },
  })
  await db.document.create({
    data: {
      requestId: z1039.id, type: 'POA', fileName: 'doverennost.jpg',
      dataUri: docSvg('ДОВЕРЕННОСТЬ № 47', ['№ 47', '18.10.2026', 'ООО «ПЕРЕВОЗЧИК А»', 'ИВАНОВ ИВАН ИВАНОВИЧ', '31.12.2026'], '#3f6212'),
      status: 'PASSED', quality: 93, engine: 'PaddleOCR-демо',
      fields: JSON.stringify({ 'Номер доверенности': '47', 'Дата выдачи': '18.10.2026', 'Действительна до': '31.12.2026', 'Кем выдана (перевозчик)': 'ООО «ПЕРЕВОЗЧИК А»', 'Представитель (ФИО)': 'ИВАНОВ ИВАН ИВАНОВИЧ' }),
      confidence: JSON.stringify({ 'Номер доверенности': 0.98, 'Дата выдачи': 0.99, 'Действительна до': 0.995, 'Кем выдана (перевозчик)': 0.97, 'Представитель (ФИО)': 0.98 }),
      issues: JSON.stringify(['Срок доверенности действителен; представитель совпал с водителем заявки']),
      createdAt: hoursAgo(27.2), updatedAt: hoursAgo(27),
    },
  })

  // ---------- Реестр: подтверждённые и закрытые рейсы ----------
  const regRows = [
    { number: 'Z-1038', status: 'CONFIRMED', carrier: carrierA, start: 11200, best: 10400, load: '14.10.2026', cargo: 'Перевозка готовой продукции - катанка', cargoId: cargoWireRod.id, route: ['Абинск', 'Санкт-Петербург'], pass: true, etrn: 'SENT', h: 96 },
    { number: 'Z-1037', status: 'CLOSED', carrier: carrierB, start: 5400, best: 5150, load: '08.10.2026', cargo: 'Перевозка металлолома', cargoId: cargoScrap.id, route: ['Абинск', 'Санкт-Петербург, склад «Южный»'], pass: true, etrn: 'SIGNED', h: 190 },
    { number: 'Z-1041', status: 'CLOSED', carrier: carrierB, start: 4600, best: 4350, load: '12.10.2026', cargo: 'Перевозка готовой продукции - пруток', cargoId: cargoBar.id, route: ['Абинск', 'Санкт-Петербург, склад «Южный»'], pass: true, etrn: 'SIGNED', h: 150 },
    { number: 'Z-1036', status: 'CLOSED', carrier: carrierG, start: 11800, best: 11250, load: '05.10.2026', cargo: 'Перевозка готовой продукции - пруток', cargoId: cargoBar.id, route: ['Абинск', 'Санкт-Петербург'], pass: true, etrn: 'SIGNED', h: 280 },
    { number: 'Z-1035', status: 'CLOSED', carrier: carrierA, start: 2600, best: 2600, load: '02.10.2026', cargo: 'Автоуслуги для собственных подразделений', cargoId: cargoAuto.id, route: ['Абинск', 'Санкт-Петербург, склад «Южный»'], pass: true, etrn: 'SIGNED', h: 330 },
    { number: 'Z-1034', status: 'CLOSED', carrier: carrierV, start: 7600, best: 7300, load: '29.09.2026', cargo: 'Перевозка готовой продукции - катанка', cargoId: cargoWireRod.id, route: ['Абинск', 'Санкт-Петербург'], pass: false, etrn: 'SIGNED', h: 400 },
  ]
  for (const [i, r] of regRows.entries()) {
    await db.request.create({
      data: {
        number: r.number, fromPoint: r.route[0], toPoint: r.route[1], cargo: r.cargo.split(',')[0], cargoTypeId: r.cargoId,
        tonnage: Number(r.cargo.split('т')[0].match(/(\d+)\s*$/)?.[1] ?? 20),
        truckType: 'Тент', mode: 'AUCTION', createdBy: i % 2 === 0 ? FIO.logist1 : FIO.logist2,
        startRate: r.start, bestRate: r.best, status: r.status, loadDate: r.load, loadWindow: '08:00–12:00',
        winnerId: r.carrier.id, passPackage: r.pass, etrnStatus: r.etrn,
        createdAt: hoursAgo(r.h + 24), updatedAt: hoursAgo(r.h),
        bids: { create: [{ carrierId: r.carrier.id, amount: r.best, isWinner: true, createdAt: hoursAgo(r.h + 12) }] },
        events: { create: { type: 'CONFIRMED_1C', message: 'Документы сверены и подтверждены — рейс выполняется', createdAt: hoursAgo(r.h) } },
      },
    })
  }

  // ---------- Заявки от лица логистов: черновики и новые выходы на площадку (Task 113) ----------
  // Номера 1050–1063 занимает prisma/seed-more.js — черновики идут после них
  await db.request.create({
    data: {
      number: 'Z-1064', fromPoint: 'Абинск', toPoint: 'Краснодар, распределительный центр', cargo: 'Перевозка готовой продукции - проволока', cargoTypeId: cargoWire.id,
      tonnage: 12, truckType: 'Тент', mode: 'AUCTION', startRate: 5300,
      status: 'DRAFT', loadDate: dateInDays(4), loadWindow: '08:00–11:00', createdBy: FIO.logist2,
      comment: 'Черновик подготовила Морозова — на публикацию согласовать с ведущим специалистом',
      createdAt: hoursAgo(3),
      events: { create: { type: 'DRAFT_CREATED', message: `Черновик создан: ${FIO.logist2}`, createdAt: hoursAgo(3) } },
    },
  })
  await db.request.create({
    data: {
      number: 'Z-1065', fromPoint: 'Абинск', toPoint: 'Новороссийск, терминал', cargo: 'Перевозка металлолома', cargoTypeId: cargoScrap.id,
      tonnage: 20, truckType: 'Борт', mode: 'CLOSED', startRate: 4700,
      status: 'DRAFT', loadDate: dateInDays(5), loadWindow: '13:00–16:00', createdBy: FIO.logist1,
      comment: 'Закрытые ставки — лом на терминал, старт пониже после прошлого рейса',
      createdAt: hoursAgo(5),
      events: { create: { type: 'DRAFT_CREATED', message: `Черновик создан: ${FIO.logist1}`, createdAt: hoursAgo(5) } },
    },
  })
  await db.request.create({
    data: {
      number: 'Z-1066', fromPoint: 'Абинск', toPoint: 'Ростов-на-Дону', cargo: 'Перевозка готовой продукции - катанка', cargoTypeId: cargoWireRod.id,
      tonnage: 22, truckType: 'Борт', mode: 'AUCTION', startRate: 9100, bestRate: null,
      status: 'PUBLISHED', loadDate: dateInDays(3), loadWindow: '08:00–12:00', createdBy: FIO.logist2,
      deadline: inHours(30),
      events: { create: { type: 'REQUEST_PUBLISHED', message: `Заявка опубликована: стартовая ставка 9 100 ₽/т (${FIO.logist2})`, createdAt: hoursAgo(2) } },
    },
  })
  await db.request.create({
    data: {
      number: 'Z-1067', fromPoint: 'Абинск', toPoint: 'Сочи, стройплощадка «Матарами»', cargo: 'Перевозка готовой продукции - арматура', cargoTypeId: cargoRebar.id,
      tonnage: 12, truckType: 'Тент', mode: 'CLOSED', startRate: 9900, bestRate: null,
      status: 'PUBLISHED', loadDate: dateInDays(4), loadWindow: '09:00–13:00', createdBy: FIO.logist1,
      deadline: inHours(44),
      events: { create: { type: 'REQUEST_PUBLISHED', message: `Заявка опубликована: закрытые ставки (${FIO.logist1})`, createdAt: hoursAgo(1) } },
    },
  })

  console.log('Seed complete:',
    await db.carrier.count(), 'carriers,',
    await db.cargoType.count(), 'cargoTypes,',
    await db.request.count(), 'requests,',
    await db.bid.count(), 'bids,',
    await db.document.count(), 'documents')
}

main().finally(() => db.$disconnect())

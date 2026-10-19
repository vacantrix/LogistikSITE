/**
 * Seed: демо-данные платформы «Привлечённый транспорт» (АЭМЗ)
 * Запуск: bun prisma/seed.ts  (или bun run db:seed)
 */
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
  await db.event.deleteMany()
  await db.document.deleteMany()
  await db.bid.deleteMany()
  await db.request.deleteMany()
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
        license: 'Серия — 4 знака, номер — 6 цифр; срок действия не истёк на дату погрузки; для тягача — категории C, CE',
        categories: 'Для грузовика — C, для тягача с полуприцепом — CE; не найдена — решает человек',
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
          // сроки медсправки покрывают все состояния подсветки: истёк / истекает / ок
          { fullName: 'Иванов Иван Иванович', birthDate: '15.05.1990', passport: '99 12 345678', license: '99 12 345678', licenseTill: '12.03.2030', medTill: dateInDays(-12), categories: 'C, CE', createdAt: hoursAgo(24 * 40) },
          { fullName: 'Петров Пётр Сергеевич', birthDate: '22.08.1988', passport: '03 13 992210', license: '23 11 770145', licenseTill: '01.06.2029', medTill: dateInDays(24), categories: 'C', createdAt: hoursAgo(24 * 12) },
          { fullName: 'Ковалёв Андрей Викторович', birthDate: '12.03.1986', passport: '23 14 220018', license: '23 14 220018', licenseTill: '05.05.2030', medTill: dateInDays(95), categories: 'C, CE', createdAt: hoursAgo(24 * 31) },
          { fullName: 'Егоров Максим Андреевич', birthDate: '07.09.1993', passport: '23 15 771064', license: '23 15 771064', licenseTill: '19.07.2029', medTill: dateInDays(45), categories: 'C', createdAt: hoursAgo(24 * 18) },
          { fullName: 'Тарасов Олег Дмитриевич', birthDate: '25.12.1984', passport: '52 08 330592', license: '52 08 330592', licenseTill: '11.11.2028', medTill: dateInDays(160), categories: 'C, CE', createdAt: hoursAgo(24 * 6) },
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
          { fullName: 'Сидоров Алексей Владимирович', birthDate: '03.02.1992', passport: '52 04 118872', license: '52 04 118872', licenseTill: '18.09.2028', medTill: dateInDays(210), categories: 'C, CE', createdAt: hoursAgo(24 * 33) },
          { fullName: 'Кузнецов Дмитрий Олегович', birthDate: '17.11.1985', passport: '52 05 442301', license: '52 05 442301', licenseTill: dateInDays(18), medTill: dateInDays(150), categories: 'C', createdAt: hoursAgo(24 * 9) },
          { fullName: 'Фомин Сергей Петрович', birthDate: '30.06.1989', passport: '52 09 661427', license: '52 09 661427', licenseTill: '23.02.2031', medTill: dateInDays(280), categories: 'C, CE', createdAt: hoursAgo(24 * 27) },
          { fullName: 'Гусев Павел Романович', birthDate: '14.02.1995', passport: '52 10 884610', license: '52 10 884610', licenseTill: '08.10.2029', medTill: dateInDays(120), categories: 'C', createdAt: hoursAgo(24 * 11) },
          { fullName: 'Лебедев Артём Игоревич', birthDate: '19.04.1983', passport: '61 11 553876', license: '61 11 553876', licenseTill: '16.08.2028', medTill: dateInDays(-3), categories: 'C, CE', createdAt: hoursAgo(24 * 4) },
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
      name: 'ООО «Перевозчик В»', inn: '2310045673', contractNo: '18-В', contractDate: '21.08.2025',
      drivers: {
        create: [
          { fullName: 'Морозов Игорь Павлович', birthDate: '09.07.1987', passport: '77 02 551209', license: '77 02 551209', licenseTill: '30.11.2029', medTill: '—', categories: 'C, CE', createdAt: hoursAgo(24 * 21) },
          { fullName: 'Сазонов Виктор Юрьевич', birthDate: '02.10.1988', passport: '77 12 994523', license: '77 12 994523', licenseTill: '27.03.2030', medTill: dateInDays(200), categories: 'C, CE', createdAt: hoursAgo(24 * 16) },
          { fullName: 'Носов Роман Алексеевич', birthDate: '08.06.1991', passport: '77 13 441205', license: '77 13 441205', licenseTill: '30.09.2028', medTill: dateInDays(60), categories: 'C', createdAt: hoursAgo(24 * 8) },
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
          { fullName: 'Волков Сергей Николаевич', birthDate: '28.01.1991', passport: '61 06 773410', license: '61 06 773410', licenseTill: '14.02.2031', medTill: dateInDays(320), categories: 'C, CE', createdAt: hoursAgo(24 * 7) },
          { fullName: 'Захаров Денис Львович', birthDate: '21.11.1987', passport: '61 14 330917', license: '61 14 330917', licenseTill: '13.01.2030', medTill: dateInDays(150), categories: 'C, CE', createdAt: hoursAgo(24 * 10) },
          { fullName: 'Куликов Игорь Валерьевич', birthDate: '05.03.1994', passport: '23 16 225840', license: '23 16 225840', licenseTill: '02.12.2029', medTill: dateInDays(90), categories: 'C', createdAt: hoursAgo(24 * 3) },
        ],
      },
      trucks: {
        create: [{ brand: 'MAN TGX', plate: 'Г456УА161', vin: 'WMA06XZZ7CP012345', sts: '61 02 445566', techTill: dateInDays(240), owner: 'ООО «Перевозчик Г»', createdAt: hoursAgo(24 * 7) }],
      },
      trailers: { create: [{ plate: 'ГА901161', sts: '61 02 778899', type: 'Полуприцеп тент', techTill: dateInDays(310), createdAt: hoursAgo(24 * 5) }] },
    },
  })

  // ---------- Активные заявки на площадке ----------
  const z1042 = await db.request.create({
    data: {
      number: 'Z-1042', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Металлоконструкции',
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 8400, bestRate: 7900,
      status: 'PUBLISHED', loadDate: '20.10.2026', loadWindow: '08:00–12:00',
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
      number: 'Z-1043', fromPoint: 'Завод', toPoint: 'Склад', cargo: 'Оборудование',
      tonnage: 18, truckType: 'Реф', mode: 'AUCTION', startRate: 6800, bestRate: null,
      status: 'PUBLISHED', loadDate: '21.10.2026', loadWindow: '09:00–13:00',
      deadline: inHours(26),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 6 800 ₽/т', createdAt: hoursAgo(20) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1044', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Металлоконструкции',
      tonnage: 20, truckType: 'Борт', mode: 'CLOSED', startRate: 11500, bestRate: null,
      status: 'PUBLISHED', loadDate: '22.10.2026', loadWindow: '08:00–11:00',
      deadline: inHours(28),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: закрытые ставки, участники не видят цены друг друга', createdAt: hoursAgo(14) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1045', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Металлоконструкции',
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 9200, bestRate: null,
      status: 'PUBLISHED', loadDate: '22.10.2026', loadWindow: '13:00–17:00',
      deadline: inHours(5.5),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 9 200 ₽/т', createdAt: hoursAgo(6) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1046', fromPoint: 'Завод', toPoint: 'Склад', cargo: 'Клининг',
      tonnage: 10, truckType: 'Тент', mode: 'AUCTION', startRate: 3200, bestRate: null,
      status: 'PUBLISHED', loadDate: '23.10.2026', loadWindow: '10:00–14:00',
      deadline: inHours(20),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 3 200 ₽/т', createdAt: hoursAgo(3) } },
    },
  })

  // ---------- Выигранные перевозчиком Б: готовятся к подаче заявки ----------
  await db.request.create({
    data: {
      number: 'Z-1047', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Оборудование',
      tonnage: 18, truckType: 'Тент', mode: 'AUCTION', startRate: 8800, bestRate: 8200,
      status: 'AWARDED', loadDate: '24.10.2026', loadWindow: '08:00–12:00',
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
      number: 'Z-1048', fromPoint: 'Завод', toPoint: 'Склад', cargo: 'Клининг',
      tonnage: 10, truckType: 'Тент', mode: 'AUCTION', startRate: 4100, bestRate: 3850,
      status: 'AWARDED', loadDate: '25.10.2026', loadWindow: '09:00–13:00',
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
      number: 'Z-1039', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Металлоконструкции',
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 10500, bestRate: 9800,
      status: 'AT_LOGIST', loadDate: '16.10.2026', loadWindow: '08:00–12:00',
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

  const passFields = { 'Фамилия': 'ИВАНОВ', 'Имя': 'ИВАН', 'Отчество': 'ИВАНОВИЧ', 'Дата рождения': '15.05.1990', 'Серия и номер': '99 12 345678', 'Дата выдачи': '10.04.2024', 'Код подразделения': '230-027' }
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
      dataUri: docSvg('ПАСПОРТ РФ · регистрация', ['ЗАРЕГИСТРИРАН', 'КРАСНОДАРСКИЙ КРАЙ', 'Г. АБИНСК УЛ.', 'ИНТЕРНАЦИОНАЛЬНАЯ Д. 110', '13.03.2024  230-027'], '#0f3b66'),
      status: 'MANUAL', quality: 91, engine: 'PaddleOCR-демо',
      fields: JSON.stringify({ 'Дата регистрации': '13.03.2024', 'Код подразделения': '230-027', 'Адрес регистрации': 'г. АБИНСК, ул. ИНТЕРНАЦИОНАЛЬНАЯ д. 110' }),
      confidence: JSON.stringify({ 'Дата регистрации': 1.0, 'Код подразделения': 0.95, 'Адрес регистрации': 0.49 }),
      issues: JSON.stringify(['Адрес на штампе прочитан с ошибками (оценка 0,49) — смотрит оператор']),
      createdAt: hoursAgo(30), updatedAt: hoursAgo(29.5),
    },
  })
  await db.document.create({
    data: {
      requestId: z1039.id, type: 'LICENSE', fileName: 'license_front.jpg',
      dataUri: docSvg('ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ', ['ИВАНОВ ИВАН ИВАНОВИЧ', '15.05.1990', '99 12 345678', 'B B1 M', '28.04.2032'], '#5b3413'),
      status: 'MANUAL', quality: 94, engine: 'PaddleOCR-демо',
      fields: JSON.stringify({ 'ФИО': 'Иван Иванович', 'Дата рождения': '15.05.1990', 'Номер ВУ': '99 12 345678', 'Категории': 'B, B1, M', 'Дата выдачи': '28.04.2022', 'Действует до': '28.04.2032' }),
      confidence: JSON.stringify({ 'ФИО': 0.99, 'Дата рождения': 1.0, 'Номер ВУ': 0.97, 'Категории': 1.0, 'Дата выдачи': 1.0, 'Действует до': 0.97 }),
      issues: JSON.stringify(['Категории: прочитаны B, B1, M — для тягача нет C и CE, решает человек', 'ФИО на ВУ отличается от заявки («Иван Иванович» без фамилии) — сверяет оператор']),
      createdAt: hoursAgo(29), updatedAt: hoursAgo(28.6),
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
      dataUri: docSvg('ЗАЯВКА НА ПЕРЕВОЗКУ', ['№ Z-1039', '18.10.2026', 'ГРУЗ: МЕТАЛЛОКОНСТРУКЦИИ, 20 Т', 'МАРШРУТ: ЗАВОД → ПОРТ', 'СТАВКА: 9 800 РУБ/Т'], '#9a3412'),
      status: 'PASSED', quality: 95, engine: 'PaddleOCR-демо',
      fields: JSON.stringify({ 'Номер заявки': 'Z-1039', 'Дата заявки': '18.10.2026', 'Груз': 'МЕТАЛЛОКОНСТРУКЦИИ, 20 Т', 'Ставка': '9 800 РУБ/Т' }),
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
    { number: 'Z-1038', status: 'CONFIRMED', carrier: carrierA, start: 11200, best: 10400, load: '14.10.2026', cargo: 'Металлоконструкции', route: ['Завод', 'Порт'], pass: true, etrn: 'SENT', h: 96 },
    { number: 'Z-1037', status: 'CLOSED', carrier: carrierB, start: 5400, best: 5150, load: '08.10.2026', cargo: 'Оборудование', route: ['Завод', 'Склад'], pass: true, etrn: 'SIGNED', h: 190 },
    { number: 'Z-1036', status: 'CLOSED', carrier: carrierG, start: 11800, best: 11250, load: '05.10.2026', cargo: 'Контейнеры', route: ['Завод', 'Порт'], pass: true, etrn: 'SIGNED', h: 280 },
    { number: 'Z-1035', status: 'CLOSED', carrier: carrierA, start: 2600, best: 2600, load: '02.10.2026', cargo: 'Клининг', route: ['Завод', 'Склад'], pass: true, etrn: 'SIGNED', h: 330 },
    { number: 'Z-1034', status: 'CLOSED', carrier: carrierV, start: 7600, best: 7300, load: '29.09.2026', cargo: 'Металлоконструкции', route: ['Завод', 'Порт'], pass: false, etrn: 'SIGNED', h: 400 },
  ]
  for (const r of regRows) {
    await db.request.create({
      data: {
        number: r.number, fromPoint: r.route[0], toPoint: r.route[1], cargo: r.cargo.split(',')[0],
        tonnage: Number(r.cargo.split('т')[0].match(/(\d+)\s*$/)?.[1] ?? 20),
        truckType: 'Тент', mode: 'AUCTION',
        startRate: r.start, bestRate: r.best, status: r.status, loadDate: r.load, loadWindow: '08:00–12:00',
        winnerId: r.carrier.id, passPackage: r.pass, etrnStatus: r.etrn,
        createdAt: hoursAgo(r.h + 24), updatedAt: hoursAgo(r.h),
        bids: { create: [{ carrierId: r.carrier.id, amount: r.best, isWinner: true, createdAt: hoursAgo(r.h + 12) }] },
        events: { create: { type: 'CONFIRMED_1C', message: `Данные подтверждены и переданы в 1C:ERP — справочник и реестр`, createdAt: hoursAgo(r.h) } },
      },
    })
  }

  console.log('Seed complete:',
    await db.carrier.count(), 'carriers,',
    await db.request.count(), 'requests,',
    await db.bid.count(), 'bids,',
    await db.document.count(), 'documents')
}

main().finally(() => db.$disconnect())

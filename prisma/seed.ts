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
          { fullName: 'Иванов Иван Иванович', birthDate: '15.05.1990', passport: '99 12 345678', license: '99 12 345678', licenseTill: '12.03.2030', categories: 'C, CE' },
          { fullName: 'Петров Пётр Сергеевич', birthDate: '22.08.1988', passport: '03 13 992210', license: '23 11 770145', licenseTill: '01.06.2029', categories: 'C' },
        ],
      },
      trucks: {
        create: [
          { brand: 'KAMAZ 5490', plate: 'А123ВС777', vin: 'X9622277XKG123456', sts: '99 00 123456', owner: 'ООО «Перевозчик А»' },
          { brand: 'Scania R450', plate: 'Е456КХ777', vin: 'YS2R4X20005412345', sts: '99 00 778812', owner: 'ООО «Перевозчик А»' },
        ],
      },
      trailers: {
        create: [
          { plate: 'АВ124777', sts: '99 00 554411', type: 'Полуприцеп тент' },
          { plate: 'АВ777023', sts: '99 00 332255', type: 'Полуприцеп реф' },
        ],
      },
    },
  })

  const carrierB = await db.carrier.create({
    data: {
      name: 'ООО «Перевозчик Б»', inn: '2310045672', contractNo: '15-Б', contractDate: '02.06.2025',
      drivers: {
        create: [
          { fullName: 'Сидоров Алексей Владимирович', birthDate: '03.02.1992', passport: '52 04 118872', license: '52 04 118872', licenseTill: '18.09.2028', categories: 'C, CE' },
          { fullName: 'Кузнецов Дмитрий Олегович', birthDate: '17.11.1985', passport: '52 05 442301', license: '52 05 442301', licenseTill: '25.04.2027', categories: 'C' },
        ],
      },
      trucks: {
        create: [
          { brand: 'Volvo FH460', plate: 'В234МН150', vin: 'YV2RT40A8FA556789', sts: '50 01 223344', owner: 'ООО «Перевозчик Б»' },
        ],
      },
      trailers: { create: [{ plate: 'ВС567150', sts: '50 01 665577', type: 'Полуприцеп борт' }] },
    },
  })

  const carrierV = await db.carrier.create({
    data: {
      name: 'ООО «Перевозчик В»', inn: '2310045673', contractNo: '18-В', contractDate: '21.08.2025',
      drivers: {
        create: [
          { fullName: 'Морозов Игорь Павлович', birthDate: '09.07.1987', passport: '77 02 551209', license: '77 02 551209', licenseTill: '30.11.2029', categories: 'C, CE' },
        ],
      },
      trucks: {
        create: [{ brand: 'МАЗ 5440', plate: 'М345СО199', vin: 'YM3B544090G012345', sts: '77 03 998811', owner: 'ООО «Перевозчик В»' }],
      },
      trailers: { create: [{ plate: 'МВ890199', sts: '77 03 112233', type: 'Полуприцеп контейнеровоз' }] },
    },
  })

  const carrierG = await db.carrier.create({
    data: {
      name: 'ООО «Перевозчик Г»', inn: '2310045674', contractNo: '21-Г', contractDate: '05.09.2025',
      drivers: {
        create: [
          { fullName: 'Волков Сергей Николаевич', birthDate: '28.01.1991', passport: '61 06 773410', license: '61 06 773410', licenseTill: '14.02.2031', categories: 'C, CE' },
        ],
      },
      trucks: {
        create: [{ brand: 'MAN TGX', plate: 'Г456УА161', vin: 'WMA06XZZ7CP012345', sts: '61 02 445566', owner: 'ООО «Перевозчик Г»' }],
      },
      trailers: { create: [{ plate: 'ГА901161', sts: '61 02 778899', type: 'Полуприцеп тент' }] },
    },
  })

  // ---------- Активные заявки на площадке ----------
  const z1042 = await db.request.create({
    data: {
      number: 'Z-1042', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Металлоконструкции',
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 95000, bestRate: 85900,
      status: 'PUBLISHED', loadDate: '20.10.2026', loadWindow: '08:00–12:00',
      deadline: inHours(2.25),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 95 000 ₽, торги до срока', createdAt: hoursAgo(26) } },
    },
  })
  const bids1042 = [
    { carrier: carrierA, amount: 85900, h: 9.1 },
    { carrier: carrierB, amount: 86500, h: 9.4 },
    { carrier: carrierV, amount: 89000, h: 10.2 },
    { carrier: carrierG, amount: 91500, h: 11.9 },
  ]
  for (const b of bids1042) {
    await db.bid.create({
      data: { requestId: z1042.id, carrierId: b.carrier.id, amount: b.amount, createdAt: hoursAgo(b.h) },
    })
    await db.event.create({ data: { requestId: z1042.id, type: 'BID_PLACED', message: `${b.carrier.name}: ставка ${b.amount.toLocaleString('ru-RU')} ₽`, createdAt: hoursAgo(b.h) } })
  }

  await db.request.create({
    data: {
      number: 'Z-1043', fromPoint: 'Завод', toPoint: 'Склад', cargo: 'Оборудование',
      tonnage: 18, truckType: 'Реф', mode: 'FIXED', startRate: 64000, bestRate: null,
      status: 'PUBLISHED', loadDate: '21.10.2026', loadWindow: '09:00–13:00',
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: фиксированная ставка 64 000 ₽', createdAt: hoursAgo(20) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1044', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Металлоконструкции',
      tonnage: 20, truckType: 'Борт', mode: 'CLOSED', startRate: 120000, bestRate: null,
      status: 'PUBLISHED', loadDate: '22.10.2026', loadWindow: '08:00–11:00',
      deadline: inHours(28),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: закрытые ставки, участники не видят цены друг друга', createdAt: hoursAgo(14) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1045', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Металлоконструкции',
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 98000, bestRate: null,
      status: 'PUBLISHED', loadDate: '22.10.2026', loadWindow: '13:00–17:00',
      deadline: inHours(5.5),
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: стартовая ставка 98 000 ₽', createdAt: hoursAgo(6) } },
    },
  })

  await db.request.create({
    data: {
      number: 'Z-1046', fromPoint: 'Завод', toPoint: 'Склад', cargo: 'Клининг',
      tonnage: 10, truckType: 'Тент', mode: 'FIXED', startRate: 41000, bestRate: null,
      status: 'PUBLISHED', loadDate: '23.10.2026', loadWindow: '10:00–14:00',
      events: { create: { type: 'REQUEST_PUBLISHED', message: 'Заявка опубликована: фиксированная ставка 41 000 ₽', createdAt: hoursAgo(3) } },
    },
  })

  // ---------- Z-1039: у логиста (сверка фото и полей) ----------
  const driverA = await db.driver.findFirst({ where: { carrierId: carrierA.id, fullName: 'Иванов Иван Иванович' } })
  const truckA = await db.truck.findFirst({ where: { carrierId: carrierA.id, plate: 'А123ВС777' } })
  const trailerA = await db.trailer.findFirst({ where: { carrierId: carrierA.id } })

  const z1039 = await db.request.create({
    data: {
      number: 'Z-1039', fromPoint: 'Завод', toPoint: 'Порт', cargo: 'Металлоконструкции',
      tonnage: 20, truckType: 'Тент', mode: 'AUCTION', startRate: 95000, bestRate: 87500,
      status: 'AT_LOGIST', loadDate: '16.10.2026', loadWindow: '08:00–12:00',
      winnerId: carrierA.id, driverId: driverA?.id, truckId: truckA?.id, trailerId: trailerA?.id,
      createdAt: hoursAgo(52), updatedAt: hoursAgo(4),
      bids: { create: [{ carrierId: carrierA.id, amount: 87500, isWinner: true, createdAt: hoursAgo(48) }] },
      events: {
        create: [
          { type: 'WINNER_AWARDED', message: 'Логист согласовал победителя: ООО «Перевозчик А» — 87 500 ₽', createdAt: hoursAgo(47) },
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

  // ---------- Реестр: подтверждённые и закрытые рейсы ----------
  const regRows = [
    { number: 'Z-1038', status: 'CONFIRMED', carrier: carrierA, start: 95000, best: 85900, load: '14.10.2026', cargo: 'Металлоконструкции', route: ['Завод', 'Порт'], pass: true, etrn: 'SENT', h: 96 },
    { number: 'Z-1037', status: 'CLOSED', carrier: carrierB, start: 68000, best: 64500, load: '08.10.2026', cargo: 'Оборудование', route: ['Завод', 'Склад'], pass: true, etrn: 'SIGNED', h: 190 },
    { number: 'Z-1036', status: 'CLOSED', carrier: carrierG, start: 130000, best: 124000, load: '05.10.2026', cargo: 'Контейнеры', route: ['Завод', 'Порт'], pass: true, etrn: 'SIGNED', h: 280 },
    { number: 'Z-1035', status: 'CLOSED', carrier: carrierA, start: 42000, best: 42000, load: '02.10.2026', cargo: 'Клининг', route: ['Завод', 'Склад'], pass: true, etrn: 'SIGNED', h: 330 },
    { number: 'Z-1034', status: 'CLOSED', carrier: carrierV, start: 88000, best: 83200, load: '29.09.2026', cargo: 'Металлоконструкции', route: ['Завод', 'Порт'], pass: false, etrn: 'SIGNED', h: 400 },
  ]
  for (const r of regRows) {
    await db.request.create({
      data: {
        number: r.number, fromPoint: r.route[0], toPoint: r.route[1], cargo: r.cargo.split(',')[0],
        tonnage: Number(r.cargo.split('т')[0].match(/(\d+)\s*$/)?.[1] ?? 20),
        truckType: 'Тент', mode: r.best === r.start ? 'FIXED' : 'AUCTION',
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

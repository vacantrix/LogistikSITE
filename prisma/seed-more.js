/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Наполнение базы реалистичными данными (АЭМЗ Логистика):
 *  +12 водителей, +6 тягачей, +5 прицепов (по 4 перевозчикам),
 *  +14 заявок (все статусы: PUBLISHED/AUCTION+CLOSED, AWARDED, DOCS_REVIEW,
 *  AT_LOGIST, CONFIRMED, CLOSED) со ставками, событиями, экипажами,
 *  ЭТРАН/пропусками и документами на сверку (OCR-поля, статусы верификации).
 * Идемпотентно: если заявка Z-1063 уже есть — повторный запуск ничего не делает.
 * Запуск: node prisma/seed-more.js
 */
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

// ——— утилиты ———
const svgDoc = (title, sub) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="340" viewBox="0 0 480 340"><rect width="480" height="340" fill="#f1f5f9"/><rect x="24" y="24" width="432" height="292" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/><text x="240" y="120" font-family="Arial" font-size="22" font-weight="bold" fill="#334155" text-anchor="middle">${title}</text><text x="240" y="156" font-family="Arial" font-size="14" fill="#64748b" text-anchor="middle">${sub}</text><rect x="120" y="196" width="240" height="8" rx="4" fill="#e2e8f0"/><rect x="120" y="220" width="200" height="8" rx="4" fill="#e2e8f0"/><rect x="120" y="244" width="220" height="8" rx="4" fill="#e2e8f0"/></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n)
const d = (dd, mm = 10, y = 2026) => `${String(dd).padStart(2, '0')}.${String(mm).padStart(2, '0')}.${y}`
const dt = (dd, hh = 12, mm = 10, y = 2026) => new Date(`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hh).padStart(2, '0')}:00:00.000Z`)

async function main() {
  const exists = await db.request.findUnique({ where: { number: 'Z-1063' } })
  if (exists) { console.log('seed-more: уже выполнено (Z-1063 существует), пропуск'); return }

  const carriers = await db.carrier.findMany({ include: { drivers: true, trucks: true, trailers: true } })
  const C = Object.fromEntries(carriers.map((c) => [c.name.includes('А»') ? 'А' : c.name.includes('Б»') ? 'Б' : c.name.includes('В»') ? 'В' : 'Г', c]))
  const cargo = await db.cargoType.findMany()
  const CG = Object.fromEntries(cargo.map((c) => [c.name.split(' - ').pop().split(' ')[0], c]))

  // ——— 1. Водители (+12) ———
  const driversSeed = [
    ['А', 'Мельников Артём Валерьевич', '12.04.1990', '53 10 221456', '53 10 221456', d(22, 3, 2029), d(14, 2, 2027), 'C, CE', '+7 (918) 311-45-22', 'г. Абинск', 'РФ', 'ОУФМС по Краснодарскому краю', '20.05.2014', 'Водитель'],
    ['А', 'Дроздов Никита Олегович', '03.09.1994', '53 11 765210', '53 11 765210', d(18, 9, 2026), d(30, 9, 2026), 'C, CE', '+7 (918) 445-78-03', 'г. Крымск', 'РФ', 'ОУФМС по Краснодарскому краю', '12.11.2016', 'Водитель'],
    ['А', 'Киселёв Станислав Петрович', '27.06.1987', '52 08 440917', '52 08 440917', d(10, 6, 2028), d(22, 6, 2028), 'C', '+7 (918) 209-11-76', 'г. Армавир', 'РФ', 'ОУФМС по Краснодарскому краю', '03.07.2010', 'Водитель'],
    ['Б', 'Романов Виталий Сергеевич', '19.01.1992', '50 09 118734', '50 09 118734', d(25, 1, 2029), d(8, 2, 2029), 'C, CE', '+7 (903) 778-45-19', 'г. Подольск', 'РФ', 'ОУФМС по Московской обл.', '05.02.2013', 'Водитель'],
    ['Б', 'Панов Григорий Ильич', '08.11.1985', '61 12 902365', '61 12 902365', d(30, 11, 2026), d(12, 12, 2026), 'C, CE', '+7 (863) 302-77-41', 'г. Батайск', 'РФ', 'ОУФМС по Ростовской обл.', '17.12.2008', 'Водитель-экспедитор'],
    ['Б', 'Жуков Артём Дмитриевич', '24.02.1996', '52 10 663921', '52 10 663921', d(14, 2, 2027), d(28, 2, 2027), 'C', '+7 (909) 155-20-88', 'г. Тихорецк', 'РФ', 'ОУФМС по Краснодарскому краю', '09.03.2017', 'Водитель'],
    ['В', 'Семёнов Валерий Николаевич', '15.07.1988', '77 07 330845', '77 07 330845', d(20, 7, 2028), d(2, 8, 2028), 'C, CE', '+7 (495) 611-34-72', 'г. Москва', 'РФ', 'ОУФМС по г. Москве', '21.07.2011', 'Водитель'],
    ['В', 'Гордеев Руслан Олегович', '30.03.1993', '23 13 884519', '23 13 884519', d(5, 4, 2027), d(19, 4, 2027), 'C, CE', '+7 (918) 66-22-105', 'г. Новороссийск', 'РФ', 'ОУФМС по Краснодарскому краю', '11.04.2015', 'Водитель'],
    ['В', 'Филатов Кирилл Андреевич', '11.12.1990', '52 11 209573', '52 11 209573', d(17, 12, 2026), d(1, 1, 2027), 'C', '+7 (961) 480-93-27', 'г. Геленджик', 'РФ', 'ОУФМС по Краснодарскому краю', '28.12.2013', 'Водитель'],
    ['Г', 'Дементьев Пётр Ильич', '02.05.1984', '61 08 557412', '61 08 557412', d(9, 5, 2027), d(23, 5, 2027), 'C, CE', '+7 (863) 250-18-90', 'г. Таганрог', 'РФ', 'ОУФМС по Ростовской обл.', '15.05.2007', 'Водитель'],
    ['Г', 'Зуев Анатолий Викторович', '21.10.1991', '23 14 663908', '23 14 663908', d(28, 10, 2026), d(11, 11, 2026), 'C, CE', '+7 (918) 75-33-410', 'г. Славянск-на-Кубани', 'РФ', 'ОУФМС по Краснодарскому краю', '02.11.2014', 'Водитель'],
    ['Г', 'Калинин Егор Станиславович', '07.08.1995', '52 12 110467', '52 12 110467', d(13, 8, 2028), d(27, 8, 2028), 'C', '+7 (909) 715-62-38', 'г. Краснодар', 'РФ', 'ОУФМС по Краснодарскому краю', '19.09.2018', 'Водитель'],
  ]
  const createdDrivers = {}
  for (const [key, fullName, birthDate, passport, license, licenseTill, medTill, categories, phone, birthPlace, citizenship, passportIssuedBy, passportIssuedDate, position] of driversSeed) {
    const existing = await db.driver.findFirst({ where: { carrierId: C[key].id, fullName } })
    if (existing) { (createdDrivers[key] ||= []).push(existing); continue }
    const order = (createdDrivers[key] || []).length
    const created = await db.driver.create({ data: { carrierId: C[key].id, fullName, birthDate, passport, license, licenseTill, medTill, categories, phone, birthPlace, citizenship, passportIssuedBy, passportIssuedDate, position, createdAt: dt(6 + order) } })
    ;(createdDrivers[key] ||= []).push(created)
  }

  // ——— 2. Тягачи (+6) ———
  const trucksSeed = [
    ['А', 'КАМАЗ 54901 NEO', 'А721МТ193', 'X9634400SCK548210', '23 00 781245', d(11, 12, 2026), 'ООО «Перевозчик А»', 'белый'],
    ['А', 'MAN TGS 18.440', 'В318ОР193', 'WMA06XZZ8DP987654', '23 00 556310', d(9, 3, 2027), 'ООО «Перевозчик А»', 'серый'],
    ['Б', 'Volvo FM13', 'Е598НТ150', 'YV2RT40A9GA214578', '50 00 990817', d(20, 11, 2026), 'ООО «Перевозчик Б»', 'синий'],
    ['Б', 'Scania G450 A4x2', 'Т447КХ161', 'YS2R4X20015402187', '61 00 331905', d(2, 2, 2027), 'ООО «Перевозчик Б»', 'белый'],
    ['В', 'КАМАЗ 5490', 'М784ВК199', 'X9634400TCK112209', '77 00 448612', d(17, 1, 2027), 'ООО «Перевозчик В»', 'графит'],
    ['В', 'Mercedes-Benz Actros 1845', 'О933МУ177', 'WDB9340321L554090', '77 00 662541', d(25, 12, 2026), 'ООО «Перевозчик В»', 'белый'],
  ]
  const createdTrucks = {}
  for (const [key, brand, plate, vin, sts, techTill, owner, color] of trucksSeed) {
    const existing = await db.truck.findFirst({ where: { plate } })
    if (existing) { (createdTrucks[key] ||= []).push(existing); continue }
    const created = await db.truck.create({ data: { carrierId: C[key].id, brand, plate, vin, sts, techTill, owner, color, createdAt: dt(8) } })
    ;(createdTrucks[key] ||= []).push(created)
  }

  // ——— 3. Прицепы (+5) ———
  const trailersSeed = [
    ['А', 'АЕ311 23', '23 00 118743', 'Полуприцеп шторный', d(14, 1, 2027), 'OOO «Перевозчик А»', 'серый'],
    ['Б', 'НЕ459 150', '50 00 774312', 'Полуприцеп зерновоз', d(3, 12, 2026), 'ООО «Перевозчик Б»', 'зелёный'],
    ['В', 'КС774 199', '77 00 220981', 'Полуприцеп трал', d(28, 2, 2027), 'ООО «Перевозчик В»', 'чёрный'],
    ['А', 'НЕ666 193', '23 00 905184', 'Полуприцеп борт', d(8, 11, 2026), 'ООО «Перевозчик А»', 'синий'],
    ['Г', 'РМ258 161', '61 00 551729', 'Полуприцеп реф', d(19, 3, 2027), 'ООО «Перевозчик Г»', 'белый'],
  ]
  const createdTrailers = {}
  for (const [key, plate, sts, type, techTill, owner, color] of trailersSeed) {
    const existing = await db.trailer.findFirst({ where: { plate } })
    if (existing) { (createdTrailers[key] ||= []).push(existing); continue }
    const created = await db.trailer.create({ data: { carrierId: C[key].id, plate, sts, type, techTill, owner, color, createdAt: dt(9) } })
    ;(createdTrailers[key] ||= []).push(created)
  }

  // ——— 4. Заявки (+14) ———
  // [number, from, to, cargoKey, tonnage, truckType, mode, status, start, best, winnerKey|null, crewKey|null, etrn, pass, loadDate, deadlineDay|0, createdDay]
  const reqSeed = [
    ['Z-1050', 'Абинск', 'Новороссийск (порт)', 'проволока', 20, 'Тент', 'AUCTION', 'PUBLISHED', 8100, 7900, null, null, 'NONE', false, d(27), 25, 20],
    ['Z-1051', 'Абинск', 'Краснодар', 'арматура', 18, 'Тент', 'AUCTION', 'PUBLISHED', 5600, 5450, null, null, 'NONE', false, d(28), 26, 20],
    ['Z-1052', 'Абинск', 'Ростов-на-Дону', 'катанка', 22, 'Борт', 'CLOSED', 'PUBLISHED', 9400, null, null, null, 'NONE', false, d(29), 27, 20],
    ['Z-1053', 'Абинск', 'Туапсе', 'моток', 19, 'Тент', 'AUCTION', 'PUBLISHED', 7200, 7000, null, null, 'NONE', false, d(30), 28, 21],
    ['Z-1054', 'Абинск', 'Ставрополь', 'пруток', 15, 'Тент', 'AUCTION', 'PUBLISHED', 6300, null, null, null, 'NONE', false, d(31), 29, 21],
    ['Z-1055', 'Абинск', 'Волгоград', 'металлолом', 20, 'Борт', 'AUCTION', 'AWARDED', 8900, 8450, 'Б', null, 'NONE', false, d(4, 11), 0, 15],
    ['Z-1056', 'Абинск', 'Сочи', 'проволока', 12, 'Тент', 'AUCTION', 'AWARDED', 9800, 9250, 'Г', null, 'NONE', false, d(5, 11), 0, 15],
    ['Z-1057', 'Абинск', 'Новороссийск (порт)', 'арматура', 20, 'Тент', 'AUCTION', 'DOCS_REVIEW', 8500, 7950, 'А', 'А', 'NONE', false, d(6, 11), 0, 14],
    ['Z-1058', 'Абинск', 'Краснодар', 'моток', 16, 'Тент', 'CLOSED', 'DOCS_REVIEW', 5900, 5750, 'В', 'В', 'NONE', false, d(7, 11), 0, 14],
    ['Z-1059', 'Абинск', 'Ростов-на-Дону', 'пруток', 21, 'Борт', 'AUCTION', 'AT_LOGIST', 9100, 8650, 'Б', 'Б', 'NONE', true, d(9, 11), 0, 12],
    ['Z-1060', 'Абинск', 'Тихорецк', 'арматура', 18, 'Тент', 'AUCTION', 'AT_LOGIST', 5400, 5150, 'В', 'В', 'SENT', true, d(10, 11), 0, 12],
    ['Z-1061', 'Абинск', 'Новороссийск (порт)', 'катанка', 20, 'Тент', 'AUCTION', 'CONFIRMED', 8300, 7750, 'А', 'А', 'SIGNED', true, d(14, 10), 0, 9],
    ['Z-1062', 'Абинск', 'Волгоград', 'проволока', 20, 'Борт', 'CLOSED', 'CONFIRMED', 11500, 11200, 'Г', 'Г', 'SENT', true, d(16, 10), 0, 8],
    ['Z-1063', 'Абинск', 'Краснодар', 'металлолом', 20, 'Борт', 'AUCTION', 'CLOSED', 4900, 4650, 'Б', 'Б', 'SIGNED', true, d(13, 10), 0, 7],
  ]

  // ставки: [заявка, [[ключ перевозчика, сумма, день, час], ...]]
  const bidsSeed = {
    'Z-1050': [['А', 7900, 21, 14], ['Б', 7950, 21, 15], ['Г', 8050, 21, 16]],
    'Z-1051': [['Б', 5500, 21, 11], ['В', 5450, 21, 13]],
    'Z-1053': [['А', 7000, 21, 9], ['В', 7100, 21, 10], ['Г', 7150, 21, 11], ['Б', 7250, 21, 12]],
    'Z-1055': [['А', 8700, 15, 10], ['В', 8600, 15, 12], ['Б', 8450, 15, 14]],
    'Z-1056': [['А', 9500, 15, 9], ['Б', 9400, 15, 11], ['Г', 9250, 15, 13]],
    'Z-1057': [['Б', 8200, 14, 10], ['В', 8100, 14, 12], ['А', 7950, 14, 15]],
    'Z-1058': [['А', 5800, 14, 9], ['В', 5750, 14, 11]],
    'Z-1059': [['А', 8900, 12, 10], ['В', 8750, 12, 13], ['Б', 8650, 12, 16]],
    'Z-1060': [['А', 5300, 12, 9], ['Б', 5250, 12, 11], ['В', 5150, 12, 14]],
    'Z-1061': [['Б', 8000, 9, 10], ['Г', 7900, 9, 12], ['А', 7750, 9, 15]],
    'Z-1062': [['А', 11400, 8, 10], ['Г', 11200, 8, 14]],
    'Z-1063': [['А', 4800, 7, 10], ['В', 4700, 7, 12], ['Б', 4650, 7, 15]],
  }

  for (const [number, fromPoint, toPoint, cargoKey, tonnage, truckType, mode, status, startRate, bestRate, winnerKey, crewKey, etrnStatus, passPackage, loadDate, deadlineDay, createdDay] of reqSeed) {
    const cg = CG[cargoKey]
    const winner = winnerKey ? C[winnerKey] : null
    const req = await db.request.create({
      data: {
        number, fromPoint, toPoint,
        cargo: cg ? cg.name : cargoKey,
        cargoTypeId: cg ? cg.id : null,
        tonnage, truckType, mode, startRate, bestRate, status,
        loadDate, loadWindow: '08:00–12:00',
        deadline: deadlineDay ? dt(deadlineDay, 18) : null,
        winnerId: winner ? winner.id : null,
        driverId: null, truckId: null, trailerId: null,
        passPackage, etrnStatus,
        createdAt: dt(createdDay, 8),
      },
    })

    // ставки
    const bids = bidsSeed[number] || []
    for (const [key, amount, day, hour] of bids) {
      await db.bid.create({ data: { requestId: req.id, carrierId: C[key].id, amount, isWinner: !!winner && winnerKey === key && !!bestRate && amount === bestRate, createdAt: dt(day, hour) } })
    }

    // события
    const events = [[dt(createdDay, 8), 'REQUEST_PUBLISHED', mode === 'AUCTION' ? `Заявка опубликована: стартовая ставка ${fmt(startRate)} ₽/т, торги до срока` : 'Заявка опубликована: закрытые ставки, участники не видят цены друг друга']]
    for (const [key, amount, day, hour] of bids) events.push([dt(day, hour + 1), 'BID_PLACED', `${C[key].name}: ставка ${fmt(amount)} ₽/т`])
    if (winner) events.push([dt(createdDay + 1, 10), 'WINNER_AWARDED', `Победитель определён: ${winner.name} — ${fmt(bestRate ?? startRate)} ₽/т`])
    if (status === 'DOCS_REVIEW') events.push([dt(createdDay + 2, 9), 'DOCS_REVIEW', 'Документы экипажа отправлены на сверку'])
    if (crewKey) {
      // приоритет новым записям, фолбэк — существующий парк перевозчика
      const drv = (createdDrivers[crewKey] || [])[0] || C[crewKey].drivers[0]
      const trk = (createdTrucks[crewKey] || [])[0] || C[crewKey].trucks[0]
      const trl = (createdTrailers[crewKey] || [])[0] || C[crewKey].trailers[0] || null
      if (!drv || !trk) throw new Error(`Нет экипажа у ${crewKey}: drv=${!!drv} trk=${!!trk}`)
      await db.request.update({ where: { id: req.id }, data: { driverId: drv.id, truckId: trk.id, trailerId: trl ? trl.id : null } })
      events.push([dt(createdDay + 2, 11), 'DRIVER_ASSIGNED', `Назначен экипаж: ${drv.fullName} · ${trk.brand} ${trk.plate}${trl ? ` · ${trl.plate}` : ''}`])
      if (['AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(status)) {
        events.push([dt(createdDay + 3, 9), 'CREW_APPROVED', 'Экипаж утверждён логистом'])
        if (passPackage) events.push([dt(createdDay + 3, 14), 'PASS_SENT', 'Пропуск на площадку оформлен'])
      }
      if (etrnStatus !== 'NONE') events.push([dt(createdDay + 4, 10), 'ETRN_SENT', 'Заявка отправлена в ЭТРАН'])
      if (etrnStatus === 'SIGNED') events.push([dt(createdDay + 5, 12), 'CONFIRMED_1C', 'Заявка подтверждена в 1С'])
    }
    if (status === 'CLOSED') events.push([dt(createdDay + 6, 16), 'REQUEST_CLOSED', 'Заявка закрыта: рейс выполнен'])
    for (const [at, type, message] of events) await db.event.create({ data: { requestId: req.id, type, message, createdAt: at } })

    // ——— 5. Документы на сверку ———
    const drv = crewKey ? ((createdDrivers[crewKey] || [])[0] || C[crewKey].drivers[0]) : null
    const trk = crewKey ? ((createdTrucks[crewKey] || [])[0] || C[crewKey].trucks[0]) : null
    const docBase = dt(createdDay + 2, 9)
    const put = (type, fileName, status, quality, fields, confidence, issues, message) =>
      db.document.create({ data: { requestId: req.id, type, fileName, dataUri: svgDoc(type, number), status, quality, engine: fields ? 'PaddleOCR-демо' : null, fields: fields ? JSON.stringify(fields) : null, confidence: confidence ? JSON.stringify(confidence) : null, issues: issues ? JSON.stringify(issues) : null, message, createdAt: docBase, updatedAt: docBase } })

    if (['DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(status) && drv && trk) {
      const p = drv.fullName.split(' ')
      if (status === 'DOCS_REVIEW' && number === 'Z-1057') {
        await put('PASSPORT_PHOTO', 'passport_photo.jpg', 'PASSED', 96, { 'Фамилия': p[0].toUpperCase(), 'Имя': p[1].toUpperCase(), 'Отчество': p[2].toUpperCase(), 'Дата рождения': drv.birthDate, 'Серия и номер': drv.passport }, { 'Фамилия': 0.99, 'Имя': 0.996, 'Отчество': 0.984, 'Дата рождения': 0.999, 'Серия и номер': 0.998 }, ['Все оценки от 0,95 — поля приняты по уверенности; ФИО и дата совпали с заявкой'], null)
        await put('PASSPORT_REG', 'passport_reg.jpg', 'REUPLOAD', 52, { 'Дата регистрации': '10.06.2019', 'Код подразделения': '230-027', 'Адрес регистрации': 'г. АБИНСК, ул. КРАСНАЯ д. 14' }, { 'Дата регистрации': 0.93, 'Код подразделения': 0.91, 'Адрес регистрации': 0.45 }, ['Штамп регистрации смазан — адрес прочитан с ошибкой (0,45), требуется повторная загрузка'], null)
        await put('LICENSE', 'license.jpg', 'PENDING', null, null, null, null, 'Ожидает нейропроверки')
        await put('STS', 'sts.jpg', 'PENDING', null, null, null, null, 'Ожидает нейропроверки')
      } else if (status === 'DOCS_REVIEW' && number === 'Z-1058') {
        await put('PASSPORT_PHOTO', 'passport_photo.jpg', 'PASSED', 94, { 'Фамилия': p[0].toUpperCase(), 'Имя': p[1].toUpperCase(), 'Отчество': p[2].toUpperCase(), 'Дата рождения': drv.birthDate, 'Серия и номер': drv.passport }, { 'Фамилия': 0.98, 'Имя': 0.99, 'Отчество': 0.97, 'Дата рождения': 0.995, 'Серия и номер': 0.99 }, [], null)
        await put('LICENSE', 'license.jpg', 'REJECTED', 88, { 'ФИО': drv.fullName, 'Дата рождения': drv.birthDate, 'Номер ВУ': '52 11 209999', 'Действует до': drv.licenseTill }, { 'ФИО': 0.99, 'Дата рождения': 0.99, 'Номер ВУ': 0.993, 'Действует до': 0.98 }, ['Номер ВУ на фото не совпал с карточкой водителя (52 11 209999 ≠ ' + drv.license + ')'], 'Нейросеть: документ отклонён — сверка номера ВУ не прошла')
        await put('STS', 'sts.jpg', 'PASSED', 97, { 'Госномер': trk.plate, 'VIN': trk.vin, 'Номер СТС': trk.sts }, { 'Госномер': 0.999, 'VIN': 0.998, 'Номер СТС': 0.996 }, [], null)
        await put('POA', 'poa.jpg', 'MANUAL', 84, { 'Номер доверенности': 'Д-44/26', 'Дата выдачи': d(1, 10), 'Действительна до': d(31, 12), 'Кем выдана (перевозчик)': C[crewKey].name, 'Представитель (ФИО)': drv.fullName }, { 'Номер доверенности': 0.97, 'Дата выдачи': 0.98, 'Действительна до': 0.98, 'Кем выдана (перевозчик)': 0.6, 'Представитель (ФИО)': 0.99 }, ['Наименование перевозчика прочитано частично (0,6) — смотрит оператор'], null)
      } else if (status === 'AT_LOGIST' && number === 'Z-1059') {
        await put('PASSPORT_PHOTO', 'passport_photo.jpg', 'PASSED', 97, { 'Фамилия': p[0].toUpperCase(), 'Имя': p[1].toUpperCase(), 'Отчество': p[2].toUpperCase(), 'Дата рождения': drv.birthDate, 'Серия и номер': drv.passport }, { 'Фамилия': 0.995, 'Имя': 0.997, 'Отчество': 0.99, 'Дата рождения': 0.999, 'Серия и номер': 0.999 }, ['Все поля распознаны с оценкой от 0,95 — автодопуск'], null)
        await put('PASSPORT_REG', 'passport_reg.jpg', 'PASSED', 93, { 'Дата регистрации': '17.05.2021', 'Код подразделения': '612-044', 'Адрес регистрации': 'г. БАТАЙСК, ул. ЛЕНИНА д. 88' }, { 'Дата регистрации': 0.96, 'Код подразделения': 0.96, 'Адрес регистрации': 0.95 }, [], null)
        await put('LICENSE', 'license.jpg', 'PASSED', 98, { 'ФИО': drv.fullName, 'Дата рождения': drv.birthDate, 'Номер ВУ': drv.license, 'Действует до': drv.licenseTill }, { 'ФИО': 0.999, 'Дата рождения': 0.999, 'Номер ВУ': 0.998, 'Действует до': 0.999 }, [], null)
        await put('STS', 'sts.jpg', 'PASSED', 98, { 'Госномер': trk.plate, 'VIN': trk.vin, 'Номер СТС': trk.sts }, { 'Госномер': 0.999, 'VIN': 0.998, 'Номер СТС': 0.997 }, [], null)
        await put('REQUEST_DOC', 'request_doc.pdf', 'PASSED', 96, { 'Номер заявки': number, 'Дата заявки': d(createdDay), 'Груз': 'Перевозка металлолома', 'Ставка': `${fmt(bestRate)} ₽/т` }, { 'Номер заявки': 0.99, 'Дата заявки': 0.98, 'Груз': 0.97, 'Ставка': 0.98 }, [], null)
        await put('POA', 'poa.jpg', 'PASSED', 95, { 'Номер доверенности': 'Д-51/26', 'Дата выдачи': d(5, 10), 'Действительна до': d(31, 12), 'Кем выдана (перевозчик)': C[crewKey].name, 'Представитель (ФИО)': drv.fullName }, { 'Номер доверенности': 0.98, 'Дата выдачи': 0.98, 'Действительна до': 0.99, 'Кем выдана (перевозчик)': 0.95, 'Представитель (ФИО)': 0.99 }, [], null)
      } else if (status === 'AT_LOGIST' && number === 'Z-1060') {
        await put('PASSPORT_PHOTO', 'passport_photo.jpg', 'PASSED', 95, { 'Фамилия': p[0].toUpperCase(), 'Имя': p[1].toUpperCase(), 'Отчество': p[2].toUpperCase(), 'Дата рождения': drv.birthDate, 'Серия и номер': drv.passport }, { 'Фамилия': 0.99, 'Имя': 0.995, 'Отчество': 0.99, 'Дата рождения': 0.998, 'Серия и номер': 0.997 }, [], null)
        await put('LICENSE', 'license.jpg', 'PASSED', 96, { 'ФИО': drv.fullName, 'Дата рождения': drv.birthDate, 'Номер ВУ': drv.license, 'Действует до': drv.licenseTill }, { 'ФИО': 0.996, 'Дата рождения': 0.998, 'Номер ВУ': 0.995, 'Действует до': 0.997 }, [], null)
        await put('STS', 'sts.jpg', 'REUPLOAD', 58, { 'Госномер': trk.plate, 'VIN': trk.vin.slice(0, 8), 'Номер СТС': trk.sts }, { 'Госномер': 0.94, 'VIN': 0.52, 'Номер СТС': 0.9 }, ['Фото СТС с бликом — VIN прочитан не полностью (0,52), загрузите более чёткий снимок'], null)
        await put('POA', 'poa.jpg', 'PASSED', 92, { 'Номер доверенности': 'Д-63/26', 'Дата выдачи': d(6, 10), 'Действительна до': d(31, 12), 'Кем выдана (перевозчик)': C[crewKey].name, 'Представитель (ФИО)': drv.fullName }, { 'Номер доверенности': 0.96, 'Дата выдачи': 0.97, 'Действительна до': 0.97, 'Кем выдана (перевозчик)': 0.93, 'Представитель (ФИО)': 0.98 }, [], null)
      } else if (status === 'CONFIRMED' || status === 'CLOSED') {
        await put('PASSPORT_PHOTO', 'passport_photo.jpg', 'PASSED', 97, { 'Фамилия': p[0].toUpperCase(), 'Имя': p[1].toUpperCase(), 'Отчество': p[2].toUpperCase(), 'Дата рождения': drv.birthDate, 'Серия и номер': drv.passport }, { 'Фамилия': 0.995, 'Имя': 0.996, 'Отчество': 0.99, 'Дата рождения': 0.999, 'Серия и номер': 0.998 }, [], null)
        await put('LICENSE', 'license.jpg', 'PASSED', 97, { 'ФИО': drv.fullName, 'Дата рождения': drv.birthDate, 'Номер ВУ': drv.license, 'Действует до': drv.licenseTill }, { 'ФИО': 0.998, 'Дата рождения': 0.999, 'Номер ВУ': 0.997, 'Действует до': 0.998 }, [], null)
        await put('STS', 'sts.jpg', 'PASSED', 98, { 'Госномер': trk.plate, 'VIN': trk.vin, 'Номер СТС': trk.sts }, { 'Госномер': 0.999, 'VIN': 0.998, 'Номер СТС': 0.998 }, [], null)
        await put('REQUEST_DOC', 'request_doc.pdf', 'PASSED', 96, { 'Номер заявки': number, 'Дата заявки': d(createdDay), 'Груз': 'Металлолом', 'Ставка': `${fmt(bestRate)} ₽/т` }, { 'Номер заявки': 0.99, 'Дата заявки': 0.99, 'Груз': 0.98, 'Ставка': 0.98 }, [], null)
      }
    }
  }

  const counts = {
    drivers: await db.driver.count(), trucks: await db.truck.count(), trailers: await db.trailer.count(),
    requests: await db.request.count(), bids: await db.bid.count(), documents: await db.document.count(), events: await db.event.count(),
  }
  console.log('seed-more готов:', JSON.stringify(counts))
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())

/**
 * Создание пользователей платформы (идемпотентно — можно запускать повторно).
 * Пароль один для всех демо-учёток — из SEED_PASSWORD (.env.local), как в prisma/seed.ts;
 * без неё — случайный, печатается один раз. В коде пароль не хранится: репозиторий публичный.
 * Пароли в базе — scrypt-хеши.
 *
 * Task 113: заодно заполняет проформы персонажей (ФИО, должность, организация, контакты)
 * и персональные права: logist1 — ведущий специалист (права роли логиста — почти все),
 * logist2 — линейный сотрудник (урезанный набор без операционных решений).
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'crypto'

const db = new PrismaClient()

const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

const FIO = {
  admin: 'Громова Елена Викторовна',
  logist1: 'Соколов Дмитрий Алексеевич',
  logist2: 'Морозова Анна Сергеевна',
  carrierA: 'Ковалёв Игорь Петрович',
  carrierB: 'Богданов Сергей Михайлович',
  carrierV: 'Литвинов Артём Владимирович',
  carrierG: 'Ткачёв Николай Андреевич',
}

const ACCOUNTS: { login: string; name: string; role: 'admin' | 'logist' | 'carrier'; carrierName?: string }[] = [
  { login: 'admin', name: FIO.admin, role: 'admin' },
  { login: 'logist1', name: FIO.logist1, role: 'logist' },
  { login: 'logist2', name: FIO.logist2, role: 'logist' },
  { login: 'carrier-a', name: FIO.carrierA, role: 'carrier', carrierName: 'ООО «Перевозчик А»' },
  { login: 'carrier-b', name: FIO.carrierB, role: 'carrier', carrierName: 'ООО «Перевозчик Б»' },
  { login: 'carrier-v', name: FIO.carrierV, role: 'carrier', carrierName: 'ООО «Перевозчик В»' },
  { login: 'carrier-g', name: FIO.carrierG, role: 'carrier', carrierName: 'ООО «Перевозчик Г»' },
]

/** Проформы персонажей (плашка аккаунта): должность, организация, контакты */
const PROFILES: Record<string, { fullName: string; position: string; phone: string; email: string; companyName: string }> = {
  admin: { fullName: FIO.admin, position: 'Администратор платформы', phone: '+7 (86131) 5-02-01', email: 'e.gromova@aemz.ru', companyName: 'АО «АЭМЗ»' },
  logist1: { fullName: FIO.logist1, position: 'Ведущий специалист по логистике', phone: '+7 (86131) 5-03-12', email: 'd.sokolov@aemz.ru', companyName: 'АО «АЭМЗ»' },
  logist2: { fullName: FIO.logist2, position: 'Специалист по логистике', phone: '+7 (86131) 5-03-15', email: 'a.morozova@aemz.ru', companyName: 'АО «АЭМЗ»' },
  'carrier-a': { fullName: FIO.carrierA, position: 'Руководитель отдела перевозок', phone: '+7 (918) 402-11-05', email: 'kovalev@perevoz-a.ru', companyName: 'ООО «Перевозчик А»' },
  'carrier-b': { fullName: FIO.carrierB, position: 'Директор', phone: '+7 (903) 411-22-18', email: 'bogdanov@perevoz-b.ru', companyName: 'ООО «Перевозчик Б»' },
  'carrier-v': { fullName: FIO.carrierV, position: 'Руководитель экспедиции', phone: '+7 (495) 621-33-90', email: 'litvinov@perevoz-v.ru', companyName: 'ООО «Перевозчик В»' },
  'carrier-g': { fullName: FIO.carrierG, position: 'Директор по логистике', phone: '+7 (863) 250-44-27', email: 'tkachev@perevoz-g.ru', companyName: 'ООО «Перевозчик Г»' },
}

/** Персональные права линейного сотрудника (logist2): без операционных решений */
const LOGIST2_DENY: Record<string, 'deny'> = {
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
}

const password = process.env.SEED_PASSWORD || randomBytes(9).toString('base64url')
if (!process.env.SEED_PASSWORD) console.log(`Пароль демо-пользователей (сохраните): ${password}`)

for (const acc of ACCOUNTS) {
  const carrier = acc.carrierName
    ? await db.carrier.findFirst({ where: { name: acc.carrierName } })
    : null
  if (acc.role === 'carrier' && !carrier) {
    console.warn(`! перевозчик «${acc.carrierName}» не найден — пропуск`)
    continue
  }
  const user = await db.user.upsert({
    where: { login: acc.login },
    update: { name: acc.name, role: acc.role, carrierId: carrier?.id ?? null, passwordHash: hashPassword(password) },
    create: { login: acc.login, passwordHash: hashPassword(password), name: acc.name, role: acc.role, carrierId: carrier?.id ?? null },
  })
  // проформа персонажа
  const profileData = {
    ...PROFILES[acc.login],
    ...(acc.role === 'carrier' && carrier
      ? { inn: carrier.inn, kpp: carrier.kpp }
      : {}),
  }
  await db.profile.upsert({
    where: { userId: user.id },
    update: profileData,
    create: { userId: user.id, ...profileData },
  })
  // персональные права: logist2 — урезанный набор, logist1 — как у роли (почти всё)
  if (acc.login === 'logist2') {
    await db.user.update({ where: { id: user.id }, data: { permOverrides: JSON.stringify(LOGIST2_DENY) } })
  }
  if (acc.login === 'logist1') {
    await db.user.update({ where: { id: user.id }, data: { permOverrides: null } })
  }
  console.log(`✓ ${acc.login} — ${acc.name} (${acc.role})`)
}

await db.$disconnect()

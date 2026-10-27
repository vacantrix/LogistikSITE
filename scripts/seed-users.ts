/**
 * Создание пользователей платформы (идемпотентно — можно запускать повторно).
 * Пароль один для всех демо-учёток — из SEED_PASSWORD (.env.local), как в prisma/seed.ts;
 * без неё — случайный, печатается один раз. В коде пароль не хранится: репозиторий публичный.
 * Пароли в базе — scrypt-хеши.
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'crypto'

const db = new PrismaClient()

const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

const ACCOUNTS: { login: string; name: string; role: 'logist' | 'carrier'; carrierName?: string }[] = [
  { login: 'logist1', name: 'Логист 1', role: 'logist' },
  { login: 'logist2', name: 'Логист 2', role: 'logist' },
  { login: 'carrier-a', name: 'ООО «Перевозчик А»', role: 'carrier', carrierName: 'ООО «Перевозчик А»' },
  { login: 'carrier-b', name: 'ООО «Перевозчик Б»', role: 'carrier', carrierName: 'ООО «Перевозчик Б»' },
  { login: 'carrier-v', name: 'ООО «Перевозчик В»', role: 'carrier', carrierName: 'ООО «Перевозчик В»' },
  { login: 'carrier-g', name: 'ООО «Перевозчик Г»', role: 'carrier', carrierName: 'ООО «Перевозчик Г»' },
]

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
  await db.user.upsert({
    where: { login: acc.login },
    update: { name: acc.name, role: acc.role, carrierId: carrier?.id ?? null, passwordHash: hashPassword(password) },
    create: { login: acc.login, passwordHash: hashPassword(password), name: acc.name, role: acc.role, carrierId: carrier?.id ?? null },
  })
  console.log(`✓ ${acc.login} — ${acc.name} (${acc.role})`)
}

await db.$disconnect()

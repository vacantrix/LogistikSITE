/**
 * Создание пользователей платформы (идемпотентно — можно запускать повторно).
 * Логины и пароли демо-контура; пароли хранятся как scrypt-хеши.
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'crypto'

const db = new PrismaClient()

const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

const ACCOUNTS: { login: string; password: string; name: string; role: 'logist' | 'carrier'; carrierName?: string }[] = [
  { login: 'logist1', password: 'aemz2024', name: 'Логист 1', role: 'logist' },
  { login: 'logist2', password: 'aemz2024', name: 'Логист 2', role: 'logist' },
  { login: 'carrier-a', password: 'aemz2024', name: 'ООО «Перевозчик А»', role: 'carrier', carrierName: 'ООО «Перевозчик А»' },
  { login: 'carrier-b', password: 'aemz2024', name: 'ООО «Перевозчик Б»', role: 'carrier', carrierName: 'ООО «Перевозчик Б»' },
  { login: 'carrier-v', password: 'aemz2024', name: 'ООО «Перевозчик В»', role: 'carrier', carrierName: 'ООО «Перевозчик В»' },
  { login: 'carrier-g', password: 'aemz2024', name: 'ООО «Перевозчик Г»', role: 'carrier', carrierName: 'ООО «Перевозчик Г»' },
]

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
    update: { name: acc.name, role: acc.role, carrierId: carrier?.id ?? null, passwordHash: hashPassword(acc.password) },
    create: { login: acc.login, passwordHash: hashPassword(acc.password), name: acc.name, role: acc.role, carrierId: carrier?.id ?? null },
  })
  console.log(`✓ ${acc.login} / ${acc.password} — ${acc.name} (${acc.role})`)
}

await db.$disconnect()

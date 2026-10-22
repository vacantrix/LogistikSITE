/**
 * Seed: мок-документы справочников + принадлежность (Task 62).
 * Запуск: bun prisma/seed-directory-docs.ts
 *
 * Идемпотентно:
 *  — принадлежность (OWNED/HIRED/LEASE) проставляется только записям со значениями по умолчанию;
 *  — мок-сканы (DirectoryPhoto) создаются только записям, у которых ещё нет ни одного фото.
 * Персонифицированные сканы — SVG с читаемым текстом (как в «Подать документы»).
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

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

const uri = (title: string, lines: string[], accent: string) => docSvg(title, lines, accent)

/** демо-контрагенты для принадлежности */
const HIRED_OWNERS = ['ИП Смирнов О.В.', 'ООО «ТрансЛайн Юг»', 'ИП Ковалёв Д.А.', 'ООО «АвтоКолонна-24»']
const LEASE_CONTRACTS = ['АР-2024/17 от 12.03.2024', 'ЛЗ-118/26 от 05.08.2025', 'АР-2025/04 от 01.02.2025']

async function main() {
  const carriers = await db.carrier.findMany({
    include: { drivers: true, trucks: true, trailers: true },
    orderBy: { name: 'asc' },
  })
  if (carriers.length === 0) {
    console.log('Справочник пуст — сначала выполните основной сид (bun prisma/seed.ts)')
    return
  }

  let owned = 0, hired = 0, leased = 0, photos = 0, review = 0
  let seq = 0 // сквозной счётчик записей — детерминированное распределение принадлежности

  for (const c of carriers) {
    const counterparty = (i: number) => HIRED_OWNERS[(seq + i) % HIRED_OWNERS.length]

    for (const [i, d] of c.drivers.entries()) {
      const n = seq++
      // принадлежность: каждый 3-й — наёмный, каждый 7-й — аренда (для водителя трактуем как «предоставлен контрагентом»)
      const kind = n % 7 === 6 ? 'LEASE' : n % 3 === 2 ? 'HIRED' : 'OWNED'
      if (d.ownershipType === 'OWNED' && d.ownerName === '—') {
        await db.driver.update({
          where: { id: d.id },
          data: {
            ownershipType: kind,
            ownerName: kind === 'OWNED' ? c.name : counterparty(i),
            leaseContract: kind === 'LEASE' ? LEASE_CONTRACTS[n % LEASE_CONTRACTS.length] : '—',
          },
        })
        if (kind === 'OWNED') owned++; else if (kind === 'HIRED') hired++; else leased++
      }

      // мок-документы водителя: паспорт (фото), регистрация, ВУ
      const existing = await db.directoryPhoto.count({ where: { kind: 'driver', refId: d.id } })
      if (existing === 0) {
        const short = d.fullName.split(' ').slice(0, 2).join(' ').toUpperCase()
        const docs = [
          {
            label: 'Паспорт: стр. с фото', fileName: 'passport_page1.jpg', status: 'LOADED',
            dataUri: uri('ПАСПОРТ РФ · СТР. С ФОТО', [short, d.birthDate, d.passport, 'ОТДЕЛ УФМ РОССИИ'], '#0f3b66'),
          },
          {
            label: 'Паспорт: регистрация', fileName: 'passport_reg.jpg', status: 'LOADED',
            dataUri: uri('ПАСПОРТ РФ · РЕГИСТРАЦИЯ', [short, 'РЕГИСТРАЦИЯ ПО МЕСТУ ЖИТЕЛЬСТВА', 'Г. КРАСНОДАР'], '#0f3b66'),
          },
          {
            label: 'Водительское удостоверение', fileName: 'license.jpg',
            // каждый 5-й комплект требует проверки (демо индикатора «Требует проверки»)
            status: n % 5 === 4 ? 'NEEDS_REVIEW' : 'LOADED',
            dataUri: uri('ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ', [short, d.license, `КАТ. ${d.categories}`, `ДО ${d.licenseTill}`], '#5b3413'),
          },
        ]
        await db.directoryPhoto.createMany({
          data: docs.map((x) => ({ kind: 'driver', refId: d.id, label: x.label, fileName: x.fileName, dataUri: x.dataUri, status: x.status })),
        })
        photos += 3
        if (n % 5 === 4) review++
      }
    }

    for (const [i, t] of c.trucks.entries()) {
      const n = seq++
      const kind = n % 5 === 4 ? 'LEASE' : n % 4 === 3 ? 'HIRED' : 'OWNED'
      if (t.ownershipType === 'OWNED') {
        // чужой собственник в старых данных — наёмная техника (Task 62)
        const foreign = t.owner !== '—' && t.owner !== c.name
        const resolved = foreign ? 'HIRED' : kind
        await db.truck.update({
          where: { id: t.id },
          data: {
            ownershipType: resolved,
            owner: t.owner === '—' ? (resolved === 'OWNED' ? c.name : counterparty(i + 1)) : t.owner,
            leaseContract: resolved === 'LEASE' ? LEASE_CONTRACTS[(n + 1) % LEASE_CONTRACTS.length] : '—',
          },
        })
        if (resolved === 'OWNED') owned++; else if (resolved === 'HIRED') hired++; else leased++
      }

      // мок-документы тягача: СТС + фото ТС
      const existing = await db.directoryPhoto.count({ where: { kind: 'truck', refId: t.id } })
      if (existing === 0) {
        const docs = [
          {
            label: 'СТС тягача', fileName: 'sts_truck.jpg',
            status: n % 4 === 1 ? 'NEEDS_REVIEW' : 'LOADED',
            dataUri: uri('СТС ТЯГАЧА', [t.plate, t.vin, `СТС ${t.sts}`, t.brand, t.owner], '#14532d'),
          },
          {
            label: 'Фото тягача', fileName: 'truck_photo.jpg', status: 'LOADED',
            dataUri: uri('ФОТО ТЯГАЧА', [`${t.brand} · ${t.plate}`, 'СОСТОЯНИЕ: УДОВЛЕТВОРИТЕЛЬНОЕ'], '#334155'),
          },
        ]
        await db.directoryPhoto.createMany({
          data: docs.map((x) => ({ kind: 'truck', refId: t.id, label: x.label, fileName: x.fileName, dataUri: x.dataUri, status: x.status })),
        })
        photos += 2
        if (n % 4 === 1) review++
      }
    }

    for (const [i, z] of c.trailers.entries()) {
      const n = seq++
      const kind = n % 4 === 3 ? 'LEASE' : n % 5 === 2 ? 'HIRED' : 'OWNED'
      if (z.ownershipType === 'OWNED') {
        // чужой собственник в старых данных — наёмная техника (Task 62)
        const foreign = z.owner !== '—' && z.owner !== c.name
        const resolved = foreign ? 'HIRED' : kind
        await db.trailer.update({
          where: { id: z.id },
          data: {
            ownershipType: resolved,
            owner: z.owner === '—' ? (resolved === 'OWNED' ? c.name : counterparty(i + 2)) : z.owner,
            leaseContract: resolved === 'LEASE' ? LEASE_CONTRACTS[(n + 2) % LEASE_CONTRACTS.length] : '—',
          },
        })
        if (resolved === 'OWNED') owned++; else if (resolved === 'HIRED') hired++; else leased++
      }

      // мок-документы прицепа: СТС + фото прицепа
      const existing = await db.directoryPhoto.count({ where: { kind: 'trailer', refId: z.id } })
      if (existing === 0) {
        const docs = [
          {
            label: 'СТС прицепа', fileName: 'sts_trailer.jpg', status: 'LOADED',
            dataUri: uri('СТС ПРИЦЕПА', [z.plate, `СТС ${z.sts}`, z.type, z.owner], '#7c2d12'),
          },
          {
            label: 'Фото прицепа', fileName: 'trailer_photo.jpg',
            status: n % 6 === 5 ? 'NEEDS_REVIEW' : 'LOADED',
            dataUri: uri('ФОТО ПРИЦЕПА', [`${z.type} · ${z.plate}`, 'СОСТОЯНИЕ: УДОВЛЕТВОРИТЕЛЬНОЕ'], '#334155'),
          },
        ]
        await db.directoryPhoto.createMany({
          data: docs.map((x) => ({ kind: 'trailer', refId: z.id, label: x.label, fileName: x.fileName, dataUri: x.dataUri, status: x.status })),
        })
        photos += 2
        if (n % 6 === 5) review++
      }
    }
  }

  console.log(`Принадлежность: собственный парк ${owned}, наёмный ${hired}, аренда/лизинг ${leased}`)
  console.log(`Мок-документов создано: ${photos} (из них «требует проверки»: ${review})`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())

import { PrismaClient } from '@/generated/kontur-client'

/**
 * Клиент Prisma диспетчерской (собственный транспорт АЭМЗ).
 *
 * ЕДИНЫЙ СПРАВОЧНИК ПАРКА: модели Driver/Vehicle/Trailer этого клиента маппятся
 * на платформенные таблицы Driver/Truck/Trailer — та же база, те же строки.
 * Собственный парк АЭМЗ лежит у служебного перевозчика-«АЭМЗ» (ownFleet = true):
 *
 *   1) контур ВИДИТ ТОЛЬКО собственный парк: каждый запрос чтения (findMany,
 *      findUnique, count, aggregate, update, delete…) автоматически получает
 *      условие carrierId = OWN_CARRIER_ID — привлечённые водители и техника
 *      перевозчиков для контура не существуют;
 *   2) записи контура всегда попадают в собственный парк: create/upsert
 *      автоматически получают carrierId = OWN_CARRIER_ID — «выйти» из парка
 *      из кода контура невозможно.
 *
 * Так единый справочник остаётся единым (одна таблица на сущность), а два
 * контура не залезают в чужие данные. Аудит контура пишется напрямую в общий
 * журнал PlatformLog (src/lib/kontur/audit.ts) — собственной таблицы аудита нет.
 */

/** id служебного перевозчика «АЭМЗ» (собственный парк) — фиксированный,
 *  создаётся миграцией data-fixes и не меняется */
export const OWN_CARRIER_ID = 'aemz-own-fleet'

/** Вставка «свой парк» в данные записи */
function toOwnPark<T extends object>(data: T): T {
  return { ...data, carrierId: OWN_CARRIER_ID }
}

/** Вставка «свой парк» в условие запроса (не затирая имеющееся условие) */
function scopedWhere<W extends object>(where: W | undefined): { AND: [W, { carrierId: string }] } {
  return { AND: [where ?? ({} as W), { carrierId: OWN_CARRIER_ID }] }
}

/** Скоуп одной модели справочника парка: чтения и записи не выходят из парка.
 *  Имена моделей — клиентские (driver / vehicle / trailer), таблицы — платформенные. */
function ownParkExtension(model: 'driver' | 'vehicle' | 'trailer') {
  return {
    async findMany({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async findFirst({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async findFirstOrThrow({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async findUnique({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async findUniqueOrThrow({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async count({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async aggregate({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async groupBy({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async create({ args, query }: { args: { data: object }; query: (args: unknown) => unknown }) {
      args.data = toOwnPark(args.data)
      return query(args)
    },
    async createMany({ args, query }: { args: { data: object | object[] }; query: (args: unknown) => unknown }) {
      args.data = Array.isArray(args.data) ? args.data.map(toOwnPark) : toOwnPark(args.data)
      return query(args)
    },
    async createManyAndReturn({ args, query }: { args: { data: object | object[] }; query: (args: unknown) => unknown }) {
      args.data = Array.isArray(args.data) ? args.data.map(toOwnPark) : toOwnPark(args.data)
      return query(args)
    },
    async update({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async updateMany({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async upsert({ args, query }: { args: { where?: object; create: object; update: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      args.create = toOwnPark(args.create)
      return query(args)
    },
    async delete({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
    async deleteMany({ args, query }: { args: { where?: object }; query: (args: unknown) => unknown }) {
      args.where = scopedWhere(args.where)
      return query(args)
    },
  } as const
}

function createClient() {
  const base = new PrismaClient()
  return base.$extends({
    query: {
      driver: ownParkExtension('driver'),
      vehicle: ownParkExtension('vehicle'),
      trailer: ownParkExtension('trailer'),
    },
  })
}

type DbClient = ReturnType<typeof createClient>

// Единственный экземпляр Prisma-клиента на процесс (hot-reload dev-режима
// не плодит соединений; в проде — обычный синглтон).
// ВАЖНО: собственный ключ globalThis (konturPrisma), НЕ общий «prisma»:
// платформенный клиент (src/lib/db.ts) кэшируется под globalThis.prisma.
// Клиенты разные (расширенный скоупом и платформенный), а база одна —
// таблицы Driver/Truck/Trailer общие, «своих» таблиц у контура больше нет.
const globalForPrisma = globalThis as unknown as { konturPrisma: DbClient | undefined }

export const db = globalForPrisma.konturPrisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.konturPrisma = db

/** Служебный перевозчик «АЭМЗ» — контейнер собственного парка в общих таблицах
 *  Driver/Truck/Trailer (ownFleet = true, доступ к площадке закрыт — не контрагент).
 *  Идемпотентно: создаётся один раз, дальше только подтверждается флаг. */
export async function ensureOwnFleetCarrier(): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO Carrier (id, name, inn, ownFleet, role, kpp, phone, diadocBoxId, contractNo, contractDate, access, createdAt, updatedAt)
     VALUES ('${OWN_CARRIER_ID}', 'АЭМЗ — собственный парк', 'AEMZ-OWN', 1, 'CARRIER', '', '', '', '—', '—', 0, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET ownFleet = 1, access = 0`,
  )
}

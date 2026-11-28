// kontur-db.cjs — перенос Dispatch*-таблиц контура в общую базу платформы.
// Вызывается из .zscripts/kontur-db.sh. ЕДИНЫЙ СПРАВОЧНИК ПАРКА: модели
// Driver/Vehicle/Trailer контура маппятся на платформенные таблицы — сюда
// копируются только Dispatch*-таблицы оперативного контура (рейсы, плечи,
// план, ATI.SU…).
//
// Режимы (argv[2]):
//  backup  <платформа> <файл-бэкапа>              — сохранить Dispatch*-данные
//                                                    (вызывается ДО платформенного
//                                                    db:push, который их сносит)
//  restore <свежая-база> <платформа> <файл-бэкапа> — пересоздать Dispatch*-таблицы
//                                                    из kontur.prisma и вернуть строки
//                                                    (INSERT OR IGNORE — идемпотентно)
/* eslint-disable @typescript-eslint/no-require-imports */
const { Database } = require('bun:sqlite')

const mode = process.argv[2]
const isDispatch = (name) => name.startsWith('Dispatch')
const listTables = (db) =>
  db
    .query("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name")
    .all()
    .filter((t) => isDispatch(t.name))

/** Перенос строк таблицы из одной базы в другую (INSERT OR IGNORE, пересечение колонок).
 *  Устойчиво к гонке с параллельным процессом: исчезнувшая таблица — не ошибка. */
function copyRows(from, to, name, ignore = false) {
  let rows
  try {
    rows = from.query(`SELECT * FROM "${name}"`).all()
  } catch {
    return 0 // таблица исчезла (параллельный процесс) — пропускаем
  }
  if (!rows.length) return 0
  const toCols = to.query(`PRAGMA table_info("${name}")`).all().map((c) => c.name)
  const cols = Object.keys(rows[0]).filter((c) => toCols.includes(c))
  if (!cols.length) return 0
  const ph = cols.map(() => '?').join(',')
  const sql = `${ignore ? 'INSERT OR IGNORE' : 'INSERT'} INTO "${name}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${ph})`
  const stmt = to.prepare(sql)
  let n = 0
  for (const r of rows) {
    stmt.run(...cols.map((c) => r[c]))
    n++
  }
  return n
}

if (mode === 'backup') {
  // Сохранить Dispatch*-таблицы (DDL + строки) в файл-бэкап: платформенный
  // db:push, который выполняется ПОСЛЕ этого, таблицы контура снесёт —
  // после пуша kontur-db.sh вернёт строки из бэкапа.
  const dst = new Database(process.argv[3])
  const backup = new Database(process.argv[4])
  const tables = listTables(dst)
  backup.run('PRAGMA foreign_keys=OFF')
  for (const t of tables) {
    backup.run(`DROP TABLE IF EXISTS "${t.name}"`)
    backup.run(t.sql)
  }
  let rows = 0
  for (const t of tables) rows += copyRows(dst, backup, t.name)
  console.log(`[kontur-db] бэкап: таблиц ${tables.length}, строк ${rows}`)
  process.exit(0)
}

if (mode === 'restore') {
  // Пересоздать Dispatch*-таблицы из свежей схемы контура и вернуть данные.
  const src = new Database(process.argv[3], { readonly: true }) // свежие Dispatch* из kontur.prisma
  const dst = new Database(process.argv[4]) // база платформы
  const backupPath = process.argv[5] // бэкап, снятый ДО платформенного db:push

  // что ещё живо в базе (мог остаться после одиночного запуска без пуша) —
  // тоже сохраняем, чтобы пересоздание таблиц ничего не теряло
  const live = listTables(dst)
  const liveBackup = new Database(`${backupPath}.live`)
  liveBackup.run('PRAGMA foreign_keys=OFF')
  for (const t of live) {
    liveBackup.run(`DROP TABLE IF EXISTS "${t.name}"`)
    liveBackup.run(t.sql)
  }
  for (const t of live) copyRows(dst, liveBackup, t.name)

  // пересоздание таблиц из свежей схемы
  dst.run('PRAGMA foreign_keys=OFF')
  let merged = 0
  for (const t of listTables(src)) {
    dst.run(`DROP TABLE IF EXISTS "${t.name}"`)
    dst.run(t.sql)
    merged++
  }

  // возвращаем строки: сначала «живые» (свежее), затем бэкап до пуша;
  // каждая таблица независимо — исчезнувшая не роняет весь восстановление
  let restored = 0
  for (const t of listTables(src)) {
    restored += copyRows(liveBackup, dst, t.name, true)
  }
  if (backupPath) {
    const backup = new Database(backupPath, { readonly: true })
    for (const t of listTables(backup)) {
      restored += copyRows(backup, dst, t.name, true)
    }
  }

  // индексы свежей схемы контура: уже существующие молча пропускаются
  let idx = 0
  for (const i of src
    .query("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
    .all()) {
    try {
      dst.run(i.sql)
      idx++
    } catch {
      /* индекс уже есть — не страшно */
    }
  }

  console.log(`[kontur-db] таблиц контура: ${merged}, строк возвращено: ${restored}, индексов: ${idx}`)
  process.exit(0)
}

console.error('[kontur-db] неизвестный режим:', mode)
process.exit(1)

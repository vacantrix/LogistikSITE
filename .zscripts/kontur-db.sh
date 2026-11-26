#!/bin/bash
# kontur-db.sh — контурная часть общей базы: генерирует клиент диспетчерской
# (src/generated/kontur-client, вне git) и вносит Dispatch*-таблицы в базу
# платформы. Без этого /kontur/api/state падает: платформенный db:push
# (schema.prisma) не знает таблиц контура и удаляет их при каждом запуске.
# Идемпотентен: повторный запуск пересоздаёт Dispatch*-таблицы с нуля.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1) путь к общей базе платформы (DATABASE_URL как у prisma; относительный — от prisma/)
DB_URL="${DATABASE_URL:-file:../db/custom.db}"
DB_PATH="${DB_URL#file:}"
if [[ "$DB_PATH" != /* ]]; then DB_PATH="$PROJECT_DIR/prisma/$DB_PATH"; fi
mkdir -p "$(dirname "$DB_PATH")"

echo "[kontur-db] база платформы: $DB_PATH"

# 2) клиент диспетчерской из prisma/kontur.prisma (в .gitignore: src/generated/)
cd "$PROJECT_DIR"
bunx prisma generate --schema prisma/kontur.prisma >/dev/null 2>&1

# 3) временная база с таблицами контура (DDL уже с префиксом Dispatch*)
TMP_DB="$(mktemp -d)/kontur.db"
DATABASE_URL="file:$TMP_DB" bunx prisma db push --schema prisma/kontur.prisma --accept-data-loss >/dev/null 2>&1

# 4) перенос Dispatch*-таблиц в базу платформы как есть (DDL + строки + индексы)
bun -e '
const { Database } = require("bun:sqlite")
const src = new Database(process.argv[1], { readonly: true })
const dst = new Database(process.argv[2])
dst.run("PRAGMA foreign_keys=OFF")
const tables = src.query(
  "SELECT name, sql FROM sqlite_master WHERE type=? AND name NOT LIKE ? AND name NOT LIKE ? ORDER BY name"
).all("table", "sqlite_%", "_prisma%")
let merged = 0, rows = 0
for (const t of tables) {
  dst.run(`DROP TABLE IF EXISTS "${t.name}"`)
  dst.run(t.sql)
  const list = src.query(`SELECT * FROM "${t.name}"`).all()
  if (list.length) {
    const cols = Object.keys(list[0])
    const ph = cols.map(() => "?").join(",")
    const stmt = dst.prepare(`INSERT INTO "${t.name}" (${cols.map(c => `"${c}"`).join(",")}) VALUES (${ph})`)
    for (const r of list) stmt.run(...cols.map(c => r[c]))
    rows += list.length
  }
  merged++
}
let idx = 0
for (const i of src.query(
  "SELECT name, sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE ?"
).all("index", "sqlite_%")) {
  try { dst.run(i.sql); idx++ } catch {}
}
console.log(`[kontur-db] таблиц: ${merged}, строк: ${rows}, индексов: ${idx}`)
' "$TMP_DB" "$DB_PATH"

rm -rf "$(dirname "$TMP_DB")"
echo "[kontur-db] Dispatch*-таблицы в общей базе — готово"

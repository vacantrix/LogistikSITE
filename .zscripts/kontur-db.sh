#!/bin/bash
# kontur-db.sh — контурная часть общей базы: генерирует клиент диспетчерской
# (src/generated/kontur-client, вне git) и вносит Dispatch*-таблицы в базу
# платформы. Платформенный db:push (schema.prisma) не знает таблиц контура
# и удаляет их — поэтому в dev.sh вызов идёт парой:
#
#   bash kontur-db.sh --backup   # ДО bun run db:push: снять копию Dispatch*-данных
#   bun run db:push              # платформенная схема (сносит Dispatch*-таблицы)
#   bash kontur-db.sh            # ПОСЛЕ: пересоздать таблицы контура и вернуть данные
#
# ЕДИНЫЙ СПРАВОЧНИК ПАРКА: модели Driver/Vehicle/Trailer контура маппятся
# на платформенные таблицы Driver/Truck/Trailer — они НЕ копируются сюда:
# их создаёт и ведёт платформенный db:push (schema.prisma), данные контура
# живут там же (служебный перевозчик-«АЭМЗ», ownFleet = true). Копируются
# только Dispatch*-таблицы оперативного контура (рейсы, плечи, план, ATI.SU…).
#
# Перезапуск dev.sh данные контура не сносит: строки возвращаются из бэкапа.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1) путь к общей базе платформы (DATABASE_URL как у prisma; относительный — от prisma/)
DB_URL="${DATABASE_URL:-file:../db/custom.db}"
DB_PATH="${DB_URL#file:}"
if [[ "$DB_PATH" != /* ]]; then DB_PATH="$PROJECT_DIR/prisma/$DB_PATH"; fi
mkdir -p "$(dirname "$DB_PATH")"

# бэкап Dispatch*-данных рядом с базой (живёт между шагами push/restore)
BACKUP_DB="${DB_PATH}.kontur-bak"

if [[ "${1:-}" == "--backup" ]]; then
  echo "[kontur-db] бэкап таблиц контура: $DB_PATH → $BACKUP_DB"
  rm -f "$BACKUP_DB" "$BACKUP_DB.live"
  bun "$SCRIPT_DIR/kontur-db.cjs" backup "$DB_PATH" "$BACKUP_DB"
  echo "[kontur-db] бэкап готов"
  exit 0
fi

echo "[kontur-db] база платформы: $DB_PATH"

# 2) клиент диспетчерской из prisma/kontur.prisma (в .gitignore: src/generated/)
cd "$PROJECT_DIR"
bunx prisma generate --schema prisma/kontur.prisma >/dev/null 2>&1

# 3) временная база с таблицами контура (только Dispatch* — справочники парка
#    живут в платформенных таблицах и сюда не входят)
TMP_DIR="$(mktemp -d)"
TMP_DB="$TMP_DIR/kontur.db"
DATABASE_URL="file:$TMP_DB" bunx prisma db push --schema prisma/kontur.prisma --accept-data-loss >/dev/null 2>&1

# 4) пересоздание Dispatch*-таблиц в базе платформы и возврат строк из бэкапа
bun "$SCRIPT_DIR/kontur-db.cjs" restore "$TMP_DB" "$DB_PATH" "$BACKUP_DB"

rm -rf "$TMP_DIR"
echo "[kontur-db] Dispatch*-таблицы в общей базе — готово"

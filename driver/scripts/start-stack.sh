#!/bin/bash
# Полный подъём стенда «АЗМЗ Логистика»:
#   :3001 — платформа «Контур 1С» (basePath /kontur)
#   :3002 — приложение водителя (веб-версия + API драйверского APK)
#   :3000 — роутер, единая точка входа превью (scripts/router.js)
# Использование: bash /home/z/my-project/scripts/start-stack.sh
set -u
cd /home/z/my-project

# 0) освободить :3000 — автостарт корневого проекта конфликтует с роутером
if ss -tlnp 2>/dev/null | rg -q ':3000 .*next-server'; then
  echo "Освобождаю :3000 (автостарт дев-сервера)…"
  pkill -f 'next dev -p 3000' 2>/dev/null || true
  sleep 2
fi

# 1) платформа «Контур 1С» на :3001
# ВАЖНО: в сессии глобально экспортирован DATABASE_URL корневого проекта (база
# приложения водителя) — он перебивает kontur-1c/.env, поэтому передаём адрес
# офисной базы явно, инлайном.
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:3001/kontur/api/1c/orders; then
  echo "Поднимаю «Контур 1С» на :3001…"
  (cd /home/z/my-project/kontur-1c && [ -d node_modules ] || bun install)
  (cd /home/z/my-project/kontur-1c && DATABASE_URL=file:/home/z/my-project/kontur-1c/db/custom.db setsid nohup bun run dev > /dev/null 2>&1 &)
fi

# 2) приложение водителя на :3002
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:3002/; then
  echo "Поднимаю приложение водителя на :3002…"
  KONTUR_1C_URL=http://127.0.0.1:3001/kontur setsid nohup ./node_modules/.bin/next dev -p 3002 > dev.log 2>&1 &
fi

# 3) роутер на :3000
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:3000/kontur; then
  echo "Поднимаю роутер на :3000…"
  setsid nohup node scripts/router.js > router.log 2>&1 &
fi

# 4) ждём готовности обеих точек входа
for i in $(seq 1 60); do
  K=$(curl -s -o /dev/null -w '%{http_code}' -m 2 http://127.0.0.1:3000/kontur)
  D=$(curl -s -o /dev/null -w '%{http_code}' -m 2 http://127.0.0.1:3000/)
  if [ "$K" = "200" ] && [ "$D" = "200" ]; then
    echo "Стенд поднят:"
    echo "  • Контур 1С:        http://127.0.0.1:3000/kontur"
    echo "  • Приложение водителя: http://127.0.0.1:3000/"
    exit 0
  fi
  sleep 2
done
echo "Не дождались готовности за 120 с — смотри kontur-1c/dev.log, dev.log, router.log"
exit 1

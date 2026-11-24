#!/bin/bash
# Перезапуск платформы «Контур 1С» (эмулятор 1С) на порту 3001.
# Использование: bash /home/z/my-project/scripts/kontur-restart.sh
set -e

echo "Останавливаю прежний процесс (если был)…"
pkill -f "next dev -p 3001" 2>/dev/null && sleep 2 || true

echo "Пересев канонических демо-данных…"
cd /home/z/my-project/kontur-1c
bun run db:seed 2>&1 | tail -2

echo "Запускаю платформу на http://127.0.0.1:3001 …"
(setsid nohup bash -c 'bun run dev' > /dev/null 2>&1 &)

for i in $(seq 1 30); do
  if curl -s -o /dev/null --max-time 2 http://127.0.0.1:3001/api/1c/orders; then
    echo "Готово: платформа отвечает, приложение водителя подключено через KONTUR_1C_URL."
    exit 0
  fi
  sleep 1
done
echo "Платформа не поднялась за 30 с — смотри /home/z/my-project/kontur-1c/dev.log"
exit 1

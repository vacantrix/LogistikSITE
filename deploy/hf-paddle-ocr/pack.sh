#!/usr/bin/env bash
# Собирает папку hf-space-upload/ — готовый набор файлов для Hugging Face Space.
# Запуск: bash deploy/hf-paddle-ocr/pack.sh   (из корня репозитория или откуда угодно)
set -euo pipefail
cd "$(dirname "$0")"

rm -rf hf-space-upload
mkdir hf-space-upload
cp Dockerfile requirements.txt hf-space-upload/
cp ../../mini-services/paddle-ocr/engine.py ../../mini-services/paddle-ocr/lexicon.py \
   ../../mini-services/paddle-ocr/server.py hf-space-upload/

# README.md идёт последним: он же манифест Space (YAML-шапка для Hugging Face)
cp README.md hf-space-upload/

echo "Готово: deploy/hf-paddle-ocr/hf-space-upload/"
echo "Загрузите эти 6 файлов в свой Space (Files → Add file → Upload files)."

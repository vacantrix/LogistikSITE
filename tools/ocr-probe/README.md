# OCR-проба: ручная проверка распознавания

Автономные скрипты раннего OCR-стенда: читают тестовые документы через
PaddleOCR, печатают поля и уверенности, рисуют разметку строк. Это не
production-сервис (он — `mini-services/paddle-ocr`), а инструмент для
диагностики и сравнения моделей.

## Состав

| Файл | Назначение |
|---|---|
| `make_samples.py` | генерирует синтетические образцы ВУ и СТС со штампом «ОБРАЗЕЦ», наклоном, тенью и шумом |
| `recognize.py` | полный проход: тип документа, поля, правила, сверка с заявкой, вердикт |
| `confidence_probe.py` | распределение уверенностей по строкам и полям |
| `alphabet_probe.py` | проверка чтения букв/цифр на синтетической таблице |
| `explain_images.py` | картинки «вход → рамки строк → выпрямленные строки → текст» |

## Запуск

```powershell
cd tools\ocr-probe
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python make_samples.py      # создаст samples\
.venv\Scripts\python recognize.py         # out\
.venv\Scripts\python recognize.py --real  # samples_real\ -> out_real\
```

Для `recognize.py --real` положите свои фото в `samples_real/`; для сравнения
с заявкой — JSON в `requests/` (например, `Z-1042.json`).

## Приватность

В репозитории нет и не должно быть реальных паспортов, ВУ и СТС. Каталоги
`samples_real/`, `out_real/`, `out/` и `requests/` — локальные, они исключены
`.gitignore`. Синтетические образцы (`make_samples.py`) содержат только
вымышленные данные и штамп «ОБРАЗЕЦ». Реальные сканы не коммитьте и не
пересылайте в чат: это персональные данные.

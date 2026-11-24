# Сборка и проверки

## 1. Платформа

```powershell
bun install
npm run db:push
npm run db:generate
npm run lint
npm run build
```

`npm run build` — `next build` + копирование `.next/static` и `public` в
standalone. Для стенда используйте `publish\build-public.ps1`: он делает то же
самое, синхронизирует ассеты и пишет `publish/build-manifest.json`.

Проверка типов отдельной командой:

```powershell
npx tsc --noEmit
```

В `next.config.ts` платформы `ignoreBuildErrors` не включён: ошибки типов
ломают сборку. У модуля водителя типы пока игнорируются при сборке — это
известное ограничение, не повод коммитить ошибки.

## 2. Модуль водителя

```powershell
cd driver
npm install
npx next build
npx next start -p 3102
```

Открыть `http://127.0.0.1:3102/driver`. Проверить:

- `sw.js` содержит `aemz-driver-v10`;
- манифест и иконки отдаются по `/driver/...`;
- MapLibre worker — `/driver/maplibre-gl-worker.mjs`;
- API `/api/driver/v1/sync/pull?cursor=0` отвечает.

`publish\build-driver.ps1` дополнительно копирует `.next/static` и `public` в
standalone. Без этого standalone отдаёт старую версию или 404 на ассеты.

## 3. Полный стек

```powershell
powershell -File publish\start-all.ps1
powershell -File publish\status.ps1
```

Ожидается `RESULT: OK`: платформа, gateway, портал, WS, OCR, модуль водителя,
публичный HTTPS. `verify-stack.ps1` проверяет:

- топологию loopback-only;
- маршруты Caddy;
- доступность БД;
- движок прав (админ открывает профили/доступы, не-админ получает отказ);
- шаблоны, пользователей, эффективные права.

## 4. Публичные проверки

```powershell
curl.exe -sS -o NUL -w "%{http_code}`n" https://logistiksite.vacantrix.ru/
curl.exe -sS -o NUL -w "%{http_code}`n" https://logistiksite.vacantrix.ru/driver
curl.exe -sS https://logistiksite.vacantrix.ru/driver/sw.js | Select-String VERSION
curl.exe -sS -o NUL -w "%{http_code}`n" https://logistiksite.vacantrix.ru/dl/Drivemobile.apk
```

## 5. OCR

```powershell
# движок
Invoke-RestMethod http://127.0.0.1:3031/health
# шлюз
Invoke-RestMethod http://127.0.0.1:3020/health -Headers @{ 'X-OCR-Token' = $env:OCR_SERVICE_TOKEN }
```

Синтетические образцы:

```powershell
cd tools\ocr-probe
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python make_samples.py
.venv\Scripts\python recognize.py
```

Реальные сканы в репозиторий не кладутся; `--real` использует локальный
`samples_real/`, который исключён `.gitignore`.

## 6. APK

```powershell
powershell -File tools\android-build\build-apk.ps1
powershell -File publish\publish-apk.ps1
```

Проверить:

- `driver/download/azmz-driver.apk` существует;
- размер и SHA-256 совпадают с ожидаемыми;
- `publish/portal/dl/Drivemobile.apk` обновлён;
- `https://.../dl/Drivemobile.apk` отдаёт новый файл (`Cache-Control:
  no-cache`).

CI: Actions → Android APK → артефакт `azmz-driver-apk`.

## 7. Смоук маршрута и синхронизации

1. В «Контуре» открыть рейс, вставить ссылку Яндекс.Карт, сохранить.
2. Проверить в БД `DispatchLeg.routeSource = 'yandex'`, число координат,
   `routeDistanceM`, `routeDurationS`.
3. Открыть `/driver`, убедиться, что линия полная и оранжевая, ETA/остаток
   пересчитаны.
4. Принять `DISPATCH`-заявку кнопкой «Взять заявку».
5. Проверить `sync/pull` — журнал растёт, `entries > 0`.
6. Отключить сеть, сделать отметку, включить сеть — операция досылается.

## 8. Что считать успехом

- `status.ps1` → `RESULT: OK`;
- `verify-stack.ps1` → без ошибок;
- `/driver` открывается, SW v10, карта и маршрут на месте;
- `/kontur` открывается, заявки и рейсы видны;
- OCR `health` → `ok: true, ready: true`;
- APK скачивается и совпадает по SHA-256;
- в `git status` нет секретов, баз, `node_modules`, реальных сканов.

# Диагностика и типовые проблемы

Начинайте с `publish\status.ps1` и `publish\verify-stack.ps1`: они показывают,
какой сервис не отвечает, и проверяют архитектуру, права и маршруты.

## 1. Платформа и gateway

| Симптом | Причина | Решение |
|---|---|---|
| `platform port 3000 : DOWN` | сборка/процесс упали | `publish\start-platform.ps1`, смотреть `publish\logs\platform.*.log` |
| `platform HTTP : FAIL` | standalone без `static`/`public` | пересобрать `publish\build-public.ps1` |
| 502 от Caddy | gateway :8080 не запущен | `publish\start-gateway.ps1` |
| `RESULT: FAIL` после обновления | несовпадение `build-manifest.json` | пересобрать платформу |
| пустая страница `/app/<key>` | старый `index.html`/JS в кэше | жёсткое обновление; Caddy уже шлёт `no-cache` для HTML |
| `/kontur` просит Basic Auth | периметр Caddy | ввести демо-логин `admin`; внутри — учётная запись платформы |

## 2. Модуль водителя и PWA

| Симптом | Причина | Решение |
|---|---|---|
| `/driver` → 404 | gateway не проксирует или модуль не собран | проверить :3102, `publish\build-driver.ps1`, `start-drivemobile.ps1` |
| `Worker failed to load` | MapLibre worker не по `/driver/...` | worker должен быть `/driver/maplibre-gl-worker.mjs`; проверить `public/` и `basePath` |
| линия маршрута не рисуется | нет геометрии или worker | проверить `routeSource`, `routeCoords`, консоль браузера |
| показывается старая версия PWA | service worker | `sw.js` → `aemz-driver-v10`; очистить кэш/перерегистрировать SW |
| офлайн-страница вместо приложения | SW не прогрелся | открыть `/driver` онлайн один раз, проверить scope `/driver` |
| входящие приходят с задержкой 15 с | long-poll режется прокси | это резервный polling; проверить `/api/driver/v1/sync/wait` |
| изменения не уходят | outbox/сеть | смотреть `azmz:outbox`, `sync/push`, статус связи; очередь не теряется |
| чужие точки на карте | старый `trip.id` в кэше | очистить данные модуля; точки фильтруются по активному рейсу |
| APK старый | скачался кэш | проверить `versionCode`, SHA-256, `Cache-Control` на `/dl/*` |

## 3. Маршрут офиса

| Симптом | Причина | Решение |
|---|---|---|
| `routeSource=osrm`, хотя ссылка Яндекса есть | страница Яндекса не отдалась/разметка изменилась | проверить `fetchYandexRoadRoute`, повторить позже; OSRM — резерв |
| «линия по точкам» | нет точной геометрии | это честный резерв; вставить ссылку заново |
| линия идёт не через все адреса | потеряны waypoints | проверить `routeWaypoints`, порядок `rtext` |
| `403`/`401` при ingest | неверный `DRIVER_APP_INGEST_TOKEN` | сверить токен платформы и модуля |
| рейс не появился у водителя | bridge не отправил | проверить `DRIVER_BRIDGE_URL`, `x-ingest-token`, журнал модуля |
| расстояние/время не совпадают | взяты из OSRM | при `yandex` использовать `routeDistanceM`/`routeDurationS` |

## 4. OCR

| Симптом | Причина | Решение |
|---|---|---|
| `OCR is not ready` | venv/модели/порт | `start-service.ps1`, лог `mini-services\paddle-ocr\logs\service-3031*.log` |
| `503` от шлюза | движок недоступен | проверить :3031, `PADDLE_OCR_URL`, токен |
| `422` | нет шаблона для типа документа | проверить `type` запроса |
| очень долго | модель грузится/мало памяти | первый запрос 5–20 с; уменьшить параллельность, включить `OCR_LOW_MEMORY=1` |
| процесс убит OOM | пиковая память детекции | снизить «Максимум фото в обработке» до 1–2; «лестница» сама уменьшит кадр |
| документ «на проверке» | OCR недоступен | это корректно; повторить позже, не подменять результат |
| модели исчезли | лежали в `%TEMP%` | перенести `.models` рядом с сервисом |

## 5. 1С и ЭДО

| Симптом | Причина | Решение |
|---|---|---|
| `503` на `/api/integration/1c/*` | не задан `ONEC_API_KEY` | добавить ключ ≥24 символов, перезапустить |
| `401` | неверный `X-API-Key` | сверить ключ 1С и сервера |
| CORS-ошибка в симуляторе | origin не разрешён | `ONEC_CORS_ORIGINS=https://vacantrix.github.io` |
| повтор создаёт дубль | разный `oneC_number` | ключ должен быть «номер от даты», уникальный |
| ЭТрН не уходит | нет `DIADOC_CLIENT_ID`/токена | проверить `.env`, `npm run diadoc:check` |
| статусы ЭТрН не обновляются | фоновая сверка выключена | `DIADOC_SYNC_INTERVAL_SEC`, кнопка «Обновить статусы» |

## 6. База и файлы

| Симптом | Причина | Решение |
|---|---|---|
| `database is locked` | два процесса/долгая транзакция | остановить лишние сервисы, проверить WAL, не копировать файл на ходу |
| пропали фото | очищен `upload/` | восстановить из резервной копии; файлы не в git |
| «нет доступа к файлу» | истёк токен/нет прав | открыть заново из карточки, проверить сессию |
| после `db:push` пусто | указан другой `DATABASE_URL` | сверить путь с `db/combat.db` |

## 7. Caddy, DNS, TLS

| Симптом | Причина | Решение |
|---|---|---|
| нет сертификата | A-запись не на этот IP / 443 закрыт | обновить DNS в reg.ru, проверить firewall |
| `https` не отвечает локально | Caddy не запущен | `publish\start-caddy.ps1`, лог `publish\logs\caddy.err.log` |
| домен открывает старый сайт | DNS/прокси | проверить A-запись и `curl --resolve` |
| `413` при загрузке | тело > 50 MB | уменьшить фото/файл, лимит Caddy |
| порт занят | старый процесс | `Get-NetTCPConnection -LocalPort <port>` → остановить владельца |

## 8. Сборка

| Симптом | Причина | Решение |
|---|---|---|
| `driver next build` падает | нет `node_modules` | `cd driver; npm install` |
| standalone без `public` | не выполнен sync | `publish\build-driver.ps1` копирует static/public |
| Gradle не находит SDK | нет `ANDROID_SDK_ROOT` | задать JDK 17/SDK 34/Gradle 8.9, см. `tools/android-build/README.md` |
| APK не публикуется | нет `publish/portal` | собрать платформу или создать каталог |
| CI APK падает | нет Gradle wrapper | workflow ставит Gradle 8.9 через `gradle/actions` |

## 9. Полезные команды

```powershell
# кто держит порт
Get-NetTCPConnection -State Listen -LocalPort 3102 | Select-Object OwningProcess

# хвосты логов
Get-Content publish\logs\platform.err.log -Tail 50
Get-Content publish\logs\driver.err.log -Tail 50
Get-Content mini-services\paddle-ocr\logs\service-3031.err.log -Tail 50

# публичные проверки
curl.exe -sS -o NUL -w "%{http_code}`n" https://logistiksite.vacantrix.ru/driver
curl.exe -sS https://logistiksite.vacantrix.ru/driver/sw.js | Select-String VERSION
curl.exe -sS -o NUL -w "%{http_code}`n" https://logistiksite.vacantrix.ru/dl/Drivemobile.apk
```

Если проблема не описана: снимите `publish\logs\*`, `status.ps1`, версию
`git rev-parse HEAD` и приложите к обращению. Не прикладывайте реальные
паспорта и ключи.

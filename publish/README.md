# Публикация LogistikSITE с домашнего ПК

Демонстрационный контур платформы для руководства. Всё работает на этом ПК:
Next.js и PaddleOCR слушают только `127.0.0.1`, наружу открыт единственный
HTTPS-вход Caddy на порту 443. Tuna в штатной схеме не используется.

## Адреса

**https://vacantrix.ru** — портал экосистемы Vacantrix:

- каталог приложений и промо-ролики;
- скачивание Vacantrix Platform без входа: `/dl/VacantrixSetup.exe`;
- блок LogistikSITE с переходом в демо;
- регистрация, вход и личный кабинет через локальный сервис `/api/portal/*`
  (Node.js + SQLite, без писем и внешних провайдеров).

**https://logistiksite.vacantrix.ru** — демо-стенд LogistikSITE:

- `/` — лендинг демо-стенда;
- `/demo/` — сама платформа.

`https://www.vacantrix.ru` перенаправляется на основной домен.

На экране входа LogistikSITE есть кнопка **«Демо-доступы для тестирования»**:
в списке первым стоит `admin`, по клику на учётку логин и пароль подставляются
в форму. Отдельной кнопки «Войти как администратор» нет. Текст «Пароль для
всех…» на экран не выводится. Резервная копия доступов —
`publish/credentials.local.txt` (не в git и не отдаётся публично).

Демо-учётка портала: `demo@vacantrix.ru` / `aemz2024`. Пароль хранится
scrypt-хешем в `publish/data/portal.db`.

### Автозаполнение документов

В карточке водителя (раздел **«Подать документы»**) есть отдельная кнопка
**«Автозаполнение»**. Она отправляет фото в локальный PaddleOCR, заполняет поля
карточки и **не пишет ничего в базу**. После чтения открывается панель
**«Что прочитала нейросеть · N полей»** со всеми распознанными полями, включая
те, которых нет в карточке.

Допуск в базу выполняет только кнопка **«Проверить»**: она ещё раз читает фото,
проверяет обязательные поля и сохраняет карточку вместе с фотографиями.
Должности перевозчика «Руководитель компании» и «Диспетчер» имеют право
`directory:addManual`, поэтому «Проверить» работает без ошибки 403.

Фото загружаются через `accept="image/*"`; крупные снимки сжимаются в браузере
до 2400 px и JPEG 92 %, небольшие резкие фото передаются без пересжатия.
Физический телефон к стенду не подключён: мобильный путь проверен загрузкой
крупных фото через публичный HTTPS и реальный `input[type=file]`.

## Схема

```
браузер
  → https://vacantrix.ru:443                (Caddy, Let's Encrypt TLS-ALPN-01)
  → 127.0.0.1:8090                          (portal-auth: /api/portal/*, SQLite)
  → статика publish/portal                  (портал: каталог, промо, установщик)

  → https://logistiksite.vacantrix.ru:443   (тот же Caddy)
  → 127.0.0.1:8080                          (локальный шлюз: лендинг + /demo)
  → 127.0.0.1:3000                          (Next.js standalone)
  → 127.0.0.1:3031                          (PaddleOCR, только localhost)
```

Порт 80 у провайдера закрыт, поэтому сертификат Let's Encrypt получается
методом TLS-ALPN-01 сразу на 443 — Caddy делает это автоматически.

OCR-сервис наружу не выставлен: фото документов не покидают ПК.
Публичный доступ защищён логином платформы.

## DNS

Домен `vacantrix.ru` обслуживается NS `ns1.reg.ru` / `ns2.reg.ru` (аккаунт reg.ru).

| Запись | Значение |
|---|---|
| `A logistiksite` | текущий публичный IP этого ПК |
| `A @` (vacantrix.ru) | текущий публичный IP этого ПК |
| `A www` | текущий публичный IP этого ПК (или CNAME на `@`) |

IP у ER-Telecom динамический. Если он сменился, обновите A-записи в панели
reg.ru: домен → «DNS-серверы и управление зоной» → изменить `A logistiksite`,
`A @` и `A www`.

Идентификация администратора домена через Госуслуги пройдена 08.11.2026 —
без неё reg.ru не применял изменения зоны (запись сохранялась в панели, но
авторитетные NS продолжали отвечать NXDOMAIN).

TTL зоны выставлен в **3600 секунд (1 час)** — это минимальное значение,
которое позволяет панель reg.ru (диапазон 3600–2419200). При смене IP новый
адрес разойдётся по резолверам примерно за час, а не за сутки. В старых
кэшах прежний IP может жить до истечения ранее полученного TTL.

Проверка через DoH (обходит кэш провайдера):

```powershell
curl.exe --ssl-no-revoke --doh-url https://cloudflare-dns.com/dns-query -I https://vacantrix.ru/
```

Если локальный резолвер ещё отдаёт старый IP, это кэш провайдера: сайт уже
работает снаружи, а на этом ПК запись обновится после истечения TTL.

## Основной домен

`vacantrix.ru` отдаёт восстановленный портал экосистемы (статика из
`publish/portal`), `www.vacantrix.ru` перенаправляет на основной домен.
`/demo` на основном домене редиректит на демо-поддомен. Все имена включены
в `Caddyfile.publish`; сертификаты Let's Encrypt выпускаются автоматически
по TLS-ALPN-01.

Портал — SPA с path-роутингом (`/apps`, `/pricing`, `/app/<key>`): Caddy
отдаёт `index.html` для неизвестных путей. API входа проксируется на
`127.0.0.1:8090`.

Когда A-записи `@` и `www` начинают указывать на этот ПК, конфиг применяется
без остановки Caddy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\enable-main-domain.ps1"
```

Скрипт проверяет DNS через DoH, делает `caddy reload` и ждёт, пока
`vacantrix.ru` начнёт отдавать 200, а `www` — редирект. Для ожидания раскатки
зоны запустите его с `-TimeoutMinutes 1440`; прогресс пишется в
`publish/logs/main-domain.log`.

## Быстрые команды

Все команды — из PowerShell. Папка `publish`:

```powershell
# боевой запуск: OCR, платформа, шлюз, portal-auth, Caddy, проверка и открытие сайта
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\start-production.ps1"

# запустить всё без проверок и открытия браузера
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\start-all.ps1"

# проверить состояние
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\status.ps1"

# включить основной домен после смены DNS (одна проверка или ожидание)
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\enable-main-domain.ps1"

# остановить всё
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\stop-all.ps1"
```

Скрипты идемпотентны: повторный `start-all.ps1` не поднимает второй экземпляр,
а проверяет порты и PID-файлы.

## Боевой запуск и ярлык

`start-production.ps1` — запуск одним кликом:

1. проверяет наличие сборки, Caddy, Node.js, portal-auth, файлов портала и установщиков;
2. поднимает OCR, платформу, шлюз, portal-auth и Caddy через `start-all.ps1`;
3. запускает `status.ps1` и проверяет HTTPS, каталог `/apps` и установщики `/dl/*`;
4. открывает портал **`https://vacantrix.ru/`** в браузере.

LogistikSITE остаётся отдельным блоком портала и демо на
`https://logistiksite.vacantrix.ru/demo/`. Платформа локально —
`http://127.0.0.1:3000/`.

Ярлык **«LogistikSITE — запуск»** лежит на рабочем столе и запускает именно
этот скрипт. Права администратора не нужны. Повторный запуск безопасен:
сервисы не дублируются.

Если ярлык потерялся, пересоздайте его:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\make-icon.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\make-desktop-shortcut.ps1"
```

Иконка хранится в `publish/assets/logistiksite.ico`, исходный знак —
`src/components/platform/logo-mark.tsx`.

## Автозапуск

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\register-autostart.ps1"
```

Создаётся задача планировщика `LogistikSITE-Demo`:

- запуск при входе пользователя (через 60 секунд после входа);
- повтор каждые 10 минут как лёгкий watchdog (скрипт ничего не дублирует);
- сон и гибернация отключаются, монитор может гаснуть.

Удалить автозапуск:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\unregister-autostart.ps1"
```

Проверить задачу:

```powershell
Get-ScheduledTask -TaskName LogistikSITE-Demo
Get-ScheduledTaskInfo -TaskName LogistikSITE-Demo
```

## Что где лежит

| Что | Где |
|---|---|
| Портал Vacantrix | `https://vacantrix.ru`, каталог — `/apps` |
| Демо LogistikSITE | `https://logistiksite.vacantrix.ru/demo/` |
| Боевой лаунчер | `publish/start-production.ps1` |
| Иконка и ярлык | `publish/assets/logistiksite.ico`, «LogistikSITE — запуск» на рабочем столе |
| Логины и пароль демо | `publish/credentials.local.txt` |
| Лендинг | `publish/landing/index.html` |
| Шлюз лендинг + `/demo` | `publish/landing-server.mjs` |
| Портал экосистемы | `publish/portal` (статика, без сборки) |
| Вход портала | `publish/portal-auth.mjs`, БД `publish/data/portal.db` |
| Установщики приложений | `publish/portal/dl/Vacantrix*.exe` |
| Превью-ролики карточек | `publish/portal/img/preview/*.mp4` |
| Полные промо и постеры | `publish/portal/img/promo/` |
| Скриншоты приложений | `publish/portal/img/screens/` |
| Конфиг Caddy | `publish/Caddyfile.publish` |
| Исполняемый файл Caddy | `publish/bin/caddy.exe` |
| Сертификаты Caddy | `%AppData%\Caddy` |
| Логи платформы | `publish/logs/platform.out.log`, `platform.err.log` |
| Логи шлюза | `publish/logs/gateway.out.log`, `gateway.err.log` |
| Логи входа портала | `publish/logs/portal-auth.out.log`, `portal-auth.err.log` |
| Логи Caddy | `publish/logs/caddy.out.log`, `caddy.err.log` |
| Логи OCR | `mini-services/paddle-ocr/bench-v6/logs/service-3031.log` |
| База демо | `db/combat.db` (абсолютный путь передаётся при запуске) |
| Сборка | `.next/standalone/server.js` |
| Отчёт по OCR | `mini-services/paddle-ocr/bench-v6/REPORT-v6.md` |

## Публикация приложений и промо

Каталог портала — статический: данные карточек лежат в
`publish/portal/js/appdata.js`, вёрстка — `js/apps.js` / `js/appdetail.js`,
стили — `css/main.css`. После правок обязательно поднимите
`window.__ASSET_V` в `publish/portal/index.html`, иначе браузер покажет
старый JS/CSS из кэша.

Опубликованные установщики (все скачиваются без входа):

| Приложение | Файл | Версия | Размер |
|---|---|---|---|
| Platform | `dl/VacantrixSetup.exe` | — | 133 МБ |
| HH | `dl/VacantrixHH.exe` | 1.1.7 | 97 МБ |
| Авито | `dl/VacantrixAvito.exe` | 1.0.9 | 66 МБ |
| Publisher | `dl/VacantrixPublisher.exe` | 0.2.0 | 245 МБ |
| Monitor | `dl/VacantrixMonitor.exe` | 1.0.1 | 62 МБ |
| Analytics | `dl/VacantrixAnalytics.exe` | 1.0.3 | 68 МБ |

Tasks и Leads намеренно в статусе «Скоро»: у Tasks ссылка и файл убраны,
у Leads нет рабочей сборки. Не возвращайте им `download` без готового EXE.

Источники файлов на этом ПК:

- установщики — `C:\Users\AUSU\AppData\Local\VacantrixPlatform\tools\<slug>\`;
- полные ролики и постеры — `C:\Users\AUSU\VACANTRIX\vacantrix-platform\resources\promo\`;
- скриншоты — `C:\Users\AUSU\VACANTRIX\vacantrix-platform\resources\screenshots\`;
- превью 7 секунд, 640 px, без звука — пересобираются `ffmpeg` из полных роликов.

Проверка после публикации:

```powershell
curl.exe -sS -I https://vacantrix.ru/dl/VacantrixHH.exe
curl.exe -sS -o NUL -w "%{http_code}" https://vacantrix.ru/dl/VacantrixTasks.exe  # ожидается 404
```

Caddy отдаёт `/dl/*` отдельным `handle` без SPA-фолбэка, поэтому удалённый
установщик не маскируется под `index.html`.

## Пересборка публичной версии

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\AUSU\Desktop\AEMZ-Logistika\LogistikSITE\publish\build-public.ps1"
```

Скрипт:

1. останавливает платформу;
2. временно очищает в `.env.local` только `NEXT_PUBLIC_WS_URL`;
3. делает чистую сборку `next build`;
4. копирует `static` и `public` в standalone;
5. восстанавливает `.env.local`;
6. проверяет, что `NEXT_PUBLIC_DEMO_PASSWORD` задан и попал в сборку —
   от этого зависит кнопка «Демо-доступы» и подстановка пароля по клику.

После сборки запустите `start-all.ps1`.

Портал `publish/portal` — статика без сборщика. После правок JS/CSS/роликов
достаточно обновить `window.__ASSET_V` в `publish/portal/index.html`, чтобы
браузеры получили новые файлы. Ролики лежат в `publish/portal/img/promo`.

## Безопасность и ограничения

- Наружу открыт только порт 443 через Caddy. `3000` (платформа), `8080` (шлюз)
  и `3031` (OCR) слушают `127.0.0.1`.
- Порт 80 у провайдера закрыт; Caddy получает сертификаты по TLS-ALPN-01 на 443.
- Демо-пароль намеренно вшит в публичную сборку: на экране входа есть кнопка
  «Демо-доступы для тестирования» со списком логинов; по клику на учётку
  логин и пароль подставляются в форму. Первым в списке идёт `admin`.
  Текст «Пароль для всех…» на экран не выводится. Стенд тестовый, данные
  в нём не являются боевыми.
- Вход на портал — локальный `portal-auth` (`127.0.0.1:8090`) с SQLite,
  scrypt-хешами и HMAC-сессией в HttpOnly-cookie. Писем нет: Яндекс Бизнес
  не оплачен, поэтому OTP, подтверждение регистрации и сброс пароля по почте
  отключены. Смена email применяется сразу.
- В публичной сборке отключён real-time WebSocket (`NEXT_PUBLIC_WS_URL` пуст):
  данные обновляются действиями и перезагрузкой страницы. Шина `ws-service`
  на `3003` в этом контуре не публикуется.
- ЭДО в демо работает через локальный контур Diadoc (`127.0.0.1:3040`,
  mock). Внешний роуминг с реальным Диадоком не настроен; при остановленном
  mock данные ЭДО остаются в БД, но синхронизация не идёт.
- Почтовые уведомления не отправляются: доступны только уведомления внутри
  платформы. Платёжный контур (Robokassa) в демо не подключён.
- ПК должен быть включён и в сети. Сон отключён; после перезагрузки Windows
  автозапуск сработает при входе пользователя. Windows Update может перезагрузить
  ПК — настройте активные часы или перезапустите `start-all.ps1` вручную.
- IP динамический: при смене адреса обновите A-записи `logistiksite`, `@` и `www`
  в reg.ru, иначе сайты перестанут открываться снаружи.
- Домен требует идентификации администратора через Госуслуги (требование для .ru
  с 01.09.2026). Без неё reg.ru может ограничить управление зоной.

## Откат

1. Публичный доступ: `stop-all.ps1` — платформа останется доступна локально
   на `http://127.0.0.1:3000` и `http://127.0.0.1:8080`.
2. OCR: production-модели `PP-OCRv6_medium_det` + `metrika-labs/PP-OCRv6_medium_rec_cyrillic`
   работают из `.venv-v6`/`.models-v6`. Старые `.venv` и `.models` не тронуты,
   `requirements.txt` не менялся. Порядок отката — раздел 13 в
   `mini-services/paddle-ocr/bench-v6/REPORT-v6.md`.
3. Платформа: демо обновлено до `origin/main` `84dfaac`; предыдущая версия
   `9cabb72` остаётся в git. Бэкап БД до обновления —
   `db/combat.backup-20261108-before-v102.db`. При необходимости
   `git checkout 9cabb72 -- .` и `build-public.ps1` (публичные переменные
   очищаются скриптом автоматически), затем вернуть `db/combat.db` из бэкапа.
4. Аварийный резерв: старый туннель Tuna можно поднять вручную
   (`start-tunnel.ps1`, адрес `https://wise-ibis-6779.a.tuna.free`), но в штатном
   запуске он не участвует.

## Диагностика

| Симптом | Что проверить |
|---|---|
| Публичная ссылка не открывается | `status.ps1`; `curl.exe --doh-url https://cloudflare-dns.com/dns-query -I https://logistiksite.vacantrix.ru/`; логи `publish/logs/caddy.err.log` |
| `vacantrix.ru` не открывается | A-записи `@` и `www` в reg.ru; `status.ps1` (строка «HTTPS main domain»); `publish/logs/main-domain.log`; `caddy.err.log` |
| Локально открывается старый сайт, снаружи — новый | кэш DNS провайдера; проверить через DoH; `ipconfig /flushdns`; запись обновится после истечения TTL |
| Сертификат не получен | DNS ещё не разошёлся; `caddy.err.log`; порт 443 снаружи; правила файрвола |
| Порт 443 занят | `stop-caddy.ps1`, затем `start-caddy.ps1` |
| В панели reg.ru «Внесены изменения зоны», но NS отвечает NXDOMAIN | не пройдена идентификация администратора через Госуслуги |
| Сессия reg.ru истекла | войти заново в панели браузера |
| Лендинг не открывается локально | `http://127.0.0.1:8080/`; `gateway.err.log`; порт 8080 |
| Вход на портал не работает | `http://127.0.0.1:8090/api/portal/health`; `portal-auth.err.log`; порт 8090; `publish/data/portal.db` |
| В демо-доступах не подставляется пароль | `NEXT_PUBLIC_DEMO_PASSWORD` в `.env.local`; пересобрать через `build-public.ps1` |
| Логин не проходит | логины из `credentials.local.txt`; база `db/combat.db`; `platform.err.log` |
| OCR «недоступен» | `http://127.0.0.1:3031/health`; логи `service-3031.err.log`; порт 3031 |
| Ошибка Prisma `Unable to open the database file` | `DATABASE_URL` должен быть абсолютным; `start-platform.ps1` делает это сам |
| Порт 3000 занят | `stop-platform.ps1`, затем `start-all.ps1` |

## Проверка OCR end-to-end

Публичный путь можно проверить без изменения базы: войти, открыть
**«Подать документы» → «Добавить водителя»**, загрузить два эталона из
`public/examples/` и нажать **«Автозаполнение»**. Это тот же путь, которым
пользуется интерфейс: браузер → Caddy → шлюз → Next.js → локальный PaddleOCR.
На исходных резких эталонах качество изображения — 100 %, читаются дата
рождения `14.02.1977`, «Кем выдан», место рождения и адрес регистрации.
Дата выдачи в эталоне паспорта отсутствует — её нужно заполнить вручную.

Для допуска нажмите **«Проверить»**: карточка сохранится в справочнике вместе
с фото. Тестовую запись после проверки удалите из `db/combat.db`.
Подробный smoke-тест OCR — `smoke_service.ps1`.

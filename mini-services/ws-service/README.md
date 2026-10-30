# Real-time шина ws-service (порт 3003)

Socket.io-сервис: после каждой значимой записи в БД сервер платформы дёргает
`notifyLive()` (`src/lib/notify.ts`) → шина рассылает событие `platform:update`
всем открытым вкладкам — списки и статусы обновляются без перезагрузки.

## События

`BID_PLACED`, `REQUEST_AWARDED`, `DOCS_VERIFIED`, `PERMS_CHANGED` и др. —
вкладки по ним перечитывают свои данные через `api.*`.

## Подключение клиента

```ts
import { io } from 'socket.io-client'
const socket = io('/?XTransformPort=3003', { path: '/' })  // только так: шлюз Caddy
```

Прямые адреса `http://localhost:3003` в клиенте запрещены — единый внешний порт
проксируется Caddy по query-параметру `XTransformPort`.

## Авторизация

Шина пускает только с валидной сессией платформы: подписанная кука `aemz_session`
или `?token=` (Bearer) — проверка через `src/lib/auth.ts`.

## Запуск

```bash
cd mini-services/ws-service
bun install
bun run dev    # :3003
```

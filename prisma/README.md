# prisma/ — база данных

SQLite (`db/custom.db`) через Prisma ORM. Схема — `schema.prisma`, применена командой
`bun run db:push` (без миграций: стенд, схема меняется часто).

## Блоки схемы

| Блок | Модели | Что хранит |
|---|---|---|
| Люди и компании | `Carrier`, `User`, `Profile` | перевозчики, учётки (роли, sessionVersion), профили |
| Доступ | `AccessTemplate`, `TemplatePerm`, `PermException`, `RolePerm` (устар.) | должности и гранулярные права |
| Техника | `Driver`, `Truck`, `Trailer`, `DirectoryPhoto` | допущенные карточки водителей/тягачей/прицепов с фото |
| Торги и рейсы | `CargoType`, `Request`, `Bid`, `Event` | заявки (статусы, `onecRef`), ставки, журнал действий |
| Документы | `RequestFile`, `Document` | сканы (dataUri), статусы, поля и уверенности нейросети, вердикты |
| ЭДО | `EdoDocument`, `DiadocState` | ЭТрН и статусы Диадока |
| Служебное | `Notification`, `PlatformLog`, `Ticket`, `TicketMessage`, `TicketAttachment`, `Setting` | уведомления, техжурнал, поддержка, настройки (пороги + **нейросеть: `nnParallel`, `nnTimeoutSec`, `nnCacheMin`, `nnMaxSide`**) |

## Сиды

| Файл | Запуск | Назначение |
|---|---|---|
| `seed.ts` | `bun run db:push`-после / вручную | демо-данные: перевозчики, заявки, справочник |
| `seed-users.ts` (в `scripts/`) | `bun run auth:seed` | учётные записи всех ролей (идемпотентно) |
| `seed-directory-docs.ts` | вручную | документы справочника со сроками |
| `seed-more.js` | вручную (bun) | расширенное демо-наполнение: торги, экипажи, вердикты |

Пароль демо-учёток — `SEED_PASSWORD` (`.env.local` / `.env`); без переменной сид
печатает случайный.

# src/ — код платформы

Весь код веб-платформы «АЭМЗ Логистика» (Next.js 16, App Router, TypeScript).

```
src/
├── app/            маршруты и страницы (App Router)      → app/README.md
│   └── api/        REST API платформы                    → app/api/README.md
├── components/
│   ├── ui/         shadcn/ui — базовые компоненты        → components/README.md
│   └── platform/   экраны платформы по ролям             → components/platform/README.md
├── lib/            серверные правила и клиенты           → lib/README.md
└── hooks/          клиентские хуки                       → hooks/README.md
```

Принципы:

- **Один маршрут `/`.** Страница `app/page.tsx` читает сессию (`/api/auth/me`) и
  показывает вкладки по роли; серверных страниц-роутов нет.
- **Тонкие маршруты, толстые правила.** HTTP-обработчики в `app/api/*` только
  валидируют вход и вызывают логику из `lib/*` — бизнес-правила переиспользуются.
- **Контракт с клиентом — DTO.** Prisma-модели сериализуются в DTO (`lib/serialize.ts`,
  типы — `lib/types.ts`), клиент работает только с ними (`lib/api.ts`).
- **Права проверяются на сервере.** `lib/auth.ts` (роли) и `lib/permissions.ts`
  (гранулярные права по должностям); UI лишь скрывает недоступное.

Файл `instrumentation.ts` — хук старта Next.js: при запуске приводит старые данные
к справочникам (`lib/data-fixes.ts`).

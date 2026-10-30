# src/hooks/ — клиентские хуки

| Хук | Роль |
|---|---|
| `use-toast.ts` | тосты платформы (обёртка shadcn/ui toast + Toaster) |
| `use-mobile.ts` | детект мобильного ширины-видового окна (для Tab Bar) |

Хуки состояния (Zustand/TanStack Query) не используются: данные приходят через
`src/lib/api.ts` в локальном состоянии вкладок, обновления — по real-time событиям
шины WS (`platform:update`).

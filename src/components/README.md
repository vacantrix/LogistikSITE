# src/components/

```
components/
├── ui/          shadcn/ui (New York) — базовые кирпичики интерфейса
└── platform/    экраны и блоки платформы «АЭМЗ Логистика»  → platform/README.md
```

## ui/ — shadcn/ui

Сгенерированные компоненты shadcn/ui (Radix + Tailwind 4): кнопки, карточки, диалоги,
таблицы, селекты, слайдеры, тосты и т. д. Правила:

- **не редактируем без необходимости** — это общий фундамент; платформенные стили
  живут в `platform/*` и `globals.css`;
- иконки — `lucide-react`;
- состав соответствует `components.json`.

## platform/ — экраны платформы

Подробная карта — в `platform/README.md`.

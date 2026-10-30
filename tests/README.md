# tests/ — проверки окружения

Служебные проверки стенда (не юнит-тесты платформы): среда запуска Next.js,
Python-рантайм для движка PaddleOCR.

| Файл | Проверяет |
|---|---|
| `database-runtime-build.sh` | сборку/запуск рантайма с доступом к SQLite |
| `python-runtime-build.sh` · `python-runtime-container.sh` | сборку Python-окружения для PaddleOCR |
| `vlm-path-test.ts` | доступность зрительной модели на старом контуре (историческое) |

Рабочие проверки проекта: `bun run lint` (ESLint), `bunx tsc --noEmit` (типы),
`scripts/aemz-e2e.py` (E2E нейроконтурa).

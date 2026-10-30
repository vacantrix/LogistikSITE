# public/ — статика платформы

Раздаётся Next.js как есть (корень — `/`).

| Файл/папка | Назначение |
|---|---|
| `logo-mark.svg`, `favicon.ico`, `apple-touch-icon.png` | логотип и иконки платформы (`logo.svg` — запасной, кодом не подключён) |
| `robots.txt` | для поисковых систем (закрытая платформа) |
| `examples/` | реальные демо-сканы (`passport-photo.jpg`, `passport-registration.jpg`, `sts-truck.jpg`): используются **тестовым прогоном раздела «Нейросеть»** (`admin/nn`); `sts-trailer.jpg` — запасной образец. Демо-сканы кабинета перевозчика генерируются на лету (`src/lib/demo-media.ts`) |
| `1c-simulator/` | установленная копия симулятора 1С (исходник — `docs/1c/simulator/`): платформа раздаёт её по `/1c-simulator/start.html` — тот же origin, CORS не нужен |

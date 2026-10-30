# public/ — статика платформы

Раздаётся Next.js как есть (корень — `/`).

| Файл/папка | Назначение |
|---|---|
| `logo.svg`, `logo-mark.svg`, `favicon.ico`, `apple-touch-icon.png` | логотип и иконки платформы |
| `robots.txt` | для поисковых систем (закрытая платформа) |
| `examples/` | реальные демо-сканы (`passport-photo.jpg`, `passport-registration.jpg`, `sts-truck.jpg`, `sts-trailer.jpg`): используются кнопками демо-входа и **тестовым прогоном раздела «Нейросеть»** |
| `1c-simulator/` | установленная копия симулятора 1С (исходник — `docs/1c/simulator/`): платформа раздаёт её по `/1c-simulator/start.html` — тот же origin, CORS не нужен |

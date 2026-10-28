/**
 * Проверка обмена с 1С без 1С: скрипт делает те же запросы, что модуль формы 1С
 * (send-request-form-module.bsl в этой папке), и печатает ответы платформы.
 *
 *   1) GET  /ping      — связь и API-ключ;
 *   2) POST /requests  — черновик заявки (как кнопка «Отправить на веб-платформу»);
 *   3) POST /requests  — тот же документ ещё раз: платформа должна вернуть тот же черновик (duplicate: true);
 *   4) GET  /requests?status=DRAFT — черновик виден в реестре для 1С с полем onecRef.
 *
 * Запуск (ключ — тот же, что ONEC_API_KEY на сервере):
 *   node --env-file-if-exists=.env.local docs/1c/onec-check.mjs
 *   ONEC_URL=https://logistika.example.ru ONEC_API_KEY=… node docs/1c/onec-check.mjs
 *   node docs/1c/onec-check.mjs --ref "ЗП-0012 от 28.10.2026"   — свой номер документа 1С
 * Без --ref номер уникальный (ПРОВЕРКА-<время>), поэтому каждый запуск создаёт новый черновик —
 * лишние черновики логист удаляет в «Черновиках заявок».
 */
const base = (process.env.ONEC_URL || 'http://localhost:3000').replace(/\/+$/, '') + '/api/integration/1c'
const key = process.env.ONEC_API_KEY || ''
const refArg = process.argv.indexOf('--ref')
const ref = refArg > 0 ? process.argv[refArg + 1] : `ПРОВЕРКА-${Date.now()}`

if (key.length < 24) {
  console.error('Задайте ONEC_API_KEY (не короче 24 символов) — тот же ключ, что на сервере')
  process.exit(1)
}

const pad = (n) => String(n).padStart(2, '0')
const tomorrow = new Date(Date.now() + 24 * 3600_000)
// 1С отправляет дату как Формат(Дата, "ДФ=yyyy-MM-dd")
const loadDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`

const draft = {
  oneC_number: ref,
  fromPoint: 'Краснодарский край, г. Абинск, ул. Промышленная, д. 4',
  toPoint: 'г. Санкт-Петербург, Канонерский остров, д. 45',
  cargo: 'Перевозка готовой продукции - арматура',
  tonnage: 20.5,
  truckType: 'Борт',
  loadDate,
  loadWindow: '09:00–18:00',
  startRate: 0, // ₽/т; 0 — ставку задаст логист при публикации
  comment: 'Проверка обмена с 1С (docs/1c/onec-check.mjs)',
}

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'X-API-Key': key, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* не JSON — покажем как есть */ }
  return { status: res.status, json, text }
}

function step(title, r, expect) {
  const ok = expect.includes(r.status)
  console.log(`${ok ? '✔' : '✘'} ${title}: HTTP ${r.status}`)
  if (!ok) {
    console.log('  ответ:', r.json ? JSON.stringify(r.json) : r.text.slice(0, 500))
    process.exit(1)
  }
  return r.json
}

console.log(`Платформа: ${base}`)
const ping = step('ping', await call('GET', '/ping'), [200])
console.log(`  ${ping.service}, версия API ${ping.version}`)

const first = step('черновик из 1С', await call('POST', '/requests', draft), [200, 201])
console.log(`  №${first.data.number} (id ${first.data.id}), статус «${first.data.statusRu}», документ 1С «${first.data.onecRef}»`
  + (first.data.duplicate ? ' — уже был создан раньше' : '')
  + (first.data.cargoCreated ? ` · груз «${first.data.cargo}» добавлен в справочник` : ''))

const again = step('повтор того же документа', await call('POST', '/requests', draft), [200])
if (!again.data.duplicate || again.data.id !== first.data.id) {
  console.log('✘ повтор создал новую заявку вместо возврата существующей:', JSON.stringify(again.data))
  process.exit(1)
}
console.log(`  дубль не создан — платформа вернула тот же №${again.data.number}`)

const list = step('реестр черновиков для 1С', await call('GET', '/requests?status=DRAFT&limit=500'), [200])
const row = list.data.find((r) => r.onecRef === ref)
if (!row) {
  console.log(`✘ черновик «${ref}» не найден в GET /requests?status=DRAFT`)
  process.exit(1)
}
console.log(`  найден: ${row.route.from} → ${row.route.to}, ${row.cargo}, ${row.tonnage} т, ${row.truckType}, погрузка ${row.loadDate}`)
console.log('Готово: черновик ждёт логиста в «Черновиках заявок».')

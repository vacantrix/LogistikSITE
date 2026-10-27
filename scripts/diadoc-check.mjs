/**
 * Проверка подключения к Диадоку — ничего не отправляет и не подписывает.
 *
 *   npm run diadoc:check                                — токен, организация и ящик, тип ЭТрН, пробная сборка Т1
 *   npm run diadoc:check -- --inn 2315000001 [--kpp 231501001] — найти ящик контрагента по ИНН
 *
 * Ключи берутся из .env.local (DIADOC_*), как у платформы. Контур при каждом обмене выдаёт
 * новый refresh-токен — скрипт сохраняет его в базу (DiadocState), откуда его берёт платформа,
 * иначе следующий обмен не пройдёт. Секреты на экран не выводятся.
 *
 * Пробная сборка Т1 — метод GenerateTitleXml по вымышленным данным, где грузополучатель
 * и перевозчик — свой же ящик: так Диадок проверяет наш упрощённый XML, ничего не отправляя.
 */
import { PrismaClient } from '@prisma/client'
import { diadocConfig, diadocStandLabel, shipperSettings } from '../src/lib/diadoc/config.ts'
import { ETRN_TYPE, buildT1UserXml } from '../src/lib/diadoc/waybill.ts'

const db = new PrismaClient()
const c = diadocConfig()
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? (process.argv[i + 1] ?? '').trim() : ''
}
const ok = (s) => console.log(`  ✓ ${s}`)
const bad = (s) => { console.log(`  ✗ ${s}`); process.exitCode = 1 }
const note = (s) => console.log(`    ${s}`)
const fail = bad

const boxGuid = (boxId) => {
  const m = boxId.trim().match(/^([0-9a-f]{32})@/i)
  if (!m) return boxId.trim()
  const h = m[1].toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Обмен refresh-токена: сначала сохранённый в базе, затем из .env.local — как в src/lib/diadoc/client.ts */
async function token() {
  const state = await db.diadocState.findUnique({ where: { id: 'main' } })
  const candidates = [
    ...(state?.refreshToken ? [['из базы', state.refreshToken]] : []),
    ...(c.refreshToken && c.refreshToken !== state?.refreshToken ? [['из .env.local', c.refreshToken]] : []),
  ]
  if (candidates.length === 0) return fail('Нет refresh-токена: задайте DIADOC_REFRESH_TOKEN в .env.local')
  for (const [label, rt] of candidates) {
    const res = await fetch(`${c.oidcUrl}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: c.clientId, client_secret: c.clientSecret, refresh_token: rt }),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e.cause?.code ?? e.message) }))
    if (!res.ok) {
      note(`токен ${label} не подошёл: ${res.status} ${(await res.text()).slice(0, 200)}`)
      continue
    }
    const j = await res.json()
    const expiresAt = new Date(Date.now() + (j.expires_in ?? 3600) * 1000)
    // токен из базы не подошёл — значит, в базе состояние другого стенда или старого токена: позицию ленты событий сбрасываем
    const reset = label === 'из .env.local' && Boolean(state?.refreshToken)
    const data = {
      accessToken: j.access_token, accessTokenExpiresAt: expiresAt, refreshToken: j.refresh_token ?? rt,
      ...(reset ? { eventsIndexKey: null, lastError: null } : {}),
    }
    await db.diadocState.upsert({ where: { id: 'main' }, create: { id: 'main', ...data }, update: data })
    ok(`токен доступа получен (refresh-токен ${label}; новый сохранён в базе)`)
    if (j.scope) note(`права: ${j.scope}`)
    const scopes = String(j.scope ?? '').split(/\s+/)
    if (j.scope && !scopes.includes('offline_access')) note('нет offline_access — токен не будет обновляться сам: выпустите refresh-токен с этим правом')
    const need = c.apiUrl.includes('staging') ? 'Diadoc.PublicAPI.Staging' : 'Diadoc.PublicAPI'
    if (j.scope && !c.apiUrl.includes('127.0.0.1') && !scopes.includes(need)) note(`нет права ${need} для этой площадки — выпустите refresh-токен с ним`)
    return j.access_token
  }
  fail('Контур не выдал токен: проверьте DIADOC_CLIENT_ID, DIADOC_CLIENT_SECRET и выпустите новый refresh-токен в Кабинете интегратора')
}

async function call(access, path, { query = {}, method = 'GET', xml, accept = 'application/json' } = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v))
  const res = await fetch(`${c.apiUrl}${path}${qs.size ? `?${qs}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${access}`, Accept: accept,
      ...(xml ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
    },
    body: xml,
    signal: AbortSignal.timeout(60_000),
  })
  return res
}

const hint403 = 'токен и ящик с разных площадок (основная / тестовая) или у учётной записи нет доступа к ящику'

async function main() {
  console.log(`Диадок: ${diadocStandLabel(c)} (${c.apiUrl})`)
  if (!c.clientId || !c.clientSecret) return fail('Не заданы DIADOC_CLIENT_ID и DIADOC_CLIENT_SECRET в .env.local')
  console.log(`Подпись Т1: ${c.testSignature ? 'тестовая подпись Диадока' : 'отложенная — логист подписывает своей КЭП в Диадоке'}`)

  console.log('\n1. Авторизация')
  const access = await token()
  if (!access) return

  console.log('\n2. Организация и ящик')
  const orgsRes = await call(access, '/GetMyOrganizations')
  if (!orgsRes.ok) {
    return fail(`GetMyOrganizations: ${orgsRes.status} ${orgsRes.status === 403 ? hint403 : (await orgsRes.text()).slice(0, 300)}`)
  }
  const orgs = (await orgsRes.json()).Organizations ?? []
  if (orgs.length === 0) return fail('учётной записи не доступна ни одна организация на этой площадке — возможно, ящик на другой площадке')
  for (const o of orgs) {
    note(`${o.ShortName || o.FullName || 'без названия'} · ИНН ${o.Inn ?? '—'}${o.Kpp ? ` · КПП ${o.Kpp}` : ''}`)
    for (const b of o.Boxes ?? []) note(`  ящик ${b.BoxIdGuid ?? boxGuid(b.BoxId)}${b.Title ? ` «${b.Title}»` : ''}`)
  }
  const boxes = orgs.flatMap((o) => (o.Boxes ?? []).map((b) => ({ org: o, id: (b.BoxIdGuid ?? boxGuid(b.BoxId)).toLowerCase() })))
  const want = c.boxId ? boxGuid(c.boxId).toLowerCase() : ''
  const box = want ? boxes.find((b) => b.id === want) : boxes[0]
  if (!box) return fail(want ? `ящик DIADOC_BOX_ID=${want} не найден среди доступных — ${hint403}` : 'у организаций нет ящиков')
  ok(`ящик АЭМЗ: ${box.id} (${box.org.ShortName || box.org.FullName}, ИНН ${box.org.Inn})${want ? '' : ' — первый доступный; чтобы закрепить, задайте DIADOC_BOX_ID'}`)

  console.log('\n3. Тип документа ЭТрН в ящике')
  const typesRes = await call(access, '/V2/GetDocumentTypes', { query: { boxId: box.id } })
  if (!typesRes.ok) {
    fail(`GetDocumentTypes: ${typesRes.status} ${typesRes.status === 403 ? hint403 : (await typesRes.text()).slice(0, 300)}`)
  } else {
    const types = (await typesRes.json()).DocumentTypes ?? []
    const t = types.find((d) => d.Name === ETRN_TYPE.typeNamedId)
    const fn = t?.Functions?.find((f) => f.Name === ETRN_TYPE.func)
    const ver = fn?.Versions?.find((v) => v.Version === ETRN_TYPE.version)
    if (ver) ok(`${ETRN_TYPE.typeNamedId} / ${ETRN_TYPE.func} / ${ETRN_TYPE.version} доступен${ver.IsActual === false ? ' (версия помечена неактуальной)' : ''}`)
    else if (t) fail(`${ETRN_TYPE.typeNamedId} есть, но нет ${ETRN_TYPE.func}/${ETRN_TYPE.version}: ${(t.Functions ?? []).map((f) => `${f.Name}: ${(f.Versions ?? []).map((v) => v.Version).join(', ')}`).join('; ')}`)
    else fail(`в ящике нет типа ${ETRN_TYPE.typeNamedId} — подключите транспортный ЭДО в Диадоке (доступно типов: ${types.length})`)
  }

  console.log('\n4. Пробная сборка титула Т1 (ничего не отправляется)')
  const sh = shipperSettings()
  const today = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date())
  const at = (hm) => `${today.split('.').reverse().join('-')}T${hm}:00+03:00`
  const input = {
    number: 'ПРОВЕРКА-1', date: today, orderNumber: 'ПРОВЕРКА', orderDate: today,
    consignee: { inn: box.org.Inn ?? '', kpp: box.org.Kpp ?? '', name: '', phone: '+78617000001' },
    delivery: { zip: '353900', region: '23', city: 'Новороссийск', street: 'Портовая', building: '7' },
    cargo: {
      name: 'Арматура А500С d12', condition: 'Без повреждений', packageMethod: 'Пачки', containerType: '00',
      places: '10', grossWeightKg: '20000', marks: '',
    },
    carrierPhone: '+78610000001',
    driver: { lastName: 'Петров', firstName: 'Алексей', middleName: 'Сергеевич', phone: '+79000000001' },
    vehicle: { number: 'А001АА23', ownership: '4', type: 'Тягач седельный', model: 'SITRAK C7H', maxWeight: '20', capacity: '82', sts: '9900000001', vin: 'LZZ7CCWD0PC000001' },
    trailer: { number: 'АА000123', ownership: '4', type: 'Полуприцеп тентованный', model: 'KRONE SD', maxWeight: '25', capacity: '90', sts: '9900000002', vin: '' },
    loading: { statedArrival: at('08:00'), actualArrival: at('08:20'), actualDeparture: at('10:45'), weighingMethod: '01' },
  }
  const missing = [
    !sh.phone && 'EDO_SHIPPER_PHONE', !sh.signer.lastName && 'EDO_SIGNER_LAST_NAME', !sh.signer.firstName && 'EDO_SIGNER_FIRST_NAME',
  ].filter(Boolean)
  if (missing.length) note(`не заданы ${missing.join(', ')} — без них платформа Т1 не отправит`)
  const userXml = buildT1UserXml(input, {
    shipperBoxId: box.id, shipperInn: box.org.Inn ?? '', shipperPhone: sh.phone || '+78615000000',
    consigneeBoxId: box.id, carrierBoxId: box.id,
    loadingAddress: sh.loading,
    loader: sh.loader.lastName ? sh.loader : { ...sh.loader, lastName: 'Тестов', firstName: 'Логист' },
    signer: sh.signer.lastName ? sh.signer : { ...sh.signer, lastName: 'Тестов', firstName: 'Логист' },
  })
  const genRes = await call(access, '/GenerateTitleXml', {
    method: 'POST', accept: 'application/xml', xml: userXml,
    query: { boxId: box.id, documentTypeNamedId: ETRN_TYPE.typeNamedId, documentFunction: ETRN_TYPE.func, documentVersion: ETRN_TYPE.version, titleIndex: String(ETRN_TYPE.titleIndex) },
  })
  if (genRes.ok) {
    const size = (await genRes.arrayBuffer()).byteLength
    ok(`Диадок принял данные и собрал титул Т1 по формату ФНС (${Math.round(size / 1024)} КБ)`)
  } else {
    fail(`GenerateTitleXml: ${genRes.status} ${(await genRes.text()).slice(0, 1500)}`)
  }

  const inn = arg('inn')
  if (inn) {
    console.log(`\n5. Контрагент по ИНН ${inn}`)
    const res = await call(access, '/GetOrganizationsByInnKpp', { query: { inn, kpp: arg('kpp') } })
    if (!res.ok) return fail(`GetOrganizationsByInnKpp: ${res.status} ${(await res.text()).slice(0, 300)}`)
    const found = ((await res.json()).Organizations ?? []).filter((o) => o.Boxes?.length)
    if (found.length === 0) bad('организация не найдена в Диадоке — ЭТрН ей не отправить (нужен ящик или роуминг)')
    for (const o of found) ok(`${o.ShortName || o.FullName} · ящик ${o.Boxes[0].BoxIdGuid ?? boxGuid(o.Boxes[0].BoxId)}`)
  }
  console.log(process.exitCode ? '\nЕсть ошибки — см. ✗ выше' : '\nПодключение работает')
}

try {
  await main()
} catch (e) {
  fail(`сбой: ${e.cause?.code ?? e.message}`)
} finally {
  await db.$disconnect()
}

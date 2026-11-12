/**
 * Локальная авторизация портала vacantrix.ru.
 *
 * Зачем свой сервис: старый Supabase/GoTrue жил на Cloud.ru и вместе с
 * api.vacantrix.ru больше недоступен. Почта у Яндекс Бизнеса не оплачена,
 * поэтому OTP, подтверждение регистрации и сброс пароля письмом невозможны.
 * Здесь: email + пароль, сессия в HttpOnly-cookie, SQLite рядом с порталом.
 *
 * Слушает только 127.0.0.1: Caddy проксирует /api/portal/* с HTTPS.
 * Без внешних зависимостей: node:sqlite, node:crypto, node:http.
 */
import http from 'node:http'
import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST = process.env.PORTAL_AUTH_HOST || '127.0.0.1'
const PORT = Number(process.env.PORTAL_AUTH_PORT || 8090)
const DATA_DIR = process.env.PORTAL_DATA_DIR || path.join(__dirname, 'data')
const DB_PATH = process.env.PORTAL_DB_PATH || path.join(DATA_DIR, 'portal.db')
const SECRET_PATH = process.env.PORTAL_SECRET_PATH || path.join(DATA_DIR, 'portal.secret')
const DEMO_EMAIL = (process.env.PORTAL_DEMO_EMAIL || 'demo@vacantrix.ru').toLowerCase()
const DEMO_PASSWORD = process.env.PORTAL_DEMO_PASSWORD || 'aemz2024'
const COOKIE_NAME = 'vx_portal_session'
const CONSENT_VERSION = '2026-07-17'
const SESSION_TTL_REMEMBER = 30 * 24 * 3600_000
const SESSION_TTL_BROWSER = 12 * 3600_000
const MAX_BODY = 64 * 1024
const MAX_FAILS = 8
const LOCK_MS = 15 * 60_000

mkdirSync(DATA_DIR, { recursive: true })
if (!existsSync(SECRET_PATH)) {
  writeFileSync(SECRET_PATH, randomBytes(32).toString('hex'), { encoding: 'utf8', mode: 0o600 })
}
const SECRET = readFileSync(SECRET_PATH, 'utf8').trim()
if (SECRET.length < 32) {
  console.error('portal-auth: secret is too short:', SECRET_PATH)
  process.exit(1)
}

const db = new DatabaseSync(DB_PATH)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id                  TEXT PRIMARY KEY,
    email               TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    display_name        TEXT NOT NULL DEFAULT '',
    marketing_consent   INTEGER NOT NULL DEFAULT 0,
    marketing_consent_at TEXT,
    consent_version     TEXT,
    consent_at          TEXT,
    ref_code            TEXT,
    session_version     INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    last_sign_in_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name        TEXT NOT NULL DEFAULT '',
    hh_username         TEXT NOT NULL DEFAULT '',
    avito_username      TEXT NOT NULL DEFAULT '',
    hh_applicant_id     TEXT NOT NULL DEFAULT '',
    avito_user_id       TEXT NOT NULL DEFAULT '',
    subscription_expire TEXT,
    avatar_url          TEXT NOT NULL DEFAULT '',
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS consents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    version     TEXT NOT NULL,
    granted     INTEGER NOT NULL,
    granted_at  TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'web',
    UNIQUE (user_id, kind, version, granted, granted_at)
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(user_id);
`)

console.log(`portal-auth: db=${DB_PATH}`)
console.log(`portal-auth: listen=http://${HOST}:${PORT}`)

// ── Пароли и сессии ──────────────────────────────────────────────────
function newId() {
  return 'pu_' + randomBytes(16).toString('hex')
}
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
function verifyPassword(password, stored) {
  try {
    const [salt, hex] = String(stored || '').split(':')
    if (!salt || !hex) return false
    const expected = Buffer.from(hex, 'hex')
    const actual = scryptSync(password, salt, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
function signToken(uid, sv, ttlMs) {
  const payload = { uid, sv, exp: Date.now() + ttlMs }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}
function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.')
    if (!body || !sig) return null
    const expected = createHmac('sha256', SECRET).update(body).digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!payload || !payload.uid || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
function parseCookies(header) {
  const out = {}
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=')
    if (i < 0) return
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  })
  return out
}
function getTokenFromRequest(req) {
  const auth = String(req.headers.authorization || '')
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null
}
function getSession(req) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload) return null
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid)
  if (!user) return null
  if (Number(user.session_version) !== Number(payload.sv)) return null
  return { user, payload }
}
function isSecure(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted
}
function setSessionCookie(req, res, userId, sessionVersion, remember) {
  const ttl = remember ? SESSION_TTL_REMEMBER : SESSION_TTL_BROWSER
  const token = signToken(userId, sessionVersion, ttl)
  let cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax`
  if (isSecure(req)) cookie += '; Secure'
  if (remember) cookie += `; Max-Age=${Math.floor(ttl / 1000)}`
  res.setHeader('Set-Cookie', cookie)
}
function clearSessionCookie(req, res) {
  let cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  if (isSecure(req)) cookie += '; Secure'
  res.setHeader('Set-Cookie', cookie)
}

// ── DTO ───────────────────────────────────────────────────────────────
function userDTO(row) {
  return {
    id: row.id,
    email: row.email,
    created_at: row.created_at,
    last_sign_in_at: row.last_sign_in_at || null,
    email_confirmed_at: row.created_at,
    user_metadata: {
      display_name: row.display_name || '',
      marketing_consent: !!row.marketing_consent,
      marketing_consent_at: row.marketing_consent_at || null,
      consent_accepted: !!row.consent_at,
      consent_version: row.consent_version || null,
      consent_at: row.consent_at || null,
      ref_code: row.ref_code || null,
    },
    app_metadata: { provider: 'email', providers: ['email'] },
  }
}
function profileDTO(row) {
  if (!row) return null
  return {
    id: row.user_id,
    web_user_id: row.user_id,
    display_name: row.display_name || '',
    hh_username: row.hh_username || '',
    avito_username: row.avito_username || '',
    hh_applicant_id: row.hh_applicant_id || '',
    avito_user_id: row.avito_user_id || '',
    subscription_expire: row.subscription_expire || null,
    avatar_url: row.avatar_url || '',
  }
}
function ensureProfile(user) {
  db.prepare(`
    INSERT OR IGNORE INTO profiles (user_id, display_name, updated_at)
    VALUES (?, ?, ?)
  `).run(user.id, user.display_name || '', new Date().toISOString())
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id)
}

// ── Демо-учётка ───────────────────────────────────────────────────────
function seedDemo() {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(DEMO_EMAIL)
  if (existing) {
    ensureProfile(existing)
    return
  }
  const id = newId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, marketing_consent,
                       consent_version, consent_at, created_at, last_sign_in_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(id, DEMO_EMAIL, hashPassword(DEMO_PASSWORD), 'Демо-доступ Vacantrix',
         CONSENT_VERSION, now, now, now)
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?, ?, ?)')
    .run(id, 'Демо-доступ Vacantrix', now)
  db.prepare(`
    INSERT OR IGNORE INTO consents (user_id, kind, version, granted, granted_at, source)
    VALUES (?, 'terms', ?, 1, ?, 'seed')
  `).run(id, CONSENT_VERSION, now)
  console.log(`portal-auth: seeded demo account ${DEMO_EMAIL}`)
}
seedDemo()

// ── HTTP-помощники ────────────────────────────────────────────────────
function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': body.length,
    ...extraHeaders,
  })
  res.end(body)
}
function sendError(res, status, message, code) {
  sendJson(res, status, code ? { error: message, code } : { error: message })
}
async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('Слишком большой запрос.'), { status: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Некорректный JSON.'), { status: 400 })
  }
}
function normEmail(value) {
  return String(value || '').trim().toLowerCase()
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}
function clientIp(req) {
  return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local')
    .split(',')[0].trim()
}
function originAllowed(req) {
  const origin = req.headers.origin
  if (!origin) return true // curl / same-origin without Origin
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'vacantrix.ru' || host === 'www.vacantrix.ru' ||
           host === 'logistiksite.vacantrix.ru' || host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}
function requireAuth(req, res) {
  const session = getSession(req)
  if (!session) {
    sendError(res, 401, 'Сессия истекла — войдите заново.', 'unauthorized')
    return null
  }
  return session
}

// ── Ограничение попыток входа ─────────────────────────────────────────
const fails = new Map()
function failKey(req, email) {
  return `${clientIp(req)}|${email}`
}
function isLocked(key) {
  const rec = fails.get(key)
  if (!rec) return false
  if (Date.now() > rec.until) {
    fails.delete(key)
    return false
  }
  return rec.count >= MAX_FAILS
}
function noteFail(key) {
  const now = Date.now()
  const rec = fails.get(key)
  if (!rec || now > rec.until) {
    fails.set(key, { count: 1, until: now + LOCK_MS })
    return
  }
  rec.count += 1
  rec.until = now + LOCK_MS
}
function clearFails(key) {
  fails.delete(key)
}

// ── Маршруты ──────────────────────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method || 'GET'

  if (method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET,POST,PUT,OPTIONS' })
    res.end()
    return
  }
  if (pathname.startsWith('/api/portal/') && method !== 'GET' && !originAllowed(req)) {
    sendError(res, 403, 'Запрос с чужого сайта отклонён.', 'forbidden_origin')
    return
  }

  if (pathname === '/api/portal/health' && method === 'GET') {
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
    sendJson(res, 200, { ok: true, service: 'portal-auth', version: '1.0.0', users })
    return
  }

  if (pathname === '/api/portal/register' && method === 'POST') {
    const body = await readJson(req)
    const email = normEmail(body.email)
    const password = String(body.password || '')
    if (!validEmail(email)) { sendError(res, 400, 'Введите корректный email.', 'bad_email'); return }
    if (password.length < 6) { sendError(res, 400, 'Пароль — минимум 6 символов.', 'weak_password'); return }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      sendError(res, 409, 'Этот email уже зарегистрирован.', 'already_registered')
      return
    }
    const now = new Date().toISOString()
    const id = newId()
    const displayName = String(body.displayName || '').trim().slice(0, 80) || email.split('@')[0]
    const marketing = !!body.marketing
    const refCode = String(body.refCode || '').trim().slice(0, 64) || null
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, marketing_consent,
                         marketing_consent_at, consent_version, consent_at, ref_code,
                         created_at, last_sign_in_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, hashPassword(password), displayName,
           marketing ? 1 : 0, marketing ? now : null,
           CONSENT_VERSION, now, refCode, now, now)
    db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?, ?, ?)')
      .run(id, displayName, now)
    db.prepare(`
      INSERT OR IGNORE INTO consents (user_id, kind, version, granted, granted_at, source)
      VALUES (?, 'terms', ?, 1, ?, 'web')
    `).run(id, CONSENT_VERSION, now)
    if (marketing) {
      db.prepare(`
        INSERT OR IGNORE INTO consents (user_id, kind, version, granted, granted_at, source)
        VALUES (?, 'marketing', ?, 1, ?, 'web')
      `).run(id, CONSENT_VERSION, now)
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    setSessionCookie(req, res, user.id, user.session_version, true)
    sendJson(res, 201, { ok: true, user: userDTO(user), needsConfirmation: false })
    return
  }

  if (pathname === '/api/portal/login' && method === 'POST') {
    const body = await readJson(req)
    const email = normEmail(body.email)
    const password = String(body.password || '')
    if (!validEmail(email) || !password) {
      sendError(res, 400, 'Укажите email и пароль.', 'bad_credentials')
      return
    }
    const key = failKey(req, email)
    if (isLocked(key)) {
      sendError(res, 429, 'Слишком много попыток. Подождите 15 минут и попробуйте снова.', 'rate_limited')
      return
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!user || !verifyPassword(password, user.password_hash)) {
      noteFail(key)
      sendError(res, 401, 'Неверный email или пароль.', 'invalid_login')
      return
    }
    clearFails(key)
    const now = new Date().toISOString()
    db.prepare('UPDATE users SET last_sign_in_at = ? WHERE id = ?').run(now, user.id)
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    ensureProfile(fresh)
    setSessionCookie(req, res, fresh.id, fresh.session_version, !!body.remember)
    sendJson(res, 200, { ok: true, user: userDTO(fresh), needsOtp: false })
    return
  }

  if (pathname === '/api/portal/logout' && method === 'POST') {
    const session = getSession(req)
    if (session && url.searchParams.get('scope') === 'global') {
      db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(session.user.id)
    }
    clearSessionCookie(req, res)
    sendJson(res, 200, { ok: true })
    return
  }

  if (pathname === '/api/portal/me' && method === 'GET') {
    const session = getSession(req)
    // 200 + user:null вместо 401: отсутствие сессии — штатное состояние,
    // а 401 в консоли браузера выглядел бы как ошибка.
    sendJson(res, 200, { user: session ? userDTO(session.user) : null })
    return
  }

  if (pathname === '/api/portal/token' && method === 'GET') {
    const session = requireAuth(req, res)
    if (!session) return
    const ttl = 5 * 60_000
    sendJson(res, 200, {
      token: signToken(session.user.id, session.user.session_version, ttl),
      expires_at: new Date(Date.now() + ttl).toISOString(),
    })
    return
  }

  if (pathname === '/api/portal/profile' && method === 'GET') {
    const session = requireAuth(req, res)
    if (!session) return
    sendJson(res, 200, { profile: profileDTO(ensureProfile(session.user)) })
    return
  }

  if (pathname === '/api/portal/profile' && (method === 'PUT' || method === 'POST')) {
    const session = requireAuth(req, res)
    if (!session) return
    const body = await readJson(req)
    const displayName = String(body.display_name ?? body.displayName ?? '').trim().slice(0, 80)
    const now = new Date().toISOString()
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, session.user.id)
    ensureProfile(session.user)
    db.prepare('UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ?')
      .run(displayName, now, session.user.id)
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user.id)
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(session.user.id)
    sendJson(res, 200, { ok: true, profile: profileDTO(profile), user: userDTO(fresh) })
    return
  }

  if (pathname === '/api/portal/profile/link' && method === 'POST') {
    const session = requireAuth(req, res)
    if (!session) return
    const body = await readJson(req)
    const kind = String(body.kind || '').toLowerCase()
    const externalId = String(body.externalId || body.external_id || '').trim().slice(0, 120)
    if (!externalId) { sendError(res, 400, 'Укажите ID аккаунта.', 'bad_external_id'); return }
    if (!['hh', 'avito'].includes(kind)) { sendError(res, 400, 'Неизвестный сервис.', 'bad_kind'); return }
    ensureProfile(session.user)
    const column = kind === 'hh' ? 'hh_applicant_id' : 'avito_user_id'
    db.prepare(`UPDATE profiles SET ${column} = ?, updated_at = ? WHERE user_id = ?`)
      .run(externalId, new Date().toISOString(), session.user.id)
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(session.user.id)
    sendJson(res, 200, { ok: true, profile: profileDTO(profile) })
    return
  }

  if (pathname === '/api/portal/profile/unlink' && method === 'POST') {
    const session = requireAuth(req, res)
    if (!session) return
    ensureProfile(session.user)
    db.prepare(`
      UPDATE profiles
         SET hh_applicant_id = '', avito_user_id = '',
             hh_username = '', avito_username = '', updated_at = ?
       WHERE user_id = ?
    `).run(new Date().toISOString(), session.user.id)
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(session.user.id)
    sendJson(res, 200, { ok: true, profile: profileDTO(profile) })
    return
  }

  if (pathname === '/api/portal/password' && method === 'POST') {
    const session = requireAuth(req, res)
    if (!session) return
    const body = await readJson(req)
    const currentPassword = body.currentPassword == null ? null : String(body.currentPassword)
    const newPassword = String(body.newPassword || '')
    if (newPassword.length < 6) { sendError(res, 400, 'Новый пароль — минимум 6 символов.', 'weak_password'); return }
    if (currentPassword !== null) {
      if (!verifyPassword(currentPassword, session.user.password_hash)) {
        sendError(res, 400, 'Текущий пароль неверен.', 'bad_current')
        return
      }
      if (currentPassword === newPassword) {
        sendError(res, 400, 'Новый пароль совпадает с текущим.', 'same_password')
        return
      }
    }
    const nextVersion = Number(session.user.session_version) + 1
    db.prepare('UPDATE users SET password_hash = ?, session_version = ? WHERE id = ?')
      .run(hashPassword(newPassword), nextVersion, session.user.id)
    // Текущая вкладка остаётся в системе, остальные сессии становятся недействительными.
    setSessionCookie(req, res, session.user.id, nextVersion, true)
    sendJson(res, 200, { ok: true })
    return
  }

  if (pathname === '/api/portal/email' && method === 'POST') {
    const session = requireAuth(req, res)
    if (!session) return
    const body = await readJson(req)
    const email = normEmail(body.email)
    if (!validEmail(email)) { sendError(res, 400, 'Введите корректный email.', 'bad_email'); return }
    if (email === session.user.email) { sendError(res, 400, 'Это ваш текущий email.', 'same_email'); return }
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, session.user.id)
    if (taken) { sendError(res, 409, 'Этот email уже зарегистрирован.', 'already_registered'); return }
    // Почта не подтверждается письмом: адрес меняется сразу.
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, session.user.id)
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user.id)
    sendJson(res, 200, { ok: true, user: userDTO(fresh) })
    return
  }

  if (pathname === '/api/portal/marketing' && method === 'POST') {
    const session = requireAuth(req, res)
    if (!session) return
    const body = await readJson(req)
    const optIn = !!body.optIn
    const now = new Date().toISOString()
    db.prepare('UPDATE users SET marketing_consent = ?, marketing_consent_at = ? WHERE id = ?')
      .run(optIn ? 1 : 0, optIn ? now : null, session.user.id)
    db.prepare(`
      INSERT OR IGNORE INTO consents (user_id, kind, version, granted, granted_at, source)
      VALUES (?, 'marketing', ?, ?, ?, 'web')
    `).run(session.user.id, CONSENT_VERSION, optIn ? 1 : 0, now)
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user.id)
    sendJson(res, 200, { ok: true, user: userDTO(fresh) })
    return
  }

  if (pathname === '/api/portal/delete' && method === 'POST') {
    const session = requireAuth(req, res)
    if (!session) return
    db.prepare('DELETE FROM consents WHERE user_id = ?').run(session.user.id)
    db.prepare('DELETE FROM profiles WHERE user_id = ?').run(session.user.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(session.user.id)
    clearSessionCookie(req, res)
    sendJson(res, 200, { ok: true })
    return
  }

  if (pathname === '/api/portal/export' && method === 'GET') {
    const session = requireAuth(req, res)
    if (!session) return
    const profile = ensureProfile(session.user)
    sendJson(res, 200, {
      exported_at: new Date().toISOString(),
      source: 'vacantrix.ru',
      account: userDTO(session.user),
      profile: profileDTO(profile),
      subscriptions: [],
    })
    return
  }

  sendError(res, 404, 'Не найдено.', 'not_found')
}

const server = http.createServer((req, res) => {
  const started = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - started
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> ${res.statusCode} ${ms}ms`)
  })
  handle(req, res).catch(err => {
    const status = Number(err && err.status) || 500
    if (status >= 500) console.error('portal-auth error:', err)
    if (!res.headersSent) sendError(res, status, status >= 500 ? 'Внутренняя ошибка сервиса.' : err.message)
    else res.end()  })
})

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.listen(PORT, HOST, () => {
  console.log(`portal-auth: ready http://${HOST}:${PORT}/api/portal/health`)
})

function shutdown() {
  console.log('portal-auth: stopping')
  server.close(() => {
    try { db.close() } catch {}
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

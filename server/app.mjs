import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import webPush from 'web-push';
import { aiEnabled, recognizeImage } from './ai.mjs';

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'med_session';
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;
const COLORS = new Set(['sage', 'amber', 'blue', 'rose']);
const RECORD_STATUSES = new Set(['taken', 'skipped', 'snoozed']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value.includes('/') || value === 'UTC';
  } catch {
    return false;
  }
}

function zonedParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

export function localDateTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  const exactCandidates = new Set();
  for (const probe of [wanted - 36 * 60 * 60_000, wanted, wanted + 36 * 60 * 60_000]) {
    const probeParts = zonedParts(new Date(probe), timeZone);
    const offset = Date.UTC(probeParts.year, probeParts.month - 1, probeParts.day,
      probeParts.hour, probeParts.minute, probeParts.second) - probe;
    const candidate = wanted - offset;
    const candidateParts = zonedParts(new Date(candidate), timeZone);
    if (candidateParts.year === year && candidateParts.month === month && candidateParts.day === day
      && candidateParts.hour === hour && candidateParts.minute === minute && candidateParts.second === 0) {
      exactCandidates.add(candidate);
    }
  }
  if (exactCandidates.size) return new Date(Math.min(...exactCandidates)).toISOString();

  let guess = wanted;
  const candidates = new Set([guess]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const delta = wanted - actualAsUtc;
    if (delta === 0) return new Date(guess).toISOString();
    const next = guess + delta;
    if (candidates.has(next)) {
      // DST spring gaps oscillate around the missing wall time. Choosing the later
      // candidate moves the reminder forward by the gap (02:30 -> 03:30).
      return new Date(Math.max(guess, next)).toISOString();
    }
    candidates.add(next);
    guess = next;
  }
  return new Date(Math.max(...candidates)).toISOString();
}

export function dateInTimeZone(instant, timeZone) {
  const parts = zonedParts(instant, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function text(value, field, { required = false, max = 2000 } = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw httpError(400, `${field}格式不正确。`);
  const result = value.trim();
  if (required && !result) throw httpError(400, `请填写${field}。`);
  if (result.length > max) throw httpError(400, `${field}内容过长。`);
  return result;
}

function normalizeEmail(value) {
  const email = text(value, '邮箱', { required: true, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, '邮箱格式不正确。');
  return email;
}

function rawPassword(value, { registration = false } = {}) {
  if (typeof value !== 'string' || !value) throw httpError(400, '请填写密码。');
  if (value.length > 128) throw httpError(400, '密码内容过长。');
  if (registration && value.length < 8) throw httpError(400, '密码至少需要 8 位。');
  return value;
}

function normalizeMedication(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, '药品信息格式不正确。');
  const allowed = new Set(['name', 'specification', 'expiryDate', 'instructions', 'dose', 'times', 'startDate', 'endDate', 'notes', 'color']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw httpError(400, '药品信息包含不允许的字段。');
  const startDate = text(body.startDate, '开始日期', { required: true, max: 10 });
  const expiryDate = text(body.expiryDate, '有效期', { max: 10 });
  const endDate = text(body.endDate, '结束日期', { max: 10 });
  if (!validDate(startDate)) throw httpError(400, '开始日期格式不正确。');
  if (expiryDate && !validDate(expiryDate)) throw httpError(400, '有效期格式不正确。');
  if (endDate && (!validDate(endDate) || endDate < startDate)) throw httpError(400, '结束日期不能早于开始日期。');
  if (!Array.isArray(body.times) || body.times.length < 1 || body.times.length > 8 || body.times.some((item) => typeof item !== 'string' || !TIME_RE.test(item))) {
    throw httpError(400, '每天服药时间需为 1 到 8 个 HH:mm 时间。');
  }
  const times = [...new Set(body.times)].sort();
  if (times.length !== body.times.length) throw httpError(400, '每天服药时间不能重复。');
  const color = text(body.color, '颜色', { required: true, max: 10 });
  if (!COLORS.has(color)) throw httpError(400, '药品颜色不正确。');
  return {
    name: text(body.name, '药品名称', { required: true, max: 120 }),
    specification: text(body.specification, '规格', { max: 200 }),
    expiryDate,
    instructions: text(body.instructions, '说明', { max: 6000 }),
    dose: text(body.dose, '剂量', { required: true, max: 120 }),
    times,
    startDate,
    endDate,
    notes: text(body.notes, '备注', { max: 500 }),
    color,
  };
}

function medicationDto(row) {
  return {
    id: row.id,
    name: row.name,
    specification: row.specification,
    expiryDate: row.expiry_date,
    instructions: row.instructions,
    dose: row.dose,
    times: JSON.parse(row.times),
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
    color: row.color,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

function cookieMap(header = '') {
  const values = {};
  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    if (separator > 0) values[segment.slice(0, separator).trim()] = decodeURIComponent(segment.slice(separator + 1).trim());
  }
  return values;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString('hex')}`;
}

async function matchesPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(':');
  if (!salt || !expectedHex) return false;
  const actual = Buffer.from((await hashPassword(password, salt)).split(':')[1], 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function openDatabase(dbPath = path.resolve('data', 'medications.sqlite')) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      time_zone TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS medications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, specification TEXT NOT NULL, expiry_date TEXT NOT NULL,
      instructions TEXT NOT NULL, dose TEXT NOT NULL, times TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, notes TEXT NOT NULL,
      color TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS medications_user ON medications(user_id, active);
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      medication_id TEXT NOT NULL REFERENCES medications(id), date TEXT NOT NULL, time TEXT NOT NULL,
      status TEXT NOT NULL, recorded_at TEXT NOT NULL, snoozed_until TEXT NOT NULL DEFAULT '',
      medication_name TEXT NOT NULL DEFAULT '', dose_snapshot TEXT NOT NULL DEFAULT '',
      UNIQUE(user_id, medication_id, date, time)
    );
    CREATE INDEX IF NOT EXISTS records_user_date ON records(user_id, date);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      subscription TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id);
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_endpoint TEXT NOT NULL, notification_key TEXT NOT NULL, sent_at TEXT NOT NULL,
      PRIMARY KEY(subscription_endpoint, notification_key)
    );
  `);
  const recordColumns = new Set(db.prepare('PRAGMA table_info(records)').all().map((column) => column.name));
  if (!recordColumns.has('medication_name')) db.exec("ALTER TABLE records ADD COLUMN medication_name TEXT NOT NULL DEFAULT ''");
  if (!recordColumns.has('dose_snapshot')) db.exec("ALTER TABLE records ADD COLUMN dose_snapshot TEXT NOT NULL DEFAULT ''");
  db.exec(`UPDATE records SET medication_name=COALESCE(NULLIF(medication_name,''),
    (SELECT name FROM medications WHERE medications.id=records.medication_id)),
    dose_snapshot=COALESCE(NULLIF(dose_snapshot,''),
    (SELECT dose FROM medications WHERE medications.id=records.medication_id))
    WHERE medication_name='' OR dose_snapshot=''`);
  return db;
}

function userDto(row) {
  return { id: row.id, email: row.email, name: row.name, timeZone: row.time_zone };
}

function pushEndpointAllowed(endpoint) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === 'fcm.googleapis.com'
      || host === 'updates.push.services.mozilla.com'
      || host === 'push.services.mozilla.com'
      || host === 'web.push.apple.com'
      || host.endsWith('.push.apple.com')
      || host === 'wns.notify.windows.com'
      || host.endsWith('.notify.windows.com');
  } catch {
    return false;
  }
}

function normalizeSubscription(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, '推送订阅格式不正确。');
  const endpoint = text(body.endpoint, '推送地址', { required: true, max: 3000 });
  if (!pushEndpointAllowed(endpoint)) throw httpError(400, '推送地址不是受支持的浏览器推送服务。');
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (typeof p256dh !== 'string' || !p256dh || typeof auth !== 'string' || !auth) throw httpError(400, '推送订阅密钥不完整。');
  return { endpoint, expirationTime: body.expirationTime ?? null, keys: { p256dh, auth } };
}

function configurePush({ env, keysPath, webPushImpl }) {
  let publicKey = env.VAPID_PUBLIC_KEY?.trim();
  let privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if ((!publicKey || !privateKey) && keysPath && fs.existsSync(keysPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
      publicKey = saved.publicKey;
      privateKey = saved.privateKey;
    } catch { /* Regenerate invalid local key data. */ }
  }
  if (!publicKey || !privateKey) {
    const generated = webPushImpl.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    if (keysPath) {
      fs.mkdirSync(path.dirname(keysPath), { recursive: true });
      fs.writeFileSync(keysPath, `${JSON.stringify({ publicKey, privateKey }, null, 2)}\n`, { mode: 0o600 });
    }
  }
  webPushImpl.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey, privateKey);
  return { publicKey, enabled: true };
}

function occurrenceFor(medication, record, date, time, timeZone) {
  const scheduledAt = localDateTimeToUtc(date, time, timeZone);
  return {
    id: `${medication.id}:${date}:${time}`,
    medicationId: medication.id,
    date,
    time,
    scheduledAt,
    status: record?.status || 'pending',
    snoozedUntil: record?.snoozed_until || '',
    medication: medicationDto(medication),
  };
}

export function createApp({
  dbPath = path.resolve('data', 'medications.sqlite'),
  db: suppliedDb,
  env = process.env,
  now = () => new Date(),
  keysPath = path.resolve('data', 'keys.json'),
  webPushImpl = webPush,
  recognizeImpl = recognizeImage,
} = {}) {
  const db = suppliedDb || openDatabase(dbPath);
  const ownsDb = !suppliedDb;
  const push = configurePush({ env, keysPath, webPushImpl });
  const app = express();
  const authAttempts = new Map();
  const pushTestAttempts = new Map();
  const consumeAttempt = (bucket, key, maximum, windowMs, message) => {
    const timestamp = now().getTime();
    const recent = (bucket.get(key) || []).filter((item) => timestamp - item < windowMs);
    if (recent.length >= maximum) throw httpError(429, message);
    recent.push(timestamp);
    bucket.set(key, recent);
  };
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '12mb', type: 'application/json' }));
  app.use((req, _res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next();
    const expected = env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (origin !== expected) return next(httpError(403, '请求来源校验失败。'));
    next();
  });

  const requireAuth = (req, _res, next) => {
    const authorizationPresent = req.headers.authorization !== undefined;
    let sessionId;
    if (authorizationPresent) {
      const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
      if (!match) return next(httpError(401, '请先登录。'));
      const digest = crypto.createHash('sha256').update(match[1]).digest('hex');
      sessionId = `native:${digest}`;
    } else {
      sessionId = cookieMap(req.get('cookie'))[COOKIE_NAME];
      if (sessionId && !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return next(httpError(401, '请先登录。'));
    }
    const row = sessionId ? db.prepare(`
      SELECT s.id AS session_id, u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?
    `).get(sessionId, now().toISOString()) : null;
    if (!row) return next(httpError(401, '请先登录。'));
    req.auth = { sessionId: row.session_id, user: row };
    next();
  };

  const setSession = (res, userId) => {
    const id = crypto.randomBytes(32).toString('base64url');
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + SESSION_AGE_SECONDS * 1000);
    db.prepare('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)')
      .run(id, userId, expiresAt.toISOString(), createdAt.toISOString());
    res.cookie(COOKIE_NAME, id, {
      httpOnly: true, sameSite: 'strict', secure: env.NODE_ENV === 'production',
      path: '/', maxAge: SESSION_AGE_SECONDS * 1000,
    });
  };

  const createNativeSession = (userId) => {
    const accessToken = crypto.randomBytes(32).toString('hex');
    const id = `native:${crypto.createHash('sha256').update(accessToken).digest('hex')}`;
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + SESSION_AGE_SECONDS * 1000);
    db.prepare('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)')
      .run(id, userId, expiresAt.toISOString(), createdAt.toISOString());
    return { accessToken, expiresAt: expiresAt.toISOString() };
  };

  app.get('/api/health', (_req, res) => res.json({ data: { ok: true } }));

  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      consumeAttempt(authAttempts, `register:${req.ip}:${email}`, 10, 60 * 60_000, '注册尝试过于频繁，请稍后再试。');
      const password = rawPassword(req.body?.password, { registration: true });
      const name = text(req.body?.name, '昵称', { required: true, max: 80 });
      const timeZone = text(req.body?.timeZone, '时区', { required: true, max: 100 });
      if (!validTimeZone(timeZone)) throw httpError(400, '请选择有效的 IANA 时区。');
      const user = { id: crypto.randomUUID(), email, name, timeZone, createdAt: now().toISOString() };
      const passwordHash = await hashPassword(password);
      try {
        db.prepare('INSERT INTO users (id,email,name,time_zone,password_hash,created_at) VALUES (?,?,?,?,?,?)')
          .run(user.id, email, name, timeZone, passwordHash, user.createdAt);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw httpError(409, '该邮箱已注册。');
        throw error;
      }
      setSession(res, user.id);
      res.status(201).json({ data: userDto({ id: user.id, email, name, time_zone: timeZone }) });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const attemptKey = `login:${req.ip}:${email}`;
      consumeAttempt(authAttempts, attemptKey, 8, 15 * 60_000, '登录尝试过于频繁，请稍后再试。');
      const password = rawPassword(req.body?.password);
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !(await matchesPassword(password, user.password_hash))) throw httpError(401, '邮箱或密码不正确。');
      authAttempts.delete(attemptKey);
      setSession(res, user.id);
      res.json({ data: userDto(user) });
    } catch (error) { next(error); }
  });

  app.post('/api/native/auth/register', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      consumeAttempt(authAttempts, `register:${req.ip}:${email}`, 10, 60 * 60_000, '注册尝试过于频繁，请稍后再试。');
      const password = rawPassword(req.body?.password, { registration: true });
      const name = text(req.body?.name, '昵称', { required: true, max: 80 });
      const timeZone = text(req.body?.timeZone, '时区', { required: true, max: 100 });
      if (!validTimeZone(timeZone)) throw httpError(400, '请选择有效的 IANA 时区。');
      const user = { id: crypto.randomUUID(), email, name, timeZone, createdAt: now().toISOString() };
      const passwordHash = await hashPassword(password);
      try {
        db.prepare('INSERT INTO users (id,email,name,time_zone,password_hash,created_at) VALUES (?,?,?,?,?,?)')
          .run(user.id, email, name, timeZone, passwordHash, user.createdAt);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw httpError(409, '该邮箱已注册。');
        throw error;
      }
      const session = createNativeSession(user.id);
      res.status(201).json({ data: { user: userDto({ id: user.id, email, name, time_zone: timeZone }), ...session } });
    } catch (error) { next(error); }
  });

  app.post('/api/native/auth/login', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const attemptKey = `login:${req.ip}:${email}`;
      consumeAttempt(authAttempts, attemptKey, 8, 15 * 60_000, '登录尝试过于频繁，请稍后再试。');
      const password = rawPassword(req.body?.password);
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !(await matchesPassword(password, user.password_hash))) throw httpError(401, '邮箱或密码不正确。');
      authAttempts.delete(attemptKey);
      const session = createNativeSession(user.id);
      res.json({ data: { user: userDto(user), ...session } });
    } catch (error) { next(error); }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ data: userDto(req.auth.user) }));

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    db.prepare('DELETE FROM push_subscriptions WHERE session_id = ?').run(req.auth.sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.auth.sessionId);
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: env.NODE_ENV === 'production', path: '/' });
    res.json({ data: { ok: true } });
  });

  app.get('/api/medications', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM medications WHERE user_id = ? AND active = 1 ORDER BY created_at DESC').all(req.auth.user.id);
    res.json({ data: rows.map(medicationDto) });
  });

  app.post('/api/medications', requireAuth, (req, res, next) => {
    try {
      const medication = normalizeMedication(req.body);
      const id = crypto.randomUUID();
      const createdAt = now().toISOString();
      db.prepare(`INSERT INTO medications
        (id,user_id,name,specification,expiry_date,instructions,dose,times,start_date,end_date,notes,color,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
        .run(id, req.auth.user.id, medication.name, medication.specification, medication.expiryDate, medication.instructions,
          medication.dose, JSON.stringify(medication.times), medication.startDate, medication.endDate, medication.notes,
          medication.color, createdAt, createdAt);
      const row = db.prepare('SELECT * FROM medications WHERE id = ?').get(id);
      res.status(201).json({ data: medicationDto(row) });
    } catch (error) { next(error); }
  });

  app.put('/api/medications/:id', requireAuth, (req, res, next) => {
    try {
      const medication = normalizeMedication(req.body);
      const result = db.prepare(`UPDATE medications SET name=?,specification=?,expiry_date=?,instructions=?,dose=?,times=?,
        start_date=?,end_date=?,notes=?,color=?,updated_at=? WHERE id=? AND user_id=? AND active=1`)
        .run(medication.name, medication.specification, medication.expiryDate, medication.instructions, medication.dose,
          JSON.stringify(medication.times), medication.startDate, medication.endDate, medication.notes, medication.color,
          now().toISOString(), req.params.id, req.auth.user.id);
      if (!result.changes) throw httpError(404, '未找到该药品。');
      res.json({ data: medicationDto(db.prepare('SELECT * FROM medications WHERE id = ?').get(req.params.id)) });
    } catch (error) { next(error); }
  });

  app.delete('/api/medications/:id', requireAuth, (req, res, next) => {
    try {
      const result = db.prepare('UPDATE medications SET active=0,updated_at=? WHERE id=? AND user_id=? AND active=1')
        .run(now().toISOString(), req.params.id, req.auth.user.id);
      if (!result.changes) throw httpError(404, '未找到该药品。');
      res.json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  app.get('/api/today', requireAuth, (req, res, next) => {
    try {
      const date = req.query.date == null ? dateInTimeZone(now(), req.auth.user.time_zone) : String(req.query.date);
      if (!validDate(date)) throw httpError(400, '日期格式不正确。');
      const medications = db.prepare(`SELECT * FROM medications WHERE user_id=? AND active=1 AND start_date<=?
        AND (end_date='' OR end_date>=?) ORDER BY created_at,id`).all(req.auth.user.id, date, date);
      const records = db.prepare('SELECT * FROM records WHERE user_id=? AND date=?').all(req.auth.user.id, date);
      const byKey = new Map(records.map((record) => [`${record.medication_id}:${record.time}`, record]));
      const occurrences = medications.flatMap((medication) => JSON.parse(medication.times).map((time) =>
        occurrenceFor(medication, byKey.get(`${medication.id}:${time}`), date, time, req.auth.user.time_zone)));
      const dayStart = localDateTimeToUtc(date, '00:00', req.auth.user.time_zone);
      const dayEnd = localDateTimeToUtc(addDays(date, 1), '00:00', req.auth.user.time_zone);
      const carried = db.prepare(`SELECT r.*,m.*,
        r.id AS record_id,r.date AS record_date,r.time AS record_time,r.status AS record_status,
        r.snoozed_until AS record_snoozed_until,r.recorded_at AS record_recorded_at
        FROM records r JOIN medications m ON m.id=r.medication_id
        WHERE r.user_id=? AND m.active=1 AND r.status='snoozed' AND r.date<>?
          AND r.snoozed_until>=? AND r.snoozed_until<?`).all(req.auth.user.id, date, dayStart, dayEnd);
      for (const row of carried) {
        const record = {
          id: row.record_id, date: row.record_date, time: row.record_time,
          status: row.record_status, snoozed_until: row.record_snoozed_until, recorded_at: row.record_recorded_at,
        };
        occurrences.push(occurrenceFor(row, record, row.record_date, row.record_time, req.auth.user.time_zone));
      }
      occurrences.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      res.json({ data: occurrences });
    } catch (error) { next(error); }
  });

  app.get('/api/native/reminders', requireAuth, (req, res, next) => {
    try {
      const generatedAt = now();
      const horizon = generatedAt.getTime() + 7 * 86_400_000;
      const timeZone = req.auth.user.time_zone;
      const firstDate = dateInTimeZone(generatedAt, timeZone);
      const medications = db.prepare('SELECT * FROM medications WHERE user_id=? AND active=1 ORDER BY created_at,id')
        .all(req.auth.user.id);
      const records = db.prepare('SELECT * FROM records WHERE user_id=?').all(req.auth.user.id);
      const recordsByOccurrence = new Map(records.map((record) => [
        `${record.medication_id}:${record.date}:${record.time}`, record,
      ]));
      const medicationsById = new Map(medications.map((medication) => [medication.id, medication]));
      const reminders = new Map();
      const addReminder = (item) => {
        const timestamp = Date.parse(item.at);
        if (timestamp > generatedAt.getTime() && timestamp <= horizon && !reminders.has(item.key)) reminders.set(item.key, item);
      };

      for (let offset = 0; offset <= 8; offset += 1) {
        const date = addDays(firstDate, offset);
        for (const medication of medications) {
          if (medication.start_date <= date && (!medication.end_date || medication.end_date >= date)
            && (!medication.expiry_date || medication.expiry_date >= date)) {
            for (const time of JSON.parse(medication.times)) {
              const record = recordsByOccurrence.get(`${medication.id}:${date}:${time}`);
              if (record?.status === 'taken' || record?.status === 'skipped' || record?.status === 'snoozed') continue;
              const at = localDateTimeToUtc(date, time, timeZone);
              addReminder({
                key: `dose:${medication.id}:${date}:${time}:${at}`,
                kind: 'dose', title: '服药提醒', body: `${medication.name} · ${medication.dose}`, at,
                medicationId: medication.id, date, time,
              });
            }
          }
          if (medication.expiry_date) {
            const remaining = daysBetween(date, medication.expiry_date);
            if (remaining <= 30) {
              const at = localDateTimeToUtc(date, '09:00', timeZone);
              const body = remaining < 0
                ? `${medication.name} 已过期，请核查有效期。`
                : remaining === 0
                  ? `${medication.name} 今天到期，请核查有效期。`
                  : `${medication.name} 将在 ${remaining} 天后到期。`;
              addReminder({
                key: `expiry:${medication.id}:${date}`,
                kind: 'expiry', title: '药品有效期提醒', body, at,
                medicationId: medication.id, date, time: '09:00',
              });
            }
          }
        }
      }

      for (const record of records) {
        if (record.status !== 'snoozed' || !record.snoozed_until) continue;
        const medication = medicationsById.get(record.medication_id);
        if (!medication) continue;
        if (record.date < medication.start_date || (medication.end_date && record.date > medication.end_date)
          || !JSON.parse(medication.times).includes(record.time)) continue;
        const effectiveDate = dateInTimeZone(new Date(record.snoozed_until), timeZone);
        if (medication.expiry_date && medication.expiry_date < effectiveDate) continue;
        addReminder({
          key: `dose:${medication.id}:${record.date}:${record.time}:${record.snoozed_until}`,
          kind: 'dose', title: '延后服药提醒', body: `${medication.name} · ${medication.dose}`,
          at: record.snoozed_until, medicationId: medication.id, date: record.date, time: record.time,
        });
      }

      const allItems = [...reminders.values()].sort((left, right) =>
        left.at.localeCompare(right.at) || left.key.localeCompare(right.key));
      const items = allItems.slice(0, 30);
      res.json({
        data: {
          generatedAt: generatedAt.toISOString(), timeZone, items,
          total: allItems.length, hasMore: allItems.length > items.length,
        },
      });
    } catch (error) { next(error); }
  });

  app.post('/api/records', requireAuth, (req, res, next) => {
    try {
      const medicationId = text(req.body?.medicationId, '药品', { required: true, max: 100 });
      const date = text(req.body?.date, '日期', { required: true, max: 10 });
      const time = text(req.body?.time, '时间', { required: true, max: 5 });
      const status = text(req.body?.status, '状态', { required: true, max: 10 });
      if (!validDate(date) || !TIME_RE.test(time) || !RECORD_STATUSES.has(status)) throw httpError(400, '服药记录格式不正确。');
      const medication = db.prepare('SELECT * FROM medications WHERE id=? AND user_id=? AND active=1').get(medicationId, req.auth.user.id);
      if (!medication) throw httpError(404, '未找到该药品。');
      if (date < medication.start_date || (medication.end_date && date > medication.end_date) || !JSON.parse(medication.times).includes(time)) {
        throw httpError(400, '该日期或时间不在药品计划内。');
      }
      if (date > dateInTimeZone(now(), req.auth.user.time_zone)) throw httpError(400, '不能记录未来的服药日期。');
      const existing = db.prepare('SELECT * FROM records WHERE user_id=? AND medication_id=? AND date=? AND time=?')
        .get(req.auth.user.id, medicationId, date, time);
      if (existing && (existing.status === 'taken' || existing.status === 'skipped')) {
        if (existing.status !== status) throw httpError(409, '该服药任务已经完成，不能更改状态。');
        return res.json({ data: occurrenceFor(medication, existing, date, time, req.auth.user.time_zone) });
      }
      if (status === 'snoozed' && existing?.status === 'snoozed' && Date.parse(existing.snoozed_until) > now().getTime()) {
        return res.json({ data: occurrenceFor(medication, existing, date, time, req.auth.user.time_zone) });
      }
      const snoozedUntil = status === 'snoozed' ? new Date(now().getTime() + 15 * 60_000).toISOString() : '';
      const recordedAt = now().toISOString();
      if (existing) {
        db.prepare('UPDATE records SET status=?,recorded_at=?,snoozed_until=? WHERE id=?').run(status, recordedAt, snoozedUntil, existing.id);
      } else {
        db.prepare(`INSERT INTO records (id,user_id,medication_id,date,time,status,recorded_at,snoozed_until,medication_name,dose_snapshot)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), req.auth.user.id, medicationId, date, time, status,
          recordedAt, snoozedUntil, medication.name, medication.dose);
      }
      const record = db.prepare('SELECT * FROM records WHERE user_id=? AND medication_id=? AND date=? AND time=?')
        .get(req.auth.user.id, medicationId, date, time);
      res.json({ data: occurrenceFor(medication, record, date, time, req.auth.user.time_zone) });
    } catch (error) { next(error); }
  });

  app.get('/api/records', requireAuth, (req, res, next) => {
    try {
      const from = String(req.query.from || '');
      const to = String(req.query.to || '');
      if (!validDate(from) || !validDate(to) || from > to || daysBetween(from, to) > 366) throw httpError(400, '请选择有效且不超过一年的日期范围。');
      const rows = db.prepare(`SELECT r.*,COALESCE(NULLIF(r.medication_name,''),m.name) AS history_name,
        COALESCE(NULLIF(r.dose_snapshot,''),m.dose) AS history_dose FROM records r
        JOIN medications m ON m.id=r.medication_id WHERE r.user_id=? AND r.date BETWEEN ? AND ?
        ORDER BY r.date DESC,r.time DESC`).all(req.auth.user.id, from, to);
      res.json({ data: rows.map((row) => ({
        id: row.id, medicationId: row.medication_id, medicationName: row.history_name, dose: row.history_dose,
        date: row.date, time: row.time, status: row.status, recordedAt: row.recorded_at, snoozedUntil: row.snoozed_until,
      })) });
    } catch (error) { next(error); }
  });

  app.get('/api/config', (_req, res) => res.json({ data: { aiEnabled: aiEnabled(env), pushEnabled: push.enabled, vapidPublicKey: push.publicKey } }));

  const aiAttempts = new Map();
  app.post('/api/recognize', requireAuth, async (req, res, next) => {
    try {
      const timestamp = now().getTime();
      const recent = (aiAttempts.get(req.auth.user.id) || []).filter((item) => timestamp - item < 10 * 60_000);
      if (recent.length >= 5) throw httpError(429, '识别请求过于频繁，请稍后再试。');
      recent.push(timestamp);
      aiAttempts.set(req.auth.user.id, recent);
      const data = await recognizeImpl(req.body?.image, { env });
      res.json({ data });
    } catch (error) { next(error); }
  });

  app.post('/api/push/subscribe', requireAuth, (req, res, next) => {
    try {
      const subscription = normalizeSubscription(req.body);
      db.prepare(`INSERT INTO push_subscriptions (endpoint,user_id,session_id,subscription,created_at) VALUES (?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,
        subscription=excluded.subscription,created_at=excluded.created_at`)
        .run(subscription.endpoint, req.auth.user.id, req.auth.sessionId, JSON.stringify(subscription), now().toISOString());
      res.status(201).json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  app.get('/api/push/status', requireAuth, (req, res, next) => {
    try {
      const endpoint = text(req.query.endpoint, '推送地址', { required: true, max: 3000 });
      if (!pushEndpointAllowed(endpoint)) throw httpError(400, '推送地址不是受支持的浏览器推送服务。');
      const subscription = db.prepare(`SELECT 1 FROM push_subscriptions p JOIN sessions s ON s.id=p.session_id
        WHERE p.endpoint=? AND p.user_id=? AND s.expires_at>?`).get(endpoint, req.auth.user.id, now().toISOString());
      res.json({ data: { subscribed: Boolean(subscription) } });
    } catch (error) { next(error); }
  });

  app.post('/api/push/unsubscribe', requireAuth, (req, res, next) => {
    try {
      const endpoint = text(req.body?.endpoint, '推送地址', { required: true, max: 3000 });
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(endpoint, req.auth.user.id);
      res.json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  async function sendToUser(userId, notificationKey, payload, { sessionId } = {}) {
    const subscriptions = sessionId
      ? db.prepare(`SELECT p.* FROM push_subscriptions p JOIN sessions s ON s.id=p.session_id
          WHERE p.user_id=? AND p.session_id=? AND s.expires_at>?`).all(userId, sessionId, now().toISOString())
      : db.prepare(`SELECT p.* FROM push_subscriptions p JOIN sessions s ON s.id=p.session_id
          WHERE p.user_id=? AND s.expires_at>?`).all(userId, now().toISOString());
    let sentCount = 0;
    for (const row of subscriptions) {
      const sent = db.prepare('SELECT 1 FROM notification_deliveries WHERE subscription_endpoint=? AND notification_key=?').get(row.endpoint, notificationKey);
      if (sent) continue;
      try {
        await webPushImpl.sendNotification(JSON.parse(row.subscription), JSON.stringify(payload), { TTL: 60 * 60 });
        db.prepare('INSERT OR IGNORE INTO notification_deliveries (user_id,subscription_endpoint,notification_key,sent_at) VALUES (?,?,?,?)')
          .run(userId, row.endpoint, notificationKey, now().toISOString());
        sentCount += 1;
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(row.endpoint);
      }
    }
    return sentCount;
  }

  app.post('/api/push/test', requireAuth, async (req, res, next) => {
    try {
      consumeAttempt(pushTestAttempts, `${req.auth.user.id}:${req.auth.sessionId}`, 3, 10 * 60_000, '测试通知发送过于频繁，请稍后再试。');
      const subscriptions = db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id=? AND session_id=?')
        .get(req.auth.user.id, req.auth.sessionId).count;
      if (!subscriptions) throw httpError(400, '请先开启浏览器通知。');
      const sentCount = await sendToUser(req.auth.user.id, `test:${crypto.randomUUID()}`,
        { type: 'test', title: '用药提醒测试', body: '通知已成功开启。' }, { sessionId: req.auth.sessionId });
      if (!sentCount) throw httpError(502, '测试通知发送失败，请检查浏览器通知订阅后重试。');
      res.json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  const scanNotifications = async () => {
    const instant = now();
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(instant.toISOString());
    const users = db.prepare('SELECT * FROM users').all();
    for (const user of users) {
      const localDate = dateInTimeZone(instant, user.time_zone);
      const medications = db.prepare('SELECT * FROM medications WHERE user_id=? AND active=1').all(user.id);
      const records = db.prepare('SELECT * FROM records WHERE user_id=? AND date=?').all(user.id, localDate);
      const byKey = new Map(records.map((record) => [`${record.medication_id}:${record.time}`, record]));
      for (const medication of medications) {
        const scheduledToday = medication.start_date <= localDate && (!medication.end_date || medication.end_date >= localDate);
        if (scheduledToday) {
          for (const time of JSON.parse(medication.times)) {
            const record = byKey.get(`${medication.id}:${time}`);
            if (record?.status === 'taken' || record?.status === 'skipped') continue;
            const dueAt = record?.snoozed_until || localDateTimeToUtc(localDate, time, user.time_zone);
            if (Date.parse(dueAt) <= instant.getTime()) {
              const key = `dose:${medication.id}:${localDate}:${time}:${dueAt}`;
              const expired = Boolean(medication.expiry_date && medication.expiry_date < localDate);
              await sendToUser(user.id, key, {
                type: 'dose',
                title: expired ? '药品有效期核对' : '服药提醒',
                body: expired ? `${medication.name} 已过期，请核查有效期。` : `${medication.name} · ${medication.dose}`,
                medicationId: medication.id, date: localDate, time,
              });
            }
          }
        }
        if (medication.expiry_date) {
          const remaining = daysBetween(localDate, medication.expiry_date);
          if (remaining <= 30) {
            await sendToUser(user.id, `expiry:${medication.id}:${localDate}`, {
              type: 'expiry', title: '药品有效期提醒',
              body: remaining < 0 ? `${medication.name} 已过期，请核查有效期。` : `${medication.name} 将在 ${remaining} 天内到期。`,
              medicationId: medication.id,
            });
          }
        }
      }
      const carried = db.prepare(`SELECT r.*,m.name,m.dose,m.expiry_date FROM records r JOIN medications m ON m.id=r.medication_id
        WHERE r.user_id=? AND m.active=1 AND r.status='snoozed' AND r.date<? AND r.snoozed_until<=?`)
        .all(user.id, localDate, instant.toISOString());
      for (const record of carried) {
        const key = `dose:${record.medication_id}:${record.date}:${record.time}:${record.snoozed_until}`;
        const expired = Boolean(record.expiry_date && record.expiry_date < localDate);
        await sendToUser(user.id, key, {
          type: 'dose', title: expired ? '药品有效期核对' : '延后服药提醒',
          body: expired ? `${record.name} 已过期，请核查有效期。` : `${record.name} · ${record.dose}`,
          medicationId: record.medication_id, date: record.date, time: record.time,
        });
      }
    }
  };

  app.locals.db = db;
  app.locals.scanNotifications = scanNotifications;
  app.locals.close = () => { if (ownsDb) db.close(); };

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, fallthrough: true }));
    app.get('/{*path}', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((_req, _res, next) => next(httpError(404, '未找到请求的内容。')));
  app.use((error, _req, res, _next) => {
    const bodyTooLarge = error?.type === 'entity.too.large';
    const invalidJson = error?.type === 'entity.parse.failed';
    const status = bodyTooLarge ? 413 : (Number.isInteger(error?.status) ? error.status : 500);
    const safelyExposed = error?.expose === true || error?.name === 'AiError';
    const message = bodyTooLarge ? '请求内容过大。' : invalidJson ? '请求 JSON 格式不正确。' :
      (status >= 500 && !safelyExposed ? '服务器暂时无法处理请求。' : error.message);
    if (status >= 500 && env.NODE_ENV !== 'test') console.error(error);
    res.status(status).json({ error: message });
  });
  return app;
}

export { pushEndpointAllowed };

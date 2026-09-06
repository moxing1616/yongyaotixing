import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApp, localDateTimeToUtc } from '../server/app.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function mockPush() {
  return {
    generateVAPIDKeys: () => ({ publicKey: 'public-test-key', privateKey: 'private-test-key' }),
    setVapidDetails() {},
    async sendNotification() {},
  };
}

async function fixture({ instant = '2026-06-01T16:05:00.000Z' } = {}) {
  let current = new Date(instant);
  const app = createApp({
    dbPath: ':memory:', keysPath: null, env: { NODE_ENV: 'test' },
    now: () => new Date(current), webPushImpl: mockPush(),
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  cleanups.push(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
  });

  function client({ cookies = true } = {}) {
    let cookie = '';
    let token = '';
    return {
      get cookie() { return cookie; },
      get token() { return token; },
      set token(value) { token = value; },
      async request(path, { method = 'GET', body, headers = {}, bearer = token } = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(cookies && cookie ? { cookie } : {}),
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = response.headers.get('set-cookie');
        if (cookies && setCookie) cookie = setCookie.split(';')[0];
        const payload = await response.json();
        if (payload.data?.accessToken) token = payload.data.accessToken;
        return { status: response.status, body: payload, headers: response.headers };
      },
    };
  }
  return { app, client, setNow: (value) => { current = new Date(value); } };
}

const account = { email: 'native@example.com', password: 'safe-password', name: '小林', timeZone: 'Asia/Shanghai' };
const medication = {
  name: '测试药', specification: '10mg', expiryDate: '2026-06-20', instructions: '遵照医嘱', dose: '每次1片',
  times: ['08:30'], startDate: '2026-06-01', endDate: '', notes: '', color: 'sage',
};

test('欧洲时区春季缺失时刻顺延，秋季重复时刻固定为首次发生', () => {
  assert.equal(localDateTimeToUtc('2026-03-29', '02:30', 'Europe/Berlin'), '2026-03-29T01:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-10-25', '02:30', 'Europe/Berlin'), '2026-10-25T00:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-03-08', '02:30', 'America/New_York'), '2026-03-08T07:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York'), '2026-11-01T05:30:00.000Z');
});

test('原生注册、退出和重登全程无需 Cookie，且数据库不保存明文 token', async () => {
  const { app, client } = await fixture();
  const native = client({ cookies: false });
  const registered = await native.request('/api/native/auth/register', { method: 'POST', body: account });
  assert.equal(registered.status, 201);
  assert.deepEqual(registered.body.data.user, {
    id: registered.body.data.user.id, email: account.email, name: account.name, timeZone: account.timeZone,
  });
  assert.match(registered.body.data.accessToken, /^[a-f0-9]{64}$/);
  assert.equal(Date.parse(registered.body.data.expiresAt) > Date.parse('2026-06-01T16:05:00.000Z'), true);
  assert.equal(registered.headers.get('set-cookie'), null);

  const stored = app.locals.db.prepare("SELECT id FROM sessions WHERE id LIKE 'native:%'").get().id;
  assert.match(stored, /^native:[a-f0-9]{64}$/);
  assert.equal(stored.includes(registered.body.data.accessToken), false);
  assert.equal((await native.request('/api/auth/me')).body.data.email, account.email);
  assert.equal((await native.request('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await native.request('/api/auth/me')).status, 401);

  native.token = '';
  const login = await native.request('/api/native/auth/login', {
    method: 'POST', body: { email: account.email.toUpperCase(), password: account.password },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.name, account.name);
  assert.match(login.body.data.accessToken, /^[a-f0-9]{64}$/);
});

test('Bearer 非法或过期时不回落 Cookie，也不接受网页 session ID', async () => {
  const { app, client } = await fixture();
  const browser = client();
  const webRegistration = await browser.request('/api/auth/register', { method: 'POST', body: account, bearer: '' });
  assert.equal(webRegistration.status, 201);
  assert.equal((await browser.request('/api/auth/me', { bearer: '' })).status, 200);
  const webSessionId = browser.cookie.split('=')[1];
  assert.equal((await browser.request('/api/auth/me', { bearer: webSessionId })).status, 401);
  assert.equal((await browser.request('/api/auth/me', { bearer: '', headers: { authorization: 'Basic abc' } })).status, 401);
  assert.equal((await browser.request('/api/auth/me', { bearer: '0'.repeat(64) })).status, 401);

  const native = client({ cookies: false });
  await native.request('/api/native/auth/login', { method: 'POST', body: { email: account.email, password: account.password } });
  const nativeSessionId = app.locals.db.prepare("SELECT id FROM sessions WHERE id LIKE 'native:%'").get().id;
  assert.equal((await browser.request('/api/auth/me', {
    bearer: '', headers: { cookie: `med_session=${nativeSessionId}` },
  })).status, 401);
  assert.equal((await browser.request('/api/auth/me', { bearer: nativeSessionId.slice('native:'.length) })).status, 401);
  app.locals.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id LIKE 'native:%'").run();
  assert.equal((await native.request('/api/auth/me')).status, 401);
});

test('原生与网页共享业务数据，同时保持跨账户隔离', async () => {
  const { client } = await fixture();
  const native = client({ cookies: false });
  await native.request('/api/native/auth/register', { method: 'POST', body: account });
  const created = await native.request('/api/medications', { method: 'POST', body: medication });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal((await native.request('/api/records', {
    method: 'POST', body: { medicationId: id, date: '2026-06-01', time: '08:30', status: 'taken' },
  })).status, 200);

  const browser = client();
  await browser.request('/api/auth/login', {
    method: 'POST', body: { email: account.email, password: account.password }, bearer: '',
  });
  assert.equal((await browser.request('/api/medications', { bearer: '' })).body.data[0].id, id);
  assert.equal((await browser.request('/api/records?from=2026-06-01&to=2026-06-01', { bearer: '' })).body.data[0].status, 'taken');
  const updated = await native.request(`/api/medications/${id}`, {
    method: 'PUT', body: { ...medication, dose: '每次2片' },
  });
  assert.equal(updated.body.data.dose, '每次2片');

  const outsider = client({ cookies: false });
  await outsider.request('/api/native/auth/register', {
    method: 'POST', body: { ...account, email: 'other@example.com' },
  });
  assert.deepEqual((await outsider.request('/api/medications')).body.data, []);
  assert.equal((await outsider.request(`/api/medications/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await native.request(`/api/medications/${id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await native.request('/api/medications')).body.data, []);
});

test('提醒计划排除已完成和过期药催服，并保留跨午夜延后的原日期时间', async () => {
  const { client } = await fixture({ instant: '2026-06-01T15:58:00.000Z' });
  const native = client({ cookies: false });
  await native.request('/api/native/auth/register', { method: 'POST', body: account });

  const snoozedId = (await native.request('/api/medications', {
    method: 'POST', body: { ...medication, name: '延后药', expiryDate: '2026-06-30', times: ['23:55'], endDate: '2026-06-01' },
  })).body.data.id;
  await native.request('/api/records', {
    method: 'POST', body: { medicationId: snoozedId, date: '2026-06-01', time: '23:55', status: 'snoozed' },
  });

  const completedId = (await native.request('/api/medications', {
    method: 'POST', body: { ...medication, name: '已服药', expiryDate: '', times: ['23:59'], endDate: '2026-06-01' },
  })).body.data.id;
  await native.request('/api/records', {
    method: 'POST', body: { medicationId: completedId, date: '2026-06-01', time: '23:59', status: 'taken' },
  });
  const skippedId = (await native.request('/api/medications', {
    method: 'POST', body: { ...medication, name: '跳过药', expiryDate: '', times: ['23:59'], endDate: '2026-06-01' },
  })).body.data.id;
  await native.request('/api/records', {
    method: 'POST', body: { medicationId: skippedId, date: '2026-06-01', time: '23:59', status: 'skipped' },
  });

  const expiredId = (await native.request('/api/medications', {
    method: 'POST', body: { ...medication, name: '过期药', expiryDate: '2026-05-31', times: ['00:30'], endDate: '2026-06-01' },
  })).body.data.id;

  const changedTimeId = (await native.request('/api/medications', {
    method: 'POST', body: { ...medication, name: '改时药', expiryDate: '', times: ['23:55'], endDate: '2026-06-01' },
  })).body.data.id;
  await native.request('/api/records', {
    method: 'POST', body: { medicationId: changedTimeId, date: '2026-06-01', time: '23:55', status: 'snoozed' },
  });
  await native.request(`/api/medications/${changedTimeId}`, {
    method: 'PUT', body: { ...medication, name: '改时药', expiryDate: '', times: ['22:00'], endDate: '2026-06-01' },
  });

  const changedDateId = (await native.request('/api/medications', {
    method: 'POST', body: { ...medication, name: '改期药', expiryDate: '', times: ['23:55'] },
  })).body.data.id;
  await native.request('/api/records', {
    method: 'POST', body: { medicationId: changedDateId, date: '2026-06-01', time: '23:55', status: 'snoozed' },
  });
  await native.request(`/api/medications/${changedDateId}`, {
    method: 'PUT', body: { ...medication, name: '改期药', expiryDate: '', times: ['23:55'], startDate: '2026-06-02' },
  });

  const response = await native.request('/api/native/reminders');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.generatedAt, '2026-06-01T15:58:00.000Z');
  assert.equal(response.body.data.timeZone, 'Asia/Shanghai');
  assert.equal(response.body.data.total, response.body.data.items.length);
  assert.equal(response.body.data.hasMore, false);

  const carried = response.body.data.items.find((item) => item.medicationId === snoozedId && item.date === '2026-06-01');
  assert.deepEqual(carried, {
    key: `dose:${snoozedId}:2026-06-01:23:55:2026-06-01T16:13:00.000Z`,
    kind: 'dose', title: '延后服药提醒', body: '延后药 · 每次1片', at: '2026-06-01T16:13:00.000Z',
    medicationId: snoozedId, date: '2026-06-01', time: '23:55',
  });
  assert.equal(response.body.data.items.some((item) => item.medicationId === completedId && item.date === '2026-06-01'), false);
  assert.equal(response.body.data.items.some((item) => item.medicationId === skippedId && item.date === '2026-06-01'), false);
  assert.equal(response.body.data.items.some((item) => item.medicationId === expiredId && item.kind === 'dose'), false);
  assert.equal(response.body.data.items.some((item) => item.medicationId === changedTimeId && item.date === '2026-06-01'), false);
  assert.equal(response.body.data.items.some((item) => item.medicationId === changedDateId && item.date === '2026-06-01'), false);
  const firstExpiry = response.body.data.items.find((item) => item.medicationId === expiredId && item.kind === 'expiry');
  assert.equal(firstExpiry.at, '2026-06-02T01:00:00.000Z');
  assert.equal(firstExpiry.date, '2026-06-02');
  assert.equal(firstExpiry.time, '09:00');
  assert.match(firstExpiry.body, /已过期/);
  assert.deepEqual(response.body.data.items.map((item) => item.at),
    [...response.body.data.items.map((item) => item.at)].sort());

  const browser = client();
  await browser.request('/api/auth/login', {
    method: 'POST', body: { email: account.email, password: account.password }, bearer: '',
  });
  const webPlan = await browser.request('/api/native/reminders', { bearer: '' });
  assert.equal(webPlan.status, 200);
  assert.deepEqual(webPlan.body.data.items, response.body.data.items);
});

test('提醒计划按真实 UTC 七天窗口排序，最多返回 30 条并报告裁剪前总量', async () => {
  const { client } = await fixture({ instant: '2026-06-01T00:00:00.000Z' });
  const native = client({ cookies: false });
  await native.request('/api/native/auth/register', {
    method: 'POST', body: { ...account, timeZone: 'America/New_York' },
  });
  const times = ['00:30', '03:30', '06:30', '09:30', '12:30', '15:30', '18:30', '21:30'];
  for (let index = 0; index < 5; index += 1) {
    const created = await native.request('/api/medications', {
      method: 'POST',
      body: { ...medication, name: `药品${index}`, expiryDate: '', times, startDate: '2026-05-31' },
    });
    assert.equal(created.status, 201);
  }
  const response = await native.request('/api/native/reminders');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.items.length, 30);
  assert.equal(response.body.data.total > 30, true);
  assert.equal(response.body.data.hasMore, true);
  assert.equal(response.body.data.timeZone, 'America/New_York');
  const horizon = Date.parse('2026-06-08T00:00:00.000Z');
  assert.equal(response.body.data.items.every((item) => Date.parse(item.at) > Date.parse(response.body.data.generatedAt)), true);
  assert.equal(response.body.data.items.every((item) => Date.parse(item.at) <= horizon), true);
  assert.deepEqual(response.body.data.items.map((item) => item.at),
    [...response.body.data.items.map((item) => item.at)].sort());
  assert.equal(new Set(response.body.data.items.map((item) => item.key)).size, 30);
  assert.equal(response.body.data.items[0].at, '2026-06-01T01:30:00.000Z');
});

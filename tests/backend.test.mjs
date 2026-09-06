import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApp, dateInTimeZone, localDateTimeToUtc } from '../server/app.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function mockPush({ failureStatus } = {}) {
  const sent = [];
  return {
    sent,
    generateVAPIDKeys: () => ({ publicKey: 'public-test-key', privateKey: 'private-test-key' }),
    setVapidDetails() {},
    async sendNotification(subscription, payload) {
      sent.push({ subscription, payload: JSON.parse(payload) });
      if (failureStatus) throw Object.assign(new Error('push failed'), { statusCode: failureStatus });
    },
  };
}

async function fixture({ instant = '2026-06-01T16:05:00.000Z', push = mockPush(), recognizeImpl } = {}) {
  let current = new Date(instant);
  const app = createApp({
    dbPath: ':memory:',
    keysPath: null,
    env: { NODE_ENV: 'test' },
    now: () => new Date(current),
    webPushImpl: push,
    recognizeImpl,
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  cleanups.push(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
  });

  function client() {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      async request(path, { method = 'GET', body, headers = {} } = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return { status: response.status, body: await response.json(), headers: response.headers };
      },
    };
  }
  return { app, push, client, setNow: (value) => { current = new Date(value); } };
}

async function register(client, overrides = {}) {
  return client.request('/api/auth/register', {
    method: 'POST',
    body: { email: 'user@example.com', password: 'safe-password', name: '小林', timeZone: 'Asia/Shanghai', ...overrides },
  });
}

const medication = {
  name: '测试药', specification: '10mg', expiryDate: '2026-06-20', instructions: '遵照医嘱', dose: '每次1片',
  times: ['23:55'], startDate: '2026-06-01', endDate: '', notes: '', color: 'sage',
};

test('真实注册、退出和登录使用 HttpOnly Cookie，会话不泄露密码', async () => {
  const { client } = await fixture();
  const browser = client();
  const created = await register(browser, { email: '  USER@example.com ', password: '  safe-password  ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.email, 'user@example.com');
  assert.match(created.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(created.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.equal('password' in created.body.data, false);

  assert.equal((await browser.request('/api/auth/me')).status, 200);
  assert.equal((await browser.request('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await browser.request('/api/auth/me')).status, 401);

  const login = await browser.request('/api/auth/login', {
    method: 'POST', body: { email: 'USER@example.com', password: '  safe-password  ' },
  });
  assert.equal(login.status, 200);
  assert.equal((await browser.request('/api/auth/me')).body.data.name, '小林');
  assert.equal((await browser.request('/api/auth/login', {
    method: 'POST', body: { email: 'user@example.com', password: 'safe-password' },
  })).status, 401);
});

test('药品 CRUD 校验非法字段，并严格隔离账户', async () => {
  const { client } = await fixture();
  const alice = client();
  const bob = client();
  await register(alice, { email: 'alice@example.com' });
  await register(bob, { email: 'bob@example.com' });

  const unknown = await alice.request('/api/medications', { method: 'POST', body: { ...medication, active: false } });
  assert.equal(unknown.status, 400);
  const duplicates = await alice.request('/api/medications', { method: 'POST', body: { ...medication, times: ['08:00', '08:00'] } });
  assert.equal(duplicates.status, 400);
  const invalidRange = await alice.request('/api/medications', { method: 'POST', body: { ...medication, endDate: '2026-05-31' } });
  assert.equal(invalidRange.status, 400);
  assert.equal((await alice.request('/api/medications', {
    method: 'POST', body: { ...medication, notes: 'x'.repeat(501) },
  })).status, 400);

  const created = await alice.request('/api/medications', {
    method: 'POST', body: { ...medication, specification: '规'.repeat(200), instructions: '说'.repeat(6000), notes: '注'.repeat(500) },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.data.times, ['23:55']);
  const id = created.body.data.id;
  assert.deepEqual((await bob.request('/api/medications')).body.data, []);
  assert.equal((await bob.request(`/api/medications/${id}`, { method: 'PUT', body: medication })).status, 404);
  assert.equal((await bob.request(`/api/medications/${id}`, { method: 'DELETE' })).status, 404);

  const changed = await alice.request(`/api/medications/${id}`, { method: 'PUT', body: { ...medication, dose: '每次2片' } });
  assert.equal(changed.body.data.dose, '每次2片');
  assert.equal((await alice.request(`/api/medications/${id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await alice.request('/api/medications')).body.data, []);
});

test('today 按账户 IANA 时区选日，记录终态幂等且归档后历史仍在', async () => {
  const { client } = await fixture({ instant: '2026-06-01T16:05:00.000Z' });
  const browser = client();
  await register(browser);
  const created = await browser.request('/api/medications', { method: 'POST', body: medication });
  const id = created.body.data.id;

  const today = await browser.request('/api/today');
  assert.equal(today.body.data[0].date, '2026-06-02');
  assert.equal(today.body.data[0].scheduledAt, '2026-06-02T15:55:00.000Z');
  assert.equal(today.body.data[0].status, 'pending');

  const first = await browser.request('/api/records', {
    method: 'POST', body: { medicationId: id, date: '2026-06-01', time: '23:55', status: 'taken' },
  });
  assert.equal(first.status, 200);
  const repeated = await browser.request('/api/records', {
    method: 'POST', body: { medicationId: id, date: '2026-06-01', time: '23:55', status: 'taken' },
  });
  assert.equal(repeated.body.data.id, first.body.data.id);
  assert.equal((await browser.request('/api/records', {
    method: 'POST', body: { medicationId: id, date: '2026-06-01', time: '23:55', status: 'skipped' },
  })).status, 409);
  assert.equal((await browser.request('/api/records', {
    method: 'POST', body: { medicationId: id, date: '2026-06-03', time: '23:55', status: 'taken' },
  })).status, 400);

  await browser.request(`/api/medications/${id}`, {
    method: 'PUT', body: { ...medication, name: '改名后的药', dose: '每次9片' },
  });
  await browser.request(`/api/medications/${id}`, { method: 'DELETE' });
  const history = await browser.request('/api/records?from=2026-06-01&to=2026-06-30');
  assert.equal(history.body.data.length, 1);
  assert.equal(history.body.data[0].medicationName, '测试药');
  assert.equal(history.body.data[0].dose, '每次1片');
  assert.equal(history.body.data[0].status, 'taken');
});

test('从点击时刻延后 15 分钟可跨午夜，到点前重复请求保持原时间', async () => {
  const push = mockPush();
  const { app, client, setNow } = await fixture({ instant: '2026-06-01T15:58:00.000Z', push });
  const browser = client();
  await register(browser);
  const id = (await browser.request('/api/medications', {
    method: 'POST', body: { ...medication, expiryDate: '2026-06-01' },
  })).body.data.id;
  const snoozed = await browser.request('/api/records', {
    method: 'POST', body: { medicationId: id, date: '2026-06-01', time: '23:55', status: 'snoozed' },
  });
  assert.equal(snoozed.body.data.snoozedUntil, '2026-06-01T16:13:00.000Z');
  const again = await browser.request('/api/records', {
    method: 'POST', body: { medicationId: id, date: '2026-06-01', time: '23:55', status: 'snoozed' },
  });
  assert.equal(again.body.data.snoozedUntil, '2026-06-01T16:13:00.000Z');
  const nextDay = await browser.request('/api/today?date=2026-06-02');
  const carried = nextDay.body.data.find((item) => item.medicationId === id && item.status === 'snoozed');
  assert.equal(carried.date, '2026-06-01');
  assert.equal(carried.snoozedUntil, '2026-06-01T16:13:00.000Z');
  await browser.request('/api/push/subscribe', {
    method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/carried', keys: { p256dh: 'a', auth: 'b' } },
  });
  setNow('2026-06-01T16:14:00.000Z');
  await app.locals.scanNotifications();
  const carriedPush = push.sent.find((item) => item.payload.type === 'dose');
  assert.equal(carriedPush.payload.date, '2026-06-01');
  assert.equal(carriedPush.payload.time, '23:55');
  assert.match(carriedPush.payload.body, /已过期，请核查有效期/);
  assert.doesNotMatch(carriedPush.payload.body, /每次1片/);
});

test('推送只接受真实服务域，扫描对服药和每日到期提醒去重', async () => {
  const push = mockPush();
  const { app, client } = await fixture({ instant: '2026-06-01T15:56:00.000Z', push });
  const browser = client();
  await register(browser);
  await browser.request('/api/medications', { method: 'POST', body: { ...medication, expiryDate: '2026-05-31' } });

  const blocked = await browser.request('/api/push/subscribe', {
    method: 'POST', body: { endpoint: 'https://127.0.0.1/steal', keys: { p256dh: 'a', auth: 'b' } },
  });
  assert.equal(blocked.status, 400);
  const subscribed = await browser.request('/api/push/subscribe', {
    method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/example', keys: { p256dh: 'a', auth: 'b' } },
  });
  assert.equal(subscribed.status, 201);
  const endpoint = encodeURIComponent('https://fcm.googleapis.com/fcm/send/example');
  assert.deepEqual((await browser.request(`/api/push/status?endpoint=${endpoint}`)).body.data, { subscribed: true });
  const outsider = client();
  await register(outsider, { email: 'outsider@example.com' });
  assert.deepEqual((await outsider.request(`/api/push/status?endpoint=${endpoint}`)).body.data, { subscribed: false });

  await app.locals.scanNotifications();
  assert.deepEqual(push.sent.map((item) => item.payload.type).sort(), ['dose', 'expiry']);
  const dosePush = push.sent.find((item) => item.payload.type === 'dose').payload;
  const expiryPush = push.sent.find((item) => item.payload.type === 'expiry').payload;
  assert.match(dosePush.body, /已过期，请核查有效期/);
  assert.doesNotMatch(dosePush.body, /每次1片/);
  assert.match(expiryPush.body, /已过期，请核查有效期/);
  await app.locals.scanNotifications();
  assert.equal(push.sent.length, 2);
});

test('退出只删除当前会话绑定的推送订阅，跨来源修改被拒绝', async () => {
  const { app, client, push } = await fixture();
  const first = client();
  const second = client();
  await register(first);
  await second.request('/api/auth/login', { method: 'POST', body: { email: 'user@example.com', password: 'safe-password' } });
  const subscription = (browser, suffix) => browser.request('/api/push/subscribe', {
    method: 'POST', body: { endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, keys: { p256dh: 'a', auth: 'b' } },
  });
  await subscription(first, 'first');
  await subscription(second, 'second');
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get().count, 2);
  assert.equal((await first.request('/api/push/test', { method: 'POST' })).status, 200);
  assert.equal(push.sent.length, 1);
  assert.equal(push.sent[0].subscription.endpoint.endsWith('/first'), true);
  await first.request('/api/auth/logout', { method: 'POST' });
  assert.equal(app.locals.db.prepare('SELECT endpoint FROM push_subscriptions').get().endpoint.endsWith('/second'), true);

  const rejected = await second.request('/api/medications', {
    method: 'POST', body: medication, headers: { origin: 'https://evil.example' },
  });
  assert.equal(rejected.status, 403);
});

test('登录和测试通知均限流，推送失败不会谎报成功', async () => {
  const { client } = await fixture();
  const browser = client();
  await register(browser);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await browser.request('/api/auth/login', {
      method: 'POST', body: { email: 'USER@example.com', password: `wrong-${attempt}` },
    });
    assert.equal(response.status, 401);
  }
  assert.equal((await browser.request('/api/auth/login', {
    method: 'POST', body: { email: 'user@example.com', password: 'another-wrong' },
  })).status, 429);

  await browser.request('/api/push/subscribe', {
    method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/rate', keys: { p256dh: 'a', auth: 'b' } },
  });
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await browser.request('/api/push/test', { method: 'POST' })).status, 200);
  assert.equal((await browser.request('/api/push/test', { method: 'POST' })).status, 429);

  const failingPush = mockPush({ failureStatus: 500 });
  const failedFixture = await fixture({ push: failingPush });
  const failedBrowser = failedFixture.client();
  await register(failedBrowser, { email: 'push-fail@example.com' });
  await failedBrowser.request('/api/push/subscribe', {
    method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/fail', keys: { p256dh: 'a', auth: 'b' } },
  });
  const failed = await failedBrowser.request('/api/push/test', { method: 'POST' });
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /发送失败/);
});

test('过期会话订阅被扫描清理，AI 业务错误保留中文且 API 禁止缓存', async () => {
  const aiFailure = Object.assign(new Error('AI 识别服务未配置，请手动填写药品信息。'), { name: 'AiError', status: 503 });
  const { app, client } = await fixture({ recognizeImpl: async () => { throw aiFailure; } });
  const browser = client();
  const registered = await register(browser);
  assert.equal(registered.headers.get('cache-control'), 'no-store');
  await browser.request('/api/push/subscribe', {
    method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/expired', keys: { p256dh: 'a', auth: 'b' } },
  });
  app.locals.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await app.locals.scanNotifications();
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get().count, 0);

  const active = client();
  await active.request('/api/auth/login', { method: 'POST', body: { email: 'user@example.com', password: 'safe-password' } });
  const recognized = await active.request('/api/recognize', { method: 'POST', body: { image: 'data:image/png;base64,AA==' } });
  assert.equal(recognized.status, 503);
  assert.equal(recognized.body.error, aiFailure.message);
  assert.equal(recognized.headers.get('cache-control'), 'no-store');
});

test('时区换算将春季缺失时间顺延，并固定秋季重复时间为首次发生', () => {
  assert.equal(dateInTimeZone(new Date('2026-03-08T04:30:00Z'), 'America/New_York'), '2026-03-07');
  assert.equal(localDateTimeToUtc('2026-07-01', '08:30', 'America/New_York'), '2026-07-01T12:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-03-08', '02:30', 'America/New_York'), '2026-03-08T07:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York'), '2026-11-01T05:30:00.000Z');
});

test('秋季重复的本地服药时刻在两次 01:30 扫描中只推送一次', async () => {
  const push = mockPush();
  const { app, client, setNow } = await fixture({ instant: '2026-11-01T05:31:00.000Z', push });
  const browser = client();
  await register(browser, { timeZone: 'America/New_York' });
  await browser.request('/api/medications', {
    method: 'POST',
    body: { ...medication, expiryDate: '', times: ['01:30'], startDate: '2026-11-01', endDate: '2026-11-01' },
  });
  await browser.request('/api/push/subscribe', {
    method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/fall-back', keys: { p256dh: 'a', auth: 'b' } },
  });
  await app.locals.scanNotifications();
  assert.equal(push.sent.filter((item) => item.payload.type === 'dose').length, 1);
  setNow('2026-11-01T06:31:00.000Z');
  await app.locals.scanNotifications();
  assert.equal(push.sent.filter((item) => item.payload.type === 'dose').length, 1);
});

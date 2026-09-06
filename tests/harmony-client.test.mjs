import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createApp } from '../server/app.mjs';

// These are logic tests with device adapters, not an ArkTS/SDK build or device test.
const sourceRoot = new URL('../harmony/entry/src/main/ets/', import.meta.url);
function load(relative, adapters = {}) {
  const filename = new URL(relative, sourceRoot);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename.pathname,
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => {
    if (adapters[id]) return adapters[id];
    if (id.startsWith('.')) {
      const resolved = path.posix.join(path.posix.dirname(relative), id);
      return load(`${resolved}${resolved.endsWith('ServerAddress') ? '.ts' : '.ets'}`, adapters);
    }
    throw new Error(`Unmocked device module: ${id}`);
  };
  const execute = vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: filename.pathname });
  execute(localRequire, module, module.exports);
  return module.exports;
}

test('鸿蒙服务器设置在正式版强制 HTTPS，调试 HTTP 仅允许本机或内网', () => {
  const { serverAddress } = load('model/ServerAddress.ts');
  assert.equal(serverAddress(' https://api.example.com/ ', false), 'https://api.example.com');
  for (const address of ['http://192.168.1.3:3001', 'http://127.0.0.1:3001', 'http://10.0.2.2:3001']) {
    assert.equal(serverAddress(address, true), address);
    assert.throws(() => serverAddress(address, false), /HTTPS/);
  }
  for (const address of ['http://evil.example.com', 'http://172.32.1.1', 'https://u:p@host',
    'https://host/api', 'https://host#fragment', 'https://host:65536', 'http://127.0.0.999', 'http://10.evil.com']) {
    assert.throws(() => serverAddress(address, true));
  }
});

function deviceFixture(overrides = {}) {
  const published = [];
  let clears = 0;
  const reminders = {
    cancelAllReminders: async () => { clears++; },
    publishReminder: async (request) => { published.push(request); return published.length; },
    ReminderType: { REMINDER_TYPE_CALENDAR: 1 }, ActionButtonType: { ACTION_BUTTON_TYPE_CLOSE: 0 },
    ...overrides,
  };
  const adapters = {
    '@kit.AbilityKit': {}, '@kit.ArkTS': {}, '@kit.CameraKit': {}, '@kit.CoreFileKit': {},
    '@kit.ImageKit': {}, '@kit.MediaLibraryKit': {},
    '@kit.BackgroundTasksKit': { reminderAgentManager: reminders },
    '@kit.NotificationKit': { notificationManager: { SlotType: { SERVICE_INFORMATION: 2 }, requestEnableNotification: async () => {} } },
  };
  return { service: load('services/DeviceServices.ets', adapters).deviceServices, published, get clears() { return clears; } };
}

function plan(count) {
  const now = Date.now();
  return {
    generatedAt: new Date(now).toISOString(), timeZone: 'Asia/Shanghai', total: count, hasMore: count > 30,
    items: Array.from({ length: count }, (_, index) => ({
      key: `dose-${index}`, kind: 'dose', title: '服药提醒', body: '测试药 · 1片',
      at: new Date(now + (index + 1) * 60000).toISOString(), medicationId: 'test', date: '2026-06-01', time: '08:00',
    })),
  };
}

test('设备提醒最多发布 30 条，保持服务端绝对时刻且不绕过后台记录延后', async () => {
  const device = deviceFixture();
  const input = plan(40);
  input.items.reverse();
  input.items.push({ ...input.items[0], at: '2000-01-01T00:00:00Z' });
  assert.equal(await device.service.sync(input), 30);
  assert.equal(device.published.length, 30);
  assert.equal(device.clears, 1);
  const first = device.published[0];
  assert.equal(first.wantAgent.pkgName, 'com.moxing1616.medication');
  assert.equal(first.actionButton.length, 1);
  assert.equal(first.actionButton[0].title, '关闭');
  const d = first.dateTime;
  const expected = [...input.items].filter((item) => Date.parse(item.at) > Date.now()).sort((a, b) => a.at.localeCompare(b.at))[0];
  assert.equal(new Date(d.year, d.month - 1, d.day, d.hour, d.minute, d.second).getTime(), Math.floor(Date.parse(expected.at) / 1000) * 1000);
  assert.equal(new Set(device.published.map((request) => request.notificationId)).size, 30);
});

test('设备发布部分失败时撤销整批，不能报告同步成功', async () => {
  let calls = 0;
  const device = deviceFixture({ publishReminder: async () => { if (++calls === 2) throw new Error('permission denied'); return 1; } });
  await assert.rejects(device.service.sync(plan(3)), /失败/);
  assert.equal(device.clears, 2);
});

test('退出时的 clear 作废在途 sync，清理后不会继续发布旧账号提醒', async () => {
  let release;
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  let published = 0;
  const device = deviceFixture({ publishReminder: async () => {
    published++;
    began();
    await new Promise((resolve) => { release = resolve; });
    return 1;
  } });
  const sync = device.service.sync(plan(3));
  const rejected = assert.rejects(sync, /同步系统提醒失败/);
  await started;
  const clear = device.service.clear();
  release();
  await rejected;
  await clear;
  assert.equal(published, 1);
  assert.equal(device.clears, 3);
});

test('鸿蒙 HTTP 客户端使用原生认证，带 Bearer 写入记录，注销后停止发送令牌', async () => {
  const calls = [];
  let destroyed = 0;
  const user = { id: 'test', email: 'user@example.com', name: '测试', timeZone: 'Asia/Shanghai' };
  const network = {
    RequestMethod: { GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE' }, HttpDataType: { STRING: 0 },
    createHttp: () => ({
      request: async (url, options) => {
        calls.push({ url, options });
        const data = url.endsWith('/native/auth/login') ? { user, accessToken: 'test-token', expiresAt: '2027-01-01' } : { ok: true };
        return { responseCode: 200, result: JSON.stringify({ data }) };
      }, destroy: () => { destroyed++; },
    }),
  };
  const { api } = load('services/Api.ets', { '@kit.NetworkKit': { http: network } });
  api.configure('https://api.example.com', false);
  assert.deepEqual(await api.login('user@example.com', 'password'), user);
  await api.record({ medicationId: 'med', date: '2026-06-01', time: '08:00' }, 'taken');
  assert.equal(calls[0].url, 'https://api.example.com/api/native/auth/login');
  assert.equal(calls[0].options.header.Authorization, undefined);
  assert.equal(calls[1].options.header.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[1].options.extraData), { medicationId: 'med', date: '2026-06-01', time: '08:00', status: 'taken' });
  await api.logout();
  await api.config();
  assert.equal(calls[3].options.header.Authorization, undefined);
  assert.equal(destroyed, calls.length);
});

test('任何原生接口返回 401 都统一失效，包括识别/保存，不再保留 Bearer', async () => {
  let unauthorized = 0;
  let responseStatus = 200;
  const calls = [];
  const network = {
    RequestMethod: { GET: 'GET', POST: 'POST', PUT: 'PUT' }, HttpDataType: { STRING: 0 },
    createHttp: () => ({
      request: async (_url, options) => {
        calls.push(options);
        return { responseCode: responseStatus, result: JSON.stringify(responseStatus === 200
          ? { data: { user: {}, accessToken: 'test-token' } } : { error: '请先登录。' }) };
      }, destroy() {},
    }),
  };
  const { api } = load('services/Api.ets', { '@kit.NetworkKit': { http: network } });
  api.configure('https://api.example.com', false);
  api.onUnauthorized = async () => { unauthorized++; };
  await api.login('user@example.com', 'password');
  responseStatus = 401;
  await assert.rejects(api.recognize('data:image/jpeg;base64,abc'), /请先登录/);
  assert.equal(unauthorized, 1);
  await assert.rejects(api.config(), /请先登录/);
  assert.equal(calls.at(-1).header.Authorization, undefined);
});

test('鸿蒙客户端适配器实际连接 Express：注册→识别→确认保存→服药→记录→注销', async () => {
  const app = createApp({
    dbPath: ':memory:', keysPath: null, env: { NODE_ENV: 'test', OPENAI_API_KEY: 'test-only' },
    now: () => new Date('2026-06-01T00:00:00.000Z'),
    webPushImpl: { generateVAPIDKeys: () => ({ publicKey: 'test', privateKey: 'test' }), setVapidDetails() {}, async sendNotification() {} },
    recognizeImpl: async () => ({ name: '测试药', specification: '10mg', expiryDate: '2026-06-30', instructions: '包装文字', warnings: [] }),
  });
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const network = {
    RequestMethod: { GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE' }, HttpDataType: { STRING: 0 },
    createHttp: () => ({
      request: async (url, options) => {
        const response = await fetch(url, { method: options.method, headers: options.header,
          body: options.method === 'GET' ? undefined : options.extraData || undefined });
        return { responseCode: response.status, result: await response.text() };
      }, destroy() {},
    }),
  };
  try {
    const { api } = load('services/Api.ets', { '@kit.NetworkKit': { http: network } });
    api.configure(`http://127.0.0.1:${server.address().port}`, true);
    const user = await api.register('harmony@example.com', 'test-password', '鸿蒙测试', 'Asia/Shanghai');
    assert.equal(user.email, 'harmony@example.com');
    const recognized = await api.recognize('data:image/jpeg;base64,stub');
    assert.equal(recognized.name, '测试药');
    assert.equal((await api.medications()).length, 0, '识别本身不能创建服药计划');
    const saved = await api.saveMedication({
      name: recognized.name, specification: recognized.specification, expiryDate: recognized.expiryDate,
      instructions: recognized.instructions, dose: '用户确认1片', times: ['08:30'],
      startDate: '2026-06-01', endDate: '', notes: '', color: 'sage',
    });
    const today = await api.today();
    assert.equal(today[0].medicationId, saved.id);
    assert.equal((await api.reminders()).items.some((item) => item.medicationId === saved.id && item.kind === 'dose'), true);
    await api.record(today[0], 'taken');
    assert.equal((await api.records('2026-06-01', '2026-06-01'))[0].status, 'taken');
    assert.equal((await api.today())[0].status, 'taken');
    await api.logout();
    await assert.rejects(api.medications(), /登录/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
  }
});

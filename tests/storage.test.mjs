import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';

test('磁盘数据库关闭并重新打开后，账户会话、药品和服药记录仍然存在', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'medication-persistence-'));
  const dbPath = path.join(directory, 'test.sqlite');
  const fixture = async () => {
    const app = createApp({ dbPath, keysPath: null, env: { NODE_ENV: 'test' }, now: () => new Date('2026-09-06T10:00:00Z') });
    const server = await new Promise(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    return { app, server, url: `http://127.0.0.1:${server.address().port}` };
  };
  const stop = async instance => {
    await new Promise(resolve => instance.server.close(resolve));
    instance.app.locals.close();
  };
  let instance;
  try {
    instance = await fixture();
    const registered = await fetch(`${instance.url}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'persistence@example.com', password: 'test-password', name: '持久化验收', timeZone: 'Asia/Shanghai' }),
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get('set-cookie').split(';')[0];
    const headers = { 'content-type': 'application/json', cookie };
    const medicine = await fetch(`${instance.url}/api/medications`, {
      method: 'POST', headers, body: JSON.stringify({ name: '持久化测试药品', dose: '仅测试 1片', times: ['08:00'], startDate: '2026-09-06', color: 'sage' }),
    });
    assert.equal(medicine.status, 201);
    const id = (await medicine.json()).data.id;
    const recorded = await fetch(`${instance.url}/api/records`, {
      method: 'POST', headers, body: JSON.stringify({ medicationId: id, date: '2026-09-06', time: '08:00', status: 'taken' }),
    });
    assert.equal(recorded.status, 200);
    await stop(instance);
    instance = null;
    instance = await fixture();
    const me = await fetch(`${instance.url}/api/auth/me`, { headers });
    assert.equal((await me.json()).data.name, '持久化验收');
    const meds = await fetch(`${instance.url}/api/medications`, { headers });
    assert.equal((await meds.json()).data[0].id, id);
    const records = await fetch(`${instance.url}/api/records?from=2026-09-06&to=2026-09-06`, { headers });
    assert.equal((await records.json()).data[0].status, 'taken');
  } finally {
    if (instance) await stop(instance);
    // Only remove these known test files; never recursively delete a computed tree.
    for (const name of ['test.sqlite', 'test.sqlite-wal', 'test.sqlite-shm']) {
      try { unlinkSync(path.join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    rmdirSync(directory);
  }
});

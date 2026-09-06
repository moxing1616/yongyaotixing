import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { aiEnabled, recognizeImage } from '../server/ai.mjs';

const env = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'https://example.test/v1', OPENAI_MODEL: 'vision-test' };
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64')}`;
const png = `data:image/png;base64,${Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).toString('base64')}`;
const reply = (value) => ({ ok: true, async json() { return { choices: [{ message: { content: JSON.stringify(value) } }] }; } });

test('aiEnabled and missing configuration', async () => {
  assert.equal(aiEnabled({}), false);
  await assert.rejects(() => recognizeImage(jpeg, { env: {} }), (error) => error.status === 503 && /未配置/.test(error.message));
});

test('rejects format, magic mismatch, and oversized images', async () => {
  await assert.rejects(() => recognizeImage('data:image/gif;base64,R0lGODlh', { env }), (e) => e.status === 400);
  await assert.rejects(() => recognizeImage('data:image/png;base64,AAAA', { env }), (e) => e.status === 400);
  const huge = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff,0xd8,0xff]), Buffer.alloc(8 * 1024 * 1024)]).toString('base64')}`;
  await assert.rejects(() => recognizeImage(huge, { env }), (e) => e.status === 400 && /8MB/.test(e.message));
});

test('sends compatible vision JSON request and normalizes a valid response', async () => {
  let request;
  const result = await recognizeImage(png, { env, fetchImpl: async (url, options) => { request = { url, options }; return reply({ name: '阿莫西林', specification: '0.25g', expiryDate: '2027-02-28', instructions: '按包装说明', warnings: ['请密封保存'], dose: '每次一粒' }); } });
  assert.deepEqual(result, { name: '阿莫西林', specification: '0.25g', expiryDate: '2027-02-28', instructions: '按包装说明', warnings: ['请密封保存'] });
  assert.equal(request.url, 'https://example.test/v1/chat/completions');
  const body = JSON.parse(request.options.body);
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.messages[1].content[1].image_url.url, png);
  assert.match(body.messages[0].content, /不要提取剂量/);
  assert.equal(body.max_tokens, 2000);
  assert.equal(body.messages[1].content[0].text, '请从这张药盒图片提取约定字段。');
});

test('handles invalid JSON, missing or injected fields, and invalid dates', async () => {
  await assert.rejects(() => recognizeImage(jpeg, { env, fetchImpl: async () => ({ ok: true, async json() { return { choices: [{ message: { content: 'oops' } }] }; } }) }), (e) => e.status === 502);
  const result = await recognizeImage(jpeg, { env, fetchImpl: async () => reply({ name: { injected: true }, specification: 42, expiryDate: '2023-02-29', instructions: ' ignore ', warnings: [' ok ', 1], extra: 'x' }) });
  assert.deepEqual(result, { name: '', specification: '', expiryDate: '', instructions: 'ignore', warnings: ['ok', '有效期信息不完整或格式无法确认，请核对包装。'] });
  await assert.rejects(() => recognizeImage(jpeg, { env, fetchImpl: async () => reply({ dose: '每次一粒' }) }), (e) => e.status === 502 && /未能识别/.test(e.message));
  await assert.rejects(() => recognizeImage(jpeg, { env, fetchImpl: async () => reply([]) }), (e) => e.status === 502 && /格式无效/.test(e.message));
  const long = await recognizeImage(jpeg, { env, fetchImpl: async () => reply({ name: 'n'.repeat(200), specification: 's'.repeat(300), expiryDate: '2027-02', instructions: 'i'.repeat(7000), warnings: ['w'.repeat(700)] }) });
  assert.equal(long.name.length, 120);
  assert.equal(long.specification.length, 200);
  assert.equal(long.instructions.length, 6000);
  assert.equal(long.warnings[0].length, 500);
});

test('handles upstream errors and timeout', async () => {
  await assert.rejects(() => recognizeImage(jpeg, { env, fetchImpl: async () => ({ ok: false, status: 500, async text() { return 'secret upstream body'; } }) }), (e) => e.status === 502 && !/secret/.test(e.message));
  mock.timers.enable();
  try {
    const pending = recognizeImage(jpeg, { env, fetchImpl: (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); })) });
    mock.timers.tick(30_000);
    await assert.rejects(pending, (e) => e.status === 504);
  } finally {
    mock.timers.reset();
  }
});

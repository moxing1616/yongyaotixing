import path from 'node:path';
import { createApp } from './app.mjs';

const app = createApp({
  dbPath: process.env.DB_PATH || path.resolve('data', 'medications.sqlite'),
  keysPath: process.env.VAPID_KEYS_PATH || path.resolve('data', 'keys.json'),
});
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => console.log(`用药提醒服务已启动：http://${host}:${port}`));

let scanning = false;
const runScan = async () => {
  if (scanning) return;
  scanning = true;
  try { await app.locals.scanNotifications(); }
  catch (error) { console.error('推送扫描失败：', error); }
  finally { scanning = false; }
};
const timer = setInterval(runScan, 30_000);
timer.unref();
void runScan();

const shutdown = () => {
  clearInterval(timer);
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

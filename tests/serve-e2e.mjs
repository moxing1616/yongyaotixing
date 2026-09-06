import { createApp } from '../server/app.mjs';
const app = createApp({ dbPath: ':memory:', keysPath: null, env: { NODE_ENV: 'test' } });
const server = app.listen(3401, '127.0.0.1', () => console.log('E2E fixture http://127.0.0.1:3401'));
process.on('SIGTERM', () => server.close(() => { app.locals.close(); process.exit(0); }));

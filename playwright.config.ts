import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false,
  workers: 1, retries: 0, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:3401', channel: 'msedge', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/serve-e2e.mjs', url: 'http://127.0.0.1:3401/api/health', reuseExistingServer: false, timeout: 30000 },
})

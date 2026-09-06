import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const svg = await fs.readFile('public/icon.svg', 'utf8');
for (const size of [192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#526f58}svg{width:100%;height:100%}</style>${svg}`);
  await page.screenshot({ path: `public/icon-${size}.png` });
}
await browser.close();

// Rack stress test for the M2 build: 1,000-solid STEP (7.9 MB).
// Run separately — it is slow. Serves dist/ via `vite preview`.
// Run: npm run preview (background) then node tests/verify-m2-rack.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'test-fixtures');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/home/hatch/.cache/puppeteer/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

const PORT = process.env.PORT || '4173';
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => window.__viewer !== undefined, { timeout: 15000 });

const input = await page.$('#file-input');
const t0 = Date.now();
await input.uploadFile(path.join(FIX, 'rack1000.step'));
let st;
try {
  await page.waitForFunction(
    () => window.__viewer.getState().loaded && window.__viewer.getState().fileName === 'rack1000.step',
    { timeout: 240000 },
  );
  st = await page.evaluate(() => window.__viewer.getState());
} catch {
  st = await page.evaluate(() => window.__viewer.getState());
}
const wallMs = Date.now() - t0;
const okParts = st.parts === 1000;
const okBbox = st.bboxMm && [600, 63, 800].every((v, i) => Math.abs(st.bboxMm[i] - v) < 1.0);
const ok = st.loaded && okParts && okBbox && st.triangles > 0;
console.log(`${ok ? 'PASS' : 'FAIL'}  rack1000 STEP: loaded=${st.loaded} parts=${st.parts} tris=${st.triangles} bbox=${JSON.stringify(st.bboxMm?.map((v) => +v.toFixed(1)))} loadMs=${st.loadMs} wallMs=${wallMs}`);
console.log('status:', st.status);
await page.screenshot({ path: path.join(SHOTS, 'm2_rack1000.png') });
console.log('\nconsole errors:', JSON.stringify(consoleErrors, null, 1));
console.log('page errors:', JSON.stringify(pageErrors, null, 1));
await browser.close();
process.exit(ok && !consoleErrors.length && !pageErrors.length ? 0 : 1);

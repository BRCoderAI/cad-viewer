// Headless verification for the M2 build (B-rep core + Draco GLB).
// Serves dist/ via `vite preview`, loads every B-rep fixture through the
// real file input, and checks the viewer's own state hook + console errors.
// Also verifies the OCCT WASM is NOT fetched on first page load, and that
// the deflection control re-tessellates the open file.
// Run: npm run preview (background) then node tests/verify-m2.mjs
// (Rack stress test lives in verify-m2-rack.mjs — it is slow.)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'test-fixtures');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const CASES = [
  { label: 'STEP AP214 (servo)', files: ['micro_servo.step'], expect: { parts: 6, bbox: [12.0, 31.3, 30.7] } },
  { label: 'STEP AP214 (pulley)', files: ['timing_pulley.step'], expect: { parts: 1, bbox: [25.5, 17.0, 25.5] } },
  { label: 'STEP AP214 (nema17, invalid)', files: ['nema17.step'], expect: { parts: 5, bbox: [42.3, 55.0, 42.3] } },
  { label: 'STEP AP242 (servo)', files: ['micro_servo_ap242.step'], expect: { parts: 6, bbox: [12.0, 31.3, 30.7] } },
  { label: 'IGES (servo)', files: ['micro_servo.iges'], expect: { bbox: [12.0, 31.3, 30.7] } },
  { label: 'IGES (pulley)', files: ['timing_pulley.iges'], expect: { bbox: [25.5, 17.0, 25.5] } },
  { label: 'IGES (nema17, invalid)', files: ['nema17.iges'], expect: { bbox: [42.3, 55.0, 42.3] } },
  { label: 'BREP (servo)', files: ['micro_servo.brep'], expect: { bbox: [12.0, 31.3, 30.7], named: false } },
  { label: 'BREP (pulley)', files: ['timing_pulley.brep'], expect: { bbox: [25.5, 17.0, 25.5], named: false } },
  { label: 'BREP (nema17, invalid)', files: ['nema17.brep'], expect: { bbox: [42.3, 55.0, 42.3], named: false } },
  { label: 'GLB Draco (servo)', files: ['micro_servo_draco.glb'], expect: { tris: 5282, bbox: [12.0, 30.7, 31.3] } },
];

const browser = await puppeteer.launch({
  executablePath: '/home/hatch/.cache/puppeteer/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const consoleErrors = [];
const pageErrors = [];
const occtRequests = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('request', (req) => {
  if (req.url().includes('occt')) occtRequests.push(req.url());
});

// Browser-level CDP: worker fetches are invisible to page.on('request'),
// so capture network from every target (including the OCCT worker) too.
// (This puppeteer version has no createBrowserCDPSession; attach via the
// browser target and enable Network on each attached session.)
const browserSession = await browser.target().createCDPSession();
await browserSession.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
browserSession.on('Target.attachedToTarget', (params) => {
  if (params.sessionId) {
    browserSession.send('Network.enable', undefined, params.sessionId).catch(() => {});
  }
});
browserSession.on('Network.requestWillBeSent', (params) => {
  const url = params.request?.url || '';
  if (url.includes('occt')) occtRequests.push(url);
});

const PORT = process.env.PORT || '4173';
const BASE = `http://localhost:${PORT}/`;
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => window.__viewer !== undefined, { timeout: 15000 });

const results = [];
async function state() {
  return page.evaluate(() => window.__viewer.getState());
}

// 1. WASM must NOT be fetched on first page load (lazy load).
{
  const ok = occtRequests.length === 0;
  results.push({ case: 'WASM not fetched on first load', ok, requests: occtRequests });
  console.log(`${ok ? 'PASS' : 'FAIL'}  WASM not fetched on first load: ${occtRequests.length} occt requests`);
}

for (const c of CASES) {
  const paths = c.files.map((f) => path.join(FIX, f));
  const input = await page.$('#file-input');
  await input.uploadFile(...paths);
  let st;
  try {
    await page.waitForFunction(
      (want) => window.__viewer.getState().loaded && window.__viewer.getState().fileName === want,
      { timeout: 60000 },
      c.files[0],
    );
    st = await state();
  } catch {
    st = await state();
  }
  const okTris = c.expect.tris ? st.triangles === c.expect.tris : st.triangles > 0;
  const okParts = c.expect.parts ? st.parts === c.expect.parts : st.parts > 0;
  let okBbox = true;
  if (c.expect.bbox && st.bboxMm) {
    okBbox = c.expect.bbox.every((v, i) => Math.abs(st.bboxMm[i] - v) < 0.5);
  } else if (c.expect.bbox) {
    okBbox = false;
  }
  const namedParts = st.partNames.filter((n) => n && !/^Part \d+$/.test(n)).length;
  // BREP carries no product names by design, so it falls back to "Part N";
  // STEP/IGES must surface real names.
  const okNames = (c.label.includes('STEP') || c.label.includes('IGES')) && c.expect.named !== false
    ? namedParts > 0
    : true;
  const ok = st.loaded && okTris && okParts && okBbox && okNames;
  results.push({ case: c.label, ok, file: st.fileName, format: st.format, triangles: st.triangles, parts: st.parts, namedParts, partNames: st.partNames, partColors: st.partColors, bboxMm: st.bboxMm?.map((v) => +v.toFixed(1)), loadMs: st.loadMs, status: st.status });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}: loaded=${st.loaded} tris=${st.triangles} parts=${st.parts} named=${namedParts} bbox=${JSON.stringify(st.bboxMm?.map((v) => +v.toFixed(1)))} loadMs=${st.loadMs}`);
  console.log(`      names=${JSON.stringify(st.partNames)} colors=${JSON.stringify(st.partColors)}`);
  await page.screenshot({ path: path.join(SHOTS, 'm2_' + c.label.replace(/[^a-z0-9]+/gi, '_') + '.png') });
  await page.click('#btn-clear');
  await new Promise((r) => setTimeout(r, 300));
}

// 2. The OCCT files must have been fetched by now (first B-rep load
// pulled the JS + WASM in through the worker). When run against the
// logging static server (see BUILD_M2.md), the server log is the
// network-level proof; the CDP capture above is best-effort only.
{
  const js = occtRequests.filter((u) => u.endsWith('.js')).length;
  const wasm = occtRequests.filter((u) => u.endsWith('.wasm')).length;
  const serverLog = process.env.SERVER_LOG || '';
  let logHits = [];
  if (serverLog && fs.existsSync(serverLog)) {
    logHits = fs.readFileSync(serverLog, 'utf-8').split('\n').filter((l) => l.includes('occt-import-js'));
  }
  const logJs = logHits.filter((l) => l.includes('.js')).length;
  const logWasm = logHits.filter((l) => l.includes('.wasm')).length;
  const ok = (js >= 1 && wasm >= 1) || (logJs >= 1 && logWasm >= 1);
  results.push({ case: 'OCCT JS+WASM fetched on first B-rep load', ok, js, wasm, logJs, logWasm });
  console.log(`${ok ? 'PASS' : 'FAIL'}  OCCT JS+WASM fetched on first B-rep load: cdp js=${js} wasm=${wasm} | server-log js=${logJs} wasm=${logWasm}`);
}

// 3. Deflection control re-tessellates: coarse < medium < fine triangles.
{
  const input = await page.$('#file-input');
  await input.uploadFile(path.join(FIX, 'micro_servo.step'));
  await page.waitForFunction(() => window.__viewer.getState().loaded, { timeout: 60000 });
  const medium = (await state()).triangles;
  await page.select('#sel-deflection', 'fine');
  await page.waitForFunction(
    () => window.__viewer.getState().status.includes('Re-tessellated'),
    { timeout: 60000 },
  );
  const fine = (await state()).triangles;
  await page.select('#sel-deflection', 'coarse');
  await page.waitForFunction(
    () => window.__viewer.getState().status.includes('Re-tessellated'),
    { timeout: 60000 },
  );
  const coarse = (await state()).triangles;
  const ok = coarse < medium && medium < fine;
  results.push({ case: 'deflection coarse < medium < fine', ok, coarse, medium, fine });
  console.log(`${ok ? 'PASS' : 'FAIL'}  deflection triangles: coarse=${coarse} medium=${medium} fine=${fine}`);
  await page.screenshot({ path: path.join(SHOTS, 'm2_deflection_fine.png') });
  await page.click('#btn-clear');
}

// 4. Refusals still work (JT by name, unknown extension).
for (const r of [
  { label: 'JT refused by name', file: 'dummy.jt', wantInToast: 'JT (.jt) is a proprietary format' },
  { label: 'unknown extension', file: 'dummy.txt', wantInToast: 'unrecognised format' },
]) {
  const input = await page.$('#file-input');
  await input.uploadFile(path.join(FIX, r.file));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const toast = await page.$eval('#toast', (el) => (el.hidden ? '' : el.textContent));
  const st = await state();
  const ok = toast.includes(r.wantInToast) && !st.loaded;
  results.push({ case: r.label, ok, toast: toast.slice(0, 120) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.label}: toast=${JSON.stringify(toast.slice(0, 100))} loaded=${st.loaded}`);
}

console.log('\nconsole errors:', JSON.stringify(consoleErrors, null, 1));
console.log('page errors:', JSON.stringify(pageErrors, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${failed.length} failed`);
await browser.close();
process.exit(failed.length || consoleErrors.length || pageErrors.length ? 1 : 0);

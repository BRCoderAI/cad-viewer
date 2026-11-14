// Headless verification for the M0+M1 build.
// Serves dist/ via `vite preview`, loads every fixture through the real
// file input, and checks the viewer's own state hook + console errors.
// Run: npm run preview (background) then node tests/verify.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'test-fixtures');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// dummy files for the refusal paths
fs.writeFileSync(path.join(FIX, 'dummy.jt'), 'JT dummy — not a real JT file\n');
fs.writeFileSync(path.join(FIX, 'dummy.txt'), 'just text\n');

const CASES = [
  { label: 'STL binary (servo)', files: ['micro_servo.stl'], expect: { tris: 5282, bbox: [12.0, 31.3, 30.7] } },
  { label: 'STL ASCII (servo)', files: ['micro_servo_ascii.stl'], expect: { tris: 5282 } },
  { label: 'STL binary (pulley)', files: ['timing_pulley.stl'], expect: { tris: 21240, bbox: [25.5, 17.0, 25.5] } },
  { label: 'OBJ + MTL (servo)', files: ['micro_servo.obj', 'micro_servo.mtl'], expect: { tris: 5282 } },
  { label: 'OBJ (pulley, no MTL)', files: ['timing_pulley.obj'], expect: { tris: 21240 } },
  { label: 'glTF (servo)', files: ['micro_servo.gltf', 'micro_servo.bin'], expect: { tris: 5282, bbox: [12.0, 30.7, 31.3] } },
  { label: 'GLB (pulley)', files: ['timing_pulley.glb'], expect: { tris: 21240, bbox: [25.5, 25.5, 17.0] } },
  { label: 'PLY (servo)', files: ['micro_servo.ply'], expect: { tris: 5282 } },
  { label: 'AMF (pulley)', files: ['timing_pulley.amf'], expect: { tris: 21240 } },
];

const REFUSALS = [
  { label: 'JT refused by name', file: 'dummy.jt', wantInToast: 'JT (.jt) is a proprietary format' },
  { label: 'unknown extension', file: 'dummy.txt', wantInToast: 'unrecognised format' },
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
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => window.__viewer !== undefined, { timeout: 15000 });
const webgl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  return !!c.getContext('webgl2');
});
console.log('WebGL2 available in headless Chromium:', webgl);

const results = [];
async function state() {
  return page.evaluate(() => window.__viewer.getState());
}

for (const c of CASES) {
  const paths = c.files.map((f) => path.join(FIX, f));
  const input = await page.$('#file-input');
  await input.uploadFile(...paths);
  let st;
  try {
    await page.waitForFunction(
      (want) => window.__viewer.getState().loaded && window.__viewer.getState().fileName === want,
      { timeout: 20000 },
      c.files[0],
    );
    st = await state();
  } catch {
    st = await state();
  }
  const okTris = c.expect.tris ? st.triangles === c.expect.tris : st.triangles > 0;
  let okBbox = true;
  if (c.expect.bbox && st.bboxMm) {
    okBbox = c.expect.bbox.every((v, i) => Math.abs(st.bboxMm[i] - v) < 0.5);
  }
  const ok = st.loaded && okTris && okBbox;
  results.push({ case: c.label, ok, file: st.fileName, format: st.format, triangles: st.triangles, parts: st.parts, bboxMm: st.bboxMm?.map((v) => +v.toFixed(1)), status: st.status });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}: loaded=${st.loaded} tris=${st.triangles} parts=${st.parts} bbox=${JSON.stringify(st.bboxMm?.map((v) => +v.toFixed(1)))}`);
  await page.screenshot({ path: path.join(SHOTS, c.label.replace(/[^a-z0-9]+/gi, '_') + '.png') });
  // clear for the next case
  await page.click('#btn-clear');
  await new Promise((r) => setTimeout(r, 300));
}

// wireframe + units smoke test on the pulley STL
{
  const input = await page.$('#file-input');
  await input.uploadFile(path.join(FIX, 'timing_pulley.stl'));
  await page.waitForFunction(() => window.__viewer.getState().loaded, { timeout: 20000 });
  await page.click('#btn-wire');
  const pressed = await page.$eval('#btn-wire', (b) => b.getAttribute('aria-pressed'));
  await page.select('#sel-units', 'in');
  const dims = await page.$eval('#file-info', (el) => el.textContent);
  const inchOk = /1 × 0\.67 × 1 in/.test(dims);
  console.log(`wireframe toggle aria-pressed=${pressed} (want true)`);
  console.log(`units inch display ok=${inchOk} :: ${dims.replace(/\s+/g, ' ').slice(0, 160)}`);
  results.push({ case: 'wireframe toggle', ok: pressed === 'true' });
  results.push({ case: 'units inch display', ok: inchOk });
  await page.screenshot({ path: path.join(SHOTS, 'wireframe_inch.png') });
  await page.click('#btn-clear');
}

// refusal paths
for (const r of REFUSALS) {
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

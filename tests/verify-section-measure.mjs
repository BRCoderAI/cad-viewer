// Headless verification for sectional views + measure tools.
// Serves dist/ via `vite preview`, loads the micro servo STEP through the
// real file input, and drives the Section / Measure UI with real clicks.
// Ground truth for the measure test comes from an independent OCCT 8.0
// probe of the same STEP (see BUILD_SECTION_MEASURE.md): two points on
// the camera-facing (+X) side face, exactly 10.0 mm apart.
// Run: npm run preview (background) then node tests/verify-section-measure.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'test-fixtures');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// Independent ground truth (OCCT 8.0 probe, /tmp/probe_measure.py):
// both points lie on the servo's +X side face (x = 6.0), 10.0 mm apart.
const P1 = [6.0, 0.3, -9.4];
const P2 = [6.0, 10.3, -9.4];
const EXPECTED_MM = 10.0;

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
const BASE = `http://localhost:${PORT}/`;
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => window.__viewer !== undefined, { timeout: 15000 });

const results = [];
function check(name, ok, detail = '') {
  results.push({ case: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ': ' + detail : ''}`);
}
async function state() {
  return page.evaluate(() => window.__viewer.getState());
}
const close = (a, b, tol) => Math.abs(a - b) <= tol;

// --- load the servo STEP ---
const input = await page.$('#file-input');
await input.uploadFile(path.join(FIX, 'micro_servo.step'));
await page.waitForFunction(() => window.__viewer.getState().loaded, { timeout: 60000 });
let st = await state();
check('servo STEP loads', st.loaded && st.parts === 6, `parts=${st.parts} bbox=${JSON.stringify(st.bboxMm)}`);
check(
  'bbox matches simprep audit',
  st.bboxMm?.every((v, i) => close(v, [12.0, 31.3, 30.7][i], 0.5)),
  `bbox=${JSON.stringify(st.bboxMm?.map((v) => +v.toFixed(1)))}`,
);

// --- 1. bounding-box dimensions in the file panel (always mm) ---
{
  const text = await page.$eval('#file-info', (el) => el.textContent);
  const ok = text.includes('Dimensions (X × Y × Z): 12 × 31.3 × 30.68 mm');
  check('file panel shows Dimensions in mm', ok, JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 200)));
}

// --- 2. section: baseline screenshot, then enable + cut ---
await page.screenshot({ path: path.join(SHOTS, 'section_baseline.png') });
await page.click('#btn-section');
st = await state();
check('section toggle on', st.section.enabled === true && st.section.axis === 'x', JSON.stringify(st.section));
{
  // Slider range must span the model bbox along X (-6..6 — the STEP is
  // centred on the origin), offset at the centre (0).
  const slider = await page.$eval('#rng-section', (el) => ({ min: +el.min, max: +el.max, value: +el.value, disabled: el.disabled }));
  const ok = close(slider.min, -6, 0.05) && close(slider.max, 6, 0.05) && close(slider.value, 0, 0.05) && !slider.disabled;
  check('section slider spans bbox X with centre offset', ok, JSON.stringify(slider));
  const info = await page.$eval('#section-info', (el) => el.textContent);
  check('section info names the cut', info.includes('Cutting at X = 0 mm'), JSON.stringify(info));
}
{
  // Move the slider to X = 3 and confirm the state follows.
  await page.$eval('#rng-section', (el) => {
    el.value = '3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  st = await state();
  check('slider moves the cut', close(st.section.offsetMm, 3, 0.01), `offset=${st.section.offsetMm}`);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(SHOTS, 'section_x3.png') });
  const a = fs.readFileSync(path.join(SHOTS, 'section_baseline.png'));
  const b = fs.readFileSync(path.join(SHOTS, 'section_x3.png'));
  check('section changes the render', !a.equals(b), `baseline=${a.length}B section=${b.length}B`);
}
{
  // Flip keeps the offset but reverses the kept side.
  await page.click('#btn-section-flip');
  st = await state();
  check('flip reverses kept side', st.section.flipped === true && close(st.section.offsetMm, 3, 0.01), JSON.stringify(st.section));
  await page.click('#btn-section-flip');
  st = await state();
  check('flip back', st.section.flipped === false, JSON.stringify(st.section));
}
{
  // Axis Y: slider range must follow the bbox Y span.
  await page.select('#sel-section-axis', 'y');
  await new Promise((r) => setTimeout(r, 200));
  const slider = await page.$eval('#rng-section', (el) => ({ min: +el.min, max: +el.max, value: +el.value }));
  st = await state();
  const ok = close(slider.min, st.bboxMinMm[1], 0.05) && close(slider.max, st.bboxMaxMm[1], 0.05)
    && close(slider.value, (st.bboxMinMm[1] + st.bboxMaxMm[1]) / 2, 0.05);
  check('axis Y re-ranges the slider to bbox Y', ok, JSON.stringify({ slider, ymin: st.bboxMinMm[1], ymax: st.bboxMaxMm[1] }));
  // Back to X at the centre (0.0) for the visual check.
  await page.select('#sel-section-axis', 'x');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(SHOTS, 'section_x0.png') });
}

// --- 3. measure: two real clicks on the ground-truth points ---
await page.click('#btn-section'); // section off again — measure the whole model
await page.click('#btn-measure');
st = await state();
check('measure mode on', st.measure.mode === true, JSON.stringify(st.measure.mode));
{
  const s1 = await page.evaluate((p) => window.__viewer.project(p), P1);
  const s2 = await page.evaluate((p) => window.__viewer.project(p), P2);
  check('ground-truth points project on screen', s1 !== null && s2 !== null, `s1=${JSON.stringify(s1)} s2=${JSON.stringify(s2)}`);
  await page.mouse.click(s1[0], s1[1]);
  await new Promise((r) => setTimeout(r, 300));
  st = await state();
  check('first click places one point', st.measure.points.length === 1, JSON.stringify(st.measure.points));
  await page.mouse.click(s2[0], s2[1]);
  await page.waitForFunction(() => window.__viewer.getState().measure.points.length === 2, { timeout: 10000 });
  st = await state();
  const [q1, q2] = st.measure.points;
  const okP1 = q1.every((v, i) => close(v, P1[i], 0.5));
  const okP2 = q2.every((v, i) => close(v, P2[i], 0.5));
  check('picked points match ground truth (0.5 mm)', okP1 && okP2,
    `q1=${JSON.stringify(q1.map((v) => +v.toFixed(2)))} q2=${JSON.stringify(q2.map((v) => +v.toFixed(2)))}`);
  check('measured distance is 10.0 mm (0.5 mm)', st.measure.distanceMm !== null && close(st.measure.distanceMm, EXPECTED_MM, 0.5),
    `distanceMm=${st.measure.distanceMm}`);
  const label = await page.$eval('#measure-label', (el) => ({ hidden: el.hidden, text: el.textContent }));
  check('distance label shows 10 mm', !label.hidden && label.text.includes('10 mm'), JSON.stringify(label));
  const panel = await page.$eval('#measure-info', (el) => el.textContent);
  check('measure panel lists both points + distance', panel.includes('Point 1') && panel.includes('Point 2') && panel.includes('10 mm'),
    JSON.stringify(panel.replace(/\s+/g, ' ').slice(0, 200)));
  await page.screenshot({ path: path.join(SHOTS, 'measure_10mm.png') });
}
{
  // Units: the same measurement in cm.
  await page.select('#sel-units', 'cm');
  await new Promise((r) => setTimeout(r, 300));
  const label = await page.$eval('#measure-label', (el) => el.textContent);
  st = await state();
  check('units cm converts the label', label.includes('1 cm') && close(st.measure.distanceMm, 10, 0.01),
    `label=${JSON.stringify(label)} distanceMm=${st.measure.distanceMm}`);
  await page.select('#sel-units', 'mm');
}
{
  // A third click restarts the measurement with a single point.
  const s1 = await page.evaluate((p) => window.__viewer.project(p), P1);
  await page.mouse.click(s1[0], s1[1]);
  await new Promise((r) => setTimeout(r, 300));
  st = await state();
  check('third click restarts measurement', st.measure.points.length === 1, `points=${st.measure.points.length}`);
  await page.mouse.click(...(await page.evaluate((p) => window.__viewer.project(p), P2)));
  await page.waitForFunction(() => window.__viewer.getState().measure.points.length === 2, { timeout: 10000 });
}
{
  // Clear button empties the measurement and hides the label.
  await page.click('#btn-measure-clear');
  await new Promise((r) => setTimeout(r, 200));
  st = await state();
  const labelHidden = await page.$eval('#measure-label', (el) => el.hidden);
  check('clear empties measurement', st.measure.points.length === 0 && st.measure.distanceMm === null && labelHidden,
    `points=${st.measure.points.length} labelHidden=${labelHidden}`);
}
{
  // Clicking empty space places no point.
  await page.mouse.click(1250, 750);
  await new Promise((r) => setTimeout(r, 300));
  st = await state();
  check('click on empty space places no point', st.measure.points.length === 0, `points=${st.measure.points.length}`);
}

// --- 4. section + measure together: a click on the cut-away side must not pick there ---
{
  await page.click('#btn-section'); // section on, X = centre (6.0) by default
  await page.$eval('#rng-section', (el) => {
    el.value = '3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const s1 = await page.evaluate((p) => window.__viewer.project(p), P1); // P1 is at x=6, cut away (kept: x<=3)
  await page.mouse.click(s1[0], s1[1]);
  await new Promise((r) => setTimeout(r, 300));
  st = await state();
  const p = st.measure.points[0];
  const ok = st.measure.points.length === 1 && p !== undefined && p[0] <= 3.05;
  check('measure skips the cut-away side', ok, `picked=${JSON.stringify(p?.map((v) => +v.toFixed(2)))}`);
  await page.click('#btn-measure-clear');
  await page.click('#btn-section'); // section off
}

// --- 5. section on a second model (pulley) re-ranges correctly ---
{
  await page.click('#btn-clear');
  await new Promise((r) => setTimeout(r, 300));
  const input2 = await page.$('#file-input');
  await input2.uploadFile(path.join(FIX, 'timing_pulley.step'));
  await page.waitForFunction(() => window.__viewer.getState().loaded, { timeout: 60000 });
  st = await state();
  check('pulley loads after clear', st.loaded && st.parts === 1, `parts=${st.parts}`);
  await page.click('#btn-section');
  await new Promise((r) => setTimeout(r, 300));
  st = await state();
  const slider = await page.$eval('#rng-section', (el) => ({ min: +el.min, max: +el.max }));
  const ok = close(slider.min, st.bboxMinMm[0], 0.05) && close(slider.max, st.bboxMaxMm[0], 0.05);
  check('section re-ranges for the new model', ok, JSON.stringify({ slider, xmin: st.bboxMinMm[0], xmax: st.bboxMaxMm[0] }));
  await page.screenshot({ path: path.join(SHOTS, 'section_pulley.png') });
}

console.log('\nconsole errors:', JSON.stringify(consoleErrors, null, 1));
console.log('page errors:', JSON.stringify(pageErrors, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${failed.length} failed`);
await browser.close();
process.exit(failed.length || consoleErrors.length || pageErrors.length ? 1 : 0);

// CAD Viewer — M0 scaffold + M1 mesh formats + M2 B-rep core.
//
// Pure client-side: files are read with the File API and never leave the
// machine. B-rep formats (STEP/IGES/BREP) are parsed by OCCT in WASM
// inside a Web Worker, lazy-loaded on first B-rep open (see brep.ts).
// Proprietary formats are refused by name with the STEP workaround
// (SCOPE.md §6).

import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { identifyFile, brepFormatId } from './formats';
import { loadModel, type LoadedModel } from './loaders';
import {
  parseBrep,
  brepToModel,
  DEFLECTION_PRESETS,
  DEFAULT_DEFLECTION_KEY,
  type BrepFormat,
} from './brep';

type Unit = 'mm' | 'cm' | 'in';
const UNIT_FACTOR: Record<Unit, number> = { mm: 1, cm: 0.1, in: 1 / 25.4 };
const UNIT_LABEL: Record<Unit, string> = { mm: 'mm', cm: 'cm', in: 'in' };

// ---------- DOM ----------
const viewport = document.getElementById('viewport') as HTMLDivElement;
const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const dropOverlay = document.getElementById('drop-overlay') as HTMLDivElement;
const toast = document.getElementById('toast') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const statusStats = document.getElementById('status-stats') as HTMLSpanElement;
const fileInfo = document.getElementById('file-info') as HTMLDivElement;
const partList = document.getElementById('part-list') as HTMLUListElement;
const partsEmpty = document.getElementById('parts-empty') as HTMLDivElement;
const partCount = document.getElementById('part-count') as HTMLSpanElement;
const btnOpen = document.getElementById('btn-open') as HTMLButtonElement;
const btnFit = document.getElementById('btn-fit') as HTMLButtonElement;
const btnWire = document.getElementById('btn-wire') as HTMLButtonElement;
const btnGrid = document.getElementById('btn-grid') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnMeasure = document.getElementById('btn-measure') as HTMLButtonElement;
const btnSection = document.getElementById('btn-section') as HTMLButtonElement;
const selUnits = document.getElementById('sel-units') as HTMLSelectElement;
const selDeflection = document.getElementById('sel-deflection') as HTMLSelectElement;
const selSectionAxis = document.getElementById('sel-section-axis') as HTMLSelectElement;
const rngSection = document.getElementById('rng-section') as HTMLInputElement;
const btnSectionFlip = document.getElementById('btn-section-flip') as HTMLButtonElement;
const sectionInfo = document.getElementById('section-info') as HTMLDivElement;
const measureInfo = document.getElementById('measure-info') as HTMLDivElement;
const btnMeasureClear = document.getElementById('btn-measure-clear') as HTMLButtonElement;
const measureLabel = document.getElementById('measure-label') as HTMLDivElement;

// ---------- three.js scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
/** Clipping planes (section view) need this on; materials carry the plane. */
renderer.localClippingEnabled = true;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
camera.position.set(120, 90, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(120, 180, 90);
scene.add(key);
const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
fill.position.set(-100, 60, -120);
scene.add(fill);

const grid = new THREE.GridHelper(200, 20, 0x2a3342, 0x1c2330);
grid.position.y = -0.01;
scene.add(grid);

// ---------- state ----------
let current: { model: LoadedModel; fileName: string; formatLabel: string; bboxMm: THREE.Box3 } | null = null;
let selectedMesh: THREE.Mesh | null = null;
let units: Unit = 'mm';
let wireframe = false;
/** Tessellation detail for B-rep files; re-parses the open file on change. */
let deflectionKey = DEFAULT_DEFLECTION_KEY;
/** The open B-rep file (if any), kept so a deflection change can re-parse it. */
let lastBrep: { file: File; format: BrepFormat } | null = null;
/** Milliseconds the current model took to load (parse + build). */
let loadMs = 0;

// ---------- section (clipping plane, mesh level) ----------
type SectionAxis = 'x' | 'y' | 'z';
const AXIS_INDEX: Record<SectionAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
let sectionEnabled = false;
let sectionAxis: SectionAxis = 'x';
/** Section plane offset in mm (world/model coordinates). */
let sectionOffsetMm = 0;
let sectionFlipped = false;
/** The single clipping plane, shared by every model material (updated in place). */
const sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
/** Translucent visualisation of the section plane; never clipped, never raycast. */
let sectionHelper: THREE.Mesh | null = null;

// ---------- measure (point-to-point, on the tessellated mesh) ----------
const raycaster = new THREE.Raycaster();
let measureMode = false;
/** Picked points in mm (world coordinates); 0, 1 or 2 entries. */
let measurePoints: THREE.Vector3[] = [];
let measureGroup: THREE.Group | null = null;
/** Midpoint of the current measurement, for the screen label. */
const measureMidpoint = new THREE.Vector3();
/** Last pointerdown position, to tell a click apart from an orbit drag. */
let pointerDownPos: [number, number] | null = null;

function resize(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
window.addEventListener('resize', resize);
resize();

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  // Keep the measure label pinned to the midpoint of the measurement.
  if (!measureLabel.hidden && measurePoints.length === 2) {
    const v = measureMidpoint.clone().project(camera);
    if (v.z > 1) {
      measureLabel.hidden = true;
    } else {
      const rect = viewport.getBoundingClientRect();
      measureLabel.style.left = `${(v.x * 0.5 + 0.5) * rect.width}px`;
      measureLabel.style.top = `${(-v.y * 0.5 + 0.5) * rect.height}px`;
    }
  }
}
animate();

// ---------- helpers ----------
function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatDims(box: THREE.Box3): string {
  const size = new THREE.Vector3();
  box.getSize(size);
  const f = UNIT_FACTOR[units];
  const u = UNIT_LABEL[units];
  return `${fmt(size.x * f)} × ${fmt(size.y * f)} × ${fmt(size.z * f)} ${u}`;
}

let toastTimer: number | undefined;
function showToast(message: string, kind: 'error' | 'info' = 'error', ms = 8000): void {
  toast.textContent = message;
  toast.className = kind === 'info' ? 'info' : '';
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, ms);
}

function setStatus(text: string, stats = ''): void {
  statusText.textContent = text;
  statusStats.textContent = stats;
}

function fitToView(): void {
  if (!current) return;
  const box = current.bboxMm;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const dist = (maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.6;
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.lengthSq() === 0) dir.set(1, 0.7, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(dist / 1000, 0.01);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

// ---------- section ----------
function sectionRange(): [number, number] | null {
  if (!current) return null;
  const i = AXIS_INDEX[sectionAxis];
  return [current.bboxMm.min.getComponent(i), current.bboxMm.max.getComponent(i)];
}

/** Recompute the clipping plane from axis / offset / flip (same object, updated in place). */
function updateSectionPlane(): void {
  const i = AXIS_INDEX[sectionAxis];
  const n = new THREE.Vector3();
  n.setComponent(i, sectionFlipped ? 1 : -1);
  sectionPlane.normal.copy(n);
  // Kept side is normal·p + constant >= 0: unflipped keeps axis <= offset.
  sectionPlane.constant = sectionFlipped ? -sectionOffsetMm : sectionOffsetMm;
}

/** Attach or detach the clipping plane on every model material (not the helper/markers). */
function applyClipping(): void {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child !== sectionHelper) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        m.clippingPlanes = sectionEnabled ? [sectionPlane] : null;
        // The plane count is part of the shader program — recompile on toggle.
        m.needsUpdate = true;
      }
    }
  });
}

function disposeSectionHelper(): void {
  if (!sectionHelper) return;
  scene.remove(sectionHelper);
  sectionHelper.geometry.dispose();
  (sectionHelper.material as THREE.Material).dispose();
  sectionHelper = null;
}

/** Rebuild the translucent plane visualisation at the current cut position. */
function updateSectionHelper(): void {
  disposeSectionHelper();
  if (!sectionEnabled || !current) return;
  const box = current.bboxMm;
  const i = AXIS_INDEX[sectionAxis];
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const dims = [size.x, size.y, size.z].filter((_, k) => k !== i);
  const geo = new THREE.PlaneGeometry(dims[0], dims[1]);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x58a6ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  if (sectionAxis === 'x') {
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(sectionOffsetMm, center.y, center.z);
  } else if (sectionAxis === 'y') {
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(center.x, sectionOffsetMm, center.z);
  } else {
    mesh.position.set(center.x, center.y, sectionOffsetMm);
  }
  mesh.renderOrder = 10;
  sectionHelper = mesh;
  scene.add(mesh);
}

function refreshSectionInfo(): void {
  if (!sectionEnabled) {
    sectionInfo.textContent = current
      ? 'Section off — press Section in the toolbar to cut the model.'
      : 'Section off — load a model first.';
    return;
  }
  const dir = sectionFlipped ? '≥' : '≤';
  sectionInfo.textContent =
    `Cutting at ${sectionAxis.toUpperCase()} = ${fmt(sectionOffsetMm)} mm — keeping ${sectionAxis} ${dir} ${fmt(sectionOffsetMm)} mm.`;
  if (current) {
    setStatus(
      `Section on — ${sectionAxis.toUpperCase()} = ${fmt(sectionOffsetMm)} mm.`,
      `${fmt(current.model.triangles)} triangles · ${formatDims(current.bboxMm)}`,
    );
  }
}

/** Sync slider range/value and control enablement with the loaded model. */
function refreshSectionControls(): void {
  const range = sectionRange();
  const hasModel = current !== null;
  selSectionAxis.disabled = !hasModel;
  btnSectionFlip.disabled = !hasModel || !sectionEnabled;
  rngSection.disabled = !hasModel || !sectionEnabled;
  if (range) {
    const [lo, hi] = range;
    rngSection.min = String(lo.toFixed(2));
    rngSection.max = String(hi.toFixed(2));
    rngSection.step = '0.1';
    sectionOffsetMm = THREE.MathUtils.clamp(sectionOffsetMm, lo, hi);
    rngSection.value = String(sectionOffsetMm);
  }
  updateSectionPlane();
  updateSectionHelper();
  refreshSectionInfo();
}

// ---------- measure ----------
function measureDistanceMm(): number | null {
  if (measurePoints.length < 2) return null;
  return measurePoints[0].distanceTo(measurePoints[1]);
}

function formatDistance(mm: number): string {
  return `${fmt(mm * UNIT_FACTOR[units])} ${UNIT_LABEL[units]}`;
}

function rebuildMeasureGraphics(): void {
  if (measureGroup) {
    scene.remove(measureGroup);
    measureGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    measureGroup = null;
  }
  if (measurePoints.length === 0) return;
  const maxDim = current
    ? Math.max(current.bboxMm.max.x - current.bboxMm.min.x, current.bboxMm.max.y - current.bboxMm.min.y, current.bboxMm.max.z - current.bboxMm.min.z, 1)
    : 30;
  const r = THREE.MathUtils.clamp(maxDim * 0.006, 0.15, 1.5);
  const group = new THREE.Group();
  for (const p of measurePoints) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb000 }),
    );
    marker.position.copy(p);
    group.add(marker);
  }
  if (measurePoints.length === 2) {
    const lineGeo = new THREE.BufferGeometry().setFromPoints(measurePoints);
    group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x58a6ff })));
  }
  measureGroup = group;
  scene.add(group);
}

function refreshMeasureDisplay(): void {
  const d = measureDistanceMm();
  if (measurePoints.length === 0) {
    measureInfo.textContent = measureMode
      ? 'Click two points on the model.'
      : 'Measure off — enable it in the toolbar, then click two points on the model.';
  } else if (measurePoints.length === 1) {
    const p = measurePoints[0];
    measureInfo.innerHTML =
      `Point 1: (${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}) mm<br/>Click a second point.`;
  } else {
    const p1 = measurePoints[0];
    const p2 = measurePoints[1];
    measureInfo.innerHTML =
      `Point 1: (${fmt(p1.x)}, ${fmt(p1.y)}, ${fmt(p1.z)}) mm<br/>` +
      `Point 2: (${fmt(p2.x)}, ${fmt(p2.y)}, ${fmt(p2.z)}) mm<br/>` +
      `<b>Distance: ${formatDistance(d!)} (${fmt(d!)} mm)</b>`;
  }
  btnMeasureClear.disabled = measurePoints.length === 0;
  if (d !== null) {
    measureLabel.textContent = formatDistance(d);
    measureLabel.hidden = false;
    measureMidpoint.copy(measurePoints[0]).add(measurePoints[1]).multiplyScalar(0.5);
  } else {
    measureLabel.hidden = true;
  }
}

function clearMeasurement(): void {
  measurePoints = [];
  rebuildMeasureGraphics();
  refreshMeasureDisplay();
}

function refreshFilePanel(): void {
  if (!current) {
    fileInfo.innerHTML = 'No file loaded.';
    return;
  }
  const { fileName, formatLabel, model, bboxMm } = current;
  const size = new THREE.Vector3();
  bboxMm.getSize(size);
  fileInfo.innerHTML =
    `<div class="fname">${escapeHtml(fileName)}</div>` +
    `<div>Format: ${escapeHtml(formatLabel)}</div>` +
    `<div>Size: ${formatDims(bboxMm)} <span class="muted">(${escapeHtml(model.unitsNote)})</span></div>` +
    `<div>Dimensions (X × Y × Z): ${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} mm</div>` +
    `<div>Triangles: ${fmt(model.triangles)} · Vertices: ${fmt(model.vertices)}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function orderedMeshes(): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  current?.model.object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  return meshes;
}

function selectMesh(mesh: THREE.Mesh | null): void {
  if (selectedMesh) {
    const mats = Array.isArray(selectedMesh.material) ? selectedMesh.material : [selectedMesh.material];
    for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) m.emissive.setHex(0x000000);
  }
  selectedMesh = mesh;
  if (mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) m.emissive.setHex(0x1f6feb);
  }
  const selectedIndex = mesh ? orderedMeshes().indexOf(mesh) : -1;
  for (const li of partList.children) {
    li.classList.toggle('selected', Number((li as HTMLLIElement).dataset.meshIndex) === selectedIndex);
  }
}

function rebuildPartList(): void {
  partList.innerHTML = '';
  if (!current) {
    partsEmpty.hidden = false;
    partCount.textContent = '';
    return;
  }
  partsEmpty.hidden = true;
  partCount.textContent = `(${current.model.meshes.length})`;
  // Stats are matched by position, not by name: B-rep assemblies routinely
  // give several solids the same path (e.g. four "… / body" solids), so a
  // name lookup would show the first solid's counts on every duplicate.
  const meshes = orderedMeshes();
  const stats = current.model.meshes;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const stat = stats[i];
    const li = document.createElement('li');
    li.dataset.meshIndex = String(i);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = mesh.visible;
    checkbox.title = 'Show / hide this part';
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => {
      mesh.visible = checkbox.checked;
    });
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = mesh.name;
    const tris = document.createElement('span');
    tris.className = 'ptris';
    tris.textContent = stat ? `${fmt(stat.triangles)} tris` : '';
    li.append(checkbox, name, tris);
    li.addEventListener('click', () => selectMesh(mesh));
    partList.appendChild(li);
  }
}

function clearModel(): void {
  if (current) {
    scene.remove(current.model.object);
    current.model.object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) m.dispose();
      }
    });
  }
  current = null;
  selectedMesh = null;
  lastBrep = null;
  loadMs = 0;
  clearMeasurement();
  refreshSectionControls();
  emptyState.hidden = false;
  rebuildPartList();
  refreshFilePanel();
  setStatus('Ready.');
}

async function openFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const modelFiles = files.filter((f) => !f.name.toLowerCase().endsWith('.mtl'));
  // Pick the first openable model file; .mtl files are only used as
  // companions to an OBJ of the same name (see loaders.ts).
  for (const file of modelFiles) {
    const info = await identifyFile(file);
    if (info.status === 'proprietary') {
      showToast(info.blockedMessage ?? `Cannot open ${info.label}.`, 'info');
      setStatus(`Refused ${file.name} — ${info.label} is not openable in this build.`);
      continue;
    }
    if (info.status !== 'supported') {
      showToast(
        `Cannot open "${file.name}" — unrecognised format.\nSupported here: STL, OBJ, glTF/GLB, PLY, AMF, STEP, IGES, BREP.`,
        'error',
      );
      setStatus(`Unrecognised file: ${file.name}.`);
      continue;
    }
    const t0 = performance.now();
    setStatus(`Loading ${file.name}…`);
    try {
      let model: LoadedModel;
      const brepFormat = brepFormatId(info.label);
      if (brepFormat) {
        setStatus(`Parsing ${file.name}… (OCCT WASM loads on the first B-rep file, ~8 MB)`);
        const parsed = await parseBrep(brepFormat, await file.arrayBuffer(), DEFLECTION_PRESETS[deflectionKey].params);
        model = brepToModel(parsed, info.label);
      } else {
        model = await loadModel(info.id, file, files);
      }
      if (model.triangles === 0) {
        showToast(`"${file.name}" loaded but contains no triangles.`, 'error');
        setStatus(`Empty model: ${file.name}.`);
        continue;
      }
      clearModel(); // also clears lastBrep — re-set below for B-rep files
      lastBrep = brepFormat ? { file, format: brepFormat } : null;
      current = {
        model,
        fileName: file.name,
        formatLabel: info.label,
        bboxMm: new THREE.Box3().setFromObject(model.object),
      };
      scene.add(model.object);
      emptyState.hidden = true;
      fitToView();
      rebuildPartList();
      refreshFilePanel();
      applyClipping();
      refreshSectionControls();
      loadMs = Math.round(performance.now() - t0);
      setStatus(
        `Loaded ${file.name} (${info.label}) in ${loadMs} ms.`,
        `${fmt(model.triangles)} triangles · ${formatDims(current.bboxMm)}`,
      );
      return; // one model at a time in this milestone
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Failed to open "${file.name}" (${info.label}):\n${msg}`);
      setStatus(`Failed to open ${file.name}: ${msg}`);
    }
  }
  if (modelFiles.length > 1) setStatus('Only the first openable model was loaded (one model at a time).');
}

// ---------- events ----------
btnOpen.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  void openFiles(Array.from(fileInput.files ?? []));
  fileInput.value = '';
});
btnFit.addEventListener('click', fitToView);
btnClear.addEventListener('click', clearModel);
btnWire.addEventListener('click', () => {
  wireframe = !wireframe;
  btnWire.setAttribute('aria-pressed', String(wireframe));
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) m.wireframe = wireframe;
    }
  });
});
btnGrid.addEventListener('click', () => {
  grid.visible = !grid.visible;
  btnGrid.setAttribute('aria-pressed', String(grid.visible));
});
btnSection.addEventListener('click', () => {
  sectionEnabled = !sectionEnabled;
  btnSection.setAttribute('aria-pressed', String(sectionEnabled));
  if (sectionEnabled && current) {
    const range = sectionRange();
    if (range) sectionOffsetMm = (range[0] + range[1]) / 2;
  }
  applyClipping();
  refreshSectionControls();
  if (current) {
    setStatus(
      sectionEnabled
        ? `Section on — ${sectionAxis.toUpperCase()} = ${fmt(sectionOffsetMm)} mm.`
        : 'Section off.',
      `${fmt(current.model.triangles)} triangles · ${formatDims(current.bboxMm)}`,
    );
  }
});
selSectionAxis.addEventListener('change', () => {
  sectionAxis = selSectionAxis.value as SectionAxis;
  if (current) {
    const range = sectionRange();
    if (range) sectionOffsetMm = (range[0] + range[1]) / 2;
  }
  refreshSectionControls();
});
rngSection.addEventListener('input', () => {
  sectionOffsetMm = Number(rngSection.value);
  updateSectionPlane();
  updateSectionHelper();
  refreshSectionInfo();
});
btnSectionFlip.addEventListener('click', () => {
  sectionFlipped = !sectionFlipped;
  updateSectionPlane();
  refreshSectionInfo();
});
btnMeasure.addEventListener('click', () => {
  measureMode = !measureMode;
  btnMeasure.setAttribute('aria-pressed', String(measureMode));
  renderer.domElement.style.cursor = measureMode ? 'crosshair' : '';
  refreshMeasureDisplay();
  setStatus(measureMode ? 'Measure on — click two points on the model.' : 'Measure off.');
});
btnMeasureClear.addEventListener('click', clearMeasurement);

/** Pick a measure point on a real click (not an orbit drag). */
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDownPos = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!pointerDownPos) return;
  const moved = Math.hypot(e.clientX - pointerDownPos[0], e.clientY - pointerDownPos[1]);
  pointerDownPos = null;
  if (moved > 6 || !measureMode || !current) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(orderedMeshes(), false);
  // A section plane hides geometry in the render, so ignore hits on the cut-away side.
  const hit = hits.find((h) => !sectionEnabled || sectionPlane.distanceToPoint(h.point) >= -1e-4);
  if (!hit) {
    setStatus('Measure: no surface under that click — try a point on the model.');
    return;
  }
  if (measurePoints.length === 2) measurePoints = [];
  measurePoints.push(hit.point.clone());
  rebuildMeasureGraphics();
  refreshMeasureDisplay();
  const d = measureDistanceMm();
  if (d !== null && current) {
    setStatus(
      `Measured ${formatDistance(d)} (${fmt(d)} mm).`,
      `${fmt(current.model.triangles)} triangles · ${formatDims(current.bboxMm)}`,
    );
  }
});
selUnits.addEventListener('change', () => {
  units = selUnits.value as Unit;
  refreshFilePanel();
  refreshMeasureDisplay();
  if (current) {
    setStatus(statusText.textContent ?? '', `${fmt(current.model.triangles)} triangles · ${formatDims(current.bboxMm)}`);
  }
});

selDeflection.addEventListener('change', () => {
  deflectionKey = selDeflection.value;
  if (!current || !lastBrep) {
    setStatus('Ready — detail applies to the next STEP / IGES / BREP file.');
    return;
  }
  const { file, format } = lastBrep;
  const label = current.formatLabel;
  const fileName = current.fileName;
  const t0 = performance.now();
  setStatus(`Re-tessellating ${fileName} (${DEFLECTION_PRESETS[deflectionKey].label} detail)…`);
  void (async () => {
    try {
      const parsed = await parseBrep(format, await file.arrayBuffer(), DEFLECTION_PRESETS[deflectionKey].params);
      const model = brepToModel(parsed, label);
      if (model.triangles === 0) {
        showToast(`Re-tessellation produced no triangles — keeping the previous mesh.`, 'error');
        return;
      }
      scene.remove(current!.model.object);
      current!.model.object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) m.dispose();
        }
      });
      current!.model = model;
      current!.bboxMm = new THREE.Box3().setFromObject(model.object);
      scene.add(model.object);
      fitToView();
      rebuildPartList();
      refreshFilePanel();
      applyClipping();
      refreshSectionControls();
      loadMs = Math.round(performance.now() - t0);
      setStatus(
        `Re-tessellated ${fileName} (${DEFLECTION_PRESETS[deflectionKey].label}) in ${loadMs} ms.`,
        `${fmt(model.triangles)} triangles · ${formatDims(current!.bboxMm)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Re-tessellation failed:\n${msg}`);
      setStatus(`Re-tessellation failed: ${msg}`);
    }
  })();
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth += 1;
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  void openFiles(Array.from(e.dataTransfer?.files ?? []));
});

// ---------- test hook (used by the headless verification, not by the UI) ----------
interface ViewerState {
  loaded: boolean;
  fileName: string | null;
  format: string | null;
  triangles: number;
  vertices: number;
  bboxMm: [number, number, number] | null;
  /** Bbox minimum corner in mm (world coordinates). */
  bboxMinMm: [number, number, number] | null;
  /** Bbox maximum corner in mm (world coordinates). */
  bboxMaxMm: [number, number, number] | null;
  parts: number;
  partNames: string[];
  /** First-material colour of each part, '#rrggbb' (null when unavailable). */
  partColors: (string | null)[];
  /** Milliseconds the current model took to load (parse + build). */
  loadMs: number;
  /** Current tessellation-detail key (coarse | medium | fine). */
  deflection: string;
  status: string;
  section: { enabled: boolean; axis: string; offsetMm: number; flipped: boolean };
  measure: { mode: boolean; points: [number, number, number][]; distanceMm: number | null };
}
(window as unknown as {
  __viewer: {
    getState: () => ViewerState;
    /** Project a world point (mm) to canvas client coordinates, or null if behind the camera. */
    project: (p: [number, number, number]) => [number, number] | null;
    /** Raycast at client coordinates (same path as a measure click); hit point in mm, or null. */
    raycastAt: (clientX: number, clientY: number) => [number, number, number] | null;
  };
}).__viewer = {
  getState: () => {
    const partNames: string[] = [];
    const partColors: (string | null)[] = [];
    current?.model.object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        partNames.push(child.name);
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const first = mats[0];
        partColors.push(
          first instanceof THREE.MeshStandardMaterial ? `#${first.color.getHexString()}` : null,
        );
      }
    });
    return {
      loaded: current !== null,
      fileName: current?.fileName ?? null,
      format: current?.formatLabel ?? null,
      triangles: current?.model.triangles ?? 0,
      vertices: current?.model.vertices ?? 0,
      bboxMm: current
        ? (() => {
            const s = new THREE.Vector3();
            current.bboxMm.getSize(s);
            return [s.x, s.y, s.z] as [number, number, number];
          })()
        : null,
      bboxMinMm: current ? [current.bboxMm.min.x, current.bboxMm.min.y, current.bboxMm.min.z] : null,
      bboxMaxMm: current ? [current.bboxMm.max.x, current.bboxMm.max.y, current.bboxMm.max.z] : null,
      parts: current?.model.meshes.length ?? 0,
      partNames,
      partColors,
      loadMs,
      deflection: deflectionKey,
      status: statusText.textContent ?? '',
      section: { enabled: sectionEnabled, axis: sectionAxis, offsetMm: sectionOffsetMm, flipped: sectionFlipped },
      measure: {
        mode: measureMode,
        points: measurePoints.map((p) => [p.x, p.y, p.z] as [number, number, number]),
        distanceMm: measureDistanceMm(),
      },
    };
  },
  project: (p) => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
    if (v.z > 1) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    return [rect.left + (v.x * 0.5 + 0.5) * rect.width, rect.top + (-v.y * 0.5 + 0.5) * rect.height];
  },
  raycastAt: (clientX, clientY) => {
    if (!current) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(orderedMeshes(), false);
    const hit = hits.find((h) => !sectionEnabled || sectionPlane.distanceToPoint(h.point) >= -1e-4);
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  },
};

setStatus('Ready — drop a file or use Open file.');

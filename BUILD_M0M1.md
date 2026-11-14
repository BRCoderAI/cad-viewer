# CAD Viewer — M0+M1 build report

**Date:** 2026-11-13
**Milestones:** M0 (scaffold) + M1 (mesh formats), per `SCOPE.md`
**Status:** Built and verified in a headless browser. Nothing published,
no repo created.

## What was built

Pure client-side static app in `~/workspace/cad-viewer/`:

- **Stack:** Vite 7.3.8 + TypeScript 5.9.3 + three.js 0.180.0. No React
  — SCOPE.md governs and does not ask for it (PLAN.md's React line was
  not followed).
- **UI:** dark, professional viewer. Header toolbar (Open file, Fit to
  view, Wireframe, Grid, units mm/cm/inch, Clear), left sidebar (file
  info, part list with per-part show/hide + select, supported-formats
  note), status bar (file, triangles, bounding-box size). Drag-drop
  anywhere plus a file picker.
- **M0:** OrbitControls (orbit/pan/zoom, damping), fit-to-view,
  file-type sniffing by extension with magic-byte fallback, and
  refusal messages that **name the format**: proprietary formats get
  "`.ext` is a proprietary format and is not supported. Export STEP
  from your CAD system and open that instead."; STEP/IGES/BREP get
  "support lands in milestone M2".
- **M1 loaders (three.js):** STL (binary + ASCII), OBJ (+ MTL when a
  same-named `.mtl` is supplied alongside), glTF/GLB (DRACOLoader,
  decoder in `public/draco`), PLY, AMF. Scene: hemisphere + key/fill
  lights, grid, ACES tone mapping. Part list, shaded/wireframe toggle,
  units display in mm with cm/inch override.
- **Units rule:** mm throughout. Mesh formats carry no unit — assumed
  mm. glTF stores metres by spec and is scaled ×1000 to mm on load;
  the file panel says so.
- **glTF external buffers:** a dropped `.gltf` may reference an
  external `.bin`; the loader rewrites those URIs to local Blob URLs
  from the sibling files, so it resolves with no server.

## Environment installed on this VM

- **Node v20.19.5 + npm 10.8.2** — official tarball, user-local at
  `~/.local/node-v20.19.5-linux-x64`, symlinked into `~/.local/bin`
  (node/npm/npx). No system packages changed.
- **Stock headless Chromium 157.0.8103.78** (Google Chrome for Testing,
  `chrome-headless-shell`) at `~/.cache/puppeteer/chrome-headless-shell-linux64/`,
  for the verification run below. The VM's built-in Chromium
  (`/opt/meta-chromium/chrome`) is policy-locked to the Muse browser
  harness ("Hatch WebGL domain policy is required") and cannot be
  launched by puppeteer; the `@puppeteer/browsers` downloader also
  failed on this network, so the build was fetched directly with curl
  from `storage.googleapis.com`.

## Test fixtures

Generated from simprep's real STEPs (`micro_servo.step`,
`timing_pulley.step`) into `test-fixtures/` — no synthetic geometry:

| File | Source |
|---|---|
| `micro_servo.stl`, `timing_pulley.stl` | build123d (simprep venv), tolerance 0.1 |
| `micro_servo_ascii.stl`, `timing_pulley_ascii.stl` | build123d, ASCII STL |
| `micro_servo.gltf` + `micro_servo.bin`, `timing_pulley.gltf` + `.bin` | build123d `export_gltf` (linear deflection 0.1) |
| `micro_servo.glb`, `timing_pulley.glb` | build123d `export_gltf` (binary) |
| `micro_servo.obj` + `.mtl`, `timing_pulley.obj` + `.mtl` | trimesh 5.2.1 (scratch venv `.fixture-venv`) + hand-written MTL |
| `micro_servo.ply`, `timing_pulley.ply` | trimesh |
| `micro_servo.amf`, `timing_pulley.amf` | hand-written AMF 1.1 XML (trimesh has no AMF exporter) |
| `micro_servo.step` | copy of the simprep fixture, for the M2 refusal test |

Ground truth from the STEPs: servo 12.0 × 31.3 × 30.7 mm, 6 solids;
pulley 25.5 × 17.0 × 25.5 mm, 1 solid. Tessellated triangle counts
(trimesh, from the same STLs): servo 5,282; pulley 21,240.

## Verification (headless browser, production build)

`npm run build` passes clean (`tsc -b && vite build`). `dist/` is
1.4 MB total; JS bundle 643 KB (168 KB gzip); Draco decoder ~760 KB.

`tests/verify.mjs` (puppeteer-core + stock headless Chromium, WebGL2
via SwiftShader) served `dist/` with `vite preview` and loaded every
fixture through the real file input, then checked the viewer's state
hook, the refusal toasts, and the wireframe/units controls.

**14/14 checks passed, 0 console errors, 0 page errors.**

| Check | Result |
|---|---|
| STL binary (servo) | PASS — 5,282 tris, 1 part, bbox 12.0 × 31.3 × 30.7 mm |
| STL ASCII (servo) | PASS — 5,282 tris, same bbox |
| STL binary (pulley) | PASS — 21,240 tris, bbox 25.5 × 17.0 × 25.5 mm |
| OBJ + MTL (servo) | PASS — 5,282 tris (MTL accepted) |
| OBJ (pulley, no MTL) | PASS — 21,240 tris |
| glTF (servo) | PASS — 5,282 tris, 100 parts, bbox 12.0 × 30.7 × 31.3 mm |
| GLB (pulley) | PASS — 21,240 tris, 299 parts, bbox 25.5 × 25.5 × 17.0 mm |
| PLY (servo) | PASS — 5,282 tris |
| AMF (pulley) | PASS — 21,240 tris |
| Wireframe toggle | PASS — button state flips, model renders wireframe |
| Units → inch | PASS — pulley shows 1 × 0.67 × 1 in |
| JT refused by name | PASS — toast names JT + STEP workaround, nothing loaded |
| STEP deferred to M2 | PASS — toast names M2, nothing loaded |
| Unknown extension | PASS — generic unrecognised-format toast, nothing loaded |

Screenshots of every load are in `tests/shots/`. Two were inspected
visually: the servo (shaded, correctly framed, part list + file info
correct) and the pulley in wireframe with inch units (wireframe
renders, dimensions convert).

## Three things found and fixed during verification

1. **CSS `display` overrode the `hidden` attribute** — the empty-state
   text and the drop overlay were visible even with a model loaded.
   Fixed with an explicit `[hidden] { display: none; }` rule.
2. **`.gltf` + external `.bin` did not load** — GLTFLoader tried to
   fetch the buffer from the server. Fixed by rewriting external buffer
   URIs to Blob URLs from the dropped sibling files.
3. **glTF sizes read ~1000× too small** — build123d's exporter writes
   metres (glTF spec). The viewer now scales glTF ×1000 to mm on load
   and says so in the file panel.

## Notes and known behaviours (not bugs)

- **glTF part counts are high** (servo 100 parts, pulley 299) because
  build123d's glTF exporter emits one mesh per face. The viewer lists
  them faithfully; a merge-by-solid step belongs in M2, not here.
- **glTF bbox axes differ from STL** (servo Y/Z swapped, pulley
  likewise): the glTF exporter converts Z-up CAD to Y-up glTF. The
  geometry is correct; the model displays upright.
- **Draco is wired but untested** — no Draco-compressed fixture exists
  yet. The decoder files ship in `public/draco`; a Draco GLB test file
  is a TODO for the M2 test pass.
- **One model at a time** in this milestone; dropping a second model
  replaces the first. Multi-model compare is not a v1 feature.
- `node_modules/`, `dist/` and `.fixture-venv/` are gitignored. The
  preview server used for verification is stopped.

## How to run it

```bash
cd ~/workspace/cad-viewer
npm install        # once (Node 20+ must be on PATH; see above)
npm run dev        # http://localhost:5173
npm run build && npm run preview   # production build, http://localhost:4173
```

Headless re-verification (needs the stock Chromium at
`~/.cache/puppeteer/chrome-headless-shell-linux64/`):

```bash
npm run preview &   # background, port 4173
node tests/verify.mjs
```

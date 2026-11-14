# CAD Viewer — Milestone M2 build report (B-rep core)

Date: 2026-11-13. Status: **built and verified** — 16/16 headless checks
pass, rack stress test passes, 0 console/page errors. Nothing published
or deployed; no GitHub repo created.

## What was built

STEP (AP203 / AP214 / AP242), IGES and BREP now open in the viewer,
parsed by OCCT in WASM inside a Web Worker. The M0+M1 TODO is also
closed: a Draco-compressed GLB fixture exists and its check passes.

### Files added / changed

| File | What |
|---|---|
| `src/brepWorker.ts` (new) | Classic Web Worker: lazy-loads occt-import-js, calls `ReadFile`, converts the result to transferred typed arrays, walks the OCCT result tree into assembly paths |
| `src/brep.ts` (new) | Main-thread client: worker lifecycle, `parseBrep()`, `brepToModel()` (three.js meshes, per-part + per-face colours via geometry groups), deflection presets |
| `src/formats.ts` | STEP/IGES/BREP moved to supported; `brep-pending` status removed; `brepFormatId()` added; magic-byte sniffing for STEP (`ISO-10303-21;`) and BREP (`DBRep_DrawableShape`) |
| `src/main.ts` | B-rep load path (worker parse → model), Detail select re-parses the open B-rep file, part list matched by position (see bug fix below), `__viewer` hook extended (`partNames`, `partColors`, `loadMs`, `deflection`) |
| `index.html` | Detail (tessellation) select in the toolbar; formats panel lists STEP/IGES/BREP with the OCCT note |
| `README.md` | M2 formats table, B-rep notes, OCCT licence |
| `public/occt/` (new) | Vendored occt-import-js build: `occt-import-js.js` (96,871 B), `occt-import-js.wasm` (7,604,031 B), both licence texts |
| `package.json` | `occt-import-js` pinned **exactly** at `0.0.23` (`--save-exact`, no caret) |
| `tests/verify-m2.mjs` (new) | 16 headless checks: lazy-load, all B-rep fixtures, Draco GLB, deflection, refusals |
| `tests/verify-m2-rack.mjs` (new) | 1,000-solid rack stress test (separate script — it is slow) |
| `test-fixtures/` | + `timing_pulley.step`, `nema17.step`, `rack1000.step` (copied, not moved), `micro_servo_ap242.step`, `*.iges` + `*.brep` for servo/pulley/nema17, `micro_servo_draco.glb` |

## Versions pinned (SCOPE §11 risk 1)

- **occt-import-js 0.0.23** (published 2024-12-03) — pinned exact in
  `package.json`. SCOPE.md said 0.0.24; that version does not exist.
- **Bundled OCCT is 7.6.1, verified** (not just claimed): the `occt`
  submodule SHA `d2abb6d8…` carries commit message "Update version up
  to 7.6.1" (2022-02-01). That is five years behind simprep's OCCT 8.0
  — the AP242 gap test below is the honest check against that risk.
- WASM SHA-256: `33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952`
- JS SHA-256: `3fb44ce11d00611f9b3f3c5775d520ebab48930c1f08279b7b1316f05f0d3379`

## Architecture

- **Lazy WASM.** The worker and the ~7.6 MB WASM are created only when
  the first B-rep file is opened. Proven at the network level (logging
  static server): 0 `occt-*` requests on first page load; exactly one
  GET of `occt-import-js.js` and one of `occt-import-js.wasm` at the
  moment the first STEP file opened (17:54:54–55Z).
- **Worker protocol.** Main → `{type:'init', jsUrl, wasmUrl}` (absolute
  URLs from `document.baseURI`, so sub-path hosting works) →
  `{type:'ready'}`; then `{type:'parse', id, format, buffer, params}`
  (buffer transferred) → `{type:'result', id, meshes, rootName}` with
  typed-array buffers transferred, not copied.
- **Tessellation.** OCCT defaults are `bounding_box_ratio / 0.001 / 0.5`.
  UI presets: Coarse (0.005 / 0.9), Medium (0.001 / 0.5, the OCCT
  default), Fine (0.0002 / 0.2). Changing Detail re-parses the open
  B-rep file from the original `File` (re-read via `arrayBuffer()`).
- **Units.** `linearUnit: 'millimeter'` is passed on every parse; the
  file panel shows "STEP units converted to mm by the reader" (BREP:
  "carries no unit — treated as mm").
- **Colours.** Mesh `color` plus per-face `brep_faces[].color` become
  geometry groups with one material per distinct colour; faces with no
  colour use the mesh colour. Groups are kept only if they exactly
  partition the mesh, otherwise a single material is used. Fallback
  colour when the file carries none: `#8fa3b8`.
- **Part names.** The OCCT result's `meshes[].name` is empty for these
  files; the real names live in the result tree, so the worker walks
  `root` and records an assembly path per mesh (e.g.
  `1143 MicroServo High Torque Metal Gear v1 / body`). The part list
  shows the path; the hierarchy itself is not rendered as a tree (see
  gaps).

## How to run

```bash
export PATH="$HOME/.local/bin:$PATH"
cd ~/workspace/cad-viewer
npm run dev      # dev server on 5173
npm run build    # tsc + vite → dist/
npm run preview  # serve dist/ on http://localhost:4173
node tests/verify-m2.mjs       # 16 checks (needs preview on 4173)
node tests/verify-m2-rack.mjs  # rack stress test (needs preview on 4173)
```

`npm run build` passes clean (tsc + vite). The worker is emitted as
`dist/assets/brepWorker-*.js`.

## Verification results

Headless Chromium (stock, `~/.cache/puppeteer/chrome-headless-shell-linux64/`),
production build, every fixture loaded through the real file input.
Ground truth from simprep's audits (`~/workspace/simprep-cad/test-runs/phase1/*.audit.json`).

| Fixture | Parts | Triangles | BBox mm (measured) | BBox mm (ground truth) | Load ms |
|---|---|---|---|---|---|
| STEP AP214 micro_servo | 6 | 1,470 | 12.0 × 31.3 × 30.7 | 12.0 × 31.3 × 30.7 | 3,786* |
| STEP AP214 timing_pulley | 1 | 6,004 | 25.5 × 17.0 × 25.5 | 25.5 × 17.0 × 25.5 | 3,591 |
| STEP AP214 nema17 (audit: valid=False) | 5 | 16,624 | 42.3 × 55.0 × 42.3 | 42.3 × 55.0 × 42.3 | 5,826 |
| STEP AP242 micro_servo | 6 | 1,470 | 12.0 × 31.3 × 30.7 | 12.0 × 31.3 × 30.7 | 896 |
| IGES micro_servo | 1 ("COMPOUND") | 1,476 | 12.0 × 31.3 × 30.7 | same | 1,094 |
| IGES timing_pulley | 1 ("COMPOUND") | 6,004 | 25.5 × 17.0 × 25.5 | same | 3,574 |
| IGES nema17 | 1 ("COMPOUND") | 24,370 | 42.3 × 55.0 × 42.3 | same | 5,913 |
| BREP micro_servo | 6 ("Part N") | 1,470 | 12.0 × 31.3 × 30.7 | same | 276 |
| BREP timing_pulley | 1 ("Part N") | 6,004 | 25.5 × 17.0 × 25.5 | same | 1,001 |
| BREP nema17 | 5 ("Part N") | 16,624 | 42.3 × 55.0 × 42.3 | same | 1,587 |
| GLB Draco micro_servo | 100 | 5,282 | 12.0 × 30.7 × 31.3† | 12.0 × 30.7 × 31.3† | 704 |
| STEP rack1000 (7.9 MB) | 1,000 | 82,100 | 600 × 63 × 800 | 600 × 63 × 800 | 55,993 |

\* First B-rep load of the session includes the WASM download +
initialisation (~2.5 s of the 3.8 s). Subsequent loads are the parse
alone. † glTF is Y-up; axes are permuted vs the STEP bbox, as in M0+M1.

- **16/16 checks pass** (`tests/verify-m2.mjs`, final run after the
  part-list fix): lazy-load, all ten B-rep cases, Draco GLB, OCCT
  JS+WASM fetch proof, deflection, JT + unknown-extension refusals.
  **0 console errors, 0 page errors.**
- **Rack stress test passes** (`tests/verify-m2-rack.mjs`): 1,000 parts,
  82,100 triangles, exact bbox, 55,993 ms load / 57,034 ms wall. Slow
  (see gaps) but it works, with no errors.
- **Deflection control verified** on the servo STEP: Coarse 882 <
  Medium 1,470 < Fine 3,184 triangles; each change re-parses and the
  status bar reports "Re-tessellated …".
- **Per-part colours verified from the files** (not the fallback):
  pulley `#f5f5f6` (near-white aluminium), NEMA-17 shaft `#cbcbcb`
  against a blue-grey body; servo parts carry no colour, so they render
  the `#8fa3b8` fallback. Screenshots inspected visually: servo
  (body, mounting ears, spline gear with teeth), pulley (teeth, bore,
  flanges), NEMA-17 (square body, shaft, mounting holes), rack (frame
  grid), Draco GLB (servo, white — the source GLB has no materials).
- **NEMA-17 opens despite `valid=False`** in its audit, as required.
- **Refusals unchanged:** JT refused by name with the STEP workaround;
  unknown extension refused.

### AP242 gap check (SCOPE risk 1)

AP242 geometry comes through OCCT 7.6.1 identically to AP214: same
6 parts, same 1,470 triangles, same bbox, same per-mesh triangle
split (12 / 782 / 28 / 252 / 116 / 280). No AP242 geometry gap found
on this fixture. Two caveats, both fixture-side, not reader-side:

- The AP242 fixture was written by OCCT 8.0's `STEPControl_Writer`
  from a bare shape (no labels), so its product names are
  writer-generated ("Open CASCADE STEP translator 8.0 1 / … 1.1") and
  it carries no colours. Name/colour fidelity for AP242 as exported by
  a commercial CAD system is **not yet tested** — no such fixture
  exists here.
- Writing that fixture exposed an OCCT 8.0 quirk worth recording:
  `Interface_Static.SetCVal("write.step.schema", "AP242")` is rejected
  (returns False); the accepted enum value is `"AP242DIS"`. The
  fixture's header confirms
  `AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF {1 0 10303 442 1 1 4 }`,
  and OCCT 8.0 reads it back as 6 solids, volume 6,872.6.

## Bugs found in verification (all fixed)

1. **Part list showed wrong per-part triangle counts.** `rebuildPartList`
   matched stats by mesh name, but B-rep assemblies give several solids
   the same path (four "… / body" solids): every duplicate showed the
   first solid's counts (12 / 12 / 12 / 12 / 116 / 116 instead of
   12 / 782 / 28 / 252 / 116 / 280), and clicking one duplicate
   highlighted all of them. Fixed by matching stats and selection by
   traversal position instead of name. Verified: rows now sum to the
   1,470 total and clicking row 1 selects only row 1.
2. **`export_iges` does not exist in build123d 0.13** (top-level or in
   `build123d.exporters`). IGES fixtures were written with OCP's
   `IGESControl_Writer` directly; BREP via top-level `export_brep`.
3. **gltf-pipeline 4.1.0 is broken** (`defaultValue is not a function` —
   a Cesium dependency mismatch). The Draco fixture was made with
   `@gltf-transform/cli` 4.1.1 instead: 256.62 KB → 104.94 KB,
   `KHR_draco_mesh_compression` present, geometry identical to the
   source GLB (5,282 tris, same bbox).

## Known gaps and limitations (stated plainly)

- **IGES flattens assemblies.** All three IGES fixtures load as a
  single "COMPOUND" part (1 part, correct geometry). IGES has no STEP
  -style assembly structure; this is the format, not a reader bug.
- **BREP carries no product names.** All three BREP fixtures fall back
  to "Part 1…N". BREP is a bare shape dump; names cannot be recovered
  from it.
- **Rack load is slow: ~56 s** for 1,000 solids at Medium deflection.
  The time is OCCT tessellation in WASM, not transfer (typed arrays
  are transferred). A progress indicator for long parses and/or a
  coarser default for very large files are open improvements, not
  attempted here.
- **Part list is flat.** Assembly paths are shown as names, but the
  hierarchy is not rendered as a collapsible tree. The worker already
  computes the paths; a tree view is a UI job for a later milestone.
- **AP242 name/colour fidelity untested** beyond the OCCT-written
  fixture (see above). No AP203 fixture exists yet either (all Adafruit
  STEPs are AP214); AP203 is the same reader path as AP214, but it has
  not been exercised.
- **No tessellated (AP242) STEP tested.** The AP242 fixture is pure
  B-rep; a tessellated AP242 file (with `TESSELLATED_*` entities) has
  not been run through the reader.
- **CDP note for future verifiers:** `page.on('request')` does not see
  worker fetches in this headless Chromium, and `browser.targets()`
  lists no worker targets. The lazy-load proof in `verify-m2.mjs`
  therefore uses a logging static server (`/tmp/static-server.mjs`,
  kept out of the repo) via `SERVER_LOG`/`PORT` env vars; the script
  falls back to the CDP capture, which records 0 and is noted as
  best-effort only.

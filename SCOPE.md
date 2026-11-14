# Universal CAD Viewer — Scope

**Project:** Universal CAD Viewer — BRCoderAI
**Date:** 2026-11-13
**Status:** Research and scoping only. Nothing here is built yet; nothing
is promised until Balaji says go.
**Attribution:** Balaji's idea and architecture. No other author is credited
anywhere in this project.

## 1. Goal

A browser-based viewer that opens most CAD and 3D formats and shows the
model — orbit, inspect, hide parts — without installing CAD software and
without uploading the file anywhere. It is a **viewer, not an editor**: it
shows geometry, it does not edit it, and it does not rebuild parametric
features.

**Non-goals (v1):** editing, parametric modelling, PMI/dimensions, CAM,
meshing for simulation, and any native proprietary format (see §6).

## 2. The one fact that shapes everything

three.js only draws triangles. A format either already *is* triangles
(mesh formats: STL, OBJ, glTF, PLY, 3MF, AMF) or it is exact
mathematical surfaces (B-rep formats: STEP, IGES, BREP) that must first be
**tessellated into triangles by a CAD kernel**. There is no three.js STEP
loader, by design — STEP needs a kernel, and the kernel is Open CASCADE
(OCCT) compiled to WebAssembly.

That split is the whole architecture: three.js loaders for mesh formats,
OCCT-in-WASM for B-rep formats, one three.js scene for both.

## 3. Rendering options compared

### A. Pure client-side static app — RECOMMENDED

Vite + TypeScript + three.js. Files are read in the browser with the File
API and never leave the machine. B-rep files (STEP/IGES/BREP) are parsed
by `occt-import-js` — OCCT compiled to WebAssembly — running in a Web
Worker so a big STEP does not freeze the UI. Mesh formats go through
three.js loaders. No server, no per-file cost, no upload, no CAD licence.

Evidence this shape works: Online 3D Viewer (3dviewer.net,
github.com/kovacsv/Online3DViewer, MIT) does exactly this — three.js +
occt-import-js + web-ifc + rhino3dm — and 3D Lab Viewer (React +
TypeScript + Vite + three.js, STEP via occt-import-js in a Web Worker)
is the same stack. This is the proven shape, not an experiment.

- **Format coverage:** everything in §4 that has a JS/WASM reader.
- **File size:** bounded by the browser tab, not by a server. Practical
  ceiling to validate in M2; nominal target is 100 MB files. Other
  client-side viewers cap at 75–150 MB for the same reason. Tessellation
  of a large assembly is CPU-bound and single-threaded inside the WASM
  module; a 1,000-solid assembly parses, a 10,000-solid one may take
  minutes. That ceiling is a test item, not a guess.
- **Hosting:** any static host — GitHub Pages, Cloudflare Pages, Vercel.
  The WASM file is a static asset, lazy-loaded only when a STEP/IGES/BREP
  file is opened, so the first page load stays small.

### B. Server-side conversion — RUNNER-UP

A Python service (FastAPI + build123d/OCCT 8.0 — the same stack simprep
already uses) that receives a file, tessellates it, and returns glTF.
This is the right answer for exactly two cases: files too large for a
browser tab, and formats with no JS/WASM reader at all. It is the
runner-up because it costs a server, makes the user upload their model,
and adds an entire backend to operate — for a viewer whose main selling
point is "your file never leaves your machine".

Do not build it in v1. Keep it as the documented escape hatch: the
client already consumes glTF, so a conversion service plugs in later
without changing the viewer. If it is ever built, the conversion core
already exists in simprep's pipeline (OCCT read → tessellate → mesh);
what would be new is only the HTTP wrapper.

A note on a common wrong turn: **assimp does not read STEP or IGES.**
It is a mesh/scene library (40+ formats, BSD) with STEP export only.
It cannot be the server-side CAD reader. The CAD reader on a server is
OCCT — via build123d, CadQuery, or `cad3d-ir-step` (STEP/IGES → glTF
via cadquery-ocp, on PyPI).

### C. Full OCCT in WASM (opencascade.js) — considered, not v1

`opencascade.js` exposes far more of the OCCT kernel than
occt-import-js (real geometry operations, not just import). It costs a
larger download and a bigger API surface. It is the fallback if
occt-import-js proves too limited — for example, if a v2 feature needs
real B-rep operations (sectioning through the kernel, measurement from
exact geometry). For viewing alone, it is more than needed.

### D. FreeCAD in WASM — rejected

FreeCAD now runs in a browser tab (WASM port, ~196 MB module,
Chromium-only, experimental, single-threaded). That is a full CAD system
in a tab, not a viewer component. It is the wrong tool for this project:
too big, too narrow in browser support, and it solves a problem the
viewer does not have.

## 4. Format survey and support matrix

Confidence means: how sure the research is that the stated path works on
real files, not on the spec. "Supported" = a real parser exists and is
used in production viewers. "Partial" = it works on some real files and
breaks on others, or needs custom code. "Out of scope" = no open reader
exists, or the only reader cannot legally ship in this project.

### B-rep (exact CAD) — via occt-import-js (OCCT in WASM)

| Format | Extensions | Status | Confidence | Notes |
|---|---|---|---|---|
| STEP AP203 / AP214 / AP242 | .step, .stp | **Supported** | High | The flagship format. Assembly tree, part names, colours. Tessellated only — no B-rep editing, no PMI. AP242 tessellated faces (TRIANGULATED_FACE) are read as pre-triangulated faces. |
| IGES | .iges, .igs | **Supported** | High | Older, surface-centric; often open shells rather than closed solids. Same reader path as STEP. |
| BREP (OCCT native) | .brep, .brp | **Supported** | High | OCCT's own format; `ReadBrepFile`. FreeCAD writes it. |

### Mesh — via three.js loaders

| Format | Extensions | Status | Confidence | Notes |
|---|---|---|---|---|
| STL | .stl | **Supported** | High | ASCII + binary. Geometry only, no colour/material. |
| OBJ | .obj (+ .mtl) | **Supported** | High | Materials only if the companion .mtl is supplied alongside; a lone .obj opens untextured. |
| glTF / GLB | .gltf, .glb | **Supported** | High | Best-in-class path: PBR materials, embedded textures, Draco compression via DRACOLoader. This is also the viewer's internal exchange format. |
| PLY | .ply | **Supported** | High | ASCII + binary, vertex colours, mesh and point-cloud forms. |
| AMF | .amf | **Supported** | Medium–high | Open standard (ISO/ASTM 52915). three.js AMFLoader exists and works; less battle-tested in production viewers than STL/OBJ. |
| 3MF | .3mf | **Partial** | Medium | The stock three.js 3MFLoader works for simple files and **breaks on slicer multi-part files** (it does not follow external part references). Ship v1 with it, but treat 3MF as a hardening task: test against real slicer exports (PrusaSlicer, Bambu Studio, Cura) before calling it done. |
| OFF | .off | **Partial** | Medium | No three.js loader. The format is simple text (vertices + faces); a small custom parser (~200 lines) covers it. Needs writing and testing, not a library. |

### 2D / drawing — partial

| Format | Extensions | Status | Confidence | Notes |
|---|---|---|---|---|
| DXF | .dxf | **Partial** | Medium | Open, Autodesk-published spec. `three-dxf-loader` (on `dxf-parser`, MIT) handles lines, polylines, circles, arcs, ellipses, splines, 3DFACE and text; hatches and complex linetypes are gaps. Mostly a 2D format — display as a flat drawing with an orthographic camera, not as a 3D model. |
| VRML | .wrl | **Partial** | Medium | three.js VRMLLoader exists (VRML97). Works; heavy files are slow, and material handling is rough. |
| X3D | .x3d | **Out of scope** | — | No maintained three.js loader (the old X3DLoader was removed years ago). Do not promise it. |

### BIM / other open formats — stretch, not v1

| Format | Extensions | Status | Confidence | Notes |
|---|---|---|---|---|
| IFC | .ifc | **Stretch (v2)** | Medium | Open standard (ISO 16739). `web-ifc` (MPL-2.0, maintained by That Open Company) is the established path; a newer Rust/WASM alternative, `ifc-lite`, also exists. But IFC is a different audience (buildings, not parts) and large federated models crash browser tabs — that is a v2 decision, Balaji's call, not a v1 promise. |
| Rhino 3DM | .3dm | **Stretch (v2)** | Medium | Open format (openNURBS). `rhino3dm.js` (WASM) is the reader; Online 3D Viewer uses it. Defer — it is one more WASM module to carry. |
| FreeCAD FCStd | .fcstd | **Stretch (v2)** | Medium | A zip containing BREP. Unzip in JS, then the BREP path. Defer — trivial in principle, untested in this stack. |

## 5. What "supported" loses

Honest limits, so the viewer is never oversold:

- **STEP/IGES/BREP are tessellated, not exact.** The viewer shows
  triangles produced from the surfaces. Measurements taken from the
  mesh are approximate; exact B-rep measurement needs the kernel, not
  the mesh. Say so in the UI wherever a number is shown.
- **No PMI, no dimensions, no constraints, no feature tree.** STEP
  carries product structure and colours; it does not carry a parametric
  history the viewer can replay.
- **Units are declared in the file.** STEP/IGES state their units
  (usually mm); the viewer normalises to mm and shows the unit.
  Mesh formats mostly carry no unit — assume mm and let the user
  override.
- **Colour is per-part, not per-face material.** occt-import-js returns
  part colours; fine for inspection, not a rendering showcase.

## 6. Out of scope — and why, format by format

These are excluded by Balaji's rule (no proprietary formats), and the
research confirms the exclusion is also the technically correct call:
there is no open reader for any of them.

| Format | Why it is out |
|---|---|
| **JT (.jt)** — named exclusion | JT is an ISO standard now (ISO 14306 series), but standardised does not mean openly readable. The only JT readers are commercial: Siemens JT Open Toolkit, CAD Exchanger SDK, and Open CASCADE's commercial plug-ins. Open-source OCCT does **not** read JT. Siemens' free JT2Go is a viewer application, not a reader library. |
| SolidWorks (.sldprt/.sldasm), CATIA (.CATPart/.CATProduct), NX (.prt), Inventor (.ipt/.iam), Creo (.prt/.asm), Solid Edge (.par/.psm) | Native proprietary formats. No open reader exists for any of them. The commercial readers (CAD Exchanger SDK, Datakit, Tech Soft 3D) are licensed per-seat/per-product and cannot ship in an open viewer. |
| Parasolid (.x_t/.x_b), ACIS (.sat/.sab) | Proprietary kernels (Siemens / Spatial). Same situation: commercial SDKs only. |
| DWG (.dwg) | Proprietary Autodesk format. The only free reader is GNU LibreDWG — GPLv3, reverse-engineered, ~99% coverage of DWG versions r1.2–r2018 — and linking GPLv3 code into this viewer would force the whole project to GPLv3 (see §7). The Open Design Alliance SDK is commercial. There is also no maintained WASM build of LibreDWG. **Workaround to state in the UI and docs: export DXF from AutoCAD and open that.** |
| FBX (.fbx), 3DS (.3ds) | Proprietary Autodesk formats. three.js happens to ship FBXLoader/TDSLoader, but the formats are proprietary, so they stay out under Balaji's rule. |

**The standard answer for every excluded format:** export STEP from
the native CAD system and open that. Every CAD package named above can
produce STEP. State this in the UI when an unsupported file is dropped,
with the format name named, not a generic error.

## 7. Licensing

| Component | Licence | Consequence |
|---|---|---|
| Own viewer code | MIT (to match simprep) | Free choice; nothing forces anything else. |
| three.js | MIT | No constraints. |
| occt-import-js (OCCT) | LGPL-2.1 (OCCT: LGPL-2.1-only + Open CASCADE Exception 1.0) | The WASM module is a separate file loaded at runtime — the standard LGPL posture for a web app. Ship the LGPL and exception texts with it, keep the WASM unmodified, link the OCCT source, and offer the exact WASM build's source on request. Do not fork or patch the WASM and ship it silently. |
| web-ifc (v2 only) | MPL-2.0 | File-level copyleft; fine for a library dependency. |
| dxf-parser / three-dxf-loader | MIT (verify at scaffold time — check the package licence before depending on it) | No constraints if MIT holds. |
| rhino3dm (v2 only) | openNURBS licence (permissive) | Verify at scaffold time. |
| **Gmsh** | **GPL-2.0+ with exception** | **Not in this stack.** Gmsh is simprep's mesh verifier, not a viewer component. Do not bundle it: GPL would force the viewer (or at least the bundle) to GPL. If mesh-quality checks are ever added, keep them in simprep or on a server, never in the viewer bundle. |
| **LibreDWG** | **GPLv3** | **Do not link, do not bundle, do not compile to WASM for this project.** GPLv3 is the strongest copyleft here; it would relicence the whole viewer. This is the reason DWG stays out, not just the format being proprietary. |
| CAD Exchanger SDK, JT Open Toolkit, ODA SDK, Datakit | Commercial | Not usable in an open viewer. Named here only so nobody suggests them later without knowing the cost. |

**Licence decision needed before publishing:** the OCCT LGPL compliance
steps above (texts shipped, source linked, WASM unmodified) must be
done before the repo flips Public. It is a checklist item, not a
blocker — the Online 3D Viewer and the CGTK STEP viewer both ship the
same stack under the same terms.

## 8. Recommended architecture (decision)

**Client-side static app.** Vite + TypeScript + three.js, occt-import-js
lazy-loaded in a Web Worker for STEP/IGES/BREP, three.js loaders for
mesh formats, all files local-only. Hosted as a static site (GitHub
Pages first choice, Cloudflare Pages or Vercel as alternatives — all
three fit a no-server app; pick at scaffold time).

**Runner-up:** the same client plus an optional Python conversion
service (FastAPI + build123d/OCCT 8.0, simprep's stack) for files too
large for a tab. Deferred; the client already consumes glTF, so the
service plugs in without changing the viewer.

**What the viewer is, in one line:** a static page that turns a dropped
file into triangles — via three.js loaders, or via OCCT-in-WASM when the
file is B-rep — and draws them.

## 9. Milestones

| Milestone | Contents | Done when |
|---|---|---|
| **M0 — Scaffold** | Repo `github.com/BRCoderAI/cad-viewer` (name is a suggestion), Vite + TS + three.js, drag-drop + file pick, orbit/pan/zoom, fit-to-view, file-type sniffing, unsupported-format message naming the format and the STEP workaround | App runs locally; a dropped STL renders |
| **M1 — Mesh formats** | STL, OBJ (+MTL), glTF/GLB, PLY, AMF loaders; scene, lighting, shaded/wireframe, units display (mm, override for unit-less formats) | Each format opens a real test file; no console errors |
| **M2 — B-rep core** | occt-import-js in a Web Worker, lazy-loaded; STEP (AP203/214/242), IGES, BREP; assembly tree with part names, show/hide per part, per-part colours; tessellation deflection control | The simprep fixture STEPs open with correct part counts and mm units (micro servo, timing pulley, NEMA-17, 1000-solid rack) |
| **M3 — Partial formats** | 3MF hardening (test against real PrusaSlicer/Bambu/Cura exports), DXF via three-dxf-loader (2D view, orthographic), OFF custom parser, VRML via VRMLLoader | Each opens real files; failures are named, not silent |
| **M4 — Export + measure** | Export viewed mesh to STL; distance measurement between two picked points (measure in v1 or v1.1 — Balaji's call); bounding-box size display | Measure matches a known dimension on a test part; STL export re-opens in a slicer |
| **M5 — Stretch (v2, his call)** | IFC via web-ifc, Rhino 3DM via rhino3dm.js, FCStd via unzip + BREP | Each behind its own flag; only if v1 is shipped and used |
| **M6 — Publish** | Private repo test live on the static host; OCCT licence texts shipped; README with format matrix and the STEP workaround; flip Public | Live URL opens the fixture STEPs; repo public |

**First milestone is M0 + M1 together:** scaffold the app and land the
five mesh formats first, because they need no WASM and prove the viewer
core (scene, controls, tree UI, units) before the B-rep work starts.
The B-rep path (M2) is the hard part and gets its own milestone.

## 10. Test corpus (already on disk, no new fixtures needed)

simprep's Phase 1 files, in `workspace/simprep-cad/`:

- `tests/fixtures/` — micro servo, timing pulley, NEMA-17 STEPs (Adafruit, MIT)
- `test-runs/phase1/` — the same files' audit/clean reports, plus the
  1,000-solid rack STEP audit
- The rack STEP itself: `workspace/cad-build/rack1000/rack1000.step`

If the viewer opens the servo and pulley STEPs with the right part
counts and mm units, the B-rep path works. The 1,000-solid rack is the
large-assembly stress test — expect it to be slow in the browser, and
record the time rather than assuming it will be fast.

For mesh formats, generate fixtures from the same STEPs (export STL/OBJ
from FreeCAD or from simprep's own pipeline) so every format is tested
against the same geometry.

## 11. Risks

1. **occt-import-js is a one-maintainer project pinned to OCCT 7.6.1.**
   The npm package is at 0.0.24 (published 2026-01-04); the bundled
   OCCT is 7.6.1, five years behind the OCCT 8.0 simprep uses. Two
   consequences: AP242 coverage may lag the current kernel, and if the
   maintainer stops, there is no upstream to fall back on. Mitigations,
   in order: vendor the exact WASM build (do not float on `latest`);
   test the simprep fixture STEPs against it in M2 and record gaps;
   keep opencascade.js as the documented fallback; long-term, rebuild
   the WASM from OCCT 8.0 in-house (Emscripten + CMake, the same build
   the project already runs).
2. **Large files hit the browser tab ceiling.** Tessellation is
   CPU-bound and single-threaded inside WASM; a big assembly can take
   minutes and use gigabytes. The tab, not the viewer, decides the
   limit. Mitigations: parse in a Web Worker (UI stays responsive),
   expose the tessellation deflection setting, and keep the server-side
   conversion service (§3B) as the documented escape hatch for files
   over the ceiling.
3. **The partial parsers will break on real files.** 3MF (slicer
   multi-part files) and DXF (hatches, complex linetypes, MTEXT edge
   cases) are the two that will fail first, and they will fail on files
   users actually have. Mitigation: M3 is a hardening milestone with
   real files from real exporters, and every failure must name the
   format and the cause in the UI instead of failing silently.

## 12. Open decisions (Balaji's, none blocking the plan)

1. Repo name (`cad-viewer` or his pick)
2. Hosting (GitHub Pages / Cloudflare Pages / Vercel)
3. Measure in v1, or v1.1?
4. IFC in v2, or never?
5. Server-side conversion service: build it later, or never?

## 13. Sources (checked 2026-11-13)

- occt-import-js: npm `occt-import-js` 0.0.24, LGPL-2.1,
  github.com/kovacsv/occt-import-js — `ReadStepFile`, `ReadIgesFile`,
  `ReadBrepFile`; WASM ~10 MB, ~3 MB gzipped; OCCT 7.6.1 in the
  0.0.23 build. Used by Online 3D Viewer and 3D Lab Viewer.
- Online 3D Viewer: github.com/kovacsv/Online3DViewer (MIT) — import:
  3dm, 3ds, 3mf, amf, bim, brep, dae, fbx, fcstd, gltf, ifc, iges,
  step, stl, obj, off, ply, wrl. External libraries: three.js, pickr,
  fflate, draco, rhino3dm, web-ifc, occt-import-js.
- three.js loaders (`three/examples/jsm/loaders`): STLLoader,
  OBJLoader (+MTLLoader), GLTFLoader, PLYLoader, 3MFLoader,
  AMFLoader, VRMLLoader. No STEP loader by design.
- 3MF loader gap: docs.cloudslicer3d.com — stock ThreeMFLoader does
  not follow external part references; breaks on slicer files.
- DXF: `three-dxf-loader` (on `dxf-parser`) — lines, polylines,
  circles, arcs, ellipses, splines, 3DFace, text.
- JT: ISO 14306 series (14306-1:2024, -2:2024, -3:2025, -4:2026);
  readers are commercial only (Siemens JT Open Toolkit, CAD Exchanger
  SDK, OCCT commercial plug-ins). OCCT open source does not read JT.
- DWG: proprietary Autodesk format; GNU LibreDWG (GPLv3+, reads
  r1.2–r2018 at ~99%) is the only free reader; ODA SDK is commercial.
- Assimp: does not import STEP or IGES (STEP export only). Not a CAD
  reader.
- `cad3d-ir-step` (PyPI): STEP (AP203/214/242) + IGES → glTF via
  cadquery-ocp — the server-side conversion shape, if ever needed.
- OCCT: LGPL-2.1-only + Open CASCADE Exception 1.0; stable release
  8.0.1 (30 July 2026). WebAssembly is a supported OCCT target since
  7.5.
- Gmsh: GPL-2.0+ with the Gmsh exception — not in this stack.
- web-ifc: MPL-2.0, maintained by That Open Company. IFC is ISO 16739.
- FreeCAD in WASM: ~196 MB module, Chromium-only, experimental — not
  a viewer base.

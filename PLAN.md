# Universal CAD Viewer — build plan (draft for Balaji's call)

**Commissioned:** 2026-11-12, in the simprep chat — "Let's then build an universal cad
viewer and publish it should support most of the format except may be proprietary
formats like JT" (his correction: "*JT").
**Sequencing:** after the simprep push lands. The push is the only gate; nothing
here needs the token.
**Attribution:** Balaji's idea and architecture, as with simprep — no Muse credit
anywhere in repo, README, or UI.

## Recommended shape: pure client-side, no server

A static web app. Files are read in the browser and never uploaded — the same
privacy shape as the CGTK STEP Viewer ("your files stay on your computer").
That also fits the earlier architecture call: Vercel is UI-only, and here
UI-only is all the viewer needs. No backend, no CAD licence, no per-file cost.

**Stack (verified against live sources, 2026-11-12):**
- Vite + TypeScript + React, three.js for rendering
  (precedent: 3D Lab Viewer — React, TypeScript, Three.js, Vite, STEP via
  occt-import-js in a Web Worker; https://news.ycombinator.com/item?id=47059819)
- `occt-import-js` — OpenCASCADE compiled to WebAssembly, for STEP / IGES / BREP.
  It returns position/normal/index buffers that map straight onto three.js
  `BufferGeometry`. WASM is ~7.6 MB, lazy-loaded only when a STEP/IGES/BREP
  file is opened. Three public functions: `ReadStepFile`, `ReadIgesFile`,
  `ReadBrepFile`. (https://docs.cloudslicer3d.com/troubleshooting/threejs-model-preview,
  https://socket.dev/npm/package/occt-import-js)
- three.js' own loaders for the mesh formats: STL, OBJ, glTF/GLB, 3MF, PLY.
  three.js has no STEP loader by design — STEP/IGES are parametric B-rep
  (NURBS surfaces), not triangles, so they must be tessellated by a CAD
  kernel first. That is exactly what occt-import-js does.

**Version flag to check at scaffold time:** simprep uses OCCT 8.0
(build123d 0.13 / cadquery-ocp 8.0.1.1.0). occt-import-js pins an older OCCT
(7.6.1 per the OpenSCAD.js provenance check, 2026-10-19). Same kernel family,
different version — test the simprep fixture STEPs against it before promising
identical tessellation. Do not assume parity.

## Format matrix — v1

| Format | How | Status |
|---|---|---|
| STEP (.step/.stp) AP203/214/242 | occt-import-js | v1 |
| IGES (.iges/.igs) | occt-import-js | v1 |
| BREP (.brep) | occt-import-js | v1 |
| STL (.stl) | three.js STLLoader | v1 |
| OBJ (.obj) | three.js OBJLoader | v1 |
| glTF / GLB (.gltf/.glb) | three.js GLTFLoader | v1 |
| 3MF (.3mf) | three.js 3MFLoader | v1 |
| PLY (.ply) | three.js PLYLoader | v1 |
| **JT (.jt)** | — | **OUT — Balaji's call.** Siemens-controlled in practice, no good open reader for a web viewer. (JT is technically ISO now; that doesn't change the reader situation.) |
| SolidWorks (.sldprt/.sldasm), CATIA, NX (.prt), Parasolid (.x_t/.x_b), Creo, Inventor, Solid Edge | — | OUT v1 — no open reader. Workaround to state in the UI/docs: export STEP from the native CAD and open that. |

**Possible v2, his call:** IFC (BIM) via web-ifc. Not v1 — different audience,
different kernel path.

## Features — v1

- Drag-drop or file pick; files never leave the machine
- Orbit / pan / zoom, shaded + wireframe, fit-to-view
- Assembly tree: part names, show/hide per part, per-part colour
  (occt-import-js returns per-part meshes with names)
- Bounding box + size in mm, units mm/inch toggle
- Export the viewed mesh to STL
- **Measure (distance):** in v1 or v1.1 — his call. CGTK's viewer does it;
  it is the most-asked viewer feature after open/rotate.

**v1.1 candidates (not promised):** section planes, explode view, part
isolate. **Idea, not a commitment:** a "Clean for sim" handoff to simprep —
simprep already reads the same STEP/IGES/BREP via OCCT, so a cleaned STEP
from simprep is a natural viewer test file, and vice versa. But simprep is a
Python CLI; wiring it into a static viewer needs a backend or a download
round-trip, so it stays an idea until the viewer itself ships.

## Test files already on disk (no new fixtures needed)

simprep's Phase 1 real STEPs — micro servo (full pass), timing pulley,
NEMA-17, 1000-solid rack audit — in `workspace/simprep-cad/test-runs/phase1/`
and `tests/fixtures/`. If the viewer opens the servo and pulley STEPs with
the right part counts, the B-rep path works.

## Publishing (same shape as simprep)

- Repo: `github.com/BRCoderAI/cad-viewer` (name is a suggestion — his call),
  Private first, flip Public after v1 tests pass
- Own code MIT, like simprep. three.js MIT. OCCT LGPL-2.1 — ship the
  licence notice with the unmodified WASM (CGTK precedent: OCCT source +
  interface available on request; we ship the notice, not a fork)
- Hosting: static — GitHub Pages, Cloudflare Pages, or Vercel. All three
  fit a no-server app; pick at scaffold time. No Gmsh in this stack, so
  simprep's GPL distribution question does not carry over.

## Build order (once he says go)

1. Scaffold Vite + TS + React + three.js; lazy-load occt-import-js in a
   Web Worker so big STEPs don't block the UI
2. Mesh loaders (STL/OBJ/glTF/3MF/PLY) + scene, controls, tree UI
3. STEP/IGES/BREP path via occt-import-js; verify against the simprep
   fixture STEPs (part counts, mm units)
4. Measure + STL export; then publish Private, test live, flip Public

## Open decisions for Balaji (all his, none blocking the plan)

1. Repo name (`cad-viewer` or his pick)
2. Hosting (GitHub Pages / Cloudflare Pages / Vercel)
3. Measure in v1, or v1.1?
4. IFC in v2, or never?

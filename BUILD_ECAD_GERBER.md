# CAD Viewer — v1.1 increment 5: ECAD — Gerber RS-274X + Excellon drill viewing

Date: 2026-11-18. Status: built and verified locally. Not published — the
parent handles `docs/` sync, GitHub publish, and the goal queue.

## What was built

Gerber RS-274X files plus Excellon drill files open in the browser as a
2D layer stack — copper, solder mask, silkscreen, board outline, drill
hits — with per-layer show/hide in the Parts list, board outline,
pan/zoom through the existing controls, and the same no-upload promise
as the rest of the viewer: files are read with the File API and never
leave the machine.

- **Multi-file drop / file picker:** a Gerber file and its drill file
  open together (all Gerber/drill files in the drop become layers of
  one board); each file also opens on its own. A non-ECAD file in the
  same drop is ignored with a toast.
- **Layer inference from the filename:** `.GTL/.GBL` copper top/bottom,
  `.G1–.G4/.GL1–.GL3` copper inner, `.GTS/.GBS` mask, `.GTO/.GBO`
  silk, `.GKO/.GM1` outline, `.GP1/.GBP` paste, `.DRL/.Xln/.NC/.EXC`
  drill; generic `.gbr/.ger/.art` files use KiCad-style name hints
  (`-F_Cu`, `-B_Cu`, `-F_Mask`, `-F_SilkS`, `Edge_Cuts`, …) with a
  neutral "Gerber layer" fallback. `.txt` counts as a drill file only
  when its content looks like Excellon (M48 header / tool definitions)
  — plain text stays "unrecognised format", which the M2 suite still
  proves with `dummy.txt`.
- **Parsing/rendering:** MIT-licensed tracespace v4 libraries
  (gerber-parser 4.2.7, gerber-plotter 4.2.8, gerber-to-svg 4.2.8),
  **vendored** under `src/vendor/tracespace/` — the packages' own
  browser bundles plus their LICENSE files, imported from the vendored
  copies, no CDN dependency at runtime. (Note: the `@tracespace/*`
  scoped packages on npm only publish v5 pre-releases; the v4 line
  lives under the unscoped names `gerber-parser` / `gerber-plotter` /
  `gerber-to-svg`, which is what the task named.) The parser's own
  filetype detection wins over the extension — a `.gbr` that is really
  a drill file renders as a drill layer.
- **Rendering is SVG → rasterised canvas texture, one textured plane
  per layer**, stacked in board order (bottom copper first, drill
  last) with a 0.05 mm z step, in the XY plane facing the camera.
  gerber-to-svg is what gets polarity (clear shapes), aperture macros,
  regions and stroke joins right; re-implementing those as three.js
  shapes would get them wrong on real files. Layers rasterise at up
  to ~120 px/mm, capped at 4096 px on the long side. Drill positions,
  pad counts and layer bboxes come from the plotter stream (with
  block-repeat expansion), so they are measured from the parse, not
  from the picture.
- **Board outline:** the outline layer's bbox when one was opened,
  otherwise the union of the layer bboxes. The board opens square-on
  (camera straight down +Z at the board centre, then fit-to-view); the
  3D grid is hidden while a board is open and restored for 3D models.
- **Design check stays off** for a 2D board — the panel says it is for
  3D models instead of running the volume analysis over flat planes.
- Results are exposed on `__viewer` as `getState().ecad` (layers with
  kind/side/colour/visibility/bbox/pixel count/drill hits/pad count,
  board bbox, outline flag, drill count and sizes) and
  `__viewer.ecadSample(layerIndex, xMm, yMm)` returns the rasterised
  layer's RGBA pixel at a Gerber coordinate, for headless verification.

### Files added / changed

- `src/vendor/tracespace/` — new. The three tracespace browser
  bundles (`gerber-parser.min.js`, `gerber-plotter.min.js`,
  `gerber-to-svg.min.js`), their LICENSE files, the bundles'
  third-party attribution files (`*.min.js.LICENSE.txt`), minimal
  TypeScript declarations (`*.min.d.ts`), and a `README.md` recording
  versions, licences, and the two changes made to the bundles (the
  `sourceMappingURL` line removed, one `export default …;` line
  appended so the webpack `var`-library bundles import as ES modules).
- `src/ecad.ts` — new: filename classification, parsing (parser
  `parseSync` + plotter stream + gerber-to-svg callback), drill/pad
  extraction with block-repeat expansion, SVG rasterisation and pixel
  counting, layer mesh building, board assembly, pixel sampling.
- `src/main.ts` — `openEcad` + ECAD detection in `openFiles`; the
  `current` record carries the board; ECAD file panel; design-check
  skip for boards; grid hidden while a board is open (restored on
  clear / 3D load); texture disposal in `clearModel`; `__viewer`
  `ecad` state and `ecadSample`.
- `src/loaders.ts` — `MeshStat` gains an optional `note`, shown in
  the part list instead of the triangle count (a flat plane's 2
  triangles say nothing about a layer; the list shows "8 pads",
  "10 drills").
- `index.html` — empty-state text and the supported-formats panel now
  list Gerber RS-274X and Excellon drill.
- `README.md` — ECAD documented, with the limits below.
- `test-fixtures/demo_board.{GTL,GBL,GTS,GTO,GKO,drl}` — new
  hand-written fixtures: a 50×30 mm board (see "Fixtures" below).
- `tests/verify-v11-ecad-gerber.mjs` — new headless suite, 33 checks
  (see "Verification results").

## How it works

### Parse path (per file)

1. `classifyEcadFile` maps the extension (and, for `.gbr`, the
   filename) to a kind/side/filetype; `.txt` is sniffed for Excellon
   markers first.
2. `gerberParser({filetype}).parseSync(text)` returns the command
   objects; the parser's `format.filetype` is trusted over the
   extension from here on.
3. The commands are fed to a `gerberPlotter` stream; the emitted
   chunks give the layer bbox (`size` chunk, converted in→mm when the
   file is in inches), tool diameters (`shape` chunks: drill tools are
   circles), pad flashes (`pad` chunks, expanded at every offset when
   a `repeat` chunk opened a block), and pad counts.
4. `gerberToSvg(text, {id, filetype, attributes: {color}})` renders
   the SVG string with the layer colour as `currentColor`.
5. The SVG is rasterised into a canvas at
   `min(120, 4096 / longSideMm)` px/mm; non-transparent pixels are
   counted (0 means the layer drew nothing, which is an error).
6. A `THREE.PlaneGeometry` sized to the layer bbox, textured with the
   canvas (`MeshBasicMaterial`, transparent, `depthWrite: false`,
   `toneMapped: false` so the layer colour is exact), positioned at
   the bbox centre with `z = stackRank × 0.05` and `renderOrder =
   stackRank`.

The SVG's own `translate(0,…) scale(1,-1)` group flip plus
`CanvasTexture`'s default `flipY` put max Gerber Y at world +Y — the
pixel checks in the suite prove the orientation end-to-end (a drill
hit renders at its own coordinates, not mirrored).

### Fixtures (hand-written, validated through the tracespace pipeline in Node before use)

| File | Contents |
| --- | --- |
| `demo_board.GTL` | Top copper: 4× Ø1.0 round pads, 2× 2.0×1.0 rect pads, 1 obround pad, 3 traces (0.3 mm), one 90° arc trace, a pour region (10,22)–(30,28) with a rectangular cutout (13,24)–(17,26), one aperture-macro flash (vector-rectangle primitive) at (45,5). 8 pads. Bbox [9.5, 4.5, 46, 28] mm. |
| `demo_board.GBL` | Bottom copper: 2 pads, 2 traces. Bbox [9.5, 9.5, 40.5, 20.5] mm. |
| `demo_board.GTS` | Top mask: 4× Ø1.5 + 2× 2.5×1.5 openings. 6 pads. |
| `demo_board.GTO` | Top silk: border rectangle, two component outlines, a full circle from two arcs, a pin-1 tick. Bbox [0.9, 0.9, 49.1, 29.1] mm. |
| `demo_board.GKO` | Outline: 50×30 mm rectangle, 0.2 mm stroke, one rounded corner (arc). Bbox [-0.1, -0.1, 50.1, 30.1] mm. |
| `demo_board.drl` | Excellon, METRIC, 3:3: T1 Ø0.8 ×5 at the through-hole pads, T2 Ø1.0 ×5 vias. 10 hits, 2 sizes. Bbox [9.6, 9.5, 45.5, 25.5] mm. |

## How to run

```bash
export PATH="$HOME/.local/bin:$PATH"
npm run build
npx vite preview --port 4173 --strictPort
node tests/verify-v11-ecad-gerber.mjs
```

## Verification results

`npm run build` passes clean (tsc + vite). Final bundle:
`dist/assets/index-A7XCuZLD.js`, 1,037,850 bytes, 275,120 bytes gzip
(was 679,123 / 179,733 before this increment — the vendored
tracespace libraries).

### New suite: `tests/verify-v11-ecad-gerber.mjs` — 33/33, 0 console errors, 0 page errors

| Check | Result |
| --- | --- |
| Board loads with 6 layers (5,747 ms in headless software rendering) | PASS |
| Layer kinds detected from filenames (GTL copper/top … drl drill) | PASS |
| Board outline present, 50.2 × 30.2 mm (0.2 mm stroke centred on the edge) | PASS |
| 10 drill hits, 2 sizes (Ø0.8, Ø1.0) | PASS |
| Every drill hit matches a fixture position (within 0.01 mm) | PASS |
| Every drill hit is inside the outline (0.5 mm margin) | PASS |
| Every layer rendered non-empty pixels (GTL 1,679,620 · GBL 236,881 · GTS 211,354 · GTO 242,280 · GKO 220,673 · drill 85,945) | PASS |
| Pad counts match (GTL 8 incl. macro, GBL 2, GTS 6) | PASS |
| No layer reported parser warnings | PASS |
| File panel names the ECAD format and the board size | PASS |
| Design check stays off for a 2D board (analysis null) | PASS |
| Part list shows the 6 layers with show/hide checkboxes | PASS |
| Drill hit renders at (10,10) on the drill layer (white, alpha 255) | PASS |
| Drill hit renders at (15,15) — the Ø1.0 tool | PASS |
| No drill renders at (12,20) / (30,12) — empty areas stay transparent | PASS |
| Top-copper pad renders at (10,10) in the copper colour (217,123,41) | PASS |
| Aperture-macro flash renders at (45,5) on the copper layer | PASS |
| Copper pour region renders at (20,25) | PASS |
| Pour cutout at (15,25) stays transparent (region hole) | PASS |
| Outline stroke renders at (25,0) — the bottom board edge | PASS |
| Outline layer is empty at the board centre (25,15) | PASS |
| Silkscreen border renders at (25,1) | PASS |
| Unchecking silkscreen hides the layer (state + viewport changes) | PASS |
| Re-checking silkscreen shows the layer again | PASS |
| Single Gerber loads as a 1-layer board (copper top) | PASS |
| Without an outline layer the board size is the layer bbox | PASS |
| Single drill file loads as a 1-layer board (drill, 10 hits) | PASS |
| Single outline file loads, outline present, board 50.2 × 30.2 | PASS |
| Servo STEP still loads after ECAD (6 parts, analysis runs, 4 holes) | PASS |
| Broken Gerber in the drop is skipped, good layers still load | PASS |
| Status names the skipped file | PASS |

### Screenshots inspected (in `tests/shots/`)

- `v11_ecad_board.png` — **inspected visually**: the board reads as a
  real PCB layer stack — yellow outline with the rounded top-right
  corner, orange copper pour with its black cutout, orange top traces
  with the arc bulge, blue bottom traces, green mask openings ringing
  the drill hits, white silk border and component outlines, white
  drill dots sitting on the pads, the small orange macro rect at
  bottom right. Sidebar shows the file panel (6 ECAD files, board
  50.2 × 30.2 mm, 10 drill hits Ø0.8, Ø1 mm) and the six layers with
  checkboxes and pad/drill counts. Not a blank or broken render.
- `v11_ecad_outline_only.png` — the single-outline load: just the
  yellow board rectangle.

### Regressions (all re-run against the final bundle, 0 console errors, 0 page errors)

| Suite | Result |
| --- | --- |
| `tests/verify-m2.mjs` (logging static server, port 4174) | 16/16 |
| `tests/verify-section-measure.mjs` | 25/25 |
| `tests/verify-v11-progress.mjs` | 12/12 |
| `tests/verify-v11-measure-history.mjs` | 35/35 |
| `tests/verify-v11-section-capping.mjs` | 37/37 |
| `tests/verify-v11-ai-design-check.mjs` | 38/38 |
| `tests/verify.mjs` (M0/M1) | 13/13 |

## Bugs found in verification (all fixed)

### 1. `getState().ecad.drills` was missing

The state exposed per-layer drills and the drill count/sizes, but not
the board-level drill array the suite checks against the fixture
positions. Fixed: `drills: current.ecad.drills` added to the state
(and to the `ViewerState` type).

### 2. Suite sampled "empty" points outside the drill layer image

The first draft checked (5,5) and (48,28) on the drill layer for
transparency — but both points lie outside the drill layer's own bbox
([9.6, 9.5, 45.5, 25.5]), so `ecadSample` correctly returned null and
the check proved nothing. Fixed: the empty-area points moved inside
the drill image — (12,20) and (30,12) — where a transparent pixel is
a real assertion.

### 3. Skipped-file detail lived only in the transient toast

A broken file in the drop was skipped and the toast named it, but the
persistent status only said "Some files were skipped — see above."
Fixed: the status now names the skipped files
("Skipped: demo_board_broken.gbr."); the toast keeps the full error.

### 4. Suite syntax error (missing paren)

The part-list check was missing the `.map(` closing paren. Fixed in
the suite; no app code involved.

## Known gaps and limitations (stated plainly)

- **Layers are rasterised, not vector.** Up to ~120 px/mm, capped at
  4096 px on the long side. At fit-to-view and normal zoom the board
  is crisp; at extreme zoom it softens instead of staying sharp. A
  vector render (plotter chunks → three.js shapes) was considered and
  rejected for this increment: it would have rendered clear-polarity
  shapes and aperture-macro thermal reliefs wrong, while gerber-to-svg
  gets them right.
- **Load time is raster-bound.** The 6-layer demo board takes ~5.7 s
  in headless software rendering (SVG rasterisation at up to 4096 px
  per layer plus a full pixel-count pass per layer). On a real GPU it
  will be faster; no timing fixture asserts a bound.
- **Block-repeat expansion is implemented but not fixture-tested.**
  `extractPlotData` expands pads at every offset of a Gerber `%SR%`
  repeat block; no fixture uses step-and-repeat, so the path is
  unproven on a real repeated file.
- **Clear-polarity rendering has no dedicated fixture.** It is handled
  by gerber-to-svg (which the fixtures exercise only through the pour
  region's inner contour, an even-odd hole — not a `%LPC%` clear).
  A file that leans on clear polarity (copper pour cutouts via LPC,
  thermal-relief macros) renders through the same SVG path, but no
  fixture proves it.
- **Inch-unit files are converted, not fixture-tested.** The plotter
  `size` chunk's units select the mm scale factor; all fixtures are
  metric.
- **Section and measure on a 2D board are untested.** Section
  clipping applies to the layer materials and measure raycasts the
  planes, but no suite check exercises either on an ECAD board, and
  the stencil cap face is meaningless on flat planes.
- **A mask layer shows its openings as drawn.** That is what the file
  contains and what other Gerber viewers show — the green shapes are
  the openings, not the mask material itself. The file panel says so.
- **KiCad board files (.kicad_pcb) are out of scope** — export Gerber
  + drill from KiCad and open those instead.
- **The Design check does not run on a 2D board** (stated in the panel).
- **A file that parses but draws nothing is skipped** with an error
  ("The file parsed but drew nothing"), and a drop in which every
  file fails reports the failure instead of opening an empty board.
- The throwaway Node probes (`/tmp/ts-inspect/test-pipeline.js`,
  `/tmp/ts-inspect/test-fixtures.js`) live outside the repo; the
  fixture ground-truth numbers are in the table above and in the
  suite.

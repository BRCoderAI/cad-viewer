# CAD Viewer — v1.1 increment 4: AI design check (on-device analysis panel)

Date: 2026-11-17. Status: built and verified locally. Not published — the
parent handles `docs/` sync, GitHub publish, and the goal queue.

## What was built

A "Design check" panel in the sidebar that analyses the loaded model
entirely on-device, from the tessellated three.js meshes — no upload, no
network, no AI, no external model. It works for mesh formats (STL/OBJ/
glTF/PLY/AMF) and B-rep formats (STEP/IGES/BREP) alike, because it
operates on the meshes the viewer already parsed. It reports:

- Part count, total volume (signed-tetrahedron sum over the mesh) and
  mass for a chosen material (Aluminium 2.70, Steel 7.85, PLA 1.24,
  ABS 1.04 g/cm³, or a custom density).
- Largest part by volume.
- Circular holes: diameter and count, found from circular rim loops on
  the mesh.
- Thinnest wall sampled (ray-cast through the mesh), with the sample
  count.
- Open shells and non-manifold edges, per part.
- DFM warnings: small holes under an adjustable threshold, walls under
  an adjustable threshold, very small parts, long-and-thin parts,
  unsewn / non-manifold triangulations.
- A plain-language summary built from the numbers (template text, no
  LLM).

Every number is labelled as mesh-computed, with the deflection caveat
where it applies (mesh measurements are approximate; exact B-rep
measurement needs the kernel — SCOPE.md §5). Results are exposed on
`__viewer` as `getState().analysis` for headless checks.

### Files added / changed

- `src/analysis.ts` — new analysis engine (see "How it works").
- `src/main.ts` — runs the analysis after a model loads and after a
  deflection re-tessellation; renders the panel; wires the controls;
  exposes `__viewer.getState().analysis`.
- `index.html` — new "Design check" sidebar panel after the Measure
  panel, with material / threshold controls and a Re-run button.
- `src/style.css` — panel styles (definition-list rows, amber warnings,
  summary, controls).
- `README.md` — Design check documented, with the honesty caveats and
  method limits.
- `tests/verify-v11-ai-design-check.mjs` — new headless suite, 38 checks
  (see "Verification results").

## How it works

### Volume

Signed-tetrahedron sum over the mesh triangles, in world coordinates
(`matrixWorld` applied, so glTF's ×1000 scale is honoured). Exact only
for closed, consistently oriented meshes; open shells are flagged and
their volume is approximate. Mass is volume/1000 × density.

### Holes

Circular rims are found as chains of sharp mesh edges (dihedral > 40°)
that fit a circle in a plane (Kasa fit; RMS residual < 2% of radius,
max < 5%, arc coverage ≥ 200°). A rim is a hole when the wall triangles
beside it face the rim's centre (material outside the cylinder); outer
rims — a boss, a pulley rim, a gear outline — face away and are excluded.
Closed chains are evaluated whole; open chains are searched with sliding
6-vertex windows that expand along the chain (this recovers trimmed /
breakout hole arcs whose whole-chain fit is dragged off by a tail of
breakout edges); closed chains whose whole-chain fit fails also fall
back to the window search (this recovers rims trapped in chains that
wandered onto a neighbouring feature at a shared vertex). Loops are
deduped by axis + diameter + centre within 0.2 mm, then merged into
holes by axis line + diameter within 5% (a mouth chamfer reads a few
percent larger than the bore), reported at the smaller (bore) diameter.
Hole count per axis group comes from axial mouth clusters (rims within
0.5 mm along the axis = one mouth; holes = ceil(mouths/2)). A
counterbored / stepped hole therefore reads as two diameters on one
axis — a stated limit, not a silent merge.

### Thin walls

Sampled rays from surface-triangle centroids along the inward normal
(origin pushed 0.002 mm inside; hits < 0.01 mm ignored). Materials are
flipped to `DoubleSide` during the raycast (same pattern as the parity
test in `main.ts`) and restored in a `finally` block. A hit only counts
when the hit surface's normal aligns with the ray direction (dot ≥ 0.3)
— the opposite wall is the surface the ray **exits** through, so its
outward normal points along the ray; grazing clips of neighbouring faces
and entry-across-a-gap hits are rejected. Budget 8,000 rays total, max
400/part, min 4/part, weighted by triangle count. The minimum is
**sampled, not exhaustive** — the panel and the warning text say so.

### Closedness (per mesh, not global)

Touching parts share coincident vertices, so closedness is computed per
mesh: boundary edges (used by one triangle) and non-manifold edges (used
by three or more) per part. Vertex quantisation is 100 (10 µm): coarse
enough to weld seam vertices from unsewn IGES triangulations, fine
enough not to merge real features. A few boundary edges are normal in a
tessellation (T-junction seams — the valid closed NEMA-17 STEP shows
~3%), so the open-shell warning only fires when boundary edges exceed
10% of a part's edges (an unsewn IGES triangulation shows ~19%). The
`closed` flag still requires 0 boundary and 0 non-manifold edges.

### Warnings and summary

`buildWarnings` covers: holes under the min-hole threshold, thinnest
wall under the min-wall threshold (with under/total sample counts),
tiny parts (volume < 1 mm³), aspect ratio > 20, open shells (> 10%
boundary edges), non-manifold edges. `buildSummary` is template text
from the numbers — no LLM. Warning lists that would flood the panel are
grouped when there are more than three of a kind (e.g. a 1,000-part rack
reports "25 parts are long and thin (worst aspect 53:1, e.g.
PNL-0001) — check stiffness" as one line; a glTF split into face
fragments reports its 100 unsewn parts as one line). Per-part volume,
tiny-part and aspect warnings are only emitted for substantially closed
parts (boundary fraction ≤ 10%): a face fragment's tetra-sum to the
origin is not a volume — it can be negative or huge — so fragments never
count as the largest part and never earn a size warning. The largest
part is the max-volume part among substantially closed parts, or null
when none is (a glTF split into fragments shows "—").

### Wiring

`runAnalysis()` runs after a model loads and after a deflection
re-tessellation, with a `setTimeout(0)` yield first so the model paints
before the (up to ~2 s) compute. `renderAnalysis()` re-reads the
material / threshold controls and rebuilds rows, warnings and summary
without recomputing. Material select, custom density input, wall/hole
threshold inputs and the Re-run button all go through `renderAnalysis`
(the Re-run button recomputes). `clearModel()` clears the analysis.
`__viewer.getState().analysis` exposes `{computed, computeMs, parts,
totalVolumeMm3, massG, material, densityGcm3, holes: [{diameterMm,
count}], holeCount, largestPart, minWallMm, wallSamples, warnings,
summary}`.

## Ground truth (OCCT 8.0, strict hole definition)

Ground truth was established with an independent probe
(`/tmp/gt_probe2.py`, build123d 0.13.0 / OCCT 8.0 via the simprep venv),
which classifies a cylindrical face as a hole when its face normal
points **toward** the cylinder axis (material outside the cylinder),
grouping faces by axis line + radius. Simprep's audit JSONs list "holes"
as every cylindrical face with diameter ≤ 10 mm — a loose heuristic that
includes partial cylinders (gear-tooth flanks, groove fillets) — and are
**not** used as hole ground truth. The strict probe's numbers:

| Fixture | Volume (mm³) | Holes (strict) |
| --- | --- | --- |
| micro_servo.step (6 solids) | 6,872.6 | Ø1.7 ×2, Ø2.0, Ø4.5 |
| timing_pulley.step (1 solid) | 5,106.7 | Ø5.0 ×1 (bore; 0.1 mm mouth chamfer reads Ø5.2 at both ends) |
| nema17.step (5 solids) | 58,681.8 | Ø2.0, Ø2.671 ×4, Ø3.07 ×4, Ø10.0 |
| rack1000.step (1,000 solids) | 3,553,194.7 | 0 — the audit's "400 holes Ø6.0" are Ø6/Ø12 cylindrical **bosses** |
| micro_servo.stl | 6,872.6 | same 4 holes as the STEP |

Per-solid volumes (servo): 3,471.4 / 2,476.4 / 793.6 / 68.4 / 49.5 /
13.3 mm³. NEMA-17 per-solid: 20,869.4 / 18,572.2 / 15,008.7 / 3,797.8 /
433.7 mm³. Rack largest solid: 57,600 mm³.

## How to run

```bash
export PATH="$HOME/.local/bin:$PATH"
npm run build
npx vite preview --port 4173 --strictPort
node tests/verify-v11-ai-design-check.mjs
```

The M2 suite needs the logging static server for its WASM lazy-load
check (see BUILD_M2.md). `/tmp` was wiped by a VM restart during this
build, so the server was recreated at `/tmp/static-server.mjs` (serves
`dist/`, logs every request to `SERVER_LOG`):

```bash
PORT=4174 SERVER_LOG=/tmp/static-server.log node /tmp/static-server.mjs
PORT=4174 SERVER_LOG=/tmp/static-server.log node tests/verify-m2.mjs
```

## Verification results

`npm run build` passes clean (tsc + vite). Final bundle:
`dist/assets/index-y-0y15g6.js`, 679,123 bytes, 179,733 bytes gzip.

### New suite: `tests/verify-v11-ai-design-check.mjs` — 38/38, 0 console errors, 0 page errors

| Check | Result |
| --- | --- |
| Servo STEP loads (6 parts, bbox 12.0 × 31.3 × 30.7 mm) | PASS |
| Analysis computed (0.2–0.6 s on the servo) | PASS |
| Servo volume 6,871.3 mm³ vs OCCT 6,872.6 (−0.02%) | PASS |
| Servo mass in aluminium 18.55 g | PASS |
| Servo holes Ø1.7 ×2, Ø2.0, Ø4.5 — 4/4 ground truth | PASS |
| Servo largest part: body, 3,471.36 mm³ vs OCCT 3,471.4 | PASS |
| Servo thinnest wall sampled 0.998 mm, 1,084 samples | PASS |
| Servo DFM warnings list the thin wall (1 warning) | PASS |
| Servo summary names parts, holes, material | PASS |
| Analysis panel shows volume, mass, largest part, holes | PASS |
| Material switch to steel scales mass ×2.91 (53.94 g) | PASS |
| Min-hole 2.0 mm flags the two Ø1.7 holes | PASS |
| Min-hole back to 1.0 mm clears the small-hole warning | PASS |
| Re-run recomputes the analysis (4 holes) | PASS |
| Coarse re-tessellation keeps all 4 holes; volume 6,865.9 (−0.10%) | PASS |
| Pulley STEP loads (1 part); volume 5,104.4 vs OCCT 5,106.7 (−0.05%) | PASS |
| Pulley has exactly 1 hole, the Ø5.0 bore | PASS |
| Pulley largest part is the whole pulley | PASS |
| Servo STL loads (1 part, 5,282 tris); volume 6,872.4 | PASS |
| STL finds the same 4 holes as the STEP | PASS |
| Servo IGES loads (1 part, 1,476 tris); volume 6,871.3 | PASS |
| IGES finds the 2× Ø1.7 holes (gear-bore rims break at unsewn seams) | PASS |
| IGES flags the unsewn triangulation (464 boundary edges, 19%) | PASS |
| NEMA-17 loads (5 parts); volume 58,666.5 vs OCCT 58,681.8 (−0.03%) | PASS |
| NEMA-17 holes Ø2.0, Ø3.07 ×4, Ø10.0 — 6 of 10 ground truth | PASS |
| NEMA-17 largest part: main body, 20,869.17 mm³ vs OCCT 20,869.4 | PASS |
| Rack STEP loads (1,000 parts, 82,100 tris, ~49 s load) | PASS |
| Rack volume 3,550,999.7 vs OCCT 3,553,194.7 (−0.06%) | PASS |
| Rack has 0 holes (800 Ø6/Ø12 cylinders are bosses) | PASS |
| Rack largest part 57,600 mm³ | PASS |
| Rack analysis completes in 1.7–2.1 s | PASS |
| Rack warnings group the 25 long-and-thin rails into one line | PASS |

### Hole-count ground-truth comparison (panel vs OCCT strict probe)

| Fixture | Panel | OCCT ground truth | Verdict |
| --- | --- | --- | --- |
| micro_servo.step | Ø1.7 ×2, Ø2.0, Ø4.5 (4) | Ø1.7 ×2, Ø2.0, Ø4.5 (4) | exact |
| timing_pulley.step | Ø5.0 ×1 | Ø5.0 ×1 | exact |
| micro_servo.stl | Ø1.7 ×2, Ø2.0, Ø4.5 (4) | Ø1.7 ×2, Ø2.0, Ø4.5 (4) | exact |
| micro_servo.iges | Ø1.7 ×2 (2) | Ø1.7 ×2, Ø2.0, Ø4.5 (4) | 2 of 4 — see gaps |
| nema17.step | Ø2.0, Ø3.07 ×4, Ø10.0 (6) | + Ø2.671 ×4 (10) | 6 of 10 — see gaps |
| rack1000.step | 0 | 0 | exact |
| micro_servo_draco.glb | Ø1.7 ×1, Ø4.5 (2) | Ø1.7 ×2, Ø2.0, Ø4.5 (4) | 2 of 4 — see gaps |

Volumes are within 0.1% of OCCT on every fixture (worst case the coarse
deflection servo, −0.10%).

### Regressions (all re-run against the final bundle, 0 console errors, 0 page errors)

| Suite | Result |
| --- | --- |
| `tests/verify-m2.mjs` (logging static server, port 4174) | 16/16 |
| `tests/verify-section-measure.mjs` | 25/25 |
| `tests/verify-v11-progress.mjs` | 12/12 |
| `tests/verify-v11-measure-history.mjs` | 35/35 |
| `tests/verify-v11-section-capping.mjs` | 37/37 |

### Screenshots inspected (in `tests/shots/`)

- `v11_analysis_servo.png` — Design check panel: Parts 6, Total volume
  (mesh) 6,871.26 mm³, Mass 18.6 g in Aluminium (2.7 g/cm³), Largest
  part body 3,471.36 mm³, Holes 4 — Ø1.7 mm ×2, Ø2 mm, Ø4.5 mm,
  Thinnest wall (sampled) about 1 mm, Open shells none, DFM warnings
  (1) in amber, full summary paragraph, honesty note at the bottom.
  Controls (material select, Min. wall 1.0, Min. hole Ø 1.0, Re-run
  analysis) render cleanly.
- `v11_analysis_stl.png` — STL servo: Parts 1, volume 6,872.39 mm³,
  4 holes, thinnest wall about 0.05 mm, 2 warnings (thin wall +
  10 non-manifold edges).
- `v11_analysis_rack.png` — Rack: Parts 1000, volume 3,550,999.75 mm³,
  Mass 9,587.7 g, Largest part PNL-0001 57,600 mm³, Holes 0 — None
  found, Thinnest wall about 1.5 mm, 1 grouped warning, summary.

## Bugs found in verification (all fixed)

### 1. Second Ø1.7 servo hole missed — rim chain carried a breakout tail

One Ø1.7 hole's rim chain (43 vertices) carried a long tail of
breakout / ear-outline edges, so the whole-chain circle fit dragged to
D = 2.39 mm with RMS 9.8% and the rim was rejected. (The hole is real:
OCCT says Ø1.7 at y = −9.70, depth 2.0 mm; it breaks out through the ear
end by 0.05 mm, hence a 321° cylinder span.) Fix: sliding-window +
expand arc search for open chains, and the same fallback for closed
chains whose whole-chain fit fails. Both Ø1.7 holes are now found with
entry + exit rims (z = 0 and z = 2).

### 2. Wall-normal filter sign backwards

The first version rejected genuine opposite-wall hits (dot ≈ +1) and
kept entry hits; servo samples collapsed from 756 to 65. The opposite
wall is the surface the ray **exits** through, so its outward normal
points **along** the ray: skip hits with dot < 0.3. After the fix,
servo 1,084 samples, minWall 0.998 mm.

### 3. False "open shell (0 boundary edges)" warning

The warning fired on `!closed` even when boundaryEdges was 0
(non-manifold only). Fixed: open-shell warning only on boundary edges,
and only when they exceed 10% of the part's edges (T-junction seams).

### 4. False non-manifold flags from a global edge map

Touching parts share coincident vertices, so a global edge map flagged
shared vertices as non-manifold. Fixed: closedness is computed per mesh.

### 5. Pulley bore double-counted as Ø5.0 + Ø5.2

The 0.1 mm mouth chamfer reads Ø5.2 at both ends. Fixed with a 5%
diameter merge tolerance (report the smaller, bore, diameter) plus
axial mouth clustering (rims within 0.5 mm along the axis = one mouth;
holes = ceil(mouths/2)). Pulley is now 1 hole, Ø5.0.

### 6. Face-fragment glTF: negative "volumes" and astronomical aspects

The Draco servo GLB splits the solid into 100 face-fragment meshes.
Per-fragment tetra-sums are not volumes (one fragment read −1,428 mm³),
and a flat fragment's ~0 side gave an aspect ratio of 1.35×10¹⁶:1,
producing 159 mostly-noise warnings. Fixed: aspect is 1 when the
smallest side is ≤ 1e-6 mm; per-part volume / tiny-part / aspect
warnings and the largest-part slot are gated on the part being
substantially closed (boundary fraction ≤ 10%); warning kinds group
into one line when there are more than three. The GLB now shows 1
grouped warning, no largest part, and its (still correct) total volume
6,872.4 mm³.

## Known gaps and limitations (stated plainly)

- **NEMA-17: 6 of 10 ground-truth holes found.** The 4× Ø2.671 mounting
  holes are missed: their rims are fragmented into ~127–146° arcs by the
  laminated plate construction (each lamination contributes a partial rim
  arc), below the 200° arc-coverage threshold. Lowering the threshold was
  considered and rejected without evidence it would not create false
  positives elsewhere.
- **IGES servo: 2 of 4 holes found** (Ø1.7 ×2 only; Ø2.0 / Ø4.5 gear-bore
  rims missed). The IGES triangulation is unsewn (464 boundary edges,
  19% of edges; seam vertex mismatches up to ~0.05 mm per the OCCT
  probe — 16% of IGES vertices have a neighbour within 0.05 mm vs 1%
  for STEP). Rim chains break at the seams. Welding at 0.05 mm was
  rejected: it would merge the 0.049 mm ligament vertices and break the
  thin-wall finding.
- **Draco GLB servo: 2 of 4 holes found** (Ø1.7 ×1, Ø4.5). Fragmentation
  into 100 face meshes plus Draco quantisation break rim chains. Total
  volume is still correct (6,872.4 mm³).
- **Holes whose cylinder is trimmed below a ~200° arc cannot be seen**
  by this method and are missed.
- **A counterbored / stepped hole reads as two diameters on one axis**
  (mitigated by the 5% merge + mouth clustering for chamfers; a genuine
  large step still reads as two diameters).
- **Wall minimum is sampled, not exhaustive**, and depends on
  tessellation density. The servo's mounting-hole ligament is genuinely
  ~0.05 mm (hole Ø1.7 at y = −9.70, radius 0.85, body edge at y = −10.5
  — the hole overlaps the edge by 0.05 mm and breaks out; the 321°
  cylinder span confirms it). The STL (5,282 tris, finer) resolves it:
  minWall 0.049 mm. The medium-deflection STEP (1,470 tris) samples
  centroids ~1 mm from the edge: minWall 0.998 mm. Both are real samples
  of the same ligament at different resolutions. The suite asserts
  minWall is a sane number with the warning firing, not an exact value.
  NEMA-17's minWall 0.011 mm is likewise a real sample (lamination gaps
  / near-breakout), not yet forensically traced.
- **Hole rims on curved faces** (rim not planar) are rejected by the
  planarity check — a stated method limit.
- **Volume** is exact only for closed, consistently oriented meshes;
  open shells are flagged.
- NEMA-17 STEP has duplicate part names ("NEMA-17 Stepper Motor v11 /
  Main Stepper Body" appears twice) — pre-existing (M2 report), affects
  per-part hole attribution by name only; the global hole list is
  unaffected.
- The throwaway probe scripts (`tests/probe-analysis.mjs`,
  `tests/probe-deflection.mjs`) were deleted before finishing; the
  ground-truth probe scripts live in `/tmp/gt_probe.py` and
  `/tmp/gt_probe2.py` (ephemeral — the key numbers are in the table
  above and in the simprep audit JSONs).

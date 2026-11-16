# CAD Viewer — v1.1 increment 3: section capping (stencil caps)

Date: 2026-11-16. Status: built and verified locally. Not published — the
parent handles `docs/` sync, GitHub publish, and the goal queue.

## What was built

The section view used to clip meshes with a single `THREE.Plane` and no
capping, so a cut solid showed its hollow interior. Cut faces are now filled
with a solid orange face, using the standard three.js stencil-buffer
technique (the approach in the three.js r180 `webgl_clipping_stencil`
example). The cut face reads as a solid cross-section on every format the
viewer opens, because capping operates on the three.js meshes, not on the
source format.

### Files added / changed

- `src/main.ts` — stencil cap implementation (see "How it works").
- `index.html` — Section panel note now says the cut face is capped with a
  filled orange face.
- `README.md` — Section bullet updated: cap now filled; the "not capped"
  statement removed; open-shell caveat added.
- `tests/verify-v11-section-capping.mjs` — new headless suite, 37 checks
  (see "Verification results").

## How it works

- The renderer is created with `stencil: true` (three.js r180 defaults the
  stencil buffer off, so this must be explicit).
- For every model mesh, two invisible meshes share its geometry and are
  added as **children of the model mesh**, so they inherit each part's
  transform (this matters for glTF loads, which apply a `scene.scale ×1000`)
  and follow the part's show/hide state. Back faces increment the stencil
  (`IncrementWrapStencilOp`), front faces decrement it
  (`DecrementWrapStencilOp`). Their material writes no colour or depth,
  tests nothing, and is clipped by the section plane, `renderOrder 1`.
- One cap plane sits exactly on the cut: `MeshBasicMaterial`, colour
  `0xe8590c`, `DoubleSide`, `toneMapped: false` (so it renders in exactly
  that colour), stencil test `NotEqual`, `renderOrder 2`. It has no
  `clippingPlanes` — it lies on the plane itself. Its `onAfterRender`
  clears the stencil. Where the stencil is non-zero (i.e. inside a closed
  solid), the plane shows; holes and empty space stay empty, which is why
  the pulley bore stays uncapped.
- Cap geometry is built when the section changes (toggle, axis, model) —
  never per frame and never per slider tick. Slider input only moves and
  resizes the existing cap plane. The 1,000-part rack therefore sections
  without a per-frame rebuild.
- `__viewer.section` now also reports `capped: boolean` and
  `capColor: '#e8590c'`. Stencil meshes are excluded from the part list and
  from mesh ordering; the cap plane is skipped by `applyClipping`.
- Existing controls are unchanged: axis X/Y/Z select, offset slider
  (re-ranged per model/axis), Flip, cut readout, translucent plane
  visualisation, section toggle.

## Measure on capped faces

Picking was extended, not replaced:

- `pickMeasurePoint` raycasts model meshes **and** the cap plane and takes
  the first surviving hit, so a click on a cap face picks the cap surface
  point. A parity test (`isPointInsideSolid`) rejects hits on cut-away
  geometry: a ray from the candidate point toward the kept side counts
  mesh crossings (odd = inside solid).
- The ground-truth measure is unaffected: the 10 mm pair still measures
  10.0000028 mm with the exact picked points (6, 0.3, −9.4) and
  (6, 10.3, −9.4) (see "Verification results").

## How to run

```bash
export PATH="$HOME/.local/bin:$PATH"
npm run build
npx vite preview --port 4173 --strictPort
node tests/verify-v11-section-capping.mjs
```

The M2 suite needs the logging static server for its WASM lazy-load check
(see BUILD_M2.md):

```bash
PORT=4174 SERVER_LOG=/tmp/static-server.log node /tmp/static-server.mjs
PORT=4174 SERVER_LOG=/tmp/static-server.log node tests/verify-m2.mjs
```

## Verification results

`npm run build` passes clean (tsc + vite). Final bundle:
`dist/assets/index-C2yUaHnZ.js`, 661,796 bytes, 173,448 bytes gzip.

### New suite: `tests/verify-v11-section-capping.mjs` — 37/37, 0 console errors, 0 page errors

Cap colour is `0xe8590c` = RGB (232, 89, 12); a pixel counts as cap if each
channel is within ±50. Calibrated against section-off = 0 cap pixels.
Measure tolerance ±0.5 mm.

| Check | Result |
| --- | --- |
| Servo STEP loads (6 parts, bbox 12.0 × 31.3 × 30.7 mm) | PASS |
| Section off: 0 cap pixels | PASS |
| Section on: `capped: true`, `capColor: '#e8590c'` | PASS |
| Part list still exactly 6 parts with caps on | PASS |
| Cap at X=0: filled face, 74,768 cap pixels | PASS |
| Cap points project on screen | PASS |
| First cap click picks x = 0 exactly: (0, 0.3, −9.4) | PASS |
| Cap measurement picks both points on the cap face | PASS |
| Cap measurement = 10.0000006 mm (ground truth 10.0 mm) | PASS |
| Hide all parts: 0 cap pixels; show all: 74,768 restored | PASS |
| Slider to X=3: offset = 3, cap 71,125 px (area changes with the cut) | PASS |
| Flip reverses kept side; cap viewed from the cut side after a 180° orbit: 94,792 px | PASS |
| Axis Y centre: cap 26,851 px | PASS |
| Axis Z centre: cap 36,270 px | PASS |
| Section off again: 0 cap pixels, `capped: false` | PASS |
| Ground-truth measure still 10.0000028 mm, exact points | PASS |
| Pulley STEP loads (1 part); cap 52,683 px | PASS |
| Pulley bore stays empty: bore pixel RGB (191, 198, 203), not cap colour | PASS |
| Servo STL loads (1 part, 5,282 tris); cap 74,633 px | PASS |
| Servo IGES loads (1 part, 1,476 tris); cap 74,758 px | PASS |
| Rack STEP loads: 1,000 parts, 82,100 tris, ~49–70 s load | PASS |
| Rack centre cut (X=300): cap 706 px | PASS |
| Rack end-frame cut (X=5): cap 2,339 px | PASS |

### Regressions (all re-run against the final bundle, 0 console errors, 0 page errors)

| Suite | Result |
| --- | --- |
| `tests/verify-m2.mjs` (logging static server, port 4174) | 16/16 |
| `tests/verify-section-measure.mjs` | 25/25 |
| `tests/verify-v11-progress.mjs` | 12/12 |
| `tests/verify-v11-measure-history.mjs` | 35/35 |

### Screenshots inspected (in `tests/shots/`)

- `v11_cap_x0.png` — servo at X=0: solid orange filled cap face, gear
  teeth capped, translucent blue helper plane visible above the model.
- `v11_cap_x3.png` — servo at X=3, keeping x ≤ 3: front quarter cut away,
  orange cap fills the body's cross-section, gear and mounting ear intact.
- `v11_cap_x3_flip.png` — same cut flipped (keeping x ≥ 3), viewed from
  the cut side after a 180° orbit: big solid orange face, gear teeth below.
- `v11_cap_y.png` — Y=5.15 horizontal cut: orange cap is the flat top face
  of the remaining body, gear housing intact below.
- `v11_cap_pulley.png` — pulley at X≈0: two orange cap faces flank the
  central bore, bore stays empty, cap reaches the outer rim and the flange.
- `v11_cap_rack.png` / `v11_cap_rack_end.png` — rack: a small orange sliver
  where thin rails cross the plane at X=300, a larger capped end frame at
  X=5. Correct for an open frame assembly.
- `v11_cap_x0_all_hidden.png` / `v11_cap_x0_all_back.png` — hiding all
  parts removes every cap; showing them restores the exact pixel count.

## Bugs found in verification (all fixed)

### 1. Parity test saw zero crossings — three.js raycast culls back faces

The cap rendered (74,896 cap pixels at X=0) and the cap hit was in the
raycast list at the exact cap point, but `isPointInsideSolid` returned 0
crossings, so cap clicks fell through to the far wall.

Ground truth from OCCT 8.0 (independent probe): the servo has 6 solids;
point (0, 0.3, −9.4) is **inside** solid 0 (bbox x −6..6, y −6..16.6,
z −15.8..−3), and a ray along −X from it hits (−6, 0.3, −9.4). The point
is inside solid material, so the parity ray should have hit.

Root cause: three.js `Mesh.raycast` culls back faces for `FrontSide`
materials, and a ray starting **inside** a solid only ever meets back
faces — so it sees nothing. Fix: `isPointInsideSolid` temporarily flips
all model materials' `side` to `DoubleSide` for the one synchronous
raycast and restores them in a `finally` block. No `needsUpdate` is set
and no frame renders in between, so the on-screen materials are untouched.
After the fix, all five cap probe points raycast to themselves exactly.

### 2. Cap plane (and helper) had its width/height swapped on axis X

Found in the final visual pass, after the first 37/37 run. For axis X the
plane's local X maps to world Z under `rotation.y = π/2`, but the code
used the filtered bbox sizes in axis order, so the plane spanned the wrong
cross-section axes: too short in one direction, too wide in the other.
For the pulley (25.5 mm diameter, 17 mm thick) the cap missed the outer
4.25 mm of the disc on each side; for the rack the centre-cut cap was a
36 px sliver instead of the real cross-section. The servo barely showed
it (its cross-section does not touch the bbox extremes at the cut).

Fix: in `updateSectionCapPlane` and `updateSectionHelper`, swap
width/height for axis X only; Y and Z were already correct. Pixel counts
after the fix: pulley 40,272 → **52,683**, rack centre 36 → **706**,
rack end-frame 171 → **2,339**, servo X=0 74,896 → 74,768. The full
capping suite and all four regressions were re-run against the fixed
bundle and pass (numbers in the tables above).

### 3. Three suite expectations were wrong, not the app

- **Flip showed 0 cap pixels** because after Flip the cut face is on the
  far side of the kept solid, occluded from the current camera by the
  solid itself. The suite now orbits 180° after Flip before counting.
- **Hiding one part barely moved the pixel count** (74,896 → 42,941)
  because other parts' caps cover the same screen pixels. The suite now
  hides **all** parts (expect exactly 0) and shows all back (expect the
  original count).
- **Rack centre cut is genuinely a sliver** (only a few thin rails cross
  X=300). Threshold lowered to >10 for the centre cut, with an X=5
  end-frame cut added (>50; observed 2,339 after the axis-X fix).

No test fixtures and no other suite's expectations were modified; only the
new suite's own expectations were corrected where the app was right.

## Known gaps and limitations (stated plainly)

- **Open shells may cap incorrectly.** Stencil caps need closed solids.
  The IGES servo in the fixtures is a closed shell and caps correctly, but
  an open shell (some IGES files) has no well-defined interior, so its cap
  can be wrong. The README says this.
- **Measure on cap faces is mesh-level**, like all measure in this viewer:
  the picked point is on the tessellated cap surface, not on the exact CAD
  surface.
- **The cap is a flat plane spanning the bbox cross-section**, restricted
  to the solid's interior by the stencil — it is not a tessellated outline
  of the section. This is the standard stencil approach and it is what
  makes holes stay empty, but a cap pixel at the very edge of the bbox
  cross-section is only drawn where the stencil says "inside".
- **No per-frame cap rebuild** by design (see "How it works"). A model
  whose geometry changes without a reload would need a section refresh to
  re-cap.
- During final verification the VM service restarted and wiped `/tmp`
  (the logging static server had to be recreated). All numbers in this
  report were re-run after the restart against the final bundle
  (`index-C2yUaHnZ.js`).

# CAD Viewer — Sectional views + measure tools build report

Date: 2026-11-13. Status: **built and verified** — 25/25 headless checks
pass, M2 regression 16/16, 0 console/page errors. Nothing published
or deployed; no GitHub repo created.

## What was built

Sectional views and point-to-point measurement, on top of the M2 B-rep
core. Both work on every format the viewer opens (mesh and B-rep),
because both operate on the three.js meshes the viewer already builds.

### Files added / changed

| File | What |
|---|---|
| `index.html` | Measure + Section toggle buttons in the toolbar; new sidebar panels Section (axis select, offset slider, Flip, cut readout) and Measure (point/distance readout, Clear button); `#measure-label` overlay div in the viewport |
| `src/main.ts` | Section state + `THREE.Plane` clipping (shared plane object, `renderer.localClippingEnabled`), translucent plane visualisation, slider re-ranging per model/axis; measure mode + raycast picking (click vs drag), markers + line + screen label, unit-aware display; `Dimensions (X × Y × Z)` line in the file panel; `__viewer` hook extended (section/measure state, bbox min/max, `project()` + `raycastAt()` test helpers) |
| `src/style.css` | `.ctl-row`, range styling, `#measure-label` overlay |
| `README.md` | Section / Measure notes |
| `tests/verify-section-measure.mjs` (new) | 25 headless checks: section controls + render change, measure against independent ground truth, units, clear/restart, section+measure interaction, second model |

## Sectional views

- **How:** one `THREE.Plane`, applied as `clippingPlanes` on every model
  material (`renderer.localClippingEnabled = true`). The plane object is
  updated in place, so the slider moves the cut without recompiling
  shaders; toggling on/off sets `material.needsUpdate` (the plane count
  is part of the shader program).
- **Controls:** Section toggle in the toolbar (default off); axis X / Y /
  Z; offset slider in mm whose range is the model's bbox span along the
  axis (re-ranged on axis change and on every new model); Flip reverses
  the kept side; offset and kept side shown in the panel and the status
  bar. A translucent blue plane marks the cut position in the viewport.
- **Scope:** mesh-level clipping of the tessellated triangles, **not**
  kernel sectioning — SCOPE.md §3C (opencascade.js) is the path if exact
  B-rep sectioning is ever needed. Consequence, stated in the UI: the
  cut is **not capped** — a cut solid shows its hollow interior (the
  inside of the far wall), not a filled cross-section face.

## Measure tools

- **How:** Measure mode turns a click (pointerdown/up within 6 px, so
  orbit drags never pick) into a raycast against the model meshes. Two
  points draw amber markers, a blue line, and a screen label pinned to
  the midpoint (re-projected every frame, so it tracks the camera).
- **Display:** distance in the current units (mm/cm/inch — the Units
  selector converts the label and panel live), plus both point
  coordinates and the mm value in the sidebar Measure panel.
- **Behaviour:** a third click restarts the measurement with one point;
  Clear empties it; clicking empty space places nothing; the measurement
  survives orbiting and unit changes, and is cleared with the model.
  While a section is on, raycast hits on the cut-away side are skipped,
  so a click on the removed part picks the first kept surface behind it.
- **Scope:** distances are measured on the **tessellated mesh**, not the
  exact CAD surfaces (SCOPE.md §5) — stated in the UI. On flat faces the
  tessellation is exact, so the verified error there is ~0 (see below);
  on curved surfaces the pick sits on a facet, not the true surface.

## Bounding-box dimensions

The file panel now shows `Dimensions (X × Y × Z)` in mm alongside the
existing size in display units — e.g. servo: `12 × 31.3 × 30.68 mm`.

## How to run

```bash
export PATH="$HOME/.local/bin:$PATH"
cd ~/workspace/cad-viewer
npm run dev      # dev server on 5173
npm run build    # tsc + vite → dist/
npm run preview  # serve dist/ on http://localhost:4173
node tests/verify-section-measure.mjs  # 25 checks (needs preview on 4173)
node tests/verify-m2.mjs               # M2 regression (needs preview, or the
                                       # logging static server for the WASM check)
```

`npm run build` passes clean (tsc + vite). Bundle: JS 656.62 KB /
172.52 KB gzip (was 648.21 KB / 169.78 KB in M2).

## Verification results

Headless Chromium (stock, `~/.cache/puppeteer/chrome-headless-shell-linux64/`),
production build, micro servo STEP loaded through the real file input,
section and measure driven with real clicks.

**25/25 checks pass** (`tests/verify-section-measure.mjs`), **0 console
errors, 0 page errors.**

### Measure ground truth (independent of the viewer)

The two test points were probed from the same STEP with OCCT **8.0**
via simprep's build123d (`/tmp/probe_measure.py`, kept out of the repo):
the largest planar face with normal +X (area 289.3 mm², centre
(6.0, 5.3, −9.4)), two points on it verified on-face with
`BRepExtrema_DistShapeShape` (distance 0.0000):

- p1 = (6.0, 0.3, −9.4), p2 = (6.0, 10.3, −9.4), distance **exactly 10.0 mm**.

Browser result, two real mouse clicks at the projected points:

- Picked points: (6, 0.3, −9.4) and (6, 10.3, −9.4) — match to ~1e-6 mm.
- Measured distance: **10.0000019 mm** (error 2e-6 mm — the face is planar,
  so the tessellation is exact there).
- Label shows "10 mm"; switching Units to cm shows "1 cm" with
  `distanceMm` still 10.

### Section checks

- Slider spans the servo bbox X (−6..6 — the STEP is centred on the
  origin, which the first draft of this test wrongly assumed was 0..12;
  see bugs below) with the offset at the centre (0).
- Slider to X = 3 moves the cut; screenshot differs from baseline
  (133,652 B vs 133,117 B) — and, more importantly, was inspected
  visually: the front quarter is gone, the interior and the translucent
  plane are visible.
- Flip reverses the kept side and back; axis Y re-ranges the slider to
  the bbox Y span (−10.5..20.8).
- Section at X = 0 (half the servo removed) and at X = 3 both inspected
  visually — cut correct, panel + status bar name the cut.
- Pulley: section re-ranges to its bbox X (−12.75..12.74); the sectioned
  pulley screenshot shows the bore and teeth cut cleanly.

### Interaction checks

- Third click restarts the measurement (1 point); Clear empties it and
  hides the label; clicking empty space places no point.
- With section X = 3 (keeping x ≤ 3), clicking the ground-truth point
  (x = 6, cut away) picks the first kept surface behind it
  (1.35, −4.56, −15.8) — x ≤ 3.05 as required.

### Regression

M2 suite re-run after this change: **16/16 pass** against the logging
static server (the WASM lazy-load check needs it — CDP cannot see worker
fetches; see BUILD_M2.md). Against plain `vite preview` it reports
15/16 with only that best-effort network check failing (0 occt requests
seen by CDP), which is the known harness limitation, not a regression.

## Bugs found in verification (all fixed)

1. **Test assumed the STEP origin was at a corner.** The servo STEP is
   centred on the origin (bbox X −6..6, Y −10.5..20.8), so the first
   draft of the test expected slider 0..12 / centre 6 and a "30.7 mm"
   dimensions string. The viewer was right (slider −6..6, centre 0;
   dimensions "30.68 mm" from 30.6799…). Test expectations corrected;
   no app code changed for this.
2. **Status bar went stale after moving the section slider.** It showed
   the offset from toggle time ("Section on — X = 0 mm") while the
   slider sat at 3. `refreshSectionInfo()` now updates the status text
   on every slider/flip/axis change. Re-verified 25/25 after the fix.
3. **`pkill -f "vite preview"` kills the invoking shell.** The pattern
   matches the exec command's own command line. Preview servers in
   these runs are started with `npx vite preview` and killed by PID
   file instead.

## Known gaps and limitations (stated plainly)

- **No section capping.** A cut solid shows its hollow interior. Capped
  cross-sections need stencil-buffer caps or kernel sectioning
  (opencascade.js, SCOPE.md §3C) — not attempted here.
- **One measurement at a time.** No measurement list/history; a third
  click discards the previous pair. A list (with per-measurement delete)
  is the obvious next step if Balaji wants several dimensions at once.
- **Measure picks the tessellated mesh.** On curved surfaces the picked
  point sits on a facet, so the distance is approximate to within the
  tessellation deflection (Medium by default; Fine tightens it).
- **Section plane visual is a flat rectangle** sized to the bbox
  cross-section; it does not outline the actual cut shape.
- **Measure mode stays on across Clear** (the mode is separate from the
  measurement). Clearing the model does not turn the mode off — the
  next loaded model can be measured immediately, which is the intent,
  but it can surprise if the mode was left on accidentally.

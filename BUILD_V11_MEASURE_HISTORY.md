# CAD Viewer — v1.1 increment 2: measurement history list

Date: 2026-11-15. Status: **built and verified** — 35/35 new checks
pass, M2 regression 16/16, section+measure regression 25/25, v11-progress
regression 12/12, 0 console/page errors in every suite run. `dist/` synced
to `docs/` (the GitHub Pages source); README updated. Not published to
GitHub by this build — that step is the parent agent's call.

## What was built

The viewer kept one measurement at a time: a third click discarded the
previous pair. Completed measurements are now kept in a history list in
the sidebar Measure panel.

### Files added / changed

| File | What |
|---|---|
| `src/main.ts` | `MeasureEntry` history state (`id`, both points, `distanceMm`); completing a two-point measurement appends to the list; per-entry delete; Clear active (removes the active measurement and its history entry) vs Clear all (empties the whole history, including the active one); history cleared with the model; list re-rendered on unit change; `__viewer` hook extended with `measure.history` |
| `index.html` | Measure panel: `#measure-history-list`, `#measure-history-empty` empty state, buttons renamed to the unambiguous "Clear active measurement" / "Clear all measurements" |
| `src/style.css` | History list styles (bordered entries, small delete ×, 220 px scrollable max-height) |
| `README.md` | Measurement-history note |
| `tests/verify-v11-measure-history.mjs` (new) | 35 headless checks: add several, list contents, delete one, Clear all, units conversion, active-measurement behaviour, model-clear |
| `tests/shots/v11_measure_history_3.png`, `v11_measure_history_cleared.png`, `v11_measure_history_list.png` | Screenshots: 3-entry state, cleared state, scrolled list close-up |

## How it works

- **Picking unchanged.** One active measurement at a time: markers + line +
  label behave as before; a third click restarts the active measurement
  (the completed one stays in the list). Section-aware picking (raycast
  skips the cut-away side) is untouched.
- **History.** Every completed two-point measurement appends an entry:
  `#n · <distance>` in the current units, plus both point coordinates in
  mm (same convention as the active-measurement panel). No cap; the list
  scrolls past 220 px.
- **Delete.** Each entry has a × button. Deleting the entry that is the
  active measurement also clears its markers/line/label; deleting any
  other entry leaves the active measurement alone.
- **Clear active vs Clear all.** "Clear active measurement" empties the
  active measurement (and drops its history entry, so the list never
  shows a measurement that is no longer on screen). "Clear all
  measurements" empties the whole history including the active one.
  Both buttons disable when there is nothing for them to clear.
- **Units.** Switching Units re-renders the list distances (mm → cm →
  inch); the stored data stays in mm, as the active panel does.
- **Model clear.** Clearing the model empties the history, as it already
  emptied the active measurement. Changing tessellation detail does not
  clear the history — same geometry, measurements stay valid.
- **Scope, as before:** distances are measured on the tessellated mesh,
  not the exact CAD surfaces (stated in the UI; no new claims added).

## How to run

```bash
export PATH="$HOME/.local/bin:$PATH"
cd ~/workspace/cad-viewer
npm run dev      # dev server on 5173
npm run build    # tsc + vite → dist/
npm run preview  # serve dist/ on http://localhost:4173
node tests/verify-v11-measure-history.mjs  # 35 checks (needs preview on 4173)
node tests/verify-m2.mjs                   # M2 regression (16 checks; needs
                                           # the logging static server for the
                                           # WASM network check — see below)
node tests/verify-section-measure.mjs      # 25 checks (needs preview on 4173)
node tests/verify-v11-progress.mjs         # 12 checks (needs preview on 4173)
```

`npm run build` passes clean (tsc + vite). Bundle: JS 659.92 KB /
173.60 KB gzip (was 658.56 KB / 173.20 KB before this increment).
New bundle hash: `index-7OOYwz2F.js`.

## Verification results

Headless Chromium (stock, `~/.cache/puppeteer/chrome-headless-shell-linux64/`),
production build, micro servo STEP loaded through the real file input,
measurements driven with real clicks.

**35/35 checks pass** (`tests/verify-v11-measure-history.mjs`), **0 console
errors, 0 page errors.**

| Check | Result |
|---|---|
| Servo STEP loads, history starts empty | PASS — 6 parts, bbox 12.0 × 31.3 × 30.7 mm |
| Pair A lands in history (count 1) | PASS — 10.0000019 mm, err 1.9e-6 |
| Pair A picked points match ground truth | PASS — (6, 0.3, -9.4), (6, 10.3, -9.4) exact |
| Pair B appends (count 2) | PASS — 10.0000005 mm, err 4.7e-7 |
| Pair C appends (count 3) | PASS — 9.9999955 mm, err 4.5e-6 |
| List shows 3 entries with distance + both points | PASS |
| List empty-state hidden while entries exist | PASS |
| Delete middle entry (pair B) | PASS — A and C remain, active still pair C |
| Units cm converts list to "1 cm" | PASS — history data stays mm |
| Units inch converts list to "0.39 in" | PASS — active label "0.39 in" |
| Units back to mm restores "10 mm" | PASS |
| Third click restarts the active measurement | PASS — history keeps the 2 completed entries |
| Completing the restart appends (count 3) | PASS |
| Clear active empties the active measurement | PASS — label hidden, button disables |
| Clear active drops its history entry | PASS — history 3 → 2 |
| Clear all empties the history | PASS — 0 entries, empty state shown, button disables |
| Model clear empties the history | PASS — loaded=false, history=0 |

Screenshots inspected visually: `v11_measure_history_3.png` (active pair C
with the "10 mm" label on the +X face), `v11_measure_history_list.png`
(sidebar scrolled to the Measure panel: three numbered entries, bold
distances, coordinates, × buttons, both Clear buttons), and
`v11_measure_history_cleared.png` (empty state + both buttons).

### Measure ground truth (independent of the viewer)

Three distinct 10.0 mm pairs on the servo's +X side face (x = 6.0),
probed from the same STEP with OCCT **8.0** via simprep's build123d
(`/tmp/probe_measure2.py`, kept out of the repo). Each point was verified
on-face with `BRepExtrema_DistShapeShape` (distance 0.0). The face is
the largest planar face (area 289.3 mm², centre (6.0, 5.3, −9.4),
normal +X); its bounding box (y −6..16.6, z −15.8..−3) equals its area,
so it is the full rectangle with no holes — every point inside it is
on the face.

| Pair | Points (mm) | Direction | Browser distance | Error |
|---|---|---|---|---|
| A | (6, 0.3, −9.4) → (6, 10.3, −9.4) | Y | 10.0000019 mm | 1.9e-6 |
| B | (6, −5.7, −15.5) → (6, −5.7, −5.5) | Z | 10.0000005 mm | 4.7e-7 |
| C | (6, −5.7, −9.4) → (6, 4.3, −9.4) | Y | 9.9999955 mm | 4.5e-6 |

All three pairs are on the same +X face (the camera-facing side), so a
click on any of them is guaranteed to hit that face first — nothing in
the model extends past x = 6. A candidate pair on the +Z face
(z = −3) was probed and is exact too, but was **not** used for browser
clicks: front geometry (z up to 3.88) sits between the camera and that
face, so a click there could land on the wrong surface.

### Regressions

- **M2 suite: 16/16 pass** against a logging static server
  (`/tmp/static-server.mjs`, recreated for this run — the original from
  the M2 build was gone from /tmp; same design, serves `dist/` and logs
  requests). The WASM check proves via the server log (js=1, wasm=1).
  Against plain `vite preview` it reports 15/16 with only that
  best-effort network check failing (CDP cannot see worker fetches) —
  the known harness limitation documented in BUILD_M2.md, not a
  regression.
- **Section+measure suite: 25/25 pass** (measure still 10.0000019 mm
  vs the exact 10 mm ground truth).
- **v11-progress suite: 12/12 pass** (rack 1,000 parts, 82,100 tris,
  56,724 ms load; cancel + worker recovery intact).

## Bugs found in verification (all fixed)

1. **Test bug, not app bug: `clickPair` after a restart click.** The
   step-7 flow clicked the first point of pair A to restart the active
   measurement, then called the `clickPair` helper — which clicks two
   points. Its second click started yet another (one-point) measurement,
   so "Clear active" found no completed active entry and the history
   stayed at 3 instead of dropping to 2. The app behaved per design
   (Clear drops the active entry only when the active measurement is
   complete). The test now clicks just the second point to complete the
   restarted measurement. Re-verified 35/35 after the fix.
2. **Harness: `node` not on PATH when starting the logging static
   server.** The server failed silently (`node: command not found`) and
   the still-running `vite preview` (its PID file held the `npx` shell's
   PID, not vite's) kept serving on 4173, so the first M2 run reported
   15/16 against vite preview. Killed vite by its real PID, restarted
   the static server with `~/.local/bin` on PATH, re-ran: 16/16 with
   the server-log WASM proof. The 15/16 run was the known harness
   limitation, not a regression — but the silent server failure is
   worth recording: check the server log file exists before trusting a
   run against it.
3. **Probe bug: the pair-finder scanned the face normal axis.** The
   first draft of `/tmp/probe_measure2.py` scanned the constant
   (normal) coordinate instead of fixing it at the plane value, so it
   found no pairs on the +X face or the +Z face. Fixed by taking the
   plane value from the bbox axis with ~zero span and scanning only the
   two in-plane axes. Re-ran: pairs B and C found and verified on-face.

## Known gaps and limitations (stated plainly)

- **The history list sits below the fold on short viewports.** The
  Measure panel is under File / Parts / Section in a 280 px sidebar, so
  on an 800 px-tall window the list is only visible after scrolling the
  sidebar. The list itself scrolls past 220 px. Reachable, not
  prominent — a panel reorder is a UI decision for later, not attempted
  here.
- **History is not persisted.** It lives for the page session; reloading
  the page or loading a new model clears it. No export of the list
  (copy/CSV) exists yet.
- **The list shows the active measurement only as its newest entry.**
  Older entries are records, not scene objects: their markers/lines are
  not drawn, and clicking an entry does not re-display it. Re-showing a
  past measurement from the list is a possible next step.
- **No section capping** (unchanged from BUILD_SECTION_MEASURE.md) and
  **measure still picks the tessellated mesh** — on curved surfaces the
  picked point sits on a facet, so the distance is approximate to within
  the tessellation deflection.

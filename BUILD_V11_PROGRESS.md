# CAD Viewer — v1.1 increment 1: load progress indicator

Date: 2026-11-14. Status: **built and verified** — 12/12 new checks
pass, M2 regression 16/16, section+measure regression 25/25, 0
console/page errors. Nothing published or deployed; the live site is
not updated by this increment (that step is the parent agent's call).

## What was built

The 1,000-solid rack STEP took ~56 s to load and the viewer showed
nothing until it appeared. B-rep loads now show a loading overlay with
the real stage and ticking elapsed seconds, plus a Cancel button.

### Files added / changed

| File | What |
|---|---|
| `src/brepWorker.ts` | Posts `{ type: 'progress', id, stage }` at the real stage boundaries: `'loading-occt'` (before the WASM finishes initialising), `'parsing'` (before the synchronous `ReadFile`), `'converting'` (before the result is converted to typed arrays) |
| `src/brep.ts` | `parseBrep()` takes an optional `onProgress` callback, routed by parse id; new `terminateBrepWorker()` kills the worker, rejects every pending parse with `BREP_LOAD_CANCELLED`, and resets worker state so the next load creates a fresh worker; new `BrepProgressStage` type |
| `src/main.ts` | Overlay show/hide + 250 ms elapsed ticker + Cancel wiring in the B-rep load path and the deflection re-tessellation path; a second B-rep load while one is in flight is refused with a toast instead of queuing behind the first; Clear during a load cancels it first; cancel is quiet (no "failed to open" toast) and leaves the previous model in place; `__viewer` hook extended with `loading: { active, stage, fileName, elapsedMs }` |
| `index.html` | `#load-overlay` panel in the viewport: file name, stage line, elapsed line, "Large assemblies can take a minute. The file stays on your machine.", Cancel button |
| `src/style.css` | Overlay styles (dark panel, blue stage text, `pointer-events: none` on the wrapper so the model can still be orbited mid-load; only the panel takes clicks) |
| `README.md` | Load-progress note |
| `tests/verify-v11-progress.mjs` (new) | 12 headless checks: overlay on rack load, elapsed ticking, real stage, no fake percent, rack lands, overlay clears, cancel behaviour, worker recovery, mesh loads overlay-free |

## Honest progress, not a fake percentage

OCCT's `ReadFile` is one synchronous call inside the worker — there is
no true percentage to report, and the worker cannot post messages while
it runs. So the overlay reports the stage the load is actually in:

- `Loading OCCT…` — first B-rep load only, while the ~7.6 MB WASM
  downloads and initialises (~2.5 s)
- `Parsing <file>…` — the long `ReadFile` + tessellation (56 s for the
  rack); the elapsed-seconds ticker is what keeps moving here
- `Converting meshes…` — result → transferred typed arrays
- `Building model…` — three.js geometries on the main thread (a one-tick
  yield before this step lets the stage text paint first)

The main thread stays free during the parse (the work is in the worker),
so the ticker updates and the page does not freeze — verified by the
elapsed samples below (5,024 ms → 12,323 ms while the rack parsed).

## Cancel

Cancel terminates the worker (`worker.terminate()` — the one thing that
can interrupt OCCT's synchronous call) and resets all worker state.
The pending parse rejects with the `BREP_LOAD_CANCELLED` sentinel,
which both load paths recognise and stay quiet about. The previously
loaded model, if any, stays on screen; the next B-rep load creates a
fresh worker. Verified: after cancelling a rack load mid-parse, the
micro servo STEP loaded normally (6 parts, exact bbox, 1,694 ms).

## Scope kept tight

B-rep loads only (including deflection re-tessellation, which is the
same parse). Mesh loads are fast and show no overlay. Section, measure,
and everything else untouched — both regression suites pass unchanged.

## How to run

```bash
export PATH="$HOME/.local/bin:$PATH"
cd ~/workspace/cad-viewer
npm run dev      # dev server on 5173
npm run build    # tsc + vite → dist/
npm run preview  # serve dist/ on http://localhost:4173
node tests/verify-v11-progress.mjs  # 12 checks (needs preview on 4173)
node tests/verify-m2.mjs            # M2 regression (16 checks; needs the
                                    # logging static server for the WASM
                                    # network check — see below)
node tests/verify-section-measure.mjs  # 25 checks (needs preview on 4173)
```

`npm run build` passes clean (tsc + vite). Bundle: JS 658.56 KB /
173.20 KB gzip (was 656.62 KB / 172.52 KB before this increment).

## Verification results

Headless Chromium (stock, `~/.cache/puppeteer/chrome-headless-shell-linux64/`),
production build, fixtures loaded through the real file input.

**12/12 checks pass** (`tests/verify-v11-progress.mjs`), **0 console
errors, 0 page errors.**

| Check | Result |
|---|---|
| Overlay appears on rack load | PASS |
| Elapsed ticks while parsing | PASS — 5,024 → 12,323 ms across two samples ~5 s apart |
| Stage shows the real parse stage | PASS — "Parsing rack1000.step…" at both samples |
| No fake percentage shown | PASS — no `%` in stage or elapsed text |
| Rack loads: 1,000 parts, exact bbox | PASS — 1,000 parts, 82,100 tris, bbox 600 × 63 × 800 mm, loadMs 58,108, wall 59,159 ms |
| Overlay clears on completion | PASS |
| Overlay appears on second rack load | PASS |
| Cancel hides overlay, no error toast | PASS — status "Load cancelled.", toast empty |
| Cancel leaves previous model in place | PASS — rack still loaded, 1,000 parts |
| Status reports cancellation | PASS |
| Worker recovers after cancel (servo loads) | PASS — 6 parts, bbox 12.0 × 31.3 × 30.7 mm, loadMs 1,694 ms |
| Mesh load shows no overlay | PASS — STL loaded, 5,282 tris |

Screenshots inspected visually: `tests/shots/v11_progress_midload.png`
(overlay centred over the grid: "Loading rack1000.step", blue
"Parsing rack1000.step…", "5 s", the note, Cancel button; status bar
shows the parse message) and `tests/shots/v11_rack1000_loaded.png`
(rack frame grid rendered, file panel 600 × 63 × 800 mm, 82,100
triangles, 89,150 vertices, PARTS (1000), status "Loaded rack1000.step
(STEP) in 58108 ms.", overlay gone).

### Regressions

- **M2 suite: 16/16 pass** against a logging static server
  (`/tmp/static-server.mjs`, recreated for this run — the original from
  the M2 build was gone from /tmp; same design, serves `dist/` and logs
  requests). Against plain `vite preview` it reports 15/16 with only
  the best-effort WASM network check failing (CDP cannot see worker
  fetches) — the known harness limitation documented in BUILD_M2.md,
  not a regression.
- **Section+measure suite: 25/25 pass** (measure still 10.0000019 mm
  vs the exact 10 mm ground truth).

## Known gaps and limitations (stated plainly)

- **No sub-stage progress inside the parse.** The 56 s rack parse
  shows one stage ("Parsing…") with a ticking clock the whole time.
  Finer progress would need chunked tessellation (parsing solids in
  batches) or kernel progress callbacks — occt-import-js exposes
  neither. The elapsed clock is the honest signal that work is
  happening.
- **The elapsed ticker pauses during the main-thread build.**
  `brepToModel` runs synchronously on the main thread (a few hundred
  ms for the rack), so the 250 ms interval cannot fire inside it. The
  overlay already says "Building model…" by then, and the pause is
  short.
- **The empty-state text shows faintly through the panel.** The panel
  is 0.95 opaque, so "Drop a CAD file here" is just visible behind it
  mid-load. Cosmetic; the panel text stays legible.
- **Opening a second B-rep file mid-load is refused** ("cancel it
  first") rather than queued. Deliberate: the worker runs one
  synchronous parse at a time.
- **Cancel during WASM initialisation** (the first ~2.5 s of the first
  B-rep load) terminates the worker and resets init state; the next
  load re-downloads the WASM. Not exercised by a dedicated check —
  the cancel check runs mid-parse, where the time is actually spent.

# CAD Viewer

A browser-based viewer for open CAD and 3D formats. Files are read in
the browser and never leave the machine — no upload, no server, no CAD
licence.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev      # local development server
npm run build    # production build into dist/
npm run preview  # serve the production build on http://localhost:4173
```

Or open `dist/` on any static host (GitHub Pages, Cloudflare Pages,
Vercel).

## Formats — this build (M0+M1+M2)

| Format | Status |
|---|---|
| STL (binary + ASCII) | Supported |
| OBJ (+ MTL when supplied alongside) | Supported |
| glTF / GLB | Supported (Draco verified — see BUILD_M2.md) |
| PLY | Supported |
| AMF | Supported |
| STEP (AP203 / AP214 / AP242) | Supported — parsed by OCCT 7.6.1 in WASM |
| IGES | Supported — parsed by OCCT 7.6.1 in WASM |
| BREP | Supported — parsed by OCCT 7.6.1 in WASM |

Proprietary formats (JT, SolidWorks, CATIA, NX, Inventor, Creo, DWG,
Parasolid, ACIS, FBX) are not supported — export STEP from your CAD
system and open that instead.

## Notes

- Units are mm throughout. Mesh formats carry no unit, so their size is
  assumed mm. glTF stores metres by spec and is scaled ×1000 to mm on
  load. STEP/IGES units are converted to mm by the reader; BREP carries
  no unit and is treated as mm.
- glTF files (JSON) may reference an external `.bin` buffer; drop the
  `.bin` alongside the `.gltf` and it resolves locally.
- B-rep files are tessellated in a Web Worker by occt-import-js (OCCT
  7.6.1 in WASM, vendored under `public/occt/`). The WASM (~7.6 MB) is
  downloaded only when the first B-rep file is opened, never on first
  page load. The Detail control (Coarse / Medium / Fine) sets the
  tessellation deflection and re-parses the open B-rep file on change.
- **Section:** the Section button cuts the model with a clipping plane.
  Axis (X / Y / Z), offset slider in mm across the model bbox, and Flip
  choose which side is kept. The cut is mesh-level clipping of the
  tessellated triangles — the section is not capped, so a cut solid
  shows its hollow interior. Works on every format, including B-rep.
- **Measure:** the Measure button turns clicks into picks. Click two
  points on the model and the distance shows in mm (or the selected
  units) as a line with markers and a label, plus both point coordinates
  in the sidebar. A third click starts a new measurement; Clear removes
  it. Distances are measured on the tessellated mesh, not the exact CAD
  surfaces (see SCOPE.md §5). The file panel also shows the model
  dimensions (X × Y × Z) in mm.
- See [SCOPE.md](SCOPE.md) for the full format matrix, licensing, and
  milestones, and [BUILD_M0M1.md](BUILD_M0M1.md) / [BUILD_M2.md](BUILD_M2.md)
  / [BUILD_SECTION_MEASURE.md](BUILD_SECTION_MEASURE.md) for the build
  and test reports.

## Licence

MIT. three.js is MIT. The Draco decoder files in `public/draco` are
from the three.js package (Apache 2.0 / BSD as noted in their headers).
The OCCT build in `public/occt/` is occt-import-js 0.0.23 (MIT, see
`public/occt/license.occt-import-js.txt`) embedding Open CASCADE
Technology 7.6.1 (LGPL-2.1 + Exception, see
`public/occt/license.occt.txt`); the WASM is shipped unmodified.

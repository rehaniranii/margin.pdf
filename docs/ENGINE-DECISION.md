# Engine feasibility and distribution decision

Evaluated 2026-11-07 against official documentation, the installed package's API
definitions/source, and executable output tests. Pinned dependency: `mupdf@1.28.1`.
Online documentation currently describes 1.28.5; only APIs verified in 1.28.1 are
used here.

## Technical choice

Use **MuPDF alone provisionally for local development**. It covers rendering,
positioned text extraction, removal, insertion via PDF streams, generation, and page
operations. This is the smallest evaluated combination meeting the central need.
Adding pdf-lib would duplicate generation and document parsing at this stage.

Official references:

- [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js) describes its WASM runtime,
  rendering, structured extraction, and document APIs.
- [PDFPage API](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFPage.html)
  documents content removal with applyRedactions. The proof disables black boxes,
  image removal, and vector removal while enabling text removal.
- [PDFDocument API](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFDocument.html)
  supplies font/page creation and saving. The proof rewrites with garbage collection,
  rather than appending an incremental version containing old content.
- [StructuredText API](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/StructuredText.html)
  supplies extraction/search and a walker with positioned character data. The proof
  verifies extraction and search; general region detection is implemented in the
  Phase 2 extension described below.
- [pdf-lib limitations](https://github.com/Hopding/pdf-lib#limitations) explicitly
  exclude extracting or removing ordinary page text. Its MIT-licensed generation,
  drawing, font embedding, and page-copying APIs may be useful later, but cannot
  independently satisfy the central editing requirement. It is not installed.

### Proof boundary

The generated sample uses Helvetica, horizontal text, a zero-origin letter page,
and a known rectangle. The adapter removes intersecting original glyphs, appends a
text stream, saves, and reopens the output. Tests inspect decoded streams and
extraction, check search, and compare pixels outside the line. A tinted vector
background survives, so an opaque white cover cannot pass.

This does not prove universal font preservation or safe editing of arbitrary PDF
regions. Region removal affects every overlapping glyph, including unseen text.
It does not sanitize attachments, metadata, other layers, or the whole document.
Existing subset fonts are not reused. Replacement is printable ASCII, Helvetica,
21 pt, with measured overflow rejected. General detection, cropped/rotated editing,
overlap analysis, resource isolation, and unsupported-script handling were outside
this original proof; the Phase 2 extension below records the current capability.

## Distribution decision remains with the owner

The installed package declares **AGPL-3.0-or-later**. Its JavaScript wrapper and WASM
are covered; moving it into a browser worker does not avoid licensing obligations.
The [upstream license](../public/licenses/mupdf-LICENSE.txt) is preserved and copied
into production assets. [Artifex's licensing guidance](https://artifex.com/licensing)
offers AGPL and commercial routes. No commercial license has been obtained.

Before distribution, choose and document either an AGPL-compliant distribution
with the required corresponding source, notices, and applicable application
licensing, or obtain appropriate commercial terms. Free access, no backend, and
private npm packaging do not settle this decision. No application-wide LICENSE was
created and no permission to relicense the user's code is inferred.

Direct dependency metadata reviewed:

| Dependency | Version | Declared license | Role |
| --- | --- | --- | --- |
| mupdf | 1.28.1 | AGPL-3.0-or-later | PDF engine and WASM |
| tesseract.js-core | 6.1.2 | Apache-2.0 | OCR engine (WASM), added after Phase 6 |
| @tesseract.js-data/eng | 1.0.0 | MIT packaging; Apache-2.0 model data | English OCR data, added after Phase 6 |
| react / react-dom | 19.3.1 | MIT | Interface |
| vite | 8.3.6 | MIT | Build tooling |
| typescript | 7.0.2 | Apache-2.0 | Type checking |
| tsx | 4.23.15 | MIT | TypeScript test execution |
| @types/node | 26.6.6 | MIT | Development types |
| @types/react / react-dom | 19.3.0 | MIT | Development types |

The lockfile pins transitive dependencies. Phase 6 inventories every locked npm
package and verifies the four runtime license copies against installed packages.
No additional PDF library is included. Two OFL fonts and the OCR engine were added after
Phase 6; see the post-Phase-6 review at the end of this document. The distribution route,
corresponding-source delivery and MuPDF's bundled-component notice obligations still
require resolution before distribution; an npm metadata inventory is not legal clearance.

## Phase 2 capability extension

The same pinned engine now powers detected source-span editing in local PDFs, using
StructuredText quads and Device/Text glyph walks. Glyph positions are compared before
and after content removal, replacement fonts have isolated Form resources, and the
saved output is reopened, searched, and rendered before commit. Tests cover intrinsic
rotation, nonzero CropBoxes, UserUnit scaling, shared content, character rejection,
overflow, pixel preservation, undo/redo, and preview/export agreement.

Additional official references verified before using these capabilities:

- [StructuredTextWalker](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/StructuredTextWalker.html)
  for positioned character/line data.
- [Device](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/Device.html)
  for paint/clip callbacks, and
  [Text](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/Text.html)
  for glyph metrics and walks. The installed 1.28.1 definitions/source and executable
  fixtures also verify the specific methods and ownership behavior used.

Support remains deliberately conservative: simple horizontal source text, printable
basic Latin, three replacement fonts, fixed slots, and explicit read-only states.
See the current README and Phase 2 verification for the exact limits. No dependency
or licensing-route change was made, and no project-wide license was assigned.

## Phase 3 additions

The same pinned MuPDF engine provides image embedding and PDF/vector overlays; no
pdf-lib or new dependency was needed. [Image constructors](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/Image.html)
and [PDFDocument resource/stream APIs](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFDocument.html)
were checked against official documentation and the installed declarations before use.
Tests exercise real font/image resources, alpha graphics, page transforms and exports.
Distribution licensing remains unchanged and unresolved; no project license was added.

## Phase 4 additions

The existing pinned MuPDF 1.28.1 binding also supports page graft maps, annotation/widget
baking, image-to-PDF generation, searchable stamps and PNG/JPEG pixmap export. No
additional engine or dependency was added. Official [PDFDocument baking and grafting](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFDocument.html)
and [Pixmap encoding](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/Pixmap.html)
APIs were checked, then exercised against the installed binding. In particular, tests
found the need to retain UserUnit and page Group explicitly during grafting. Missing
interactive structures are handled by the stated flatten/copy policy; layered/XFA PDFs
are rejected. Signature detection uses PDF object inspection, not certificate validation.

The inline clipboard workflow follows the browser's [Clipboard read API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/read)
and [clipboardData events](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData),
with native shortcut/file-input fallbacks. Distribution licensing remains unresolved;
no project-wide license, deployment or dependency-version change was made.

## Phase 5 additions

No new runtime/build dependency or PDF engine was introduced. Offline caching is a
small local service worker and build-manifest adapter. MuPDF remains pinned at 1.28.1.
All application dependencies, including worker/WASM/font support, are self-hosted in
the production output. JavaScript document actions remain disabled. Privacy fixtures
exercise OpenAction, AA, document JavaScript, form submission/launch actions and links
without calling network APIs during rendering, text replacement or page copying.
The CSP permits WASM compilation specifically rather than general string evaluation.
See Phase 5 verification and the offline README for actual checks and hosting headers.
The unresolved AGPL/commercial distribution decision remains unchanged.

## Phase 6 dependency review

`npm run release:licenses` records the lockfile hash, all 98 locked package entries
(including optional platform packages), their declared licenses and development/runtime
status in `output/phase6/dependency-inventory.json`. No entry has missing license metadata.
Counts: 61 MIT, 22 Apache-2.0, 12 MPL-2.0, one ISC, one BSD-3-Clause and one
AGPL-3.0-or-later. The only npm runtime packages are MuPDF, React, React DOM and Scheduler;
their preserved public license texts match the installed package files byte for byte.
Other entries are development/build dependencies. Vite's preserved license includes
its upstream notices for bundled helpers. No dependencies were added in this phase.

MuPDF remains pinned at 1.28.1; the latest online documentation may describe a newer
release, so installed declarations and executable fixtures are used to confirm behavior.
[Artifex's official licensing guidance](https://artifex.com/licensing) was rechecked on
2026-11-08. It continues to describe AGPL and commercial routes. The owner must choose
a route and meet its applicable source, notice and bundled-component obligations
before distributing this app/WASM. No commercial license, application license or
distribution authorization is inferred from this local verification work.

## Post-Phase-6 additions (reviewed 2026-11-09)

Three things now ship in the production output besides MuPDF and React:

| Component | License | Ships as | Notice in `public/licenses/` |
| --- | --- | --- | --- |
| tesseract.js-core 6.1.2 (Tesseract compiled to WASM) | Apache-2.0 | OCR worker and `tesseract-core-simd-lstm` WASM | `tesseract.js-core-LICENSE.txt` |
| English OCR data, eng 4.0.0_best_int (`@tesseract.js-data/eng` 1.0.0) | Apache-2.0 model data (Tesseract `tessdata_best`); package metadata MIT | `eng.traineddata-*.bin` | `tesseract-eng-traineddata-LICENSE.txt` |
| Dancing Script, Great Vibes (from `google/fonts`, unmodified) | SIL Open Font License 1.1 | `.ttf` assets; subsets embedded in signed PDFs | `DancingScript-OFL.txt`, `GreatVibes-OFL.txt` |

`npm run release:licenses` now inventories 100 locked packages (62 MIT, 23 Apache-2.0,
12 MPL-2.0, one ISC, one BSD-3-Clause, one AGPL-3.0-or-later). The npm runtime packages
are MuPDF, React, React DOM, Scheduler, tesseract.js-core and `@tesseract.js-data/eng`.
The data package ships no license file, so its notice was written by hand from the
tessdata source and is listed explicitly in the script as a reviewed exception; every
other runtime license copy still matches the installed file byte for byte. The fonts
are not npm packages; their OFL texts are copied verbatim from `google/fonts`.
`THIRD-PARTY-NOTICES.txt` lists all of the above.

Compatibility notes (an engineering reading, not legal advice): Apache-2.0 code can be
combined into an AGPL-3.0 distribution, so the OCR engine does not block the AGPL route.
The OFL allows bundling the fonts with software and embedding them (including subsets)
in documents; the Reserved Font Name only restricts distributing *modified* fonts under
the same name, and the fonts are shipped unmodified. None of these additions has a
commercial-licensing implication of its own.

Release-check fixes made during this review: the OCR data was first emitted as a `.gz`
file, which servers send with `Content-Encoding: gzip`, so the browser received bytes
that did not match the offline manifest and offline setup failed. It now ships as `.bin`,
and the offline build refuses any `.gz`/`.br` asset. The full release sequence (unit
tests, proof, fixtures, licenses, build, PDFKit and all five browser checks) passes.

## What deciding the distribution route involves

Nothing above changes the open decision: MuPDF is AGPL-3.0-or-later and the app is a
network service, so the owner must still pick one route before public distribution.

- **AGPL route.** License the application's own code under AGPL-3.0-or-later (or a
  compatible license) and offer every user the complete corresponding source, including
  build scripts, for the exact deployed version, for example a visible "Source code" link
  to a public repository tag. Keep the notices above. Anyone may then reuse the app.
- **Commercial route.** Obtain commercial terms from Artifex for MuPDF; the app's code can
  then stay private. The OCR engine and fonts need no separate commercial license, but
  their notices must still ship.

A private preview used only by the owner does not distribute the app. No project-wide
license has been assigned and no route has been chosen; that remains the owner's call.


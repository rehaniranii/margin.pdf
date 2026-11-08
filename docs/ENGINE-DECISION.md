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
| react / react-dom | 19.3.1 | MIT | Interface |
| vite | 8.3.6 | MIT | Build tooling |
| typescript | 7.0.2 | Apache-2.0 | Type checking |
| tsx | 4.23.15 | MIT | TypeScript test execution |
| @types/node | 26.6.6 | MIT | Development types |
| @types/react / react-dom | 19.3.0 | MIT | Development types |

The lockfile pins transitive dependencies. This phase's review establishes the
engine decision; a complete transitive notice and distribution audit remains part
of release verification. No additional PDF library or downloaded font is included.

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

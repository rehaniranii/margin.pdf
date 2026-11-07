# Architecture and phase plan

Phases 1 and 2 are implemented. Work remains local; no application service or database
is used. MuPDF is the only PDF engine, with an unresolved owner licensing decision.

## Source boundaries

| Directory/file | Responsibility |
| --- | --- |
| src/components | Actual PDF preview, positioned selection buttons, page rail, properties |
| src/model/document.ts | Immutable source/page references, text edits, worker view state |
| src/workers | Typed commands/replies, buffer ownership, ready handshake, serialized execution |
| src/engine/text-analysis.ts | Positioned spans, painted glyphs, appearance/overlap checks |
| src/engine/text-edit.ts | Validation, removal, resource-isolated insertion, save/reopen verification |
| src/engine/editor-session.ts | Candidate compilation, committed document, history, bounded analysis cache |
| src/engine/mupdf-adapter.ts | Document opening, bounded raster rendering, retained Phase 1 proof |
| src/geometry | Affine geometry, overlap/containment, actual-raster selection coordinates |
| src/export | User-initiated local PDF download |
| src/offline | Offline delivery explicitly deferred to Phase 5 |
| tests | PDF semantics, pixel preservation, geometry, history, worker lifecycle, fixtures |
| scripts | Reproducible original Phase 1 engine proof |

## Document model and worker ownership

A working document references immutable source bytes, a page organization plan, and
text edits keyed to stable source-page span IDs. Original files are never written.
Source span geometry stays stable after replacement; selecting an edited span refers
to its original slot. The current replacement, including a removed/empty span, can be
revised without stacking repeated redactions.

The main thread imports no PDF engine runtime. A single dedicated worker owns the
source/compiled document handles and serializes commands. WASM initializes before a
ready message flushes the client's queue. File.arrayBuffer input is transferred, then
the worker returns a separate source snapshot for the interface model. WASM-backed
views are copied before transfer. Replies carry independent PNG buffers, compact text
region descriptors, edit plans, and history status. Native page/pixmap/text/save/document
handles are released explicitly. Text.walk's shared font callback wrapper is borrowed;
StructuredText's per-character retained font wrappers are released after inspection.

Only one UI job can run at a time. Generation tokens discard stale results after
clearing/cancellation. Opening is transactional: a new session must analyze/render
successfully before the previous session is disposed. Clear terminates the worker,
rejects pending requests, drops source/render references, and creates a new worker.
It discards the workspace rather than pretending to preserve cancelled work.

## Detection and supported states

StructuredText (preserve-spans/whitespace) supplies source text, character quads,
baselines, font names/sizes, directions, and RGB colors. A separate Device walk
identifies actually painted glyphs, their transforms/positions, appearance, clip bounds,
and graphic obstacles. Each character must map to one unique glyph. Fabricated spaces,
ambiguous duplicate glyphs, ligature mappings, or unsupported encodings are rejected.

Source text must have an ordinary, positive, uniform horizontal transform in raw PDF
space. Its displayed direction can change with page rotation. Single-style spans are
kept separate; mixed style/positioning within a span is rejected. Basic Latin is the
explicit initial character set. No embedded subset font is reused.

Other glyphs overlapping the removal rectangle block editing. Links, annotations,
widgets and graphic obstacles overlapping the slot also block it. A simple opaque
rectangle already behind and containing the whole span is an allowed background.
Fully containing rectangular clips are safe; clipped glyphs or unusual clips fail
appearance checks. Complex masks/groups/layers/stroked or invisible text make a page
conservatively view-only. Existing Redact annotations block that page because applying
redactions would otherwise also apply unrelated removals. Repaired PDFs are view-only.

## Commit pipeline

1. Validate immutable source IDs, font choice/size/color, printable characters, and
   geometry. Measure actual replacement advances and ink with the selected MuPDF
   font. Require fitting in the original slot and no neighboring text collision.
2. Compile the entire edit plan from the unchanged original into a fresh document.
   Recompilation occurs on Apply/history, not while typing or moving a pointer.
3. Apply the selected text removals, with image/vector removal and opaque black
   boxes disabled. Before inserting anything, compare painted glyph identities
   and positions against all expected nonselected glyphs. This verifies removal
   even if the replacement wording equals the original or occurs elsewhere.
4. Append replacement text as PDF content in a Form XObject with its own font resources.
   Clone the page resource/XObject dictionaries before adding a unique entry. Original
   shared resources are not changed by insertion. Wrap original content in q/Q to
   isolate graphics state from the new form. No page rasterization is used in export.
5. Rewrite with garbage collection, reopen the bytes, verify expected remaining and
   inserted glyph positions, and verify each nonempty replacement using PDF text search.
6. Render the candidate. Only after all checks pass commit its bytes, handle, revision,
   and history. Export returns a copy of the same bytes used by this preview handle.

Failed validation, verification, or rendering does not replace the committed PDF or
history. Undo/redo stores edit plans rather than PDF snapshots; editing after undo
branches and removes the redo branch. Source descriptors are cached for at most six
pages. Only the current main render is retained; page tiles render on selection.

## Coordinates and resource budgets

Canonical interaction geometry uses MuPDF page points at 72/in, top-left, y downward.
Executable fixtures establish that the installed binding's getTransform maps raw PDF
coordinates into displayed page space, accounting for CropBox, intrinsic rotation,
and UserUnit. The insertion form uses its inverse, while replacement text matrices
follow the original displayed baseline. The page's organization rotation field records
future extra rotation, independently of intrinsic source rotation.

The renderer returns the actual raster scale, integer pixel origin, and raster extent.
Selection bounds map into percentages of that raster, including its rounding; CSS
zoom and device pixel ratio therefore cannot displace the regions. Paper height uses
the actual raster aspect ratio. Tests cover rotations, crop origins, UserUnit, DPR,
rounded raster extents, and preservation outside the editing slot.

Raster limits: 4096 pixels per axis, 8 million pixels total, effective scale at most 3,
DPR at most 2. Opening fits the current pane; Fit recalculates after resize. Zoom
changes page-point CSS dimensions with document-area scrolling. Object URLs are revoked
on replacement/unmount, downloads after the browser begins saving. The rail displays
at most seven page controls plus first/last jumps. History and source bytes remain in
memory, with no persistence or artificial usage quota. Device limits still apply.

## Remaining phases — not started

**Phase 3:** Added text/images/highlights/rectangles/ink, object selection and transforms,
extended history, polished zoom/navigation, progress, recoverable cancellation.

**Phase 4:** Page organization and utility/conversion jobs. Validate ranges; define and
disclose forms/annotations/links/bookmarks and signature handling per operation.

**Phase 5:** Versioned service-worker asset delivery including worker/WASM/fonts,
readiness checks, safe update timing, CSP, disconnected production reload, and complete
request/storage privacy audit. Document JavaScript remains disabled today; links are
not activated and previews are engine-generated images.

**Phase 6:** Cross-reader and browser fixture matrix, larger/scanned/malformed documents,
mobile hardware memory checks, offline edit/export, licensing/distribution review,
and release assessment. No distribution license has been selected for this project.

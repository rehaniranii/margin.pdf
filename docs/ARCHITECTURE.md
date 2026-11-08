# Architecture and phase plan

Phases 1–6 are implemented and locally checked. Work remains local; no application service or database
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
| src/offline | Verified application-only caching, lifecycle, readiness and job activity |
| tests | PDF semantics, pixel preservation, geometry, history, worker lifecycle, fixtures |
| scripts | Engine proof, offline build generation, release fixtures and independent-reader checks |

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

## Phase 6 scope — completed locally

Cross-reader/browser fixtures, scanned and larger documents, small-screen viewport
checks, offline edit/export, dependency inventory and release assessment are recorded
in the Phase 6 extension below. Physical mobile hardware and broad malformed-file
testing remain unverified. No distribution license has been selected for this project.

## Phase 3 extension

Phases 1–3 are implemented. Existing text remains the default tool. `AddedObject` is
an explicit union for text, image, highlight, rectangle and ink, each with stable ID,
source page and a box in displayed page points. Text/objects form one immutable
`EditPlan` per history frame. Ink stores normalized points inside its box, with its
line width reserved at the edges. Image objects reference worker-owned assets rather
than copying image data into every history frame.

`ObjectLayer` handles pointer capture, cancelled gestures, local outline/path previews,
movement, and corner resizing. It maps pointer coordinates through the actual raster
extent/origin; it never rebuilds a PDF during pointer movement. A release submits one
transaction. Image resizing preserves aspect ratio; text resizing retains font size
and is rejected if content overflows. Arrow keys and numeric fields provide keyboard
movement and sizing. Text/image/rectangle/highlight creation also has a keyboard
accessible center-placement action. Draw is inherently a pointer operation; image
insertion provides an alternative for an existing visual signature.

`added-objects.ts` validates geometry, styles, characters, fit and asset references.
It appends isolated PDF Form content using the inverse page transform. Fonts, images
and ExtGState resources are local to that form; page/XObject dictionaries are cloned.
Highlights use alpha with Multiply blending; rectangles and ink are vector paths.
JPG/PNG image matrices explicitly account for the downward page Y direction. Added
text uses real text operators and is searchable. Existing-text removal still goes
through the Phase 2 verification path before objects are composed above it.

Compilation caches one text-only result keyed by the source text edit plan. Moving
an object reuses that verified prefix and rebuilds only the object composition pass.
A text plan change invalidates the prefix; candidate render/parse/validation failures
leave the committed PDF/history untouched. This deliberately uses one PDF engine and
adds no dependency. PDF serialization is synchronous inside the dedicated worker.
Progress reports actual processing stages, not invented percentages.

`image-assets.ts` checks PNG/JPG headers and rejects decoded images beyond 32 million
pixels before engine decoding. It retains an image handle and an engine-rendered small
thumbnail. Imported but unplaced images are explicit pending assets. Assets referenced
by past/current/redo frames stay alive; branching, release and clear drop unused assets.
Only selected/pending thumbnails get Blob URLs, revoked on replacement/unmount.

Each committed view includes a transferable copy of the compiled PDF and history
position/length. The interface mirrors the observed immutable plans in memory, plus
compressed image source buffers. Export downloads those authoritative committed bytes.
Cancellation terminates the worker, rejects pending commands, discards stale responses,
and restores a fresh worker from original source, last committed PDF, mirrored history
and referenced image assets. Restoration opens the last PDF rather than recompiling
it. Revision values remain consistent so an uncommitted property draft can survive
recovery. The old page stays visible; recovery failure retains the in-memory checkpoint
and allows another recovery attempt or saving the last committed PDF. Clear workspace
is the separate, explicitly destructive in-memory reset.

Zoom changes preserve a viewport anchor. Width/whole-page fitting, typed zoom, validated
page jumps, PageUp/PageDown, Pan and temporary Space-pan extend navigation. Rendering
retains its previous raster limits; 400% CSS zoom can magnify a capped raster. Working
source, current bytes, one text prefix, one recovery PDF, asset data, native image handles,
and compact history coexist in memory. No document content is persisted in browser
storage, and the app writes nothing to localStorage.

Phase 3 ended here. The following extension implements Phase 4; offline support and release verification remain deferred.


## Phase 4 extension

The primary text properties and on-page input now share one controlled `TextEdit`
draft. Double-click (or keyboard Enter) opens a transient textarea at the source span.
Native caret selection/clipboard operations act on the draft. Enter commits through
the same verified removal/replacement pipeline, and Escape restores the baseline.
Added text has an on-page draft with Ctrl/Cmd+Enter; failed glyph/fit validation keeps
the draft visible. New pasted text can be corrected before its first PDF commit.
Unapplied drafts block navigation/export. Pointer capture for dragging retargets native
click events, so ObjectLayer recognizes stationary double taps for added-text editing
while retaining captured move/resize gestures. Sidebar formatting remains optional.

Clipboard handlers ignore native form fields and the utilities dialog. Selected source
spans and added text support native copy; native text-field behavior remains intact.
Pasted text replaces a selected supported span as a draft or creates an added-text
draft. Paste/drop images use the existing decode guard, image asset model and object
compiler; no document bytes are sent to a service. The clipboard button uses the
browser's user-initiated Clipboard API and reports a shortcut/file-input fallback if
access is unavailable. HTML clipboard data is never interpreted. The last page pointer
is reset when a new document opens. Pending clipboard reads are discarded if the
document, page, selection, draft, tool or job generation changes before they finish.

`model/utilities.ts` defines immutable source identifiers, a page organization plan
(`sourceId`, zero-based source page, additional quarter-turn rotation), stamp settings,
and transferable artifacts. `utilities/page-ranges.ts` validates one-based interface
ranges and preserves deliberate ordering without duplicates. `engine/pdf-features.ts`
checks signature dictionaries/fields/certification references and feature flags on the
worker; it does not validate certificates or claim proof of absence on inspection failure.

`PdfUtilities` owns copies of registered input buffers in a separate dedicated worker.
The editor engine remains alive and unchanged during utility jobs. Commands share the
typed protocol/client but the utility worker has no editor session until needed. Access
is serialized; inputs/results transfer ownership, while the editor's authoritative
checkpoint is copied before registration. One graft map per source preserves resource
sharing across interleaved page references. Worker teardown releases registered source
buffers; native docs/maps/fonts/pixmaps/images are explicitly destroyed after jobs.

For all PDF-to-PDF utilities, source annotations/widgets are baked into static page
content, then selected pages/resources are grafted into a new document. UserUnit and
page transparency Group are copied explicitly because the binding's default page-key
list omits them. Intrinsic rotation is retained and additional rotations are combined.
New catalogs omit links, bookmarks, attachments, document metadata, tags and labels.
Optional-content and XFA documents are rejected. The interface explains interactivity
loss and signature invalidation before generation; missing appearances and sanitization
are outside the promise. Original files and editor source buffers are never mutated.

Watermarks/numbers append searchable text in isolated page-space Forms, using inverse
page transforms, measured fit and explicit font/color/opacity. Page-number sequence
follows the selected page order. JPG/PNG conversion centers images proportionally on
A4 or pixel-sized pages with a chosen margin. Page image exports render one page at a
time with annotations/widgets, white backgrounds and the existing pixel/edge budget;
actual dpi is returned even when lower than requested. Split and image exports use
individual user-initiated downloads rather than buffering a document-wide bitmap batch.

The modal previews the first page of the actual generated PDF. Download preserves the
editor; Open result deliberately rebases into a new in-memory source/history, with a
visible explanation beforehand. The utility plan/result can be discarded independently.
Page transformations are not editor undo entries. Cancelling terminates only the utility
worker, discards in-flight changes, releases added utility inputs and re-registers the
current editor checkpoint. Generation tokens suppress stale replies. The original editor
history and last downloadable bytes are untouched. Recovery re-registration can be
retried by closing/reopening the panel. All state is memory-only.

Homepage links open utility-specific hash routes with file selection; they do not seed
merges with the sample. The existing homepage identity and theme are retained. Phase 4 stopped before offline delivery; the following extension implements Phase 5. No deployment was added.


## Refresh protection follow-up

The document remains memory-only. `model/export-state.ts` compares the current source
identifier and edit/object plan against the last requested download. Render/recovery
revisions and navigation do not count as content changes. Undo/redo back to a downloaded
plan clears the unexported state; undoing away from it restores that state. Imported
local sources start clean, while undownloaded generated utility sources start unexported.

`useUnsavedChangesWarning` registers beforeunload only while an unapplied draft or
unexported plan/result exists, and unregisters after export/discard. Utility results
track download requests and pass that state when opened as new editor sources. The
footer tells users to export before refreshing. This is a browser leave warning, not
a recovery checkpoint: accepting the warning, crashes and some mobile force-closes
still discard the session. No document storage, autosave, service worker or automatic
recovery was introduced. Persistent local recovery needs an explicit opt-in.

## Phase 5 extension

`offlineBuild` is a local Vite build plugin. It enumerates actual static output,
including nested worker dependencies and WASM, computes byte sizes/SHA-256 hashes,
and emits a versioned manifest, self-contained service worker, HTML meta CSP and
static-host header rules. A per-build identifier links the UI to its installed worker;
readiness for a different version is never advertised. No dependency or PDF engine was
added. The configuration serves at `/` with hash routes and a dedicated origin.

The service worker owns only `margin-pdf-app-*` caches. Installation fetches a fixed
same-origin GET list sequentially with omitted credentials/referrers and no redirects,
verifies every response, and removes a failed candidate cache. Readiness rehashes every
required asset and rejects unexpected cache entries. Repair is serialized, re-fetches
only the fixed list and removes unknown entries. Neither status nor activity messages
include file names, bytes, text or edit state. Runtime requests cannot add cache entries:
unknown/foreign URLs and non-GET methods return local errors without network fallback;
navigation uses the cached HTML. Cache contents are application code/resources only.

No skipWaiting or clients.claim is used. The initial page gets an explicit first-setup
reload after verification, with existing unload warnings intact and reload disabled
during jobs. Natural activation of an update waits for all old-version clients to close;
only then are old owned caches deleted. The UI never calls location.reload automatically
on controllerchange. This conservative policy also avoids taking over older, busy tabs
that predate offline registration. Users see when an update is waiting and are asked to
export before closing. No update activation message or force-update button is exposed.

The delivery store verifies controller/version/cache readiness before Available offline,
and rechecks on focus, visibility and connectivity changes. A missing/corrupt cache
returns an explicit retry state. Service-worker registration/verification require HTTPS
or localhost, subtle crypto, worker support and browser storage. Real eviction/quota
behavior prevents promising permanent availability. Development mode skips registration
and says offline delivery is disabled; production output was tested disconnected.

`offline/activity.ts` counts queued/running document requests; completion, failure,
cancellation and synchronous transfer failure release counts exactly once. UI busy
lifetimes also cover file reads outside worker calls. Setup/repair controls remain
unavailable during jobs. PDF worker state remains serialized separately from service-
worker asset verification. Clear workspace terminates document workers, drops models,
assets and recovery references, resets file inputs and triggers URL cleanup. Static
caches remain; no document data is persisted by default.

CSP is emitted in HTML and supplied as response headers by Vite preview. Static hosts
must apply equivalent headers, including worker responses. Script strings/inline JS,
forms, frames, object embedding and foreign resources are blocked; only self modules,
workers, WASM compilation, local Blob images and positional inline styles are allowed.
No analytics, ads, telemetry, session recording or remote error collection is present.
The engine opens untrusted PDFs through disableJS and the UI never dispatches PDF links,
Launch/SubmitForm actions or embedded scripts. Tests exercise malicious-action fixtures
online/offline without linked requests, and inspect storage/caches for a private canary.
This does not remove such actions from text-editing exports or sanitize a document.

## Phase 6 verification and corrections (current)

The release matrix in `scripts/release/fixtures.ts` is shared by structural/pixel tests
and the reproducible browser fixture generator. It covers source text, embedded subset
fonts, scans, cropped/rotated/UserUnit pages, annotations, form appearances, synthetic
signature detection, overlap restrictions, skewed text, 250 pages and oversized page
dimensions. Candidate exports are compared with their committed previews, and pixels
outside the selected source slot remain unchanged. A separate, optional macOS PDFKit
script opens, extracts and renders exports without MuPDF.

Browser verification found and corrected three issues: inline text inputs now follow
the source region's transformed baseline, bounded rendering reserves outward rounding
pixels, and Clear workspace no longer starts another idle WASM worker. Worker creation
is lazy on the next editor job; direct utility entry does not allocate an unused editor
worker. Recovery still creates a worker when restoring an actual checkpoint.

Production Chromium checks exercise source edit/export/reopen, native clipboard text
and image paste, added text, offline reload/edit/export and numbering, narrow layouts,
windowed large-document navigation, storage/network behavior and worker termination.
See `docs/PHASE6-VERIFICATION.md` for the checks actually performed and reproducible
commands. Cross-browser/device coverage and arbitrary-PDF compatibility remain limited.
Offline caching delivers the app; it is not document autosave or local recovery.
Licensing/distribution remains undecided. No deployment or project license was assigned.

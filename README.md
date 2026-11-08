# margin.pdf

A free, standalone PDF workspace built with React, TypeScript, Vite, and a local
MuPDF WebAssembly worker. **Phases 1–3 are implemented.** Existing-text editing
is the primary workflow. No backend, accounts, analytics, payments, usage quotas,
or external runtime services are used. Nothing has been deployed.

## Run locally

Use Node.js 22.12+ (or 20.19+) and npm. Verified on Node 26.10.

```sh
npm ci
npm run dev
```

Open the printed localhost URL and choose **Open editor** (or go to `/#/edit`).
A labeled two-page sample is generated in memory in the editor.
Or choose **Open PDF** to use your own local PDF.

1. Select a blue text region on the page. Keyboard focus and Enter also select it.
2. Change the text, replacement font, size, or color in the properties panel.
3. Choose **Apply changes** to remove the original and preview the actual resulting PDF.
4. Choose **Export PDF** to save a local copy. The original file stays unchanged.

Unapplied drafts block export, changing documents, and switching text regions/pages.
Apply or discard the draft first. Zoom preserves drafts. Document Undo/Redo controls
operate on applied edits; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z work outside text inputs.
Text fields retain their native typing history. Escape clears selection outside
text fields when no unapplied draft exists.

```sh
npm test          # PDF output, geometry, history, worker lifecycle
npm run proof     # original Phase 1 controlled before/after artifacts
npm run build     # TypeScript check and static production build in dist/
npm run preview   # serve the production build locally
```

The static build includes its worker and approximately 10.4 MB WASM engine. First
load can take time on slower devices. A local HTTP server is required; file:// is
unsupported. Vite reports externalized Node imports from MuPDF's guarded
cross-platform runtime. They were not suppressed, and production browser checks pass.

## Supported text editing

- Unencrypted, digitally generated PDFs with simple, opaque, horizontal source text.
- Single-style lines or spans with unique, positioned basic Latin glyphs.
- Intrinsic page rotations of 0/90/180/270 degrees, nonzero CropBoxes, and UserUnit scaling.
- Replacement text in printable basic Latin (U+0020–U+007E): letters, numbers,
  spaces, punctuation. No accents, emoji, complex scripts, or line breaks yet.
- Helvetica, Times Roman, or Courier replacements, with size and RGB color controls.
- Fixed layout. Replacement width and glyph bounds must fit the original span;
  overflow is rejected. Shorten the text or reduce its size. Empty text removes it.
- Verified removal before insertion, searchable replacement, accurate PDF preview,
  export, multiple edits across pages, and undo/redo with history branching.

The engine checks both the original text area and replacement ink against neighboring
text. Amber regions explain why they are view-only. Clipped glyphs, special encodings,
vertical/skewed/stretched text, overlapping graphics/text/links/forms, transparency,
layers, repaired PDFs, and pending page redactions can prevent editing. A simple,
opaque rectangular background drawn behind the entire span is preserved and allowed.
Fully containing rectangular clips (including the CropBox/Form bounds) are allowed;
partial or unusual clips are rejected. Mixed styles may be exposed as separate spans.

Embedded/subset fonts are **not reused**. The chosen replacement font may look different.
Unsupported text is never silently substituted. No full-page rasterization or opaque
cover rectangle is used for text replacement. Replacement is not comprehensive
sanitization: metadata, attachments, unused resources, and other occurrences are outside
its promise. Editing PDFs can invalidate digital signatures; signature detection and
operation-specific handling remain scheduled for Phase 4.

## Added objects and navigation

The editor defaults to **Edit existing text**. The other tools add objects above the
page content; they do not replace or erase original text.

- **Add text:** click/drag a box, or use Place at page center, then edit its content,
  font, size and color. Basic Latin text and line breaks are supported. Overflow is
  rejected until the box is enlarged or the text/font size is reduced.
- **Add image:** choose a local JPG/PNG and click the page, or use Place at page center.
  Proportions stay locked during corner/numeric resizing. Replace image changes its
  content while keeping it an editable object.
- **Highlight / Rectangle:** drag to place, or place at center. Adjust color and
  opacity for highlights; color and line width for outlined rectangles.
- **Draw:** use mouse, pen, or touch. Each stroke is an editable object. Choose Note
  or Visual signature as its purpose. A visual signature is a drawing, not
  certificate-based digital signing.
- **Select objects:** move by dragging; resize with a corner; edit exact position and
  size in points; change contextual properties; delete. Arrows move by 1 point,
  Shift+arrows by 10. Delete/Backspace deletes outside text inputs.

Dragging shows a temporary outline/path. Releasing commits the model and renders
its real PDF result. Pointer cancellation or Escape discards an unfinished gesture.
All applied object and text edits share undo/redo. Images needed by history remain
available until that history branch is discarded.

Zoom supports 10–400%, width/page fitting, and preservation of the viewed area.
Pan drags the page; holding Space temporarily pans outside text inputs. Use the page
number field or PageUp/PageDown for navigation. Page ranges and zoom values are
validated. Touch hardware and broad browser testing remain release-verification work.

**Cancel operation** terminates the active worker and restores the last applied PDF,
edit history, and referenced image assets from memory. The visible workspace stays
in place during recovery. Export downloads the same in-memory committed bytes used
for recovery, so the last applied PDF can still be saved after a worker error. Clear
workspace deliberately discards everything. Neither snapshots nor image assets are
written to browser storage.

Added objects export as PDF page content. Reopening the exported file does not restore
object handles or session history. Exported transparent graphics can also trigger the
existing-text editor’s conservative complex-appearance checks on reopening; the
current working session keeps its editable source references. Added text remains searchable; images and drawings
remain visual page content. There is no object rotation, image cropping, layer/reorder
panel, rich typography, or pressure-sensitive ink in this phase. Ink strokes resize as
paths with a fixed line width; they are individually selected/deleted. No signature
certificate, identity, or tamper-evidence validation is provided.

## Local data and current limits

Working files, edit plans, and history stay in memory. Reloading or clearing discards
them. Export is a user-initiated download. Runtime code has no upload path or persistent
document storage. The production browser request log contained localhost application
assets and local Blob URLs during the tested workflows.

**Offline reload is not implemented yet.** Service worker delivery, complete CSP and
privacy hardening, disconnected production tests, and broad release verification
remain Phases 5/6. This is not a release-ready or offline-ready build.

Rendering has an 8-million-pixel budget and bounded dimensions/DPR. Source snapshots,
compiled recovery bytes, image assets, engine state, and edit-plan history coexist in memory; very large or
malformed PDFs can exceed browser/device limits. There is no imposed file-size or
usage quota. Each added image has a 32-million-pixel decoding budget, checked from
its header before decoding to bound native memory. This is an application memory
safeguard, not a universal browser limit or per-user quota. Larger images must be resized
locally first. Cancel restores the last committed workspace; Clear workspace terminates the worker
and deliberately discards the in-memory document. Inactive page tiles currently show numbers; the selected page
has a real thumbnail. Page utilities/conversions and password entry
are not implemented. No placeholder controls imply that they are.

See [architecture](docs/ARCHITECTURE.md), [Phase 3 verification](docs/PHASE3-VERIFICATION.md),
[Phase 2 verification](docs/PHASE2-VERIFICATION.md),
[historical Phase 1 verification](docs/VERIFICATION.md), and
[engine/licensing decision](docs/ENGINE-DECISION.md).

## Licensing status

**No license has been assigned to this project. Distribution is pending an owner
licensing decision.** MuPDF is AGPL-3.0-or-later, with commercial terms available from
Artifex. Making this application free does not remove the dependency's obligations.
Read the engine decision before distributing the application or its WASM binary.

# margin.pdf

A free, standalone PDF workspace built with React, TypeScript, Vite, and a local
MuPDF WebAssembly worker. **Phases 1 and 2 are implemented.** Existing-text editing
is the primary workflow. No backend, accounts, analytics, payments, usage quotas,
or external runtime services are used. Nothing has been deployed.

## Run locally

Use Node.js 22.12+ (or 20.19+) and npm. Verified on Node 26.10.

```sh
npm ci
npm run dev
```

Open the printed localhost URL. A labeled two-page sample is generated in memory.
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

## Local data and current limits

Working files, edit plans, and history stay in memory. Reloading or clearing discards
them. Export is a user-initiated download. Runtime code has no upload path or persistent
document storage. The production browser request log contained localhost application
assets and local Blob URLs during the tested workflows.

**Offline reload is not implemented yet.** Service worker delivery, complete CSP and
privacy hardening, disconnected production tests, and broad release verification
remain Phases 5/6. This is not a release-ready or offline-ready build.

Rendering has an 8-million-pixel budget and bounded dimensions/DPR. Source snapshots,
compiled bytes, engine state, and edit-plan history coexist in memory; very large or
malformed PDFs can exceed browser/device limits. There is no imposed file-size or
usage quota. Clear workspace cancels by terminating the worker and discards the
in-memory document. Inactive page tiles currently show numbers; the selected page
has a real thumbnail. Added objects, page utilities/conversions, and password entry
are not implemented. No placeholder controls imply that they are.

See [architecture](docs/ARCHITECTURE.md), [Phase 2 verification](docs/PHASE2-VERIFICATION.md),
[historical Phase 1 verification](docs/VERIFICATION.md), and
[engine/licensing decision](docs/ENGINE-DECISION.md).

## Licensing status

**No license has been assigned to this project. Distribution is pending an owner
licensing decision.** MuPDF is AGPL-3.0-or-later, with commercial terms available from
Artifex. Making this application free does not remove the dependency's obligations.
Read the engine decision before distributing the application or its WASM binary.

# Phase 2 — existing-text editor verification

Performed locally on 2026-11-07. Phase 2 is implemented; later phases were not started.
The repository remains the project boundary. No deployment, publishing, pushing,
accounts, or external document-processing services were used. The licensing choice
for distribution remains unresolved and no application license was assigned.

## Implemented

- Detect supported, positioned source text lines/spans in local PDFs and the sample.
- Select regions by pointer or keyboard, with visible focus and supported/read-only
  outlines. Amber selections explain specific limitations.
- Change text, replacement font (Helvetica/Times Roman/Courier), point size and color.
- Reject unsupported characters, overflow, clipped/ambiguous glyphs, unusual transforms,
  and unsafe overlap. Empty text deliberately removes a span.
- Remove original PDF text before inserting real searchable replacement content;
  preserve graphics rather than painting an opaque cover or rasterizing a page.
- Preview the saved/reopened resulting PDF; export those exact compiled bytes.
- Support multiple edits, edits across pages, undo/redo, and branching after undo.
- Keep unapplied drafts distinct from committed PDF edits. Block export/navigation
  that would otherwise silently omit/discard a draft; provide explicit discard.
- Keep the existing worker ready handshake, single-job serialization, bounded
  rendering, stale-response guards, and source immutability. New session/history
  commits wait until verification and rendering succeed.

## Automated checks actually performed

`npm test`: **30 tests pass**. Coverage includes:

- Original selected content absent from rewritten decoded streams; replacement
  extraction and search; original source bytes unchanged.
- Pixel-for-pixel preservation outside edited bounds, including a background graphic,
  nearby text, an unchanged second page, and shared Form/resource content.
- All 0/90/180/270-degree rotations with nonzero CropBox and UserUnit 1/2. Tests
  verify the source-to-page transform, replacement baseline and color, extraction,
  search, geometry, and unchanged pixels outside the edit slot.
- Unsupported accents, emoji, complex scripts, line breaks, overflow, invalid font,
  size/color, intersecting text/graphics/links/annotations, pending redactions,
  skewed/vertical/clipped/invisible text, and mixed-style span separation.
- Empty/scanned-like pages, all three replacement fonts, escaped PDF delimiters,
  deliberate deletion, style-only edits without duplicate text, and reediting an
  exported PDF.
- Undo/redo, branching, multiple pages, failed edit and failed candidate-render
  rollback, preview/export PNG equality, and source preservation.
- Render budgets, raster rounding/origin coordinates, DPR-independent region mapping,
  plus worker initialization, transfer ownership, response matching and cancellation.

`npm run build`: TypeScript checking and the static production build pass. The two
MuPDF cross-platform Node-import externalization warnings remain visible and were
not suppressed. Those guarded branches were not used in the browser.

`npm run proof`: the retained Phase 1 standalone proof still passes and generates
before/after PDFs, images, and JSON in output/proof/.

`git diff --check`: passed. No commits were created.

## Production Chromium checks actually performed

Used the built dist/ application through the localhost production preview server.
A separate testing tab preserved the already-open workspace containing sample edits.

1. Opened a local generated PDF using the real file chooser, selected its text region,
   entered `Browser edit`, chose Courier, set 16 pt and #2859cf, and applied it.
2. Visually inspected the resulting document and properties. The tinted background
   and nearby text remain intact; the replacement is visibly blue Courier.
3. Used Undo/Redo controls, exported through the actual download action, and compared
   downloaded bytes with a separate verified engine compilation: exact equality.
   Reopened/extracted the download: correct text, font, size, color and baseline.
4. Reopened that download in the application. Its replacement text was detected as
   a supported selectable region again.
5. Opened a rotated 90-degree, nonzero-crop PDF; selected the correctly positioned
   region, replaced it with `Rotated edit`, visually inspected it, and downloaded it.
6. Entered emoji: the interface explicitly reported unsupported characters and disabled
   Apply/Export. Entered overflowing text: the engine rejected it and the PDF preview
   remained unchanged. A subsequent fitting edit succeeded.
7. Tested Cmd+Z and Cmd+Shift+Z with a page-region button focused: committed PDF undo
   and redo worked. Inside the textarea, native draft typing undo/redo remained intact.
8. Opened an overlapping-text PDF. Its amber region explained the overlap and showed
   a view-only state, without an edit/apply action for that region.
9. Checked the 390 × 844 layout, fitting/zoom and text properties. DOM measurements
   showed viewport width = document width = 390, without page-wide overflow.
10. Inspected production console: zero errors/warnings. The request log contained
    localhost application assets and local Blob URLs only during these workflows;
    no document bytes, filenames, extracted text, or other payload was observed in
    a remote request. This is a focused run, not the complete Phase 5 privacy audit.

Local screenshots (ignored artifacts): output/playwright/phase2-desktop.png,
phase2-rotated.png, phase2-unsupported.png, and phase2-mobile.png. An engine render
of the browser download is output/phase2/browser-export.png. Generated test PDFs
and browser downloads remain local under output/phase2/ and .playwright-cli/.
Desktop, rotated, mobile, and exported-PDF images were visually inspected.

The production preview is left available locally for review. No active working
user tab was reloaded, cleared, or closed by the tests.

## Issues found and addressed

- CropBox and Form rendering emits rectangular clipping callbacks. Treating every
  clip as unsupported incorrectly blocked valid text. The engine now verifies that
  the entire glyph lies inside an axis-aligned rectangular clip; partial/unusual
  clips remain unsupported. Crop/rotation and clipped-text regression fixtures pass.
- StructuredText's preserve-spans setting separates mixed styles. The implementation
  treats these as independent spans instead of pretending to replace a whole mixed
  line with a single style.
- UI geometry accounts for the actual rounded raster bounds/pixel origin instead
  of assuming ideal canvas dimensions at every zoom and device pixel ratio.
- A sandbox npm metadata lookup interrupted one Playwright helper call. The approved
  helper was rerun with network permission; browser checks then completed.

## Remaining limitations and readiness

Only simple opaque horizontal source text with unambiguous printable basic Latin
characters is supported. Original embedded/subset fonts are never reused. Graphics,
links/forms/annotations or other glyphs overlapping a slot can make it view-only;
complex page appearances and repaired PDFs are conservatively blocked. The fixed
slot does not reflow or grow into surrounding content. Original source slot geometry
remains the selection target after an edit; a new editing session uses the exported
replacement's own bounds. History is session-local and lost on reload/clear.

Rendered/structural checks use MuPDF; no independent reader or broad third-party
PDF corpus was exercised. Scanned-like empty pages were checked; a comprehensive
scanned/malicious/large-document matrix, additional browsers, mobile hardware memory
limits, and certificate validation remain unverified. Signature invalidation is
explained generically; detection is still Phase 4 work.

No added objects, page utilities, conversion tools, service worker, offline-ready
state, or completed release/privacy audit is claimed. No offline reload test was
performed. Text replacement is not comprehensive document sanitization. The AGPL
or commercial distribution decision remains with the owner.

Assessment: Phase 2's supported existing-text workflow is operational and verified
within the stated boundaries. **Next: Phase 3 — complete editing tools. Stop until
the user says continue.**

# margin.pdf

A free, standalone PDF workspace built with React, TypeScript, Vite, and a local
MuPDF WebAssembly worker. **Phases 1–6 are implemented and locally verified.** Existing-text editing
is the primary workflow. PDF processing has no backend, accounts, payments or usage quotas.
Vercel production builds use Web Analytics for basic visit statistics; document data stays
on the device. Local builds do not enable analytics. Nothing has been deployed by this work.

## Run locally

Use Node.js 22.12+ (or 20.19+) and npm. Verified on Node 26.10.

```sh
npm ci
npm run dev
```

Open the printed localhost URL and choose **Open editor** (or go to `/#/edit`).
The editor starts empty: choose **Open PDF** or drop a PDF anywhere on the page area.

1. Double-click any text to edit it directly on the page (keyboard: focus it and press Enter).
   Editable text is outlined on hover; **Show editable text** outlines all of it.
2. Select, copy, paste and type normally in the on-page field. Enter applies; Escape cancels.
3. Use the properties panel when you want to change font, size or color. It shares the same draft.
4. Choose **Export PDF** to download the actual resulting PDF. Original files stay unchanged.

Click a text region once to select it, then Ctrl/Cmd+C copies its applied text. The
Copy text button is an alternative. Ctrl/Cmd+V outside a field, or the Paste button,
pastes text or a clipboard JPG/PNG into the workspace. Text pasted over a selected
supported span opens a replacement draft; otherwise it opens a new text-box draft.
Double-click added text to edit it. Ctrl/Cmd+Enter applies added text; Escape cancels.
Images paste immediately as selectable objects near the last page pointer position,
or at the center. Local JPG/PNG files can also be dropped onto the preview. Clipboard
fields retain normal selection, copy, cut, paste and typing undo. Clipboard HTML is
not inserted. The Paste button needs browser clipboard access in a secure context
(localhost or HTTPS); use the native shortcut or file input when it is unavailable.

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
npm run release:fixtures # generate the release matrix and edited PDF/PNG artifacts
npm run release:pdfkit   # optional independent macOS PDFKit checks (Swift required)
npm run release:licenses # verify locked dependency metadata and runtime license copies
```

The static build includes its worker and approximately 10.4 MB WASM engine. First
load can take time on slower devices. A local HTTP server is required; file:// is
unsupported. Vite reports externalized Node imports from MuPDF's guarded
cross-platform runtime. They were not suppressed, and production browser checks pass.

## Supported text editing

- Unencrypted, digitally generated PDFs with simple, opaque, horizontal source text.
- Single-style lines or spans with unique, positioned Latin glyphs (accents included). Typographic
  ligatures (ff, fi, fl, ffi, ffl) are edited as their letters, and extraction-inserted
  spaces that are not painted are ignored.
- Intrinsic page rotations of 0/90/180/270 degrees, nonzero CropBoxes, and UserUnit scaling.
- Replacement text in the WinAnsi set: basic Latin plus Latin-1 accents (é ü ñ ç ø ß),
  curly quotes, dashes, €, ™. Written as one-byte WinAnsi codes, so it stays searchable.
  No Central European letters (ł ő č), other scripts, emoji or line breaks yet.
- The 12 standard PDF fonts (Helvetica, Times, Courier, each regular/bold/italic/bold
  italic). The closest one to the original font name is preselected.
- Words placed one by one are rejoined into lines, and consecutive same-style lines with
  steady spacing and a shared left edge become one **paragraph** you can replace as a
  whole. The replacement wraps to the paragraph's width at its original line spacing,
  using at most its original number of lines (left-aligned). Pieces separated by a border
  or rule (table cells, rows) are never joined, and a merge is kept only if it passes
  every overlap check.
- Fixed layout. Replacement width and glyph bounds must fit the original span or
  paragraph; overflow is rejected and following content does not move. Shorten the text
  or reduce its size. Empty text removes it. Overlap checks use the glyphs' real ink,
  not their taller character boxes, so ordinary tight leading does not block editing.
- Verified removal before insertion, searchable replacement, accurate PDF preview,
  export, multiple edits across pages, and undo/redo with history branching.

The engine checks both the original text area and replacement ink against neighboring
text. Amber regions explain why they are view-only. Effects are judged **per line, not
per page**: no-op transparency groups, rectangular clips, optional-content layers,
gradients, images and shapes elsewhere on the page, and anything painted *behind* the
text (images, gradients, shapes) do not block editing, because removal leaves images and
line art untouched and the replacement is drawn on top as the original was. A line is
view-only when it is itself drawn with transparency, a blend mode, a soft mask, a pattern,
a non-rectangular or partial clip, or when an image, graphic, outlined text or invisible
(OCR) text is painted *over* it. Special encodings, vertical/skewed/stretched text,
overlapping text/links/forms, repaired PDFs and pending page redactions also prevent
editing. Mixed styles may be exposed as separate spans.

Embedded/subset fonts are **not reused**. The chosen replacement font may look different.
Unsupported text is never silently substituted. No full-page rasterization or opaque
cover rectangle is used for text replacement. Replacement is not comprehensive
sanitization: metadata, attachments, unused resources, and other occurrences are outside
its promise. Digital signature dictionaries and populated signature fields are detected on open,
with an explicit warning. This is not certificate or signature-validity verification.
Detection failures are reported rather than treated as proof that no signatures exist.

## Added objects and navigation

Pages scroll continuously in one column. The page across the upper third of the view (or
the first/last page at the very top/bottom) becomes the editable page once scrolling
settles; the others are sharp renders while near the view, with a thumbnail as a stand-in.
The page list, page number box and PageUp/PageDown scroll to the chosen page.

The editor defaults to **Edit existing text**. The other tools add objects above the
page content; they do not replace or erase original text.

- **Add text:** click/drag a box, or use Place at page center, then type on the page. Use properties for
  font, size and color. Accented Latin text (the same set as replacements) and line breaks are supported. Overflow is
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
validated. Chromium desktop and small-screen layouts were exercised; physical touch/pen
hardware and other browser engines remain unverified.

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
panel, rich typography, or pressure-sensitive ink. Ink strokes resize as
paths with a fixed line width; they are individually selected/deleted. No signature
certificate, identity, or tamper-evidence validation is provided.

## Page tools and conversions

Choose **Page tools** in the editor's tool row. Each tool also has its own page
(`#/merge`, `#/split`, `#/organize`, `#/watermark`, `#/page-numbers`, `#/images-to-pdf`,
`#/pdf-to-images`, `#/compress`, `#/redact`) with a drop zone, rather than silently adding the
sample. A file dropped on the homepage is handed to the chosen tool in memory only. Inputs, page plans and results are held in a separate worker in memory.
Opening from an editor uses its last committed PDF, including text and added objects.

- **Organize:** move pages earlier/later, rotate in 90-degree clockwise steps, delete,
  or reset the proposed plan. At least one page must remain. Controls show 40 rows at
  a time for larger plans.
- **Merge:** add local PDFs, reorder/remove files, then combine their pages in file order.
- **Extract / split:** select pages such as `1-3, 5` in the desired order. Extract one
  combined PDF or prepare individually downloadable one-page PDFs.
- **Images to PDF:** add/reorder JPG/PNG images. Every image fills its page with no
  border: by default each page takes the image's own size (72 pixels/inch, nothing
  cropped); A4 turns to match the image's orientation and is covered edge to edge, with
  any overhang trimmed.
- **Pages to images:** selected pages become individually downloadable PNG/JPG files
  with white backgrounds, including rendered annotation/form appearances. Requested
  resolution is 36–300 dpi; actual resolution can be lower under the render budget and
  is reported. Downloads are individually user-initiated; no ZIP or automatic batch.
- **Watermark / Page numbers:** choose pages, size, color, opacity and center/bottom
  placement. Watermarks can be horizontal, diagonal (corner to corner on each page, either direction),
  vertical or any angle from -90° to 90°, placed once (centre, top, bottom or a corner) or
  repeated across the page (clipped at the edge), in any of the 12 standard fonts with
  accented Latin. Page numbers take the same positions and fonts. Numbering is “Page n of total”
  in the selected order, with a configurable starting number; total counts selected
  pages. Oversized or unsupported text is rejected. Stamps append above page content
  and can overlap it, so inspect the result.
- **Compress:** rewrites the source file itself, so links, bookmarks and forms are kept.
  *Lossless* only repacks objects, streams and fonts. *Balanced* / *Smallest* also re-encode
  8-bit gray/RGB photos as JPEG, capped at 2200 / 1400 px on the long edge, and only when
  that is at least 10% smaller. Masked, transparent, indexed and CMYK images are untouched.
  The result reports before/after size.
- **Redact:** finds terms (one per line; spaces also match line breaks), email addresses
  and phone numbers in page text, then applies true redaction: matched characters are
  removed from the content stream, overlapping image pixels are blacked out, and black
  boxes are drawn. The saved result is reopened and searched again; any remaining match
  fails the operation. Scanned (image-only) text, metadata, bookmarks, form values and
  attachments are not searched. Files with pre-existing redaction marks are refused.
- **Remove hidden data:** flattens comments and form fields into the page, then removes
  document Info and XMP metadata, JavaScript and automatic actions, attachments, links,
  bookmarks, named destinations, private application data and earlier saved versions.
  Accessibility tags are kept. The saved file is rescanned; anything left fails the
  operation. Files with layers or XFA forms are refused.
- **Crop pages:** trims margins (points, as seen on screen) from chosen pages by moving
  the CropBox, so trimmed content remains in the file.
- **Organize:** a thumbnail grid; drag to reorder (buttons remain for keyboard/touch),
  rotate, duplicate, insert a blank page sized like its neighbour, remove. Merge and
  Images to PDF lists are draggable too.
- **Fill and sign:** fills text, checkbox, radio and dropdown fields and reads every value
  back from the saved file. Adds a typed (Times Italic), drawn or uploaded visual signature
  placed by clicking the page. Typed signatures default to a handwriting font (Dancing Script
  or Great Vibes, OFL, embedded as a small subset) or any standard font. Optional flattening. Not certificate-based digital signing.
- **Make searchable (OCR):** pages with no extractable text (scans, photos) are rendered at
  300 dpi and read by Tesseract (WASM, English, in its own worker). Each word is written as an
  invisible text layer sized to its box, so pages look identical but text can be selected,
  searched and redacted (redaction blacks out the scanned pixels under a match). Pages that
  already have text are skipped; each read page is re-checked for text after saving. The
  engine (2.9 MB) and English data (2.9 MB) are self-hosted and cached for offline use.
- **Protect / Unlock:** Protect saves an AES-256 encrypted copy (same user and owner
  password, 4–127 printable ASCII characters, no commas). Unlock needs the real password
  and saves an unencrypted copy without permission restrictions. Both results are reopened
  and checked before download. Other tools refuse password-protected files.

PDF generation shows the first page of the actual result and offers Download PDF or
Open result in editor. **Generation leaves the current editor unchanged. Opening a
result starts a fresh source and edit history.** Export/download the working version
first if you need both. Utility page changes are not part of the editor undo history;
the proposed plan can be reset before generation. The new source remains in memory,
and neither the original local file nor the previous download is modified.

### Interactivity and signatures

For merge, extraction/split, reorder, delete, rotate, watermarks and page numbers,
all source form widgets and annotations are baked into static page content before
pages are copied. Their visible appearances are retained where available, while
form interaction and comment data are removed. Links, bookmarks, document metadata,
attachments, tags and page labels are not copied. Missing/stale appearances and
unapplied redaction appearances need particular care; this is not sanitization or
applying pending redactions. Documents with optional-content layers or XFA forms
are rejected until a locally flattened copy is supplied. The tool lists, before
generating, only the losses that apply to the chosen files (links, bookmarks, comments,
form fields, signature validity); there is no separate acknowledgment step.

Watermark and Page numbers show a live preview of the first selected page, rebuilt
quietly (no progress bar, form stays editable) about 350 ms after each change.

Digital signature validity is not preserved by these transformations. A static
signature appearance may remain. Populated signature fields, signature ByteRange
objects and catalog certification references are detected, without validating any
certificate. Every transformation explains the signature consequences before export.
Page images have no PDF interactivity, searchable text, bookmarks or signature
validity. Images-to-PDF starts from image pixels and introduces none of these.

Cancel operation terminates the utility worker, discards its in-flight work and
reinitializes the current editor snapshot. Added utility input files are released
and must be added again. The editor PDF and its history stay intact; closing the
panel releases its source buffers and worker. This cancellation does not interrupt
a synchronous WASM call cooperatively; it terminates the worker instead.

## Local data and current limits

Working files, edit plans, and history stay in memory. The editor warns before a
refresh, tab close or document navigation when drafts or unexported changes exist.
Requesting an export records that edit plan; later edits or undoing away from that plan
restore the warning. Undownloaded utility results and results opened as new sources
are protected too. The footer identifies unexported changes. Browser-controlled leave
prompts require prior interaction and are unreliable for mobile force-closes/crashes;
they are a warning, not autosave. Confirming reload, clearing, or a crash still discards
the session. Automatic local recovery is not enabled; document persistence would need
an explicit opt-in. See [browser event limits](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event). Export is a user-initiated download. Runtime code has no upload path or persistent
document storage. The production browser request log contained localhost application
assets and local Blob URLs during the tested workflows.

**Production offline delivery is implemented.** Download the application online first.
On the first visit, wait for verification, export any work, then use Reload to enable
offline. “Available offline” appears only after the controlling service worker verifies
every required file for this build. This caches the application, not your documents;
unsaved edits still disappear after a confirmed refresh or crash. Production offline
reload, editing and export passed the Phase 6 checks described below.

Rendering has an 8-million-pixel budget and bounded dimensions/DPR. Source snapshots,
compiled recovery bytes, image assets, engine state, and edit-plan history coexist in memory; very large or
malformed PDFs can exceed browser/device limits. There is no imposed file-size or
usage quota. Each added image has a 32-million-pixel decoding budget, checked from
its header before decoding to bound native memory. This is an application memory
safeguard, not a universal browser limit or per-user quota. Larger images must be resized
locally first. Cancel restores the last committed workspace; Clear workspace terminates the worker
and deliberately discards the in-memory document. Every page in the page list shows a preview of the
current (edited) page. Previews render one at a time as their tiles scroll into view,
so long documents stay light. After an edit, undo or redo only pages whose content changed
are re-rendered, and the old preview stays until the new one is ready. Password entry is not implemented. No placeholder controls
imply that unsupported functionality is complete.

See [architecture](docs/ARCHITECTURE.md), [Phase 4 verification](docs/PHASE4-VERIFICATION.md),
[Phase 3 verification](docs/PHASE3-VERIFICATION.md),
[Phase 2 verification](docs/PHASE2-VERIFICATION.md),
[historical Phase 1 verification](docs/VERIFICATION.md), and
[engine/licensing decision](docs/ENGINE-DECISION.md).

## Release readiness

This is a locally runnable **release candidate for the documented supported subset**.
The production build, 83 automated tests, real Chromium workflows, disconnected
reload/edit/export, phone/tablet layouts, and independent PDFKit reading/rendering
were checked. The release fixtures include scans, embedded subset fonts, annotations,
forms, synthetic signature dictionaries, all quarter-turn page rotations with crops,
250-page documents and an oversized page. See [Phase 6 verification and reproduction
steps](docs/PHASE6-VERIFICATION.md) for evidence and its limits.

This is not a broad-browser or unrestricted-PDF compatibility claim. Real mobile
hardware, very large image-heavy files, genuinely signed certificates, password entry,
complex scripts, OCR, and automatic document recovery remain outside the verified
release. Working documents still stay in memory by default; **export before leaving**.
Distribution remains blocked on the owner's AGPL/commercial licensing decision and
the associated source/notice requirements. No deployment or project-wide license
assignment was performed.

## Offline application delivery and privacy

Use `npm run build` followed by `npm run preview` for offline verification. Development
mode deliberately does not register the service worker or claim offline readiness.
A secure context is required: HTTPS or localhost, served at the web root `/` with hash
routes. File URLs and subpath deployment are not supported by this configuration.

The static build produces an allowlist with byte sizes and SHA-256 hashes for the
HTML, JavaScript, module workers, WASM, CSS, icon and license resources. Fonts currently
come from the OS or MuPDF's bundled engine; any future emitted font files join the
manifest automatically. Only those exact static GET URLs enter the versioned cache.
Documents, filenames, passwords, page images/thumbnails, extracted text and edit plans
never enter the offline cache, IndexedDB or browser storage. Nothing is written to
localStorage by application code. No accounts, advertisements, session recording,
remote error reporting, remote fonts or PDF runtime CDNs are included. The separately
requested Vercel Web Analytics integration sends fixed application page names only;
see the setup below and Vercel's linked privacy documentation for visit metadata.

To protect existing tabs/jobs, first installation does not claim open pages, and
updates never force activation or reload. The initial explicit reload enables control;
the existing unexported-change warning still applies. A downloaded update waits until
all old-version margin.pdf tabs close. Export before closing. Old app caches are removed
only at natural activation. Offline setup/repair buttons are disabled during document
operations. Readiness is rechecked on focus, visibility and connectivity changes;
missing or corrupted files remove Available offline. Reconnect and Retry offline setup
to repair the fixed asset list. Browser eviction, storage denial, private browsing and
real device limits can prevent continued offline availability.

Controlled navigation uses the cached app shell. Unknown/foreign resources and non-GET
requests are rejected without network fallback, except the exact same-origin Vercel
analytics script and page-view/session endpoints in analytics-enabled builds. These
requests are never cached or queued by the service worker. Document JavaScript stays disabled;
PDF links/actions are not connected to browser navigation, and previews come from local
rendered bitmaps. Processing and utility tests include inert embedded JavaScript,
OpenAction/AA, form submission/launch actions and remote links. Text-editing exports
are not sanitization; actions can remain in the exported PDF for other readers.

The production Content Security Policy blocks inline/string JavaScript, object/frame
embedding, forms and foreign connections. It permits self-hosted modules, workers,
WASM compilation, local Blob images and React's positional inline styles. The HTML
contains a meta policy; `npm run preview` supplies response headers as well. Apply the
emitted `_headers` rules (or equivalent configuration) on a static host, including
worker JavaScript: meta CSP alone does not protect worker responses or frame embedding.
Use a dedicated origin, serve `sw.js`/HTML with revalidation, and retain old hashed assets
while older clients may still need them. Nothing has been deployed.

Clear workspace terminates document workers, drops source/edit/history/image state,
resets file inputs, and revokes preview/thumbnail URLs through component cleanup. It
keeps application caches; previously downloaded files remain on
your device. Pending download URLs are released after browser pickup (up to 30 seconds).
There is no opt-in local recovery implementation yet and no automatic document saving.

See [Phase 5 verification](docs/PHASE5-VERIFICATION.md) for the actual disconnected
production, cache repair, version update, storage and request checks performed.

## Installing as an app

The site is an installable web app (`public/manifest.webmanifest`, icons in `public/icons/`,
`manifest-src 'self'` in the CSP). Chrome/Edge show an install button in the address bar,
Android offers "Install app", and iOS/iPadOS use Share → Add to Home Screen. The site
header's **Install app** button opens the browser's own install dialog in one click
(Chrome, Edge, Android); on iPhone/iPad, where sites cannot trigger installation, it shows
those steps. It is hidden where installing is impossible (e.g. Firefox desktop) or done.
The editor has the same button in its header, or in the top status strip on phones, where
the editor header has no room for it. It opens in
its own window and works offline like the site.

- **Open with:** on desktop Chrome/Edge, the installed app registers for PDF files. A file
  opened this way reaches the editor through the in-memory handoff; nothing is stored.
  Only the first file is used when several are opened at once.
- **Updates:** when a new version has downloaded, the status bar shows **Update now**.
  It switches only when no operation is running, nothing is unsaved, and no other
  margin.pdf tab is open (the service worker checks the tab count itself); otherwise it
  explains what to do. The running version is shown under Privacy & offline.
- **Not included:** the Android share target, which would need the service worker to
  accept uploaded PDFs and hold them, against the "documents are never cached" design.

## Vercel Web Analytics

The requested integration uses the pinned MIT-licensed `@vercel/analytics` React SDK.
It is enabled automatically when building with `VERCEL_ENV=production` (or
`VITE_VERCEL_ENV=production`), as provided by Vercel. Development, preview deployments
and ordinary local builds leave it disabled. Enable **Web Analytics** in the Vercel
project dashboard before your next deployment; this repository change does not
activate the dashboard or deploy anything. See [Vercel's setup guide](https://vercel.com/docs/analytics/quickstart).

Hash routes are reported as fixed pages such as `/`, `/edit` and `/merge`; section
links do not create extra page views. `beforeSend` replaces the URL with the fixed
page name, omits URL query/hash parameters and drops custom events. No filename,
password, PDF text, thumbnail, edit or export event is passed to analytics. Visit
metadata is processed by Vercel as described in its [privacy documentation](https://vercel.com/docs/analytics/privacy-policy).
The app's document processing and downloads remain local.

The production service worker permits only the exact same-origin analytics script
GET and page-view/session POST endpoints. These responses never enter the offline
cache; failed analytics requests do not block the workspace. Offline page views are
dropped, and opening the app offline does not load the analytics script. No CSP
relaxation or foreign analytics origin was added. PDF assets remain available offline
independently of analytics. Local tests cover redaction, dropped events, endpoint
restrictions and cache isolation; live dashboard collection needs a Vercel deployment.
The local production browser check used mocked analytics endpoints: hash-route page
views reached the mock after service-worker control, private query values/extra fields
were absent, analytics was not cached, and offline PDF editing/export passed with zero
browser exceptions. Both ordinary and simulated Vercel production builds passed, as
did all 124 automated tests and the dependency notice check.

## Licensing status

**No license has been assigned to this project. Distribution is pending an owner
licensing decision.** MuPDF is AGPL-3.0-or-later, with commercial terms available from
Artifex. Making this application free does not remove the dependency's obligations.
Read the engine decision before distributing the application or its WASM binary.

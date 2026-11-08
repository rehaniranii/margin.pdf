# Phase 6 — release verification

Verified locally on 2026-11-08. Readiness: **local release candidate for the documented
supported PDF subset**. No deployment, push, account/service connection, dependency
upgrade or project-wide license assignment was performed. Distribution still needs
the owner's licensing decision described in [ENGINE-DECISION.md](ENGINE-DECISION.md).

## Environment and corrections

Node 26.10, npm, macOS ARM64, Chromium 157.0.8103.38 through Playwright CLI. The static
Vite production build was served on localhost:4180 with its actual worker, WASM,
service worker and response security headers. Browser checks used that production
build, including a disconnected browser context. No development-server offline claim.

Release QA found and fixed three production issues:

- On-page replacement fields now rotate with the source text's displayed baseline.
  Their transformed bounds were checked at 90°, 180° and 270° on cropped UserUnit=2 pages.
- Raster budgeting now reserves outward pixel rounding, keeping real allocations
  within 4096 pixels per edge and 8 million pixels on oversized pages.
- Clear workspace terminates document workers without immediately allocating another
  idle engine. The next document job initializes its worker lazily. Utility-only entry
  also avoids an unused editor worker.

## Checks performed

`npm test`: **83 passed, zero failures**. Checks cover decoded-stream text removal,
searchable replacements, character/fit rejection, surrounding pixels, fonts and
coordinates, all quarter-turn/crop/UserUnit combinations, preview/export agreement,
history, object transforms, page utilities, form/annotation flattening, signature
detection, worker ownership/cancellation, inert embedded actions, verified offline
caches/update lifecycle, CSP and job activity. The additional release matrix tests
preserve original bytes and compare every pixel outside the edited text slot.

`npm run build`: passed TypeScript checking and static output generation. MuPDF's
guarded Node imports still produce Vite browser-externalization notices; they are not
suppressed and the real production browser workflows pass. `npm run proof` also passed
its selected-original removal, replacement extraction and neighbor checks.

| Fixture | Engine and production browser result |
| --- | --- |
| Two-page digital PDF | Existing text edited and exported; nearby text retained |
| Cropped/UserUnit=2 pages, rotations 90/180/270 | Regions and rotated input bounds align; exports pass |
| Embedded subset Times font | Editable source, explicit replacement font, searchable export |
| Image-only scan | No fabricated text regions; explicit no-editable-text message |
| Square annotation, away from text | Text edited; other appearance unchanged |
| Text widget with appearance, away from text | Source text edited; widget appearance retained |
| Link overlapping selected line | Explicit view-only reason |
| Skewed text matrix | Explicit view-only region |
| Synthetic populated signature dictionary | Signature warning shown; no validity claim |
| 250-page shared-resource PDF | Navigated to page 250; at most seven page tiles |
| 18,000 × 24,000 point page | Bounded raster; browser fit rendered 4,320,000 pixels |

Real browser checks also exercised keyboard entry into source editing, font/size/color
changes, unsupported-character rejection, undo/redo, local export and reopening the
result. The selected original disappears from the edited page; its intentional duplicate
on page 2 remains. Browser preview RGBA pixels are hashed and compared against a fresh
render of the downloaded export. The final controlled 400×500 preview/export check
matched SHA-256 `c5a4ad6d4274629c899a602513f28fa71e4fa2234ca626def114cffc5d7b91a0`.

Selected source text copied successfully. Native clipboard text paste opened a
replacement draft; native PNG paste created an image object. Added on-page text and
both objects exported successfully. The browser's native beforeunload warning was
triggered for an unexported edit and dismissed. This remains a warning, not autosave.
After the worker lifecycle correction, cancelling a zoom job restored the applied
replacement and preserved Undo back to its source text. The final browser console
had zero errors and zero warnings.

### Independent reader and visual checks

Poppler was unavailable. macOS PDFKit independently opened, extracted and rendered
**eight** edited matrix PDFs: digital, three rotated/cropped variants, embedded subset
font, annotation, form and synthetic signature fixtures. It confirmed replacement
and nearby text, absence of the selected original on page 1, page counts and retained
page-2 duplicates. Additional browser-exported workflow, embedded-font, clipboard/object and
offline-numbered PDFs were opened and extracted with PDFKit. Numbered output contains
the edited line and `Page 1 of 2` / `Page 2 of 2`.

Visual inspection included the desktop preview, rotated input before/after correction,
phone (390×844) and tablet (768×1024) layouts, and independent PDFKit renders. No phone
document overflow: viewport and document width were both 390 pixels. These are desktop
browser viewport checks, not physical touch, pen or mobile Safari certification.

### Offline, privacy and resource checks

After verified setup, browser networking was disabled before reloading the production
editor. The sample rendered, a local PDF opened, text was changed and downloaded, and
page numbering produced another downloaded PDF. Phone and tablet checks ran during
this disconnected session. The context was restored online afterward.

The final offline session recorded only local Blob GETs and exact application-asset
GETs, all with zero request-body bytes. Its 14 cached entries were static application
files/notices; IndexedDB and sessionStorage were empty and localStorage contained only
`theme`. Clear workspace left **zero document workers**. Reopening a local PDF started
one worker again and editing worked. An online canary PDF with embedded actions was
also edited: recorded requests contained only local worker/runtime/WASM assets and
Blob URLs, with no external URL, filename, document content or request payload.

The cache corruption, repair, waiting-update and old-version retention checks from
Phase 5 remain covered by the automated suite; the earlier real-browser update/repair
evidence is in [PHASE5-VERIFICATION.md](PHASE5-VERIFICATION.md). No new update activation
policy was introduced. The service worker caches the app, never working documents.

## Reproduce

From this repository after `npm ci`:

```sh
npm test
npm run proof
npm run release:fixtures
npm run release:licenses
npm run build
npm run preview -- --port 4180
```

In a fresh Chromium Playwright CLI session, open `http://127.0.0.1:4180/#/edit`, wait for
offline files to finish downloading, and reload once. Wait for **Available offline**.
With `playwright-cli` installed in your QA environment, run the following against that
same session (the CLI is optional QA tooling, not an app dependency):

```sh
playwright-cli -s=margin-release run-code --filename scripts/release/browser-check.js
playwright-cli -s=margin-release run-code --filename scripts/release/clipboard-browser-check.js
playwright-cli -s=margin-release run-code --filename scripts/release/workflow-browser-check.js
npm run release:browser-output
playwright-cli -s=margin-release run-code --filename scripts/release/offline-browser-check.js
npm run release:pdfkit # macOS + Swift only, after release:fixtures
```

The scripts operate on generated test files and download results under ignored
`output/phase6/`; never point them at a live editing session containing user work.
Build before starting a clean session: rebuilding while a previous version has tabs
open intentionally leaves the update waiting. Do not force activation during a job.
On other platforms use an available independent reader; do not substitute a second
MuPDF invocation and call it independent.

## Remaining limits and distribution requirements

Coverage is controlled synthetic PDFs plus the local sample, not a representative
customer corpus. Chromium was the only browser engine tested. No physical mobile/pen
device, constrained-memory hardware, image-heavy gigabyte document, fuzz corpus,
genuine certificate validation or encrypted/password-entry workflow was verified.
The 250-page fixture is small; it proves navigation/resource bounds, not arbitrary
large-file capacity. Source, history, images and compiled snapshots still coexist in RAM.

Text support remains printable basic Latin, three replacement fonts, fixed fitting
and conservative view-only states. OCR, complex scripts, whole-document reflow,
compression, Office conversion and certificate signing remain deferred. Page tools
flatten forms/annotations and omit the documented interactive/catalog structures.
Replacement is not sanitization; embedded actions can remain in downloaded files.

Documents/history remain memory-only. Confirmed refresh, close or a crash can discard
changes despite leave warnings; export first. No automatic recovery was added.
Browser storage eviction can remove offline availability.

For any future static hosting, serve the whole `dist/` at a dedicated origin root over
HTTPS, apply the emitted `_headers` rules to HTML and worker responses, serve WASM with
its proper MIME type, revalidate HTML/service worker and retain old hashed assets while
old clients exist. File URLs and subpath hosting are unsupported. Resolve MuPDF's
AGPL/commercial route, applicable corresponding-source and bundled-component notice
requirements before distribution. All six requested phases are now locally completed;
further compatibility expansion, opt-in recovery or distribution is separate work.

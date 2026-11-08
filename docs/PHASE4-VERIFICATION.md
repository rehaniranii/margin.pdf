# Phase 4 — page tools, conversions and editing usability

Implemented locally on 2026-11-08. No deployment, publishing, pushes, agent commits,
external application services, new dependencies or project-wide license assignment.
MuPDF remains pinned at 1.28.1; AGPL/commercial distribution licensing remains an owner
decision. The existing homepage/theme were retained and their utility links now work.

## Implemented

The agreed usability pass accompanies this phase: double-click existing supported text
to edit on the page, with shared optional sidebar formatting, caret selection, native
copy/paste, Enter to apply and Escape to cancel. Added text edits on the page with
Ctrl/Cmd+Enter. Selected spans/added text support native copy. Native image paste,
the Paste button and local image drops create selectable JPG/PNG objects. Text pasted
without a source selection opens a new draft so unsupported or overflowing content
can be corrected. There is no Word-style document reflow or HTML clipboard insertion.

The Page tools panel supports merge, extract, split into one-page PDFs, reorder,
delete, quarter-turn rotation, JPG/PNG-to-PDF, individual PNG/JPG page exports,
watermarks and page numbers. Ranges are validated and preserve requested order.
Generation creates a separate result using an immutable source/page plan. The actual
first page is previewed; results can be downloaded or opened as a new editor source.
Opening a result intentionally starts fresh history, explained before that action.
Utility input buffers and native engine state live in a separate worker in RAM.

The UI explains flattening and signature consequences before PDF generation and
requires acknowledgment. PDF-to-PDF tools flatten current annotation/form appearances,
remove interaction and omit links/bookmarks and other catalog structures. Layered/XFA
PDFs are explicitly rejected. See README for the operation-specific preservation policy. This is not sanitization or application of pending redaction annotations.

## Automated checks performed

- `npm test`: **58 passing tests**, including all previous 44 tests, 13 new utility
  tests and a contextual worker-failure recovery test. New coverage includes page-range errors/ordering/duplicates; merge/extract
  and source immutability; crop boxes, all four rotations and UserUnit scaling;
  added rotation and pixel comparison; searchable stamps and numbering sequences;
  unsupported characters and fitting rejection; JPG/PNG conversion and image export;
  render limits with actual dpi; synthetic signature dictionaries/inherited fields;
  flattened annotation and widget appearances with exact rendered comparison;
  bookmark/link removal; XFA/layer rejection; retained transparency groups; and
  preservation of a previously committed real text-removal/replacement edit.
- `npm run build`: TypeScript and static Vite production build pass. The existing
  MuPDF Node-import externalization notices are visible, not suppressed.
- `git diff --check`: passed during implementation and after documentation changes.
- Official MuPDF baking/grafting/pixmap APIs and browser clipboard documentation were
  reviewed; the installed API definitions and executable fixtures verify behavior.

Phase 2's strict text-removal and neighbor checks remain intact. Phase 3's documented
one-level antialias/compositing tolerance remains limited to its transparent-object
fixtures; it is not substituted for structural text-removal verification.

## Production browser checks performed

Used Chromium through Playwright against the local static production preview at
http://127.0.0.1:4175/. These checks used actual application controls and generated
local files, not a development server or a decorative mockup.

- Double-click a sample source line; type `Edit right here.`; Enter applies. Copy it
  with Copy text, then native clipboard paste changes it to `Pasted in place.`.
  Download, reopen/extract with MuPDF, verify new text and absence of the old line.
- Native image clipboard paste, the Paste button, and a constructed file-drop event
  place three editable PNG image objects. Export and visually inspect their output.
  Clipboard tests used browser clipboard permissions and a locally generated PNG.
- Paste a new text draft; check export is blocked while unapplied; reject an unsupported
  character while retaining the draft; correct and apply. On the final build,
  double-click an added text box, edit to `Edited in place.`, apply and use undo/redo.
  Edit original source text directly to `Final direct edit.` and verify native
  Ctrl/Cmd+C copies that applied span. Export contains both phrases, with the original
  sample line absent.
- Reorder pages, rotate one, delete a page, and download results. Add a second cropped,
  rotated PDF through the merge input. Extract a range, reject duplicate page input,
  prepare separate one-page downloads and download page 2.
- Import locally generated PNG and JPG files, convert to A4 PDF, and download.
  Export PDF pages as PNG and JPG through the individual download buttons.
- Reject unsupported watermark characters, generate searchable `LOCAL COPY` stamps,
  and generate page numbers with a custom starting value. Reopen/extract the actual
  browser downloads and verify page counts, page ordering, rotated dimensions,
  surviving source edits and expected watermark/number text.
- Cancel a pending utility generation using its real Cancel operation action. Download
  the editor before/after cancellation: the two files match **byte for byte**.
  The queued job was cancelled before its response; no claim is made about cooperative
  interruption within a synchronous WASM operation.
- Download a reviewed result, then Open result in editor and export again. The two
  PDFs match **byte for byte**. The rotated source remains selectable; new history
  starts empty as explained by the interface.
- A direct page-numbers route opens file selection without adding the sample to the
  input list. Load a PDF and generate a result at 390 × 844. Document width is 390;
  the dialog has no horizontal overflow. Inspect control/result screenshots.
  Cycle forward through 30 focus steps and reverse from the first control without
  leaving the modal. Open the result, fit the page and inspect the dark mobile editor.
- Load a synthetic signature fixture and verify the editor warning plus the detected-signature
  notice before utility generation. This fixture does not contain a valid certificate.
- Delay a clipboard read, change pages, then resolve it: no object/draft is inserted,
  and a clear cancellation notice appears. Restore native clipboard reads and verify
  a normal paste still works.
- The main verification browser console reported zero errors and zero warnings.
  Request logs were spot-checked for local application/WASM assets. Full disconnected
  operation, storage/privacy audit and update safety remain Phase 5 work.

Ignored local artifacts are under `output/phase4/` and `output/playwright/phase4-*`.
They include the actual downloaded PDFs/images and engine renders. Reviewed screenshots
cover inline editing, page organization, image paste/drop, mobile tools/results and
mobile dark mode. Rendered rotated and watermarked exports were visually inspected.

## Issues found and fixed

- Default page grafting omitted UserUnit and transparency Group. Both are explicitly
  copied; rotation/crop/unit/group render fixtures protect against appearance drift.
- Pointer capture retargeted double-click events on added text. Stationary double taps
  are recognized independently while captured dragging remains intact; browser retest
  passed. Keyboard Enter remains an alternative.
- A newly pasted text draft could otherwise lose its export guard when sidebar state
  reset. Draft dirtiness now includes the on-page added-text draft independently.
- Native modal focus could leave the content after the last control. Explicit forward
  and reverse Tab cycling now keeps focus within enabled, visible controls.
- Clipboard/file/drop paths reuse image dimension checks, immutable edits and object
  assets. Failed insertions release newly imported assets. Stale asynchronous clipboard
  results are discarded when workspace context changes. Utility-worker failures offer
  Close/reopen Page tools rather than asking users to discard their editor. Cancelling
  utilities tears down only their worker and preserves the editor.

Browser-helper startup was rerun outside the sandbox after restricted npm startup
stalled. Two verification-script issues (an exact label selector around a select and
VM dynamic-import support) were corrected in the checks; no application errors were
suppressed. Native file-chooser handoff was completed with the helper's upload action.

## Remaining limitations and next phase

This is a working Phase 4 build, not a release/offline readiness claim. Existing/added
text retains the supported basic Latin/font/fixed-layout limits. Clipboard support
varies by browser and secure context; native shortcuts or file inputs are fallbacks.
Visual signatures remain drawings/images, not certificate-based signing.

PDF utility output deliberately loses interactivity, links, bookmarks, catalog metadata,
attachments, tagging and page labels. Missing/stale form/annotation appearances may
not survive as expected. Opening generated content flattens prior object handles and
starts fresh history; utility page changes are not editor undo entries. Only the
first generated page is previewed in the tool; open the result to inspect all pages.
Transparent/grouped content can trigger existing-text view-only checks when reopened.

Split/page-image output uses individual downloads, without ZIP/batch automation.
Watermarks are horizontal; numbers use the stated template and selected-page sequence.
Images fit portrait A4 or their native pixel dimensions; EXIF/orientation/profile edge
cases need the release fixture matrix. Output resolution and image decoding remain
bounded by the documented memory budgets. Multiple source buffers, engine documents,
compiled/recovery bytes and image assets can exceed real device/browser memory.

No independent reader was available in the checked command paths. No certificate trust
validation, broad real-world PDF corpus, physical mobile/touch/pen testing, full assistive
technology audit, offline reload or full network/storage privacy audit was performed.

**Next: Phase 5 — offline support and privacy. Stop here until the user says continue.**

## Refresh-loss follow-up

After a reported refresh discarded unexported work, a memory-only leave guard was added.
It tracks unapplied drafts, changes since the last requested PDF download, undownloaded
utility results, and utility results opened as fresh sources without a local copy.
Export clears the corresponding guard; later changes and undo/redo away from the
exported plan restore it. Navigation/render revisions do not produce false warnings.

Checks: 61 automated tests pass (three new export-state/listener lifecycle tests),
TypeScript/static production build passes, and diff whitespace checks pass. In a
separate production Chromium tab, native refresh prompts were observed for draft and
applied edits; cancelling preserved both. Export removed the guard and an actual
reload proceeded without a warning. Utility generation/download/open-result guard
transitions were also checked in the browser. The helper's initial multi-step refresh
script stopped at a native modal, so the applied-edit refresh was verified with explicit
reload/dismiss commands and follow-up state checks. The user's existing tabs were not
refreshed or modified during this verification.

No document bytes/drafts were persisted and no automatic recovery was added. Browser
leave warnings cannot recover a refreshed/crashed session and are not reliable for all
mobile termination paths. Opt-in persistent local recovery remains a separate decision.

# Phase 3 — complete editing tools

Implemented and verified locally on 2026-11-08. No application deployment, publishing,
pushes, external services or new dependencies were used. The existing homepage/theme
were preserved. The project's distribution license decision remains unresolved.

## What works

Existing-text editing stays the initial/default tool and retains the verified Phase 2
removal/replacement operation. Added text, JPG/PNG images, highlights, outlined
rectangles and freehand strokes compile as PDF page content above it.

Added objects can be selected, moved, corner-resized, edited through contextual
properties, and deleted. Image proportions stay locked. Text fit and all object bounds
are validated before commit. Numeric geometry and keyboard movement/deletion complement
pointer interaction. Center-placement buttons make text/image/shape creation accessible
without a pointer. Draw supports notes and explicitly labeled visual signatures; it
makes no certificate/digital-signing claim.

One undo/redo history combines text edits and objects across pages, with redo-branch
invalidation and image ownership across history. Pointer movement uses transient
outlines/paths; PDF compilation happens on release/Apply, never on every movement.
Cancelled pointer gestures do not commit.

Navigation adds typed zoom, width/page fitting, a viewport anchor, page number entry,
PageUp/PageDown, Pan and temporary Space-pan. Jobs report actual stage labels and offer
cancellation. Cancellation terminates the worker and restores the last committed PDF,
history and image assets from RAM. Clear workspace remains a distinct reset.

## Checks actually performed

- `npm test`: **44 passing tests**. The previous 31 text/geometry/history tests remain
  passing. New tests cover every object type under all four intrinsic rotations,
  nonzero crop boxes and UserUnit 1/2; added-text baseline and extraction/search;
  image orientation, PNG alpha and JPG decoding; highlight alpha; vector placement;
  unchanged second pages; source-byte immutability; preview/export agreement;
  movement/resizing/deletion/history branching; restore with assets and redo history;
  failed-object/render rollback; pixel budgets and early image-dimension rejection;
  pending-image lifetime/release; pointer coordinates, corner geometry and ink
  normalization.
- `npm run build`: TypeScript and static Vite production build pass. The existing
  MuPDF Node-import externalization messages remain visible, not suppressed.
- `git diff --check`: passes. No commits were created by the agent.
- Official MuPDF Image and PDFDocument resource/stream APIs were checked before use.
  No additional PDF engine or bitmap library was added.

### Pixel comparison boundary

Phase 2's nontransparent text-replacement pixel checks remain exact. When transparent
highlights/PNG content enables MuPDF's page compositing path, existing antialiased
edges can round by one 8-bit RGB level, even outside the new object's box. Phase 3
object tests permit **at most one level**, while checking all positions, source text,
image quadrants, alpha and unchanged second pages separately. Larger outside changes
fail. This is a documented compositing effect, not a cover-up/removal technique.

## Production Chromium verification

Used a local static production preview at http://127.0.0.1:4175/#/edit with Playwright.
The visible workspace was preserved when additional interactions appeared; an isolated
browser session was used for the remaining automated checks.

Performed through the interface:

1. Create added text by clicking the page, change its content to `Local note`, apply,
   drag to move, and drag its bottom-right handle to enlarge it. Properties reflected
   the new position. Create a highlight, outlined rectangle and a freehand stroke
   using the visual-signature purpose. Import a PNG and place it. Inspect the real
   PDF preview and exported file.
2. In the isolated session, edit the original sample line to `Room for ideas.`. Add
   text through the keyboard-accessible center button, set `QA note` and numeric
   position, apply, import a JPG through the actual file chooser and place it.
3. Download the PDF, cancel a pending zoom/render request via the real Cancel action,
   and wait for restoration. Download again. The two files match **byte for byte**,
   preserving the source text edit, added text and JPG. Reopen/extract the downloaded
   PDF with the engine and confirm both new phrases and removal of the old line.
4. Undo/redo after restoration, delete the image with Delete, then undo its deletion.
5. Zoom to 180%, drag with Pan, and assert that both scroll axes change. Jump to
   page 2 by number, return to page 1 and fit the whole page.
6. Check the 390 × 844 layout and page fitting. DOM viewport/document widths both
   measured 390; the document pans/scrolls inside its pane. Inspect the mobile
   screenshot and page properties.
7. Inspect console: zero errors/warnings. Request log shows localhost static assets
   and local Blob URLs during the workflow, with no document upload or remote
   processing request. This does not replace Phase 5's full privacy audit.

Local ignored artifacts include output/playwright/phase3-initial.png,
phase3-objects.png, phase3-mobile.png and output/phase3/qa-export.png.
The latter is the engine render of the browser download. Both source/output PDFs
and test JPG/PNG files remain under output/phase3/ or .playwright-cli/.
Screenshots and exported PDF renders were visually inspected.

A browser helper invocation stalled on sandbox npm DNS access; the approved helper
was rerun with permission and completed the isolated cancellation check. The queued
render was cancelled before its response. No claim is made about cooperative
interruption inside a synchronous WASM call: cancellation uses worker termination.

## Issues found and fixed

- Imported but unplaced images could be pruned by an unrelated edit. Pending assets
  are now tracked separately and released explicitly; history/redo assets stay alive.
- Image placement and thumbnail export needed an explicit downward-page-coordinate
  image matrix. Quadrant/alpha tests verify upright output under rotation/cropping.
- A decoded-image memory guard needed to run before native decoding. PNG/JPG header
  dimensions are now inspected first; oversized images are rejected with a local
  resize instruction. The 32-million-pixel limit is an app memory budget, not a
  universal browser limit or an artificial per-user usage quota.
- Pointer ink coordinates must reserve stroke width exactly once. The normalization
  and PDF path round-trip test covers this.
- All object properties are disabled during a commit so an in-flight response cannot
  discard newly typed properties. Fractional geometry accepts arbitrary point values.
- Tool defaults are separate, so choosing a highlight does not accidentally make the
  next rectangle or signature yellow. Mobile header actions keep their labels on
  one line.

## Limits and next phase

Existing-text restrictions remain: basic Latin, three replacement fonts, fixed slots,
and explicit view-only states. Added text likewise supports basic Latin plus line
breaks. Text must fit its box. No rich typography, object rotation, image cropping,
object stacking panel, pressure-sensitive ink or stroke grouping is included. New
objects append above earlier content. Each drawing stroke is a separate object;
its stroke path scales on resize while line width stays fixed.

Exported objects are flattened into PDF page content, without rasterizing the page.
Reopening does not recover their handles or session history. Transparency can make
reopened pages view-only under the existing-text engine's conservative appearance
checks. The original source/edit plan stays editable inside the current session and
through cancellation recovery. Metadata/attachments and whole-document sanitization
are outside the promise. No certificate signing is provided.

Original source, one text-prefix cache, compiled/recovery bytes, native image handles,
compressed image backups and compact history coexist in memory. Large files, many
images or long histories can exceed device limits. Render resolution stays bounded;
400% zoom can magnify the capped preview. Only a stage indicator is shown; no fake
percentage is presented. Fine-grained/cooperative engine cancellation is unavailable.

No independent PDF reader, physical touch/pen device, broad browser/memory corpus,
malformed-image security matrix, offline reload or full release/privacy check was
performed. Document data remains in RAM; the preexisting theme preference is the
separate localStorage setting. No offline readiness or release readiness is claimed.

**Phase 3 is complete within these boundaries. Next: Phase 4 — page tools and
conversions. Stop until the user says continue.**

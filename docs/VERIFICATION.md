# Phase 1 verification

Historical record. See [Phase 2 verification](PHASE2-VERIFICATION.md) for the current
existing-text editor and its expanded checks.

Performed locally on 2026-11-07. No deployment, publishing, pushing, accounts, or
external application services were used. npm downloads and official documentation
lookups were used for setup/research. The initial repository contained only Git
metadata; no applicable AGENTS.md was found in the repository or ancestor paths.

## Automated checks actually run

- `npm run build`: passes TypeScript checking and builds the static application,
  dedicated module worker, local WASM, favicon, and license assets.
- `npm test`: **7 tests pass**. Covers removal from decoded PDF streams, extraction
  and search of replacement text, original byte immutability, preservation of all
  rendered pixels outside the line and the entire second page, rejection of
  unsupported characters/overflow, escaping PDF delimiters, output rendering,
  render budgets, origin subtraction, and worker readiness/ownership/cancellation.
- `npm run proof`: writes before/after PDFs, page PNGs, and the successful JSON
  report under `output/proof/`. The generated after image was visually inspected.
- `git diff --check`: passed. No commits were made.

The first tsx CLI test attempt hit a sandbox IPC restriction. Tests then passed
with approval. The commands now use Node's tsx import hook, avoiding the unnecessary
CLI IPC server, and the seven tests pass inside the normal sandbox.

## Real browser checks actually run

Chromium via Playwright against `npm run preview` serving **dist/**:

1. Load and display the generated sample.
2. Replace the line with `A new idea belongs here.` and inspect the updated preview.
3. Export via the real download action.
4. Read the browser's downloaded file with the engine; verify replacement extraction.
   Compare it byte-for-byte against separately generated expected engine output:
   exact match.
5. Open that downloaded file through the local file chooser; render it and confirm
   it is treated as a local PDF, without enabling the sample-only edit operation.
6. Navigate to page 2.
7. Inspect requests: only localhost assets and local Blob URLs appeared during this
   run; no document upload or remote request was observed. Production console after
   the favicon fix: zero errors/warnings.
8. Check the 390 × 844 layout, take a screenshot, and confirm viewport and document
   widths both equal 390. Check zoom actually changes the page width from 238 px to
   approximately 299.2 px, and Fit restores the fitted width.
9. Clear workspace; confirm the page, page count, and export availability reset.

The documented `npm run dev` command was also started and loaded in Chromium.
Sample generation/rendering works there. Unsupported emoji replacement displayed
an explicit error and retained the document. The development console had no errors
or warnings (React DevTools informational message only).

Screenshots are local, ignored artifacts in `output/playwright/desktop.png` and
`output/playwright/mobile.png`. The desktop screenshot shows the edited sample;
the mobile screenshot shows the fitted production sample. Both were visually
inspected. Local preview/dev servers were stopped after verification.

## Issues found and fixed

- WASM initialization could swallow the first request before the worker installed
  its message handler. An explicit ready handshake and regression test now cover it.
- Responsive CSS initially constrained all zoom levels to the same width. Page
  sizing now preserves actual point-to-CSS zoom; initial fitting and a Fit action
  handle narrow panes. Width changes were measured in the production browser.
- A favicon request initially returned 404; a local favicon is now included.

Vite still emits two informational externalization warnings for Node-only imports
in MuPDF's cross-platform runtime. Those guarded branches were not executed in
the browser; they were not suppressed. Build and browser checks pass.

## Verification limits

The renderer and PDF extraction checks use the same MuPDF engine. No independent
PDF reader was exercised. General existing-text selection, rotated/cropped editing,
arbitrary fonts/scripts, overlap handling, full undo/redo, page tools, scanned files,
malicious-file resilience, mobile hardware memory limits, offline reload, and
complete CSP/privacy hardening have not been verified. There is no service worker
or offline-ready claim. Broader fixtures belong to the requested subsequent phases.

**Assessment:** working Phase 1 foundation and controlled text-edit feasibility
proof; not a general text editor or a distribution-ready release. The next phase
is Phase 2, existing-text selection and editing. Stop here until the user continues.

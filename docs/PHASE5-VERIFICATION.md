# Phase 5 — offline support and privacy

Implemented and verified locally on 2026-11-08. No deployment, publishing, pushes,
agent commits, external application services, new dependencies or project-wide license.
MuPDF remains pinned at 1.28.1; the owner AGPL/commercial distribution decision remains
unresolved. Existing editor workflows and the user's homepage/theme changes were kept.

## Implemented

The static build emits a complete application manifest with sizes/SHA-256 hashes, a
versioned service worker, HTML meta CSP and static-host response-header instructions.
All runtime JS, dedicated workers, WASM, CSS, icon and support/license files are local.
There are 14 application cache entries in the checked build; future emitted font or
worker dependencies join the generated list automatically.

Only fixed same-origin application GET URLs are fetched for installation/repair and
stored. Runtime caching is absent. Unknown/foreign resources and non-GET methods are
blocked locally without network fallback. Navigation uses cached HTML, including home
and editor hash routes. Documents, filenames, passwords, thumbnails, extracted text,
edit plans and recovery checkpoints do not enter Cache Storage, IndexedDB or browser
storage. Theme is the sole localStorage preference. No analytics, ads, session recording,
telemetry, runtime CDN, remote fonts or remote error collection is included.

Readiness is verified for the controlling worker's matching build before Available
offline is displayed, and rechecked on focus/visibility/connectivity changes. Missing,
corrupt or unexpected cache entries remove readiness. Repair fetches only fixed assets.
First setup requires one explicit reload after all files verify; users are told to
export first. No clients.claim or skipWaiting is used. Updates wait until old-version
app tabs close and never reload an active editor. Queued/running jobs, file reads,
cancellation, failure and transfer failure are counted so setup controls cannot reload
mid-job. Only natural activation cleans old app caches.

The production CSP blocks string/inline JS, forms, object/frame embedding and foreign
resources. It specifically permits WASM compilation, self-hosted workers/modules,
Blob images and React's positional styles. Worker responses receive CSP headers through
Vite preview; static deployment must apply equivalent emitted header rules. Document
JavaScript stays disabled, and the application does not activate PDF URI/Launch/
SubmitForm/OpenAction/AA actions. This is not a PDF sanitization promise: text-edited
exports can retain actions for other PDF readers.

Clear workspace drops source, edits, object/history/image/recovery references, terminates
document workers, clears file inputs and releases page/thumbnail URLs through cleanup.
Application caches, theme and user-requested downloads remain. Browser pickup can retain
a pending download Blob URL for up to 30 seconds. No automatic document recovery or
opt-in persistence feature was introduced.

## Automated checks actually performed

`npm test`: **70 passing tests**. All prior 61 tests remain, with nine added cases:

- Verified complete installation and offline worker/WASM/navigation responses.
- No runtime fetch/cache fallthrough for foreign URLs, query-bearing assets, unknown
  thumbnails or POST requests.
- Corrupt/partial installation fails without replacing a prior valid cache.
- Eviction/corruption revokes readiness; repair restores only application resources.
- Version cleanup occurs at activation and preserves unrelated cache namespaces.
- Manifest enumeration includes actual worker dependencies, WASM, fonts and resources,
  with hashes derived from bytes rather than hand-maintained names.
- CSP capability boundaries and idempotent job activity release.
- A generated malicious-action PDF remains inert through open/render, existing-text
  removal/replacement and page utilities; no network API call is made by processing.
- A synchronous worker-transfer failure releases activity and preserves recovery.

Service-worker tests execute the real worker source in an isolated VM with a small
Cache Storage fixture. They complement, rather than replace, the real browser checks.

`npm run build`: TypeScript and static production build pass. The existing guarded
MuPDF Node-import externalization notices remain visible. New Vite native-config
extension warnings were corrected rather than suppressed. `git diff --check` passes.
No release-wide/browser-corpus claim follows from these checks.

## Disconnected production browser checks

Used a separate Chromium session against the static production preview on
http://127.0.0.1:4177/. The sandbox initially blocked a local listening port; the local
server and browser helper were run with permission. Existing user tabs on the earlier
preview were not refreshed, cleared or put offline.

1. On a fresh profile, download and verify all 14 app assets. Confirm the first page
   says Offline files downloaded and asks for an explicit setup reload. After reload,
   confirm Available offline and actual PDF rendering under the production CSP.
2. Set the test browser context offline **and stop its static server**. Reload the
   production page successfully. Open a locally generated PDF whose filename, extracted
   text and embedded action URLs contain a private canary. It includes document JS,
   OpenAction, AA, SubmitForm/Launch actions and a remote link.
3. Select `Original editable line`, edit to `Offline private edit.`, preview the actual
   PDF and download it offline. Open page tools (a separate fresh PDF worker), rotate
   and download the generated PDF while still disconnected. Reopen/extract with MuPDF;
   verify replacement text, original-line removal, preserved canary content and rotated
   page dimensions. Locally rendered outputs and workspace screenshots were inspected.
4. Audit Cache Storage bodies/URLs: one version cache, 14 application assets, no private
   filename/content marker. IndexedDB databases: zero. sessionStorage entries: zero.
   localStorage: theme only. Check browser requests during processing: same-origin
   static assets/local Blob URLs only; no canary-bearing URLs, payload bodies or linked
   requests. Clear workspace; verify No document open, disabled Export and retained
   offline availability.
5. Navigate home and back to the editor while disconnected. Both routes and fresh PDF
   rendering work. Delete the required cached WASM file and trigger a readiness check:
   Available offline disappears and Offline setup incomplete appears.
6. Restart the static server and reconnect. Retry offline setup restores verified
   readiness. Open/edit the action fixture again while online; processing still produces
   no document or linked-resource request.

## Safe update checks

Built two real output versions and kept their manifest snapshots under ignored output.
While version A controlled the app, held the dispatch of a real queued view request
using a test-only Worker.postMessage interception. The application remained busy with
Cancel operation visible. Build B installed and verified into a separate cache; the
update notice appeared, while A remained the controller and kept its full cache.

The test queried both workers through their metadata-only status ports. A stayed at
version `1d019a930d094ec02969ef41`; B waited at `11ebfdac300b281f91a1c4bf` with complete
assets. Releasing the queued render completed normally. Export before/after matched
**byte for byte**, preserving the real source-text edit. This tests a pending job;
no claim is made about cooperative interruption inside a synchronous WASM call.

Close the old-version test tab, keeping an about:blank tab in the same profile. Reopen
the app with the browser offline: B activates naturally, renders successfully, and only
B's app cache remains. Old cache cleanup and the matching-build readiness state were
asserted. No forced activation, claim, automatic reload or document reset occurred.
The final output was also smoke-tested separately after the last production build.

## Network policy, visual and storage checks

A synthetic POST to an unknown upload URL returned 403 from the controlling service
worker (`Response.fromServiceWorker()` true), without reaching the static server.
An unknown document-linked resource also returned a local 403 and neither probe entered
the cache. These intentional denials produced two expected HTTP-403 console messages;
they are not suppressed. Before these explicit probes, normal open/edit/export and
offline operations reported zero console errors and warnings.

At 390 × 844, inspect the offline/privacy panel and page fitting; no horizontal overflow.
The information panel clearly says app caching does not store or restore working PDFs.
Screenshots under ignored output/playwright include phase5-offline-edit.png,
phase5-update-waiting.png and phase5-mobile-privacy.png. Browser downloads and engine
renders are under output/phase5. Canary fixtures are generated locally, not user data.

## Boundaries and remaining work

Use HTTPS or localhost, at `/` on a dedicated origin. Subpath deployment requires a
base/scope/manifest change and fresh tests. Apply response headers to workers and HTML;
meta CSP alone cannot enforce worker policy or frame-ancestors. Keep old hashed assets
available during real host updates, and revalidate sw.js/HTML. No deployment occurred.

Browser cache eviction, storage denial, private mode, OS termination and device memory
can prevent continued offline use. A first visit needs network and an explicit setup
reload. Updates require closing all old-version tabs. Offline readiness is rechecked at
listed events, not a guarantee against eviction at every instant. Documents are still
memory-only; confirming refresh or a crash can lose edits despite leave warnings.
Downloads and copied system-clipboard data stay under the user's control.

Tests used Chromium desktop with a mobile viewport, not physical mobile hardware, a
broad browser/storage/malformed-PDF corpus or an independent reader matrix. No security
certification or forensic RAM/storage erasure is claimed. Application-level canary and
network checks cannot establish absence of every browser/OS internal behavior. Those
platform limits do not introduce application document persistence or remote processing.

Official references reviewed: [service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers),
[skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting),
[claim](https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim),
[WASM and script CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src),
and [worker CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src).

**Phase 5 is complete within these boundaries. Next: Phase 6 — release verification
and documentation. Stop until the user says continue.**

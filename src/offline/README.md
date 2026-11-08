# Offline delivery

Production builds generate `sw.js`, a hashed `offline-manifest.json`, CSP metadata and
static-host `_headers`. The manifest includes all emitted runtime JS, workers, WASM,
CSS, fonts if added, icons and supporting license resources. The service worker caches
only the manifest's exact same-origin GET URLs and verifies sizes and SHA-256 hashes.
No runtime caching, uploads, document buffers, filenames, passwords, thumbnails, text,
edit plans or document recovery data are stored here. Theme preference remains the
only application localStorage value.

First installation leaves existing tabs untouched: there is no `clients.claim()` or
`skipWaiting()`. After all files verify, the interface asks for one explicit reload;
export first. Once a controlling worker verifies the complete matching build, the
interface shows Available offline. It rechecks on focus, visibility and connectivity
changes. Repair fetches only the fixed application asset list. Missing/corrupted files,
quota denial and registration errors must not claim offline readiness.

New versions install in separate caches and wait for all old-version app tabs to close.
The running editor is never reloaded automatically. Old caches are removed only during
natural activation. The first-setup reload and cache-repair buttons are disabled while
document jobs are active. Activity includes worker requests, queued initialization,
file reads, failures and cancellation. No busy-state or file metadata is persisted.

Controlled navigation uses the cached HTML shell. Workers and WASM are served from the
same cache; unknown URLs, foreign resources and non-GET requests are rejected without
network fallthrough. Application assets remain after Clear workspace. Working documents
remain memory-only: offline reload does not restore edits, and confirming refresh still
clears them. Browser eviction/private modes/device limits can remove offline availability.

Use an HTTPS origin (or localhost) dedicated to margin.pdf. This build assumes the web
root `/` with hash routes; subpath deployments need a base/scope/manifest change and
fresh offline verification. Apply the emitted headers on the static host, including
worker JS responses; the HTML meta policy alone cannot enforce worker response headers
or frame-ancestors. `npm run preview` applies these headers locally. Avoid caching
`sw.js`/HTML indefinitely. No hosting or deployment was performed.

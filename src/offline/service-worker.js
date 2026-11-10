/* Manifest and headers are injected by the static build. This worker only stores
 * allowlisted application files. It never receives a document or edit plan. */
const PREFIX = 'margin-pdf-app-';
const CACHE = PREFIX + MANIFEST.version;
const ENTRIES = new Map(MANIFEST.assets.map(asset => [asset.url, asset]));
const scopeURL = new URL(self.registration.scope);
let verification;
let population;

async function matches(response, asset) {
  if (!response || !response.ok || response.type === 'opaque') return false;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.bytes) return false;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('') === asset.sha256;
}
async function verify() {
  if (!verification) verification = (async () => {
    // Do not create an empty cache just by checking whether offline files exist.
    if (!(await caches.has(CACHE))) return false;
    const cache = await caches.open(CACHE);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.origin !== scopeURL.origin || url.search || !ENTRIES.has(url.pathname)) return false;
    }
    for (const asset of MANIFEST.assets) if (!await matches(await cache.match(asset.url), asset)) return false;
    return true;
  })().finally(() => { verification = undefined; });
  return verification;
}
async function fillCache() {
  const cache = await caches.open(CACHE);
  for (const request of await cache.keys()) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== scopeURL.origin || url.search || !ENTRIES.has(url.pathname)) await cache.delete(request);
  }
  // Sequential fetches bound native/WASM memory and do not create a bitmap batch.
  for (const asset of MANIFEST.assets) {
    const request = new Request(new URL(asset.url, scopeURL), {cache:'reload',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
    const response = await fetch(request);
    if (!await matches(response.clone(), asset)) throw new Error('An application asset failed verification.');
    await cache.put(asset.url, response);
  }
  verification = undefined;
  if (!await verify()) throw new Error('Offline application files are incomplete.');
}
function populate() {
  if (!population) population = fillCache().finally(() => { population = undefined; });
  return population;
}
self.addEventListener('install', event => {
  event.waitUntil(populate().catch(async error => { await caches.delete(CACHE); throw error; }));
  // No automatic skipWaiting: an update only replaces the running worker when the sole open tab asks
  // (ACTIVATE below), after it has checked that no job is running and nothing is unsaved.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Natural activation only happens after clients of the previous worker close.
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  })());
  // No clients.claim: do not take over existing, possibly busy, uncontrolled tabs.
});
function targetFor(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scopeURL.origin) return null;
  if (request.mode === 'navigate') return '/index.html';
  if (url.search || !ENTRIES.has(url.pathname)) return null;
  return url.pathname;
}
self.addEventListener('fetch', event => {
  event.respondWith((async () => {
    // The owner's Vercel analytics integration is the sole network exception.
    // Never cache or queue it; PDFs and unknown/foreign URLs stay blocked.
    const url = new URL(event.request.url);
    const analytics = MANIFEST.analyticsEnabled && url.origin === scopeURL.origin && !url.search && (
      (event.request.method === 'GET' && url.pathname === '/_vercel/insights/script.js') ||
      (event.request.method === 'POST' && ['/_vercel/insights/view','/_vercel/insights/session'].includes(url.pathname))
    );
    if (analytics) {
      try { return await fetch(new Request(event.request, {credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'})); }
      catch { return new Response(null, {status:204}); }
    }
    const target = targetFor(event.request);
    if (!target) return new Response('Only local application assets are available.', {status:403,headers:{'Content-Type':'text/plain',...SECURITY_HEADERS}});
    const cache = await caches.open(CACHE);
    const response = await cache.match(target);
    // No runtime caching, no network fallthrough and no document-linked requests.
    if (!response) return new Response('Offline files are incomplete. Reconnect and repair offline setup.', {status:503,headers:{'Content-Type':'text/plain',...SECURITY_HEADERS}});
    return response;
  })());
});
self.addEventListener('message', event => {
  const port = event.ports[0];
  const client = event.source;
  if (!port || !client || new URL(client.url).origin !== scopeURL.origin) return;
  // Sent only to the waiting worker; skipWaiting on an already active worker does nothing.
  if (event.data?.type === 'ACTIVATE') {
    event.waitUntil((async () => {
      // Another tab may be mid-job or still need this build's files; only the last tab may update.
      const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
      if (windows.length > 1) { port.postMessage({ok:false,error:'Close the other margin.pdf tabs or windows first, then try again.'}); return; }
      port.postMessage({ok:true});
      await self.skipWaiting();
    })());
    return;
  }
  if (event.data?.type !== 'STATUS' && event.data?.type !== 'REPAIR') return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'REPAIR') await populate();
      port.postMessage({buildId:MANIFEST.buildId,version:MANIFEST.version,ready:await verify(),assetCount:MANIFEST.assets.length});
    } catch {
      port.postMessage({buildId:MANIFEST.buildId,version:MANIFEST.version,ready:false,error:'Offline files could not be verified. Reconnect and retry.'});
    }
  })());
});

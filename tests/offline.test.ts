import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { webcrypto, createHash } from 'node:crypto'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetManifest } from '../scripts/build/offline-plugin'
import { CONTENT_POLICY } from '../scripts/build/security'
import { beginDocumentJob, activeJobCount } from '../src/offline/activity'

const source=await readFile(new URL('../src/offline/service-worker.js',import.meta.url),'utf8')
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const origin='https://margin.example'
const files:Record<string,string>={'/index.html':'<html>margin.pdf app</html>','/assets/pdf.worker-a.js':'worker code','/assets/engine.wasm':'engine bytes'}
function harness(version='a',shared=new Map<string,Map<string,Response>>(),failure?:string,analyticsEnabled=false){
 const assets=Object.entries(files).map(([url,bytes])=>({url,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}))
 const listeners=new Map<string,(event:any)=>void>(),network:{url:string;method:string}[]=[],events={claim:0,skip:0}
 const normalize=(request:string|Request)=>new URL(typeof request==='string'?request:request.url,origin).href
 const storage={
  async has(name:string){return shared.has(name)},
  async keys(){return [...shared.keys()]},
  async delete(name:string){return shared.delete(name)},
  async open(name:string){if(!shared.has(name))shared.set(name,new Map());const entries=shared.get(name)!;return {
   async match(url:string|Request){return entries.get(normalize(url))?.clone()},
   async put(url:string|Request,response:Response){entries.set(normalize(url),response.clone())},
   async keys(){return [...entries.keys()].map(url=>new Request(url))},
   async delete(url:string|Request){return entries.delete(normalize(url))},
  }},
 }
 const self={registration:{scope:origin+'/'},clients:{claim(){events.claim++}},skipWaiting(){events.skip++},addEventListener(type:string,handler:(event:any)=>void){listeners.set(type,handler)}}
 vm.runInNewContext(`const MANIFEST=${JSON.stringify({buildId:version,version,assets,analyticsEnabled})};const SECURITY_HEADERS={};${source}`,{self,caches:storage,URL,Request,Response,crypto:webcrypto,Uint8Array,Map,Array,Error,fetch:async(request:Request)=>{network.push({url:request.url,method:request.method});const url=new URL(request.url);if(url.pathname.startsWith('/_vercel/insights/')){if(failure===url.pathname)throw new Error('offline');assert.equal(request.credentials,'omit');assert.equal(request.referrerPolicy,'no-referrer');assert.equal(request.redirect,'error');assert.equal(request.cache,'no-store');return new Response(null,{status:204})}return new Response(url.pathname===failure?'corrupt asset':files[url.pathname],{status:files[url.pathname]?200:404})}})
 return {shared,network,events,storage,async lifecycle(type:string){let work:Promise<unknown>|undefined;listeners.get(type)!({waitUntil(p:Promise<unknown>){work=p}});await work},async request(path:string,options:{method?:string;mode?:string}={}){let response:Promise<Response>|undefined;const request=new Request(new URL(path,origin),{method:options.method??'GET'});listeners.get('fetch')!({request:options.mode?{url:request.url,method:request.method,mode:options.mode}:request,respondWith(p:Promise<Response>){response=p}});return response!},async status(type='STATUS'){let work:Promise<unknown>|undefined,result:any;listeners.get('message')!({data:{type},source:{url:origin+'/'},ports:[{postMessage(value:unknown){result=value}}],waitUntil(p:Promise<unknown>){work=p}});await work;return result}}
}

test('Vercel production analytics has exact uncached endpoints; other uploads and document-linked requests stay blocked',async()=>{
 const h=harness('analytics',undefined,undefined,true);await h.lifecycle('install')
 for(const [path,method]of [['/_vercel/insights/script.js','GET'],['/_vercel/insights/view','POST'],['/_vercel/insights/session','POST']])assert.equal((await h.request(path,{method})).status,204)
 assert.equal(h.network.length,6)
 for(const [path,method]of [['/_vercel/insights/view?filename=PRIVATE.pdf','POST'],['/_vercel/insights/script.js?private','GET'],['/_vercel/insights/event','POST'],['/_vercel/insights/upload','POST'],['/_vercel/insights/view','PUT'],['https://foreign.example/_vercel/insights/view','POST']])assert.equal((await h.request(path,{method})).status,403)
 assert.equal(h.network.length,6)
 assert.equal((await h.status()).ready,true,'analytics never enters the verified asset cache')
 const local=harness();await local.lifecycle('install');assert.equal((await local.request('/_vercel/insights/script.js')).status,403)
 const offline=harness('offline',undefined,'/_vercel/insights/view',true);await offline.lifecycle('install');assert.equal((await offline.request('/_vercel/insights/view',{method:'POST'})).status,204);assert.equal((await offline.status()).ready,true)
})

test('complete verified installation serves worker/WASM/navigation offline without runtime network writes',async()=>{
 const h=harness();await h.lifecycle('install');await h.lifecycle('activate')
 assert.equal((await h.status()).ready,true);assert.equal(h.network.length,3)
 assert.equal(await(await h.request('/assets/engine.wasm')).text(),'engine bytes')
 assert.equal(await(await h.request('/other/path?private-name.pdf',{mode:'navigate'})).text(),files['/index.html'])
 assert.equal((await h.request('/upload',{method:'POST'})).status,403)
 assert.equal((await h.request('https://linked.example/document')).status,403)
 assert.equal((await h.request('/assets/engine.wasm?filename=private.pdf')).status,403)
 assert.equal((await h.request('/private-thumbnail.png')).status,403)
 assert.equal(h.network.length,3,'only precache static GETs may reach the network')
 assert.deepEqual(h.events,{claim:0,skip:0},'installation must not seize or update running tabs')
})

test('partial or corrupt installation fails without replacing a previous complete version',async()=>{
 const old=harness('old');await old.lifecycle('install')
 const next=harness('new',old.shared,'/assets/engine.wasm')
 await assert.rejects(next.lifecycle('install'),/verification/)
 assert.equal(next.shared.has('margin-pdf-app-new'),false)
 assert.equal((await old.status()).ready,true)
})

test('cache eviction, corruption and unexpected entries revoke readiness; repair restores only static assets',async()=>{
 const h=harness();await h.lifecycle('install')
 const cache=await h.storage.open('margin-pdf-app-a');await cache.delete('/assets/engine.wasm')
 assert.equal((await h.status()).ready,false);assert.equal((await h.request('/assets/engine.wasm')).status,503)
 assert.equal((await h.status('REPAIR')).ready,true)
 await cache.put('/assets/engine.wasm',new Response('broken'))
 assert.equal((await h.status()).ready,false)
 await cache.put('/private-file.pdf',new Response('document bytes that the app must never store'))
 assert.equal((await h.status('REPAIR')).ready,true)
 assert.equal(await cache.match('/private-file.pdf'),undefined)
})

test('old caches stay usable until natural activation; cleanup touches only the app namespace',async()=>{
 const old=harness('old');await old.lifecycle('install');old.shared.set('unrelated-cache',new Map())
 const next=harness('new',old.shared);await next.lifecycle('install')
 assert.equal(old.shared.has('margin-pdf-app-old'),true)
 assert.equal(await(await old.request('/assets/engine.wasm')).text(),'engine bytes')
 await next.lifecycle('activate')
 assert.equal(old.shared.has('margin-pdf-app-old'),false);assert.equal(old.shared.has('unrelated-cache'),true)
 assert.equal((await next.status()).ready,true)
})

test('manifest includes emitted worker dependencies, WASM, fonts and supporting resources with actual hashes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'margin-offline-'))
 try{await mkdir(join(dir,'assets'));await writeFile(join(dir,'index.html'),files['/index.html']);await writeFile(join(dir,'assets','font.woff2'),'font');await writeFile(join(dir,'assets','engine.wasm'),'engine');await writeFile(join(dir,'sw.js'),'management');const manifest=await assetManifest(dir);assert.equal(manifest.length,3);assert.ok(manifest.some(a=>a.url.endsWith('.woff2')));assert.equal(manifest.find(a=>a.url==='/assets/engine.wasm')?.sha256,hash('engine'))}finally{await rm(dir,{recursive:true})}
})

test('CSP allows self-hosted WASM and local previews, blocks script strings, forms, frames and objects',()=>{
 assert.ok(CONTENT_POLICY.includes("'wasm-unsafe-eval'"));assert.ok(!CONTENT_POLICY.includes("'unsafe-eval'"))
 for(const policy of ["default-src 'none'","script-src-attr 'none'","connect-src 'self'","worker-src 'self'","object-src 'none'","form-action 'none'","base-uri 'none'"])assert.ok(CONTENT_POLICY.includes(policy))
 assert.ok(!CONTENT_POLICY.includes('https:'))
})

test('job activity counts release once across completion/cancellation boundaries',()=>{
 assert.equal(activeJobCount(),0);const a=beginDocumentJob(),b=beginDocumentJob();assert.equal(activeJobCount(),2);a();a();assert.equal(activeJobCount(),1);b();assert.equal(activeJobCount(),0)
})

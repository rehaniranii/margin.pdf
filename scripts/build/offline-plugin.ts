import type { Plugin, ResolvedConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'
import { CONTENT_POLICY, SECURITY_HEADERS } from './security.ts'

export type OfflineAsset = { url: string; bytes: number; sha256: string }
export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export async function assetManifest(directory: string): Promise<OfflineAsset[]> {
  const assets: OfflineAsset[] = []
  async function walk(path: string) {
    for (const entry of await readdir(path,{withFileTypes:true})) {
      const absolute = join(path,entry.name)
      if(entry.isDirectory()) await walk(absolute)
      else {
        const file=relative(directory,absolute).split('\\').join('/')
        if(['sw.js','offline-manifest.json','_headers'].includes(file))continue
        const content=await readFile(absolute)
        assets.push({url:`/${file}`,bytes:content.byteLength,sha256:digest(content)})
      }
    }
  }
  await walk(directory)
  return assets.sort((a,b)=>a.url.localeCompare(b.url))
}

export function offlineBuild(buildId: string): Plugin {
  let config: ResolvedConfig
  return {
    name:'margin-pdf-offline',apply:'build',
    configResolved(value){config=value},
    transformIndexHtml(){return [{tag:'meta',attrs:{'http-equiv':'Content-Security-Policy',content:CONTENT_POLICY},injectTo:'head-prepend'},{tag:'meta',attrs:{name:'referrer',content:'no-referrer'},injectTo:'head-prepend'}]},
    async closeBundle(){
      const out=resolve(config.root,config.build.outDir)
      const assets=await assetManifest(out)
      if(!assets.some(asset=>asset.url.endsWith('.wasm'))||!assets.some(asset=>/\/pdf\.worker-.*\.js$/.test(asset.url)))throw new Error('The offline build is missing its PDF worker or WASM engine.')
      const template=await readFile(resolve(config.root,'src/offline/service-worker.js'),'utf8')
      const manifest={buildId,version:digest(JSON.stringify(assets)+template+buildId).slice(0,24),assets}
      await writeFile(join(out,'offline-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
      await writeFile(join(out,'sw.js'),`'use strict';\nconst MANIFEST=${JSON.stringify(manifest)};\nconst SECURITY_HEADERS=${JSON.stringify(SECURITY_HEADERS)};\n${template}`)
      const headerLines=Object.entries(SECURITY_HEADERS).map(([key,value])=>`  ${key}: ${value}`).join('\n')
      await writeFile(join(out,'_headers'),`/*\n${headerLines}\n/sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n`)
    },
  }
}

import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'

type Entry={version:string;license?:string;dev?:boolean;optional?:boolean}
const lock=JSON.parse(await readFile('package-lock.json','utf8')) as {packages:Record<string,Entry>}
const entries=Object.entries(lock.packages).filter(([name])=>name).map(([location,entry])=>({location,...entry}))
assert.ok(entries.every(entry=>entry.license),'A locked dependency has no declared license; review it explicitly.')
const runtime=entries.filter(entry=>!entry.dev)
const noticed=new Set(['mupdf','react','react-dom','scheduler','tesseract.js-core','@tesseract.js-data/eng'])
// Reviewed packages that ship no license file: their notice is written by hand instead of copied.
const reviewedNotice:Record<string,string>={'@tesseract.js-data/eng':'public/licenses/tesseract-eng-traineddata-LICENSE.txt'}
for(const entry of runtime){
 const name=entry.location.replace('node_modules/','')
 assert.ok(noticed.has(name),`Review/add notices for new runtime dependency ${name}`)
 if(reviewedNotice[name]){assert.match(await readFile(reviewedNotice[name],'utf8'),/Apache License/,`Missing reviewed notice for ${name}`);continue}
 const source=await readFile(`${entry.location}/LICENSE`)
 assert.deepEqual(await readFile(`public/licenses/${name}-LICENSE.txt`),source,`Preserved ${name} license differs from installed package`)
}
const counts:Record<string,number>={}
for(const entry of entries)counts[entry.license!]=(counts[entry.license!]??0)+1
const report={lockfileSha256:createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),packageCount:entries.length,counts,runtime,entries,note:'Declared npm metadata and runtime license copies verified. This does not settle MuPDF bundled-component notices, corresponding-source obligations or the owner licensing decision.'}
await mkdir('output/phase6',{recursive:true})
await writeFile('output/phase6/dependency-inventory.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({packageCount:entries.length,counts,runtime:runtime.map(entry=>entry.location),runtimeNoticesMatch:true},null,2))

// Optional macOS-only second-reader check. No production dependency.
import {readFile,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'

if(process.platform!=='darwin')throw new Error('This independent check requires macOS PDFKit and Swift. Use another independent reader on other systems.')
const fixtures=JSON.parse(await readFile('output/phase6/fixture-report.json','utf8')) as {name:string;exported?:string;pages:number}[]
const reports=[]
for(const fixture of fixtures){
 if(!fixture.exported)continue
 const result=spawnSync('swift',['-module-cache-path','output/phase6/swift-cache','scripts/release/pdfkit-check.swift',`output/phase6/fixtures/${fixture.exported}`,`output/phase6/pdfkit-${fixture.exported}.png`,'Release verified.',fixture.name==='embedded-subset.pdf'?'Original embedded line':'Original editable line'],{encoding:'utf8'})
 if(result.status!==0)throw new Error(`PDFKit failed ${fixture.name}: ${result.stderr}`)
 const report=JSON.parse(result.stdout)
 assert.equal(report.pageCount,fixture.pages)
 assert.ok(report.pages[0].text.includes('Nearby content stays.'))
 if(report.pageCount>1)assert.ok(report.pages[1].text.includes('Original editable line'))
 reports.push({file:fixture.exported,...report})
}
await writeFile('output/phase6/pdfkit-report.json',JSON.stringify(reports,null,2)+'\n')
console.log(`PDFKit independently opened, extracted and rendered ${reports.length} edited PDFs.`)

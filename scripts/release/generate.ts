import {mkdir,writeFile} from 'node:fs/promises'
import {releaseFixtures} from './fixtures'
import {EditorSession} from '../../src/engine/editor-session'
import {openPdf,inspect,render} from '../../src/engine/mupdf-adapter'

const directory='output/phase6/fixtures'
await mkdir(directory,{recursive:true})
const report=[]
for(const [name,fixture]of Object.entries(releaseFixtures())){
 await writeFile(`${directory}/${name}`,fixture.bytes)
 const session=new EditorSession(fixture.bytes)
 try{const first=session.view(0,.7,1),regions=first.text.regions,selected=regions.find(region=>region.text===fixture.line);let exported:string|undefined
 if(fixture.expected==='editable'&&selected&&!selected.unsupported){const next=session.apply({type:'replace-text',page:0,regionId:selected.id,text:'Release verified.',font:'Helvetica',size:14,color:'#2859cf'},.7,1);exported=name.replace('.pdf','-edited.pdf');await writeFile(`${directory}/${exported}`,new Uint8Array(session.export()));await writeFile(`${directory}/${exported}.png`,new Uint8Array(next.image.png))}
 const doc=openPdf(fixture.bytes);let text='';try{text=inspect(doc).text;await writeFile(`${directory}/${name}.png`,new Uint8Array(render(doc,0,.7,1).png))}finally{doc.destroy()}
 report.push({name,bytes:fixture.bytes.byteLength,pages:session.count,expected:fixture.expected,supported:regions.filter(r=>!r.unsupported).length,selectedReason:selected?.unsupported,message:first.text.message,text:text.slice(0,200),exported})
 }finally{session.dispose()}
}
await writeFile('output/phase6/fixture-report.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))

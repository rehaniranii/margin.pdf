import {test} from 'node:test'
import assert from 'node:assert/strict'
import {actionFixture} from './fixtures'
import {openPdf,render,inspect} from '../src/engine/mupdf-adapter'
import {EditorSession} from '../src/engine/editor-session'
import {PdfUtilities} from '../src/engine/pdf-utilities'

test('embedded JavaScript/actions/links remain inert through open, render, text editing and page utilities',()=>{
 const bytes=actionFixture(),originalFetch=globalThis.fetch
 const requests:unknown[]=[]
 globalThis.fetch=((...args:unknown[])=>{requests.push(args);throw new Error('Document processing must never fetch a linked resource')}) as typeof fetch
 const tools=new PdfUtilities()
 try{
  const doc=openPdf(bytes);try{assert.match(inspect(doc).text,/Original editable line/);assert.ok(render(doc,0,1,1).png.byteLength>0)}finally{doc.destroy()}
  const session=new EditorSession(bytes)
  try{const region=session.view(0,1,1).text.regions.find(region=>region.text==='Original editable line')!;assert.ok(!region.unsupported);session.apply({type:'replace-text',page:0,regionId:region.id,text:'Local only.',font:'Helvetica',size:16,color:'#000000'},1,1);const output=openPdf(session.export());try{assert.match(inspect(output).text,/Local only/)}finally{output.destroy()}}finally{session.dispose()}
  tools.add('source','pdf',bytes.buffer)
  assert.equal(tools.build({kind:'pages',pages:[{sourceId:'source',page:0,rotation:90}]}).pageCount,1)
  assert.deepEqual(requests,[])
 }finally{tools.dispose();globalThis.fetch=originalFetch}
})

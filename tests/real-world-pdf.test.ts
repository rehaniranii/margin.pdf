import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import {openPdf,inspect} from '../src/engine/mupdf-adapter'
import {analyzePage} from '../src/engine/text-analysis'
import {compileTextEdits} from '../src/engine/text-edit'

// Pages shaped like Word / Chrome / Canva / Illustrator exports: effects elsewhere on the page must not lock the text.
function exported(content:string,options:{group?:boolean;layer?:boolean}={}){
 const doc=new mupdf.PDFDocument(),font=new mupdf.Font('Helvetica')
 try{
  const F=doc.addSimpleFont(font)
  const pix=new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB,[0,0,8,8],false);pix.clear(200)
  const image=new mupdf.Image(pix),Im=doc.addImage(image);image.destroy();pix.destroy()
  const Sh=doc.addObject({ShadingType:2,ColorSpace:'DeviceRGB',Coords:[0,0,400,0],Function:{FunctionType:2,Domain:[0,1],C0:[1,0,0],C1:[0,0,1],N:1},Extend:[true,true]})
  const ocg=doc.addObject({Type:'OCG',Name:'Text layer'})
  const resources={Font:{F},XObject:{Im},Shading:{Sh},Properties:{L1:ocg},ExtGState:{Half:{Type:'ExtGState',ca:0.5},Mul:{Type:'ExtGState',BM:'Multiply'}}}
  const page=doc.addPage([0,0,400,500],0,resources,options.layer?`/OC /L1 BDC ${content} EMC`:content)
  if(options.group)page.put('Group',{Type:'Group',S:'Transparency',CS:'DeviceRGB'})
  doc.insertPage(-1,page);page.destroy()
  if(options.layer){const root=doc.getTrailer().get('Root');root.put('OCProperties',{OCGs:[ocg],D:{ON:[ocg]}})}
  const out=doc.saveToBuffer('garbage=4,compress');try{return out.asUint8Array().slice()}finally{out.destroy()}
 }finally{font.destroy();doc.destroy()}
}
const line='BT /F 20 Tf 1 0 0 1 80 360 Tm (Editable line) Tj ET'
const other='BT /F 12 Tf 1 0 0 1 80 300 Tm (Second line) Tj ET'
function regions(bytes:Uint8Array){const doc=openPdf(bytes);try{return analyzePage(doc,0).view}finally{doc.destroy()}}
function assertEditable(bytes:Uint8Array,text='Editable line'){
 const view=regions(bytes),region=view.regions.find(r=>r.text===text)
 assert.ok(region,`missing ${text}`);assert.equal(region.unsupported,undefined,`${text}: ${region.unsupported} / page: ${view.message}`)
 const out=compileTextEdits(bytes,[{type:'replace-text',page:0,regionId:region.id,text:'Changed',font:'Helvetica',size:region.fontSize,color:'#000000'}])
 const doc=openPdf(out);try{const t=inspect(doc).text;assert.match(t,/Changed/);assert.ok(!t.includes(text))}finally{doc.destroy()}
}

for(const [name,content,options] of [
 ['a page-level transparency group (Chrome, Word, Canva)',line,{group:true}],
 ['a full-page clip rectangle',`q 0 0 400 500 re W n ${line} Q`,{}],
 ['a clip rectangle closed by repeating its first point',`q 0 0 m 400 0 l 400 500 l 0 500 l 0 0 l h W n ${line} Q`,{}],
 ['a gradient elsewhere on the page',`q 0 450 400 50 re W n /Sh sh Q ${line}`,{}],
 ['a gradient behind the text',`/Sh sh ${line}`,{}],
 ['an image behind the text',`q 300 0 0 100 50 320 cm /Im Do Q ${line}`,{}],
 ['a blend-mode shape elsewhere',`q /Mul gs 1 0 0 rg 20 20 50 50 re f Q ${line}`,{}],
 ['a semi-transparent shape elsewhere',`q /Half gs 0 0 1 rg 20 20 50 50 re f Q ${line}`,{}],
 ['invisible OCR text elsewhere',`q BT /F 10 Tf 3 Tr 1 0 0 1 80 100 Tm (hidden ocr words) Tj ET Q ${line}`,{}],
 ['optional-content layers',line,{layer:true}],
] as const) test(`text stays editable with ${name}`,()=>assertEditable(exported(content,options)))

test('only the line drawn with an effect is view-only; the rest of the page stays editable',()=>{
 for(const effect of ['/Mul gs','/Half gs']){
  const bytes=exported(`q ${effect} ${line} Q ${other}`)
  const view=regions(bytes)
  assert.match(view.regions.find(r=>r.text==='Editable line')!.unsupported!,/effect/)
  assert.equal(view.message,undefined)
  assertEditable(bytes,'Second line')
 }
})

test('graphics drawn on top of the text still block it',()=>{
 for(const cover of [`q 300 0 0 100 50 320 cm /Im Do Q`,`q 0 340 400 40 re W n /Sh sh Q`,'q BT /F 20 Tf 1 Tr 1 0 0 1 80 362 Tm (Outlined) Tj ET Q']){
  const view=regions(exported(`${line} ${cover} ${other}`))
  assert.ok(view.regions.find(r=>r.text==='Editable line')!.unsupported,cover)
  assert.equal(view.regions.find(r=>r.text==='Second line')!.unsupported,undefined,cover)
 }
})

test('the closest standard font keeps family, weight and slant',async()=>{
 const {closestFont}=await import('../src/model/fonts')
 for(const [name,expected] of [['ABCDEF+Arial-BoldMT','Helvetica-Bold'],['Helvetica','Helvetica'],['TimesNewRomanPS-ItalicMT','Times-Italic'],['Georgia-BoldItalic','Times-BoldItalic'],['SourceSansPro-Semibold','Helvetica-Bold'],['NotoSerif','Times-Roman'],['Consolas','Courier'],['Calibri-Light','Carlito-Regular']] as const) assert.equal(closestFont(name),expected,name)
})

test('a bold replacement font compiles, verifies and is reported back as bold',()=>{
 const bytes=exported(line),doc=openPdf(bytes),region=analyzePage(doc,0).view.regions.find(r=>r.text==='Editable line')!;doc.destroy()
 const out=openPdf(compileTextEdits(bytes,[{type:'replace-text',page:0,regionId:region.id,text:'Bold now',font:'Helvetica-Bold',size:20,color:'#000000'}]))
 try{assert.match(analyzePage(out,0).view.regions.find(r=>r.text==='Bold now')!.fontName,/Bold/)}finally{out.destroy()}
})

// Word/InDesign-style output: every word positioned separately, lines of one paragraph.
const helvetica=new mupdf.Font('Helvetica'),width=(word:string)=>[...word].reduce((sum,c)=>sum+helvetica.advanceGlyph(helvetica.encodeCharacter(c))*12,0)
// Each word is its own text object at its measured position, separated by a normal 3.3 pt space.
const words=(y:number,text:string)=>{let x=80;return text.split(' ').map(word=>{const op=`BT /F 12 Tf 1 0 0 1 ${x.toFixed(2)} ${y} Tm (${word}) Tj ET`;x+=width(word)+3.34;return op}).join(' ')}
const paragraph=[words(400,'The quick brown fox jumps over'),words(385,'the lazy dog while the farmer'),words(370,'watches from the old barn.')].join(' ')

test('words placed one by one are joined into lines, and lines into one paragraph',()=>{
 const view=regions(exported(paragraph))
 assert.equal(view.regions.length,1)
 assert.equal(view.regions[0].text,'The quick brown fox jumps over the lazy dog while the farmer watches from the old barn.')
 assert.equal(view.regions[0].lines,3);assert.equal(view.regions[0].unsupported,undefined)
})

test('a whole paragraph is replaced, wrapped to its width and original line spacing',()=>{
 const bytes=exported(paragraph),region=regions(bytes).regions[0]
 const out=compileTextEdits(bytes,[{type:'replace-text',page:0,regionId:region.id,text:'A brand new paragraph that is long enough to wrap onto a second line.',font:'Helvetica',size:12,color:'#000000'}])
 const doc=openPdf(out)
 try{
  const after=analyzePage(doc,0).view.regions
  assert.equal(after.length,1);assert.equal(after[0].text,'A brand new paragraph that is long enough to wrap onto a second line.')
  assert.ok(after[0].lines!>=2);assert.ok(Math.abs(after[0].lineGap!-15)<0.1)
  assert.doesNotMatch(inspect(doc).text,/fox|farmer|barn/)
 }finally{doc.destroy()}
 assert.throws(()=>compileTextEdits(bytes,[{type:'replace-text',page:0,regionId:region.id,text:'word '.repeat(2000).trim(),font:'Helvetica',size:12,color:'#000000'}]),/room for \d+/)
})

test('lines are not merged across a change of style, a big gap, or an overlapping graphic',()=>{
 const twoStyles=regions(exported(`${words(400,'Heading words here')} BT /F 9 Tf 1 0 0 1 80 385 Tm (smaller caption text) Tj ET`))
 assert.equal(twoStyles.regions.length,2,JSON.stringify(twoStyles.regions.map(r=>[r.text,r.unsupported])))
 const farApart=regions(exported(`${words(400,'First paragraph line')} ${words(340,'Second paragraph line')}`))
 assert.equal(farApart.regions.length,2,JSON.stringify(farApart.regions.map(r=>[r.text,r.unsupported])))
 const covered=regions(exported(`${paragraph} q 0 0 1 rg 70 383 200 3 re f Q`))
 assert.ok(covered.regions.length>1,'a graphic over one line must not lock the others into an uneditable paragraph')
 assert.ok(covered.regions.some(r=>!r.unsupported))
})

test('table cells separated by borders are not merged into one line or paragraph',()=>{
 const cell=(x:number,y:number,t:string)=>`BT /F 12 Tf 1 0 0 1 ${x} ${y} Tm (${t}) Tj ET`
 const grid='q 0 G 0.5 w 75 382 m 75 412 l S 125 382 m 125 412 l S 175 382 m 175 412 l S 75 397 m 175 397 l S Q'
 const view=regions(exported(`${grid} ${cell(80,400,'North')} ${cell(130,400,'1,200')} ${cell(80,385,'South')} ${cell(130,385,'980')}`))
 assert.deepEqual(view.regions.map(r=>r.text).sort(),['1,200','980','North','South'])
})

test('page-list thumbnails render any page small, including applied edits',async()=>{
 const {EditorSession}=await import('../src/engine/editor-session')
 const bytes=exported(line),session=new EditorSession(bytes)
 try{
  const before=session.thumbnail(0,100);assert.equal(before.width,100)
  const region=session.view(0,1,1).text.regions.find(r=>r.text==='Editable line')!
  session.apply({type:'replace-text',page:0,regionId:region.id,text:'Changed',font:'Helvetica',size:20,color:'#000000'},1,1)
  const after=session.thumbnail(0,100)
  assert.notDeepEqual(new Uint8Array(after.png),new Uint8Array(before.png),'thumbnail must show the edited page')
  assert.throws(()=>session.thumbnail(5,100),/existing page/)
 }finally{session.dispose()}
})

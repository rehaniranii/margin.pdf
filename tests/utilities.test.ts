import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import { PdfUtilities } from '../src/engine/pdf-utilities'
import { pdfFeatures } from '../src/engine/pdf-features'
import { createSample, ORIGINAL_TEXT } from '../src/engine/sample'
import { openPdf, inspect, render } from '../src/engine/mupdf-adapter'
import { parsePages } from '../src/utilities/page-ranges'
import { fixture } from './fixtures'
import type { PlannedPage, Stamp } from '../src/model/utilities'

const entry=(sourceId:string,page=0,rotation:PlannedPage['rotation']=0):PlannedPage=>({sourceId,page,rotation})
function using<T>(bytes:ArrayBuffer|Uint8Array,fn:(doc:mupdf.PDFDocument)=>T) {const doc=openPdf(bytes);try{return fn(doc)}finally{doc.destroy()}}
function saved(doc:mupdf.PDFDocument) {const b=doc.saveToBuffer('garbage=4,compress');try{return b.asUint8Array().slice()}finally{b.destroy()}}
function imageBytes(format:'png'|'jpeg') {
 const pix=new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB,[0,0,20,10],false)
 try {const p=pix.getPixels();for(let i=0;i<p.length;i+=3){p[i]=220;p[i+1]=20;p[i+2]=30}return (format==='png'?pix.asPNG():pix.asJPEG(90)).slice().buffer}finally{pix.destroy()}
}

test('page range validation preserves deliberate order and rejects invalid/duplicate/empty ranges',()=>{
 assert.deepEqual(parsePages('3, 1-2, 5',5),[2,0,1,4])
 for(const value of ['', '0','6','2-1','1,','1,1','1-3,2','1.5','-1','1-9007199254740999','all'])assert.throws(()=>parsePages(value,5))
})

test('merge/reorder/extract keep source text and source bytes; output has no catalog bookmarks or links',()=>{
 const tools=new PdfUtilities(),source=createSample(),original=source.slice(),other=fixture({annotation:'Link'})
 try {
  tools.add('sample','pdf',source.buffer);tools.add('other','pdf',other.buffer)
  const result=tools.build({kind:'pages',pages:[entry('sample',1),entry('other'),entry('sample')],acceptFlattening:true})
  assert.equal(result.pageCount,3)
  using(result.bytes,doc=>{
   assert.match(inspect(doc,0).text,/Space for what comes next/);assert.match(inspect(doc,1).text,/Original editable line/);assert.match(inspect(doc,2).text,/Make room for a better idea/)
   assert.equal(pdfFeatures(doc).links,0);assert.equal(doc.loadOutline(),null)
  })
  assert.deepEqual(source,original)
  const extracted=tools.build({kind:'pages',pages:[entry('sample',1)],acceptFlattening:true})
  assert.equal(extracted.pageCount,1);assert.match(using(extracted.bytes,doc=>inspect(doc).text),/Space for what comes next/)
  assert.throws(()=>tools.build({kind:'pages',pages:[],acceptFlattening:true}),/at least one/)
  assert.throws(()=>tools.build({kind:'pages',pages:[entry('sample',2)],acceptFlattening:true}),/invalid/)
  assert.throws(()=>tools.build({kind:'pages',pages:[entry('sample')],acceptFlattening:false}),/accept/)
 }finally{tools.dispose()}
})

for(const rotation of [0,90,180,270] as const) test(`grafting preserves crop, intrinsic rotation ${rotation}, UserUnit and appearance; rotate adds 90`,()=>{
 const tools=new PdfUtilities(),source=fixture({rotation,crop:[40,70,360,450],userUnit:2})
 try{
  tools.add('source','pdf',source.buffer)
  const result=tools.build({kind:'pages',pages:[entry('source')],acceptFlattening:true})
  using(source,original=>using(result.bytes,output=>{
   assert.deepEqual(inspect(output).bounds,inspect(original).bounds)
   assert.deepEqual(new Uint8Array(render(output,0,.6,1).png),new Uint8Array(render(original,0,.6,1).png))
  }))
  const turned=tools.build({kind:'pages',pages:[entry('source',0,90)],acceptFlattening:true})
  using(turned.bytes,doc=>{const bounds=inspect(doc).bounds;const before=using(source,doc=>inspect(doc).bounds);assert.equal(bounds[2],before[3]);assert.equal(bounds[3],before[2]);assert.match(inspect(doc).text,/Original editable line/)})
 }finally{tools.dispose()}
})

test('page numbers/watermarks are searchable, correctly positioned and fit-validated on cropped rotated pages',()=>{
 const tools=new PdfUtilities();tools.add('sample','pdf',createSample().buffer)
 const stamp:Stamp={kind:'numbers',text:'Page {n} of {total}',start:7,size:12,color:'#123456',opacity:1,position:'bottom',pages:[0,1]}
 try{
  const result=tools.build({kind:'pages',pages:[entry('sample'),entry('sample',1)],acceptFlattening:true,stamp})
  using(result.bytes,doc=>{assert.match(inspect(doc,0).text,/Page 7 of 2/);assert.match(inspect(doc,1).text,/Page 8 of 2/);assert.match(inspect(doc).text,new RegExp(ORIGINAL_TEXT.replace('.','\\.')))})
  tools.add('rotated','pdf',fixture({rotation:90,crop:[40,70,360,450],userUnit:2}).buffer)
  const marked=tools.build({kind:'pages',pages:[entry('rotated')],acceptFlattening:true,stamp:{...stamp,kind:'watermark',text:'LOCAL COPY',position:'center',opacity:.2,pages:[0]}})
  using(marked.bytes,doc=>{const page=doc.loadPage(0),text=page.toStructuredText('');try{assert.equal(page.search('LOCAL COPY',{}).length,1);let origin:number[]=[];text.walk({onChar(c,o){if(c==='L'&&!origin.length)origin=o}});assert.ok(origin[0]>0&&origin[0]<760);assert.match(text.asText(),/Nearby content stays/)}finally{text.destroy();page.destroy()}})
  assert.throws(()=>tools.build({kind:'pages',pages:[entry('sample')],acceptFlattening:true,stamp:{...stamp,pages:[0],text:'\u4e2d'}}),/basic Latin/)
  assert.throws(()=>tools.build({kind:'pages',pages:[entry('sample')],acceptFlattening:true,stamp:{...stamp,pages:[0],text:'long '.repeat(100)}}),/does not fit/)
 }finally{tools.dispose()}
})

test('JPG/PNG to PDF respects order, aspect and paper/margin; page export reports actual bounded resolution',()=>{
 const tools=new PdfUtilities();tools.add('png','image',imageBytes('png'));tools.add('jpg','image',imageBytes('jpeg'))
 try{
  const fit=tools.build({kind:'images',sources:['jpg','png'],paper:'fit',margin:5})
  assert.equal(fit.pageCount,2);assert.deepEqual(using(fit.bytes,doc=>inspect(doc).bounds),[0,0,30,20])
  const a4=tools.build({kind:'images',sources:['png'],paper:'a4',margin:24})
  assert.ok(Math.abs(using(a4.bytes,doc=>inspect(doc).bounds)[2]-595.276)<.001)
  tools.add('pdf','pdf',fit.bytes.slice(0))
  for(const format of ['png','jpeg'] as const){const exported=tools.exportImage('pdf',1,format,144);assert.equal(exported.width,60);assert.equal(exported.height,40);assert.equal(exported.actualDpi,144);const image=new mupdf.Image(exported.bytes);try{assert.equal(image.getWidth(),60)}finally{image.destroy()}}
  const huge=fixture({crop:[0,0,400,500],userUnit:30});tools.add('huge','pdf',huge.buffer)
  const limited=tools.exportImage('huge',0,'png',300);assert.ok(limited.width<=4096&&limited.height<=4096);assert.ok(limited.width*limited.height<=8_010_000);assert.ok(limited.actualDpi<300)
  assert.throws(()=>tools.exportImage('pdf',2,'png',144),/existing/)
  assert.throws(()=>tools.exportImage('pdf',0,'png',301),/resolution/)
 }finally{tools.dispose()}
})

test('signatures detected including detached dictionary and inherited signature field; flattening notice gates output',()=>{
 const doc=openPdf(fixture({annotation:'Link'})),tools=new PdfUtilities()
 try{
  const sig=doc.addObject({Type:'Sig',ByteRange:[0,10,20,30],Contents:'test certificate placeholder'}),parent=doc.addObject({FT:'Sig',V:sig}),widget=doc.addObject({Type:'Annot',Subtype:'Widget',Parent:parent,Rect:[10,10,40,30]}),root=doc.getTrailer().get('Root'),page=doc.findPage(0)
  try{root.put('AcroForm',{Fields:[parent]});parent.put('Kids',[widget]);const annots=page.get('Annots');try{annots.push(widget)}finally{annots.destroy()}
   assert.equal(pdfFeatures(doc).signed,true);assert.equal(pdfFeatures(doc).widgets,1);assert.equal(pdfFeatures(doc).links,1)
   const source=saved(doc);const info=tools.add('signed','pdf',source.buffer);assert.equal(info.features?.signed,true)
   const out=tools.build({kind:'pages',pages:[entry('signed')],acceptFlattening:true});using(out.bytes,result=>{const features=pdfFeatures(result);assert.equal(features.signed,false);assert.equal(features.links,0);assert.equal(features.widgets,0)})
  }finally{sig.destroy();parent.destroy();widget.destroy();root.destroy();page.destroy()}
 }finally{tools.dispose();doc.destroy()}
})

test('annotation and form appearances are baked into vector page content; interactions removed',()=>{
 const doc=openPdf(fixture()),tools=new PdfUtilities()
 try {
  const page=doc.loadPage(0),annot=page.createAnnotation('Square');annot.setRect([20,20,60,60]);annot.setColor([1,0,0]);annot.setBorderWidth(2);annot.update();annot.destroy();page.destroy()
  const ap=doc.addStream('0 0 1 rg 0 0 40 20 re f',{Type:'XObject',Subtype:'Form',BBox:[0,0,40,20],Resources:{}}),widget=doc.addObject({Type:'Annot',Subtype:'Widget',FT:'Tx',T:'Name',V:'Example',Rect:[80,400,120,420],AP:{N:ap}}),root=doc.getTrailer().get('Root'),po=doc.findPage(0),arr=po.get('Annots')
  try{arr.push(widget);root.put('AcroForm',{Fields:[widget]})}finally{arr.destroy();po.destroy();root.destroy();widget.destroy();ap.destroy()}
  const source=saved(doc);tools.add('source','pdf',source.buffer)
  const result=tools.build({kind:'pages',pages:[entry('source')],acceptFlattening:true})
  using(source,original=>using(result.bytes,output=>{assert.deepEqual(new Uint8Array(render(output,0,1,1).png),new Uint8Array(render(original,0,1,1).png));const features=pdfFeatures(output);assert.equal(features.annotations,0);assert.equal(features.widgets,0);assert.match(inspect(output).text,/Original editable line/)}))
 }finally{tools.dispose();doc.destroy()}
})

test('optional-content documents are rejected rather than silently changing layer visibility',()=>{
 const doc=openPdf(fixture()),tools=new PdfUtilities()
 try{const root=doc.getTrailer().get('Root');root.put('OCProperties',{OCGs:[]});root.destroy();const bytes=saved(doc);tools.add('layered','pdf',bytes.buffer);assert.throws(()=>tools.build({kind:'pages',pages:[entry('layered')],acceptFlattening:true}),/layers/)}finally{tools.dispose();doc.destroy()}
})

test('document bookmarks are detected then omitted; XFA is explicitly unsupported',()=>{
 const doc=openPdf(fixture()),tools=new PdfUtilities()
 try{const trailer=doc.getTrailer(),root=trailer.get('Root'),outlines=doc.addObject({Type:'Outlines',Count:0});try{root.put('Outlines',outlines);assert.equal(pdfFeatures(doc).bookmarks,true);const bytes=saved(doc);tools.add('bookmarked','pdf',bytes.buffer);const result=tools.build({kind:'pages',pages:[entry('bookmarked')],acceptFlattening:true});assert.equal(using(result.bytes,d=>pdfFeatures(d).bookmarks),false);const xfaValue=doc.newString('unsupported dynamic form');try{root.put('AcroForm',{XFA:xfaValue})}finally{xfaValue.destroy()};const xfa=saved(doc);const info=tools.add('xfa','pdf',xfa.buffer);assert.equal(info.features?.xfa,true);assert.throws(()=>tools.build({kind:'pages',pages:[entry('xfa')],acceptFlattening:true}),/XFA/)}finally{outlines.destroy();root.destroy();trailer.destroy()}}finally{doc.destroy();tools.dispose()}
})

test('page copying retains a transparency group and searchable committed source edits',async()=>{
 const {EditorSession}=await import('../src/engine/editor-session')
 const source=fixture(),session=new EditorSession(source),tools=new PdfUtilities()
 try{const region=session.view(0,1,1).text.regions.find(r=>r.text==='Original editable line')!;session.apply({type:'replace-text',page:0,regionId:region.id,text:'Changed first.',font:'Helvetica',size:18,color:'#000000'},1,1);const current=session.export();using(current,doc=>{const page=doc.findPage(0);page.put('Group',{Type:'Group',S:'Transparency',CS:'DeviceRGB',I:true});page.destroy();const grouped=saved(doc);tools.add('edited','pdf',grouped.buffer);const result=tools.build({kind:'pages',pages:[entry('edited')],acceptFlattening:true});using(grouped,original=>using(result.bytes,output=>{assert.deepEqual(new Uint8Array(render(output,0,1,1).png),new Uint8Array(render(original,0,1,1).png));assert.match(inspect(output).text,/Changed first/);assert.ok(!inspect(output).text.includes('Original editable line'));const p=output.findPage(0),g=p.get('Group');try{assert.ok(g.isDictionary())}finally{g.destroy();p.destroy()}}))})}finally{tools.dispose();session.dispose()}
})

import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import { PdfUtilities } from '../src/engine/pdf-utilities'
import { pdfFeatures } from '../src/engine/pdf-features'
import { createSample, ORIGINAL_TEXT } from '../src/engine/sample'
import { openPdf, inspect, render } from '../src/engine/mupdf-adapter'
import { parsePages } from '../src/utilities/page-ranges'
import { actionFixture, fixture, formFixture } from './fixtures'
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
  const result=tools.build({kind:'pages',pages:[entry('sample',1),entry('other'),entry('sample')]})
  assert.equal(result.pageCount,3)
  using(result.bytes,doc=>{
   assert.match(inspect(doc,0).text,/Space for what comes next/);assert.match(inspect(doc,1).text,/Original editable line/);assert.match(inspect(doc,2).text,/Make room for a better idea/)
   assert.equal(pdfFeatures(doc).links,0);assert.equal(doc.loadOutline(),null)
  })
  assert.deepEqual(source,original)
  const extracted=tools.build({kind:'pages',pages:[entry('sample',1)]})
  assert.equal(extracted.pageCount,1);assert.match(using(extracted.bytes,doc=>inspect(doc).text),/Space for what comes next/)
  assert.throws(()=>tools.build({kind:'pages',pages:[]}),/at least one/)
  assert.throws(()=>tools.build({kind:'pages',pages:[entry('sample',2)]}),/invalid/)
 }finally{tools.dispose()}
})

for(const rotation of [0,90,180,270] as const) test(`grafting preserves crop, intrinsic rotation ${rotation}, UserUnit and appearance; rotate adds 90`,()=>{
 const tools=new PdfUtilities(),source=fixture({rotation,crop:[40,70,360,450],userUnit:2})
 try{
  tools.add('source','pdf',source.buffer)
  const result=tools.build({kind:'pages',pages:[entry('source')]})
  using(source,original=>using(result.bytes,output=>{
   assert.deepEqual(inspect(output).bounds,inspect(original).bounds)
   assert.deepEqual(new Uint8Array(render(output,0,.6,1).png),new Uint8Array(render(original,0,.6,1).png))
  }))
  const turned=tools.build({kind:'pages',pages:[entry('source',0,90)]})
  using(turned.bytes,doc=>{const bounds=inspect(doc).bounds;const before=using(source,doc=>inspect(doc).bounds);assert.equal(bounds[2],before[3]);assert.equal(bounds[3],before[2]);assert.match(inspect(doc).text,/Original editable line/)})
 }finally{tools.dispose()}
})

test('page numbers/watermarks are searchable, correctly positioned and fit-validated on cropped rotated pages',()=>{
 const tools=new PdfUtilities();tools.add('sample','pdf',createSample().buffer)
 const stamp:Stamp={kind:'numbers',text:'Page {n} of {total}',start:7,size:12,color:'#123456',opacity:1,position:'bottom',pages:[0,1]}
 try{
  const result=tools.build({kind:'pages',pages:[entry('sample'),entry('sample',1)],stamp})
  using(result.bytes,doc=>{assert.match(inspect(doc,0).text,/Page 7 of 2/);assert.match(inspect(doc,1).text,/Page 8 of 2/);assert.match(inspect(doc).text,new RegExp(ORIGINAL_TEXT.replace('.','\\.')))})
  tools.add('rotated','pdf',fixture({rotation:90,crop:[40,70,360,450],userUnit:2}).buffer)
  const marked=tools.build({kind:'pages',pages:[entry('rotated')],stamp:{...stamp,kind:'watermark',text:'LOCAL COPY',position:'center',opacity:.2,pages:[0]}})
  using(marked.bytes,doc=>{const page=doc.loadPage(0),text=page.toStructuredText('');try{assert.equal(page.search('LOCAL COPY',{}).length,1);let origin:number[]=[];text.walk({onChar(c,o){if(c==='L'&&!origin.length)origin=o}});assert.ok(origin[0]>0&&origin[0]<760);assert.match(text.asText(),/Nearby content stays/)}finally{text.destroy();page.destroy()}})
  assert.throws(()=>tools.build({kind:'pages',pages:[entry('sample')],stamp:{...stamp,pages:[0],text:'\u4e2d'}}),/Latin text/)
  assert.throws(()=>tools.build({kind:'pages',pages:[entry('sample')],stamp:{...stamp,pages:[0],text:'long '.repeat(100)}}),/does not fit/)
 }finally{tools.dispose()}
})

test('JPG/PNG to PDF respects order, aspect and paper/margin; page export reports actual bounded resolution',()=>{
 const tools=new PdfUtilities();tools.add('png','image',imageBytes('png'));tools.add('jpg','image',imageBytes('jpeg'))
 try{
  const fit=tools.build({kind:'images',sources:['jpg','png'],paper:'fit',margin:5})
  assert.equal(fit.pageCount,2);assert.deepEqual(using(fit.bytes,doc=>inspect(doc).bounds),[0,0,30,20])
  const a4=tools.build({kind:'images',sources:['png'],paper:'a4',margin:0})
  // The 20×10 image is landscape: landscape A4, covered edge to edge (every corner is image red, not white).
  using(a4.bytes,doc=>{assert.ok(Math.abs(inspect(doc).bounds[2]-841.89)<.001);const pix=doc.loadPage(0).toPixmap(mupdf.Matrix.scale(.2,.2),mupdf.ColorSpace.DeviceRGB,false,true);try{const p=pix.getPixels(),w=pix.getWidth(),h=pix.getHeight();for(const [x,y] of [[1,1],[w-2,1],[1,h-2],[w-2,h-2]]){const i=(y*w+x)*3;assert.ok(p[i]>180&&p[i+1]<80,`corner ${x},${y} is filled`)}}finally{pix.destroy()}})
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
   const out=tools.build({kind:'pages',pages:[entry('signed')]});using(out.bytes,result=>{const features=pdfFeatures(result);assert.equal(features.signed,false);assert.equal(features.links,0);assert.equal(features.widgets,0)})
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
  const result=tools.build({kind:'pages',pages:[entry('source')]})
  using(source,original=>using(result.bytes,output=>{assert.deepEqual(new Uint8Array(render(output,0,1,1).png),new Uint8Array(render(original,0,1,1).png));const features=pdfFeatures(output);assert.equal(features.annotations,0);assert.equal(features.widgets,0);assert.match(inspect(output).text,/Original editable line/)}))
 }finally{tools.dispose();doc.destroy()}
})

test('optional-content documents are rejected rather than silently changing layer visibility',()=>{
 const doc=openPdf(fixture()),tools=new PdfUtilities()
 try{const root=doc.getTrailer().get('Root');root.put('OCProperties',{OCGs:[]});root.destroy();const bytes=saved(doc);tools.add('layered','pdf',bytes.buffer);assert.throws(()=>tools.build({kind:'pages',pages:[entry('layered')]}),/layers/)}finally{tools.dispose();doc.destroy()}
})

test('document bookmarks are detected then omitted; XFA is explicitly unsupported',()=>{
 const doc=openPdf(fixture()),tools=new PdfUtilities()
 try{const trailer=doc.getTrailer(),root=trailer.get('Root'),outlines=doc.addObject({Type:'Outlines',Count:0});try{root.put('Outlines',outlines);assert.equal(pdfFeatures(doc).bookmarks,true);const bytes=saved(doc);tools.add('bookmarked','pdf',bytes.buffer);const result=tools.build({kind:'pages',pages:[entry('bookmarked')]});assert.equal(using(result.bytes,d=>pdfFeatures(d).bookmarks),false);const xfaValue=doc.newString('unsupported dynamic form');try{root.put('AcroForm',{XFA:xfaValue})}finally{xfaValue.destroy()};const xfa=saved(doc);const info=tools.add('xfa','pdf',xfa.buffer);assert.equal(info.features?.xfa,true);assert.throws(()=>tools.build({kind:'pages',pages:[entry('xfa')]}),/XFA/)}finally{outlines.destroy();root.destroy();trailer.destroy()}}finally{doc.destroy();tools.dispose()}
})

test('page copying retains a transparency group and searchable committed source edits',async()=>{
 const {EditorSession}=await import('../src/engine/editor-session')
 const source=fixture(),session=new EditorSession(source),tools=new PdfUtilities()
 try{const region=session.view(0,1,1).text.regions.find(r=>r.text==='Original editable line')!;session.apply({type:'replace-text',page:0,regionId:region.id,text:'Changed first.',font:'Helvetica',size:18,color:'#000000'},1,1);const current=session.export();using(current,doc=>{const page=doc.findPage(0);page.put('Group',{Type:'Group',S:'Transparency',CS:'DeviceRGB',I:true});page.destroy();const grouped=saved(doc);tools.add('edited','pdf',grouped.buffer);const result=tools.build({kind:'pages',pages:[entry('edited')]});using(grouped,original=>using(result.bytes,output=>{assert.deepEqual(new Uint8Array(render(output,0,1,1).png),new Uint8Array(render(original,0,1,1).png));assert.match(inspect(output).text,/Changed first/);assert.ok(!inspect(output).text.includes('Original editable line'));const p=output.findPage(0),g=p.get('Group');try{assert.ok(g.isDictionary())}finally{g.destroy();p.destroy()}}))})}finally{tools.dispose();session.dispose()}
})

test('protect encrypts with a verified password; unlock needs it and removes encryption; other tools refuse locked files',()=>{
 const tools=new PdfUtilities()
 try{
  tools.add('sample','pdf',createSample().buffer)
  assert.throws(()=>tools.build({kind:'protect',source:'sample',password:'a,b,c,d'}),/without commas/)
  assert.throws(()=>tools.build({kind:'protect',source:'sample',password:'abc'}),/4 to 127/)
  const locked=tools.build({kind:'protect',source:'sample',password:'s3cret=ok'})
  const raw=new mupdf.PDFDocument(locked.bytes);try{assert.ok(raw.needsPassword());assert.ok(!raw.authenticatePassword('wrong'));assert.ok(raw.authenticatePassword('s3cret=ok'))}finally{raw.destroy()}
  assert.throws(()=>openPdf(locked.bytes),/Unlock tool/)
  const info=tools.add('locked','pdf',locked.bytes.slice(0));assert.equal(info.locked,true)
  assert.throws(()=>tools.build({kind:'compress',source:'locked',level:'lossless'}),/Unlock tool/)
  assert.throws(()=>tools.build({kind:'unlock',source:'locked',password:'wrong'}),/not correct/)
  const open=tools.build({kind:'unlock',source:'locked',password:'s3cret=ok'})
  assert.equal(open.pageCount,2);assert.match(using(open.bytes,doc=>inspect(doc).text),new RegExp(ORIGINAL_TEXT.replace('.','\\.')))
 }finally{tools.dispose()}
})

test('remove hidden data strips metadata, scripts, actions, attachments, links and bookmarks, and verifies the saved file',()=>{
 const doc=new mupdf.PDFDocument(actionFixture());doc.setMetaData('info:Author','MARGIN_PRIVATE_AUTHOR');doc.addEmbeddedFile('secret.txt','text/plain',new mupdf.Buffer('MARGIN_PRIVATE_ATTACHMENT'),new Date(),new Date())
 const bytes=saved(doc);doc.destroy()
 const tools=new PdfUtilities()
 try{
  tools.add('dirty','pdf',bytes.buffer)
  const result=tools.build({kind:'sanitize',source:'dirty'})
  const text=new TextDecoder('latin1').decode(using(result.bytes,doc=>{const b=doc.saveToBuffer('decompress');try{return b.asUint8Array().slice()}finally{b.destroy()}}))
  for(const leak of ['MARGIN_PRIVATE_AUTHOR','MARGIN_PRIVATE_ATTACHMENT','linked.invalid','JavaScript','OpenAction'])assert.ok(!text.includes(leak),leak)
  assert.match(using(result.bytes,doc=>inspect(doc).text),/MARGIN_PRIVATE_CANARY extracted content/)
  using(result.bytes,doc=>{const f=pdfFeatures(doc);assert.equal(f.links+f.annotations+f.widgets,0);assert.equal(doc.getMetaData('info:Author'),undefined)})
 }finally{tools.dispose()}
})

test('blank and duplicate pages; crop trims the on-screen side for every rotation',()=>{
 const tools=new PdfUtilities()
 try{
  tools.add('sample','pdf',createSample().buffer)
  const result=tools.build({kind:'pages',pages:[entry('sample'),{...entry('sample'),blank:true},entry('sample')]})
  assert.equal(result.pageCount,3);using(result.bytes,doc=>{assert.equal(inspect(doc,1).text.trim(),'');assert.deepEqual(inspect(doc,1).bounds,inspect(doc,0).bounds);assert.equal(inspect(doc,2).text,inspect(doc,0).text)})
  for(const rotation of [0,90,180,270] as const){
   const id=`r${rotation}`;tools.add(id,'pdf',fixture({rotation,userUnit:2}).buffer)
   const firstChar=(bytes:ArrayBuffer)=>using(bytes,doc=>{const page=doc.loadPage(0),text=page.toStructuredText('');try{let o:number[]=[];text.walk({onChar(c,origin){if(c==='O'&&!o.length)o=origin}});const b=page.getBounds();return {x:o[0]-b[0],y:o[1]-b[1],w:b[2]-b[0],h:b[3]-b[1]}}finally{text.destroy();page.destroy()}})
   const plain=firstChar(tools.build({kind:'pages',pages:[entry(id)]}).bytes)
   const top=firstChar(tools.build({kind:'pages',pages:[entry(id)],crop:{top:40,right:0,bottom:0,left:30,pages:[0]}}).bytes)
   assert.ok(Math.abs(plain.h-top.h-40)<.01&&Math.abs(plain.w-top.w-30)<.01,`size ${rotation}`)
   assert.ok(Math.abs(plain.y-top.y-40)<.01&&Math.abs(plain.x-top.x-30)<.01,`side ${rotation}`)
  }
  assert.throws(()=>tools.build({kind:'pages',pages:[entry('sample')],crop:{top:5000,right:0,bottom:0,left:0,pages:[0]}}),/half an inch/)
 }finally{tools.dispose()}
})

test('fill and sign lists fields, fills text/checkbox/choice/radio, verifies, places typed or image signatures, and can flatten',()=>{
 const tools=new PdfUtilities()
 try{
  const info=tools.add('form','pdf',formFixture().buffer)
  assert.deepEqual(info.fields!.map(f=>[f.name,f.type,f.options.join('/')]),[['name','text',''],['agree','checkbox','Yes'],['country','choice','India/Norway'],['size','radio','S/L']])
  const values={name:'Asha Rao',agree:'Yes',country:'Norway',size:'L'}
  const filled=tools.build({kind:'fill',source:'form',values,flatten:false,signature:{page:1,box:[.1,.7,.5,.1],text:'Asha Rao'}})
  tools.add('filled','pdf',filled.bytes.slice(0))
  const back=Object.fromEntries(tools.add('again','pdf',filled.bytes.slice(0)).fields!.map(f=>[f.name,f.value]))
  assert.deepEqual(back,values)
  using(filled.bytes,doc=>{const text=inspect(doc,1).text;assert.match(text,/Asha Rao/);const page=doc.loadPage(1);try{const hit=page.search('Asha Rao',{})[0][0];const b=page.getBounds();assert.ok(hit[1]>b[1]+.65*(b[3]-b[1])&&hit[7]<b[1]+.82*(b[3]-b[1]),'signature lands inside its box')}finally{page.destroy()}})
  const untick=tools.build({kind:'fill',source:'filled',values:{agree:'Off'},flatten:false})
  assert.equal(tools.add('u','pdf',untick.bytes.slice(0)).fields!.find(f=>f.name==='agree')!.value,'Off')
  tools.add('ink','image',imageBytes('png'))
  const flat=tools.build({kind:'fill',source:'form',values:{name:'Flat Value'},flatten:true,signature:{page:0,box:[.5,.05,.4,.1],image:'ink'}})
  using(flat.bytes,doc=>{assert.equal(pdfFeatures(doc).widgets,0);assert.match(inspect(doc).text,/Flat Value/)})
  assert.throws(()=>tools.build({kind:'fill',source:'form',values:{country:'Mars'},flatten:false}),/not an option/)
  assert.throws(()=>tools.build({kind:'fill',source:'form',values:{nope:'x'},flatten:false}),/no field/)
  assert.throws(()=>tools.build({kind:'fill',source:'form',values:{},flatten:false,signature:{page:0,box:[.8,.1,.5,.1],text:'X'}}),/inside the page/)
 }finally{tools.dispose()}
})

test('watermarks and typed signatures accept accented Latin and stay searchable',()=>{
 const tools=new PdfUtilities();tools.add('sample','pdf',createSample().buffer)
 try{
  const marked=tools.build({kind:'pages',pages:[entry('sample')],stamp:{kind:'watermark',text:'BROUILLON – Café',size:30,color:'#667085',opacity:.3,position:'center',start:1,pages:[0]}})
  assert.match(using(marked.bytes,doc=>inspect(doc).text),/BROUILLON – Café/)
  const signed=tools.build({kind:'fill',source:'sample',values:{},flatten:false,signature:{page:0,box:[.1,.8,.5,.1],text:'Zoë Müller'}})
  assert.match(using(signed.bytes,doc=>inspect(doc).text),/Zoë Müller/)
  assert.throws(()=>tools.build({kind:'fill',source:'sample',values:{},flatten:false,signature:{page:0,box:[.1,.8,.5,.1],text:'Łukasz'}}),/accents/)
 }finally{tools.dispose()}
})

test('typed signatures use the chosen standard font and size, and reject text that does not fit its box',()=>{
 const tools=new PdfUtilities();tools.add('sample','pdf',createSample().buffer)
 try{
  const signed=tools.build({kind:'fill',source:'sample',values:{},flatten:false,signature:{page:0,box:[.1,.7,.6,.2],text:'Zoë Rao',font:'Courier-Bold',size:30}})
  using(signed.bytes,doc=>{const page=doc.loadPage(0),text=page.toStructuredText('');try{let found:{font:string,size:number}|undefined;text.walk({onChar(c,_o,font,size){if(c==='Z'&&!found)found={font:font.getName(),size}}});assert.match(found!.font,/Courier.*Bold|Bold.*Courier|NimbusMonoPS-Bold/i);assert.ok(Math.abs(found!.size-30)<.01)}finally{text.destroy();page.destroy()}})
  assert.throws(()=>tools.build({kind:'fill',source:'sample',values:{},flatten:false,signature:{page:0,box:[.1,.7,.2,.05],text:'A much longer signature',size:40}}),/does not fit/)
  assert.throws(()=>tools.build({kind:'fill',source:'sample',values:{},flatten:false,signature:{page:0,box:[.1,.7,.6,.2],text:'Ok',font:'Comic-Sans' as never}}),/available font/)
  const tall=tools.build({kind:'fill',source:'sample',values:{},flatten:false,signature:{page:0,box:[.1,.3,.15,.5],text:'Ok'}})
  assert.match(using(tall.bytes,doc=>inspect(doc).text),/Ok/)
 }finally{tools.dispose()}
})

test('handwriting signature fonts are embedded as a small subset and keep the text searchable',()=>{
 const tools=new PdfUtilities(),source=createSample();tools.add('sample','pdf',source.buffer)
 try{
  assert.throws(()=>tools.build({kind:'fill',source:'sample',values:{},flatten:false,signature:{page:0,box:[.1,.7,.6,.15],text:'Zoë',font:'Dancing Script'}}),/not loaded/)
  for(const [name,file] of [['Dancing Script','DancingScript.ttf'],['Great Vibes','GreatVibes-Regular.ttf']] as const){
   const bytes=readFileSync(`src/assets/fonts/${file}`);tools.addFont(name,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))
   const signed=tools.build({kind:'fill',source:'sample',values:{},flatten:false,signature:{page:0,box:[.1,.7,.6,.15],text:'Zoë Müller – “OK”',font:name}})
   assert.match(using(signed.bytes,doc=>inspect(doc).text),/Zoë Müller – “OK”/)
   assert.ok(signed.bytes.byteLength-source.byteLength<25_000,`${name} adds ${signed.bytes.byteLength-source.byteLength} bytes; the font must be subset`)
   using(signed.bytes,doc=>{let embedded=false;for(let i=1;i<doc.countObjects();i++){const o=doc.newIndirect(i).resolve();if(o.isDictionary()&&!o.get('FontFile2').isNull())embedded=true}assert.ok(embedded,`${name} is embedded`)})
  }
  assert.throws(()=>tools.addFont('Comic Sans',new ArrayBuffer(4)),/Unknown/)
 }finally{tools.dispose()}
})

test('watermark angles (diagonal corner to corner, custom, vertical), corner positions, tiling and fonts',()=>{
 const tools=new PdfUtilities();tools.add('sample','pdf',createSample().buffer)
 const base:Stamp={kind:'watermark',text:'CONFIDENTIAL',size:40,color:'#cc0000',opacity:.3,position:'center',start:1,pages:[0]}
 // Direction (degrees, counter-clockwise on screen), centre and font of the stamp's line, plus how often it appears.
 const measure=(stamp:Stamp)=>using(tools.build({kind:'pages',pages:[entry('sample')],stamp}).bytes,doc=>{
  const page=doc.loadPage(0),text=page.toStructuredText(''),b=page.getBounds()
  try{let found:{deg:number,cx:number,cy:number,font:string}|undefined;let line:{dir:number[],bbox:number[]}|undefined
   text.walk({beginLine(bbox,_w,dir){line={dir,bbox}},onChar(c,_o,font){if(c==='C'&&!found&&line)found={deg:Math.atan2(-line.dir[1],line.dir[0])*180/Math.PI,cx:(line.bbox[0]+line.bbox[2])/2-b[0],cy:(line.bbox[1]+line.bbox[3])/2-b[1],font:font.getName()}}})
   return {...found!,count:page.search('CONFIDENTIAL',{}).length,w:b[2]-b[0],h:b[3]-b[1]}}finally{text.destroy();page.destroy()}})
 try{
  const diagonal=measure({...base,angle:'diagonal'})
  assert.ok(Math.abs(diagonal.deg-Math.atan2(diagonal.h,diagonal.w)*180/Math.PI)<0.5,`diagonal runs corner to corner: ${diagonal.deg}`)
  assert.ok(Math.abs(diagonal.cx-diagonal.w/2)<2&&Math.abs(diagonal.cy-diagonal.h/2)<2,'centred')
  assert.ok(Math.abs(measure({...base,angle:'diagonal-down'}).deg+Math.atan2(diagonal.h,diagonal.w)*180/Math.PI)<0.5)
  assert.ok(Math.abs(measure({...base,angle:30}).deg-30)<0.5)
  assert.ok(Math.abs(measure({...base,angle:90,size:30}).deg-90)<0.5)
  const corner=measure({...base,size:20,position:'top-right',font:'Times-Bold'})
  assert.ok(corner.cx>corner.w*0.6&&corner.cy<corner.h*0.15,`top right: ${corner.cx},${corner.cy}`);assert.match(corner.font,/Times.*Bold|Bold.*Times|NimbusRoman-Bold/i)
  const bottomLeft=measure({...base,size:20,position:'bottom-left',angle:'diagonal'})
  assert.ok(bottomLeft.cx<bottomLeft.w*0.4&&bottomLeft.cy>bottomLeft.h*0.75,`bottom left: ${bottomLeft.cx},${bottomLeft.cy}`)
  assert.ok(measure({...base,size:24,tile:true,angle:'diagonal'}).count>=6,'tiled across the page')
  assert.throws(()=>measure({...base,size:144}),/does not fit/)
  assert.ok(measure({...base,size:144,tile:true}).count>=1,'tiling clips instead of rejecting')
  assert.throws(()=>measure({...base,angle:120}),/angle/)
 }finally{tools.dispose()}
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import {fixture} from './fixtures'
import {openPdf,inspect,render} from '../src/engine/mupdf-adapter'
import {PdfUtilities} from '../src/engine/pdf-utilities'

const text=(bytes:ArrayBuffer)=>{const doc=openPdf(bytes);try{return Array.from({length:doc.countPages()},(_,i)=>inspect(doc,i).text).join('\n')}finally{doc.destroy()}}
function withTools(bytes:Uint8Array,run:(tools:PdfUtilities)=>void){const tools=new PdfUtilities();try{tools.add('doc','pdf',bytes.slice().buffer);run(tools)}finally{tools.dispose()}}

test('redaction removes matched text from the content, keeps the rest, and reports counts',()=>{
 const bytes=fixture({extra:'BT /F 12 Tf 1 0 0 1 80 200 Tm (Contact jane.doe@example.com or +1 (555) 010-2000) Tj ET'})
 withTools(bytes,tools=>{
  const result=tools.build({kind:'redact',source:'doc',terms:['editable'],patterns:['email','phone'],matchCase:false})
  const output=text(result.bytes)
  assert.doesNotMatch(output,/editable|jane\.doe|555/)
  assert.match(output,/Nearby content stays\./)
  assert.match(result.summary!,/3 matches removed on 1 page/)
 })
})

test('redaction matches phrases wrapped across lines and respects match case',()=>{
 const bytes=fixture({content:'BT /F 14 Tf 1 0 0 1 60 400 Tm (Signed by Jane) Tj ET BT /F 14 Tf 1 0 0 1 60 380 Tm (Doe on Monday) Tj ET'})
 withTools(bytes,tools=>{
  assert.throws(()=>tools.build({kind:'redact',source:'doc',terms:['jane doe'],patterns:[],matchCase:true}),/Nothing matched/)
  const output=text(tools.build({kind:'redact',source:'doc',terms:['jane doe'],patterns:[],matchCase:false}).bytes)
  assert.doesNotMatch(output,/Jane|Doe/)
  assert.match(output,/Signed by/)
 })
})

test('redaction rejects empty and malformed requests and pre-existing redaction marks',()=>{
 withTools(fixture(),tools=>{
  assert.throws(()=>tools.build({kind:'redact',source:'doc',terms:['  '],patterns:[],matchCase:false}),/at least one/)
  assert.throws(()=>tools.build({kind:'redact',source:'doc',terms:'x' as unknown as string[],patterns:[],matchCase:false}),/malformed/)
 })
 withTools(fixture({annotation:'Redact'}),tools=>assert.throws(()=>tools.build({kind:'redact',source:'doc',terms:['Nearby'],patterns:[],matchCase:false}),/already has redaction marks/))
})

function photoPdf(){
 const doc=new mupdf.PDFDocument(),pix=new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB,[0,0,3000,2000],false)
 try{
  const px=pix.getPixels();let seed=7
  for(let i=0;i<px.length;i+=3){seed=(seed*1103515245+12345)&0x7fffffff;const x=(i/3)%3000,y=Math.floor(i/3/3000),n=seed%40;px[i]=x/12+n;px[i+1]=y/8+n;px[i+2]=128+n}
  const image=new mupdf.Image(pix),ref=doc.addImage(image)
  const page=doc.addPage([0,0,600,400],0,{XObject:{Im:ref}},'q 600 0 0 400 0 0 cm /Im Do Q');doc.insertPage(-1,page);page.destroy();ref.destroy();image.destroy()
  const out=doc.saveToBuffer('garbage=4,compress');try{return out.asUint8Array().slice()}finally{out.destroy()}
 }finally{pix.destroy();doc.destroy()}
}
const meanDiff=(a:ArrayBuffer,b:ArrayBuffer)=>{
 const pixels=(bytes:ArrayBuffer)=>{const doc=openPdf(bytes),page=doc.loadPage(0),pm=page.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,true);try{return pm.getPixels().slice()}finally{pm.destroy();page.destroy();doc.destroy()}}
 const x=pixels(a),y=pixels(b);assert.equal(x.length,y.length);let sum=0;for(let i=0;i<x.length;i++)sum+=Math.abs(x[i]-y[i]);return sum/x.length
}

test('compression downsamples large images, shrinks the file and keeps the page looking the same',()=>{
 const bytes=photoPdf()
 withTools(bytes,tools=>{
  const small=tools.build({kind:'compress',source:'doc',level:'small'})
  assert.ok(small.bytes.byteLength<bytes.byteLength/3,`expected a much smaller file, got ${small.bytes.byteLength} from ${bytes.byteLength}`)
  assert.match(small.summary!,/1 image re-encoded\..*% smaller/)
  const doc=openPdf(small.bytes);try{const image=doc.loadImage(doc.loadPage(0).getObject().get('Resources','XObject','Im'));try{assert.equal(Math.max(image.getWidth(),image.getHeight()),1400)}finally{image.destroy()}}finally{doc.destroy()}
  assert.ok(meanDiff(bytes.slice().buffer,small.bytes)<12,'rendered page should stay visually close')
  const lossless=tools.build({kind:'compress',source:'doc',level:'lossless'})
  assert.equal(meanDiff(bytes.slice().buffer,lossless.bytes),0)
  assert.ok(render(openPdf(lossless.bytes),0,0.5,1).png.byteLength>0)
 })
})

test('compression keeps text searchable and reports when a file is already compact',()=>{
 withTools(fixture(),tools=>{
  const result=tools.build({kind:'compress',source:'doc',level:'balanced'})
  assert.match(text(result.bytes),/Original editable line/)
  assert.match(result.summary!,/KB/)
 })
})

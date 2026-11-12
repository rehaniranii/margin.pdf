import * as mupdf from 'mupdf'
import { fixture } from '../../tests/fixtures'
import { createSample } from '../../src/engine/sample'
import { openPdf } from '../../src/engine/mupdf-adapter'

export type ReleaseFixture={bytes:Uint8Array<ArrayBuffer>;expected:'editable'|'scanned'|'restricted'|'large';line?:string}
function save(doc:mupdf.PDFDocument){const buffer=doc.saveToBuffer('garbage=4,compress');try{return buffer.asUint8Array().slice()}finally{buffer.destroy()}}
function modify(bytes:Uint8Array,change:(doc:mupdf.PDFDocument)=>void){const doc=openPdf(bytes);try{change(doc);return save(doc)}finally{doc.destroy()}}
function embeddedFont(){
 const doc=new mupdf.PDFDocument(),font=new mupdf.Font('Times-Roman')
 try{const ref=doc.addFont(font);try{const text='Original embedded line',encoded=[...text].map(c=>font.encodeCharacter(c).toString(16).padStart(4,'0')).join('');const page=doc.addPage([0,0,400,500],0,{Font:{E:ref}},`BT /E 18 Tf 80 360 Td <${encoded}> Tj ET\nBT /E 12 Tf 80 300 Td <${[...'Nearby content stays.'].map(c=>font.encodeCharacter(c).toString(16).padStart(4,'0')).join('')}> Tj ET`);try{doc.insertPage(-1,page)}finally{page.destroy()}doc.subsetFonts();return save(doc)}finally{ref.destroy()}}finally{font.destroy();doc.destroy()}
}
function scanned(){
 const source=openPdf(createSample()),doc=new mupdf.PDFDocument()
 try{const page=source.loadPage(0);try{const pix=page.toPixmap(mupdf.Matrix.scale(1.5,1.5),mupdf.ColorSpace.DeviceRGB,false,true);try{const image=new mupdf.Image(pix);try{const ref=doc.addImage(image);try{const object=doc.addPage([0,0,612,792],0,{XObject:{Scan:ref}},'q 612 0 0 792 0 0 cm /Scan Do Q');try{doc.insertPage(-1,object)}finally{object.destroy()}}finally{ref.destroy()}}finally{image.destroy()}}finally{pix.destroy()}}finally{page.destroy()}return save(doc)}finally{doc.destroy();source.destroy()}
}
function forms(){return modify(fixture(),doc=>{
 const font=new mupdf.Font('Helvetica'),fontRef=doc.addSimpleFont(font)
 try{const appearance=doc.addStream('0.92 0.95 1 rg 0 0 160 26 re f\nBT /F 12 Tf 0 0 0 rg 5 8 Td (Example field value) Tj ET',{Type:'XObject',Subtype:'Form',BBox:[0,0,160,26],Resources:{Font:{F:fontRef}}}),name=doc.newString('Example'),value=doc.newString('Example field value')
 try{const widget=doc.addObject({Type:'Annot',Subtype:'Widget',FT:'Tx',T:name,V:value,Rect:[60,70,220,96],AP:{N:appearance}}),trailer=doc.getTrailer(),root=trailer.get('Root'),page=doc.findPage(0)
 const defaultAppearance=doc.newString('/F 12 Tf 0 g')
 try{page.put('Annots',[widget]);root.put('AcroForm',{Fields:[widget],DA:defaultAppearance,DR:{Font:{F:fontRef}}})}finally{defaultAppearance.destroy();page.destroy();root.destroy();trailer.destroy();widget.destroy()}}
 finally{appearance.destroy();name.destroy();value.destroy()}}finally{fontRef.destroy();font.destroy()}
})}
function annotation(){return modify(fixture(),doc=>{const page=doc.loadPage(0);try{const note=page.createAnnotation('Square');try{note.setRect([20,270,70,320]);note.setColor([1,0,0]);note.setBorderWidth(2);note.setContents('Release annotation');note.update()}finally{note.destroy()}}finally{page.destroy()}})}
function bigPage(){return modify(fixture(),doc=>{const page=doc.findPage(0);try{page.put('MediaBox',[0,0,18_000,24_000])}finally{page.destroy()}})}
function signed(){return modify(fixture(),doc=>{const payload=doc.newByteString([1,2,3,4]),name=doc.newString('Synthetic signature'),sig=doc.addObject({Type:'Sig',ByteRange:[0,10,20,30],Contents:payload}),field=doc.addObject({FT:'Sig',T:name,V:sig}),trailer=doc.getTrailer(),root=trailer.get('Root');try{root.put('AcroForm',{Fields:[field]})}finally{root.destroy();trailer.destroy();field.destroy();sig.destroy();name.destroy();payload.destroy()}})}

export function releaseFixtures():Record<string,ReleaseFixture>{return {
 'digital.pdf':{bytes:fixture({pages:2}),expected:'editable',line:'Original editable line'},
 'rotated-cropped.pdf':{bytes:fixture({rotation:90,crop:[40,70,360,450],userUnit:2,pages:2}),expected:'editable',line:'Original editable line'},
 'rotated-180-cropped.pdf':{bytes:fixture({rotation:180,crop:[40,70,360,450],userUnit:2,pages:2}),expected:'editable',line:'Original editable line'},
 'rotated-270-cropped.pdf':{bytes:fixture({rotation:270,crop:[40,70,360,450],userUnit:2,pages:2}),expected:'editable',line:'Original editable line'},
 'embedded-subset.pdf':{bytes:embeddedFont(),expected:'editable',line:'Original embedded line'},
 'scanned.pdf':{bytes:scanned(),expected:'scanned'},
 'annotation.pdf':{bytes:annotation(),expected:'editable',line:'Original editable line'},
 'overlapping-link.pdf':{bytes:fixture({annotation:'Link'}),expected:'editable',line:'Original editable line'},
 'form.pdf':{bytes:forms(),expected:'editable',line:'Original editable line'},
 'synthetic-signature.pdf':{bytes:signed(),expected:'editable',line:'Original editable line'},
 'unusual-transform.pdf':{bytes:fixture({content:'BT /F 20 Tf 1 .2 .3 1 80 360 Tm (Skewed source) Tj ET'}),expected:'restricted'},
 'large-250-pages.pdf':{bytes:fixture({pages:250,sharedForm:true}),expected:'large',line:'Original editable line'},
 'oversized-page.pdf':{bytes:bigPage(),expected:'large'},
}}

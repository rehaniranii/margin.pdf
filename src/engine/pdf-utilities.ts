import * as mupdf from 'mupdf'
import type { RenderedPage } from '../model/document'
import type { Crop, FormField, ImageExport, Signature, PlannedPage, Stamp, UtilityArtifact, UtilitySource, UtilitySpec } from '../model/utilities'
import { pdfFeatures } from './pdf-features'
import { imageDimensions } from './image-assets'
import { openPdf, render } from './mupdf-adapter'
import { appendPageForm } from './page-form'
import { boundedScale } from '../geometry/page'
import { compressLevels, compressSaveOptions, findOnPage, recompressImages, redactText, redactionPattern } from './rewrite'

import { REPLACEMENT_FONTS } from './text-edit'
import { isHandwriting } from '../model/fonts'
import { fitSize, fits } from '../model/signature-fit'
import { pdfLiteral as literal, supportedText, unsupportedMessage, winAnsiCode } from '../model/text-encoding'
const rgb=(color:string)=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).join(' ')
function save(doc:mupdf.PDFDocument,options='garbage=4,compress') { const buffer=doc.saveToBuffer(options);try{return buffer.asUint8Array().slice()}finally{buffer.destroy()} }

// Embeds only the glyphs `text` uses: subset in a scratch document, then copy that one font
// across. Subsetting the real document would also cut down the source PDF's own fonts.
function subsetFont(doc:mupdf.PDFDocument,font:mupdf.Font,text:string){
  const scratch=new mupdf.PDFDocument()
  try{
    const ref=scratch.addSimpleFont(font),page=scratch.addPage([0,0,10,10],0,{Font:{F:ref}},`BT /F 1 Tf ${literal(text)} Tj ET`)
    try{scratch.insertPage(-1,page);scratch.subsetFonts();return doc.graftObject(ref)}finally{page.destroy();ref.destroy()}
  }finally{scratch.destroy()}
}
function pageText(doc:mupdf.PDFDocument,index:number){
  const page=doc.loadPage(index)
  try{const text=page.toStructuredText('');try{return text.asText().trim()}finally{text.destroy()}}finally{page.destroy()}
}
function onState(widget:mupdf.PDFWidget){
  const normal=widget.getObject().get('AP','N');let on=''
  try{if(normal.isDictionary())normal.forEach((value,key)=>{try{if(key!=='Off'&&!on)on=String(key)}finally{value.destroy()}})}finally{normal.destroy()}
  return on
}
function formFields(doc:mupdf.PDFDocument):FormField[]{
  const fields=new Map<string,FormField>()
  for(let index=0;index<doc.countPages();index++){
    const page=doc.loadPage(index)
    try{for(const widget of page.getWidgets()){
      try{
        const type=widget.isText()?'text':widget.isCheckbox()?'checkbox':widget.isRadioButton()?'radio':widget.isChoice()?'choice':undefined
        const name=widget.getName()
        if(!type||!name) continue // push buttons and signature fields are not fillable here
        const existing=fields.get(name),options=type==='choice'?widget.getOptions():type==='text'?[]:[onState(widget)].filter(Boolean)
        if(existing){for(const option of options)if(!existing.options.includes(option))existing.options.push(option);continue}
        fields.set(name,{name,type,value:widget.getValue()??'',options,page:index,readOnly:widget.isReadOnly(),multiline:type==='text'&&widget.isMultiline(),password:type==='text'&&widget.isPassword(),maxLen:type==='text'?widget.getMaxLen():0})
      }finally{widget.destroy()}
    }}finally{page.destroy()}
  }
  return [...fields.values()]
}
const catalogKeys=['Metadata','Names','Dests','OpenAction','AA','Outlines','AcroForm','PieceInfo','Threads','SpiderInfo','URI','Collection','Perms','Legal']
const objectKeys=['Metadata','PieceInfo','AA','Annots','Thumb','JS','EmbeddedFiles','LastModified']
function eachDictionary(doc:mupdf.PDFDocument,fn:(object:mupdf.PDFObject)=>void){
  for(let index=1;index<doc.countObjects();index++){const ref=doc.newIndirect(index);try{const object=ref.resolve();try{if(object.isDictionary())fn(object)}finally{object.destroy()}}finally{ref.destroy()}}
}
// Bake visible annotations/form values into the page, then drop everything a reader cannot see.
function sanitize(doc:mupdf.PDFDocument,progress?:(label:string)=>void){
  const features=pdfFeatures(doc)
  if(features.optionalContent) throw new Error('This PDF has layers, and hidden layers can hold content. Flatten it locally first.')
  if(features.xfa) throw new Error('This PDF has an XFA form, which cannot be flattened safely. Flatten it locally first.')
  progress?.('Flattening comments and form fields…')
  doc.bake(true,true)
  progress?.('Removing metadata, scripts, attachments and links…')
  const trailer=doc.getTrailer(),root=trailer.get('Root')
  try{trailer.delete('Info');for(const key of catalogKeys)root.delete(key)}finally{root.destroy();trailer.destroy()}
  eachDictionary(doc,object=>{
    for(const key of objectKeys)object.delete(key)
    // Accessibility tags point at annotations through OBJR; detach so the removed annotations are not kept alive.
    const type=object.get('Type');try{if(type.asName()==='OBJR')object.delete('Obj')}finally{type.destroy()}
  })
  const removed=[features.annotations+features.widgets&&'comments and form fields flattened',features.links&&`${features.links} ${features.links===1?'link':'links'}`,features.bookmarks&&'bookmarks'].filter(Boolean)
  return `Metadata, scripts, attachments and editing history removed${removed.length?`; ${removed.join(', ')}`:''}. Pages look the same.`
}
// What sanitize must have removed; checked on the saved file.
function hiddenData(doc:mupdf.PDFDocument){
  const left=new Set<string>(),trailer=doc.getTrailer(),root=trailer.get('Root')
  try{const info=trailer.get('Info');try{if(!info.isNull())left.add('Info')}finally{info.destroy()};for(const key of catalogKeys){const value=root.get(key);try{if(!value.isNull())left.add(key)}finally{value.destroy()}}}finally{root.destroy();trailer.destroy()}
  eachDictionary(doc,object=>{for(const key of [...objectKeys,'S']){const value=object.get(key);try{if(key==='S'?['JavaScript','Launch','SubmitForm','ImportData'].includes(value.asName()):!value.isNull())left.add(key==='S'?value.asName():key)}finally{value.destroy()}}})
  const features=pdfFeatures(doc)
  if(features.annotations+features.widgets+features.links)left.add('annotations')
  return [...left]
}

// PDF numbers have no exponent syntax: cos(90°) = 6.1e-17 would break the page's content stream.
const pdfNumber=(n:number)=>Number(n.toFixed(4)).toString()

export const formatSize=(bytes:number)=>bytes<1024*1024?`${Math.max(1,Math.round(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(1)} MB`

export class PdfUtilities {
  private sources=new Map<string,{bytes:Uint8Array<ArrayBuffer>;info:UtilitySource}>()
  private fonts=new Map<string,Uint8Array>()
  constructor(private progress?:(label:string)=>void) {}
  add(id:string,kind:'pdf'|'image',buffer:ArrayBuffer):UtilitySource {
    if (!id||this.sources.has(id)) throw new Error('This source is already registered.')
    const bytes=new Uint8Array(buffer).slice()
    let info:UtilitySource
    if(kind==='pdf') {
      this.progress?.('Inspecting PDF features and signatures…')
      const probe=new mupdf.PDFDocument(bytes)
      let locked:boolean
      try{locked=probe.needsPassword()}finally{probe.destroy()}
      // Locked files can only be unlocked; page count and features need the password.
      if(locked) info={id,kind,pageCount:0,locked}
      else {const doc=openPdf(bytes);try { info={id,kind,pageCount:doc.countPages(),features:pdfFeatures(doc)};if(info.features!.widgets)info.fields=formFields(doc) } finally {doc.destroy()}}
    } else {
      const {width,height}=imageDimensions(bytes)
      if(!width||!height||width*height>32_000_000) throw new Error('This image exceeds the 32-million-pixel decoding budget. Resize it locally first.')
      const image=new mupdf.Image(bytes)
      try {info={id,kind,pageCount:1,width:image.getWidth(),height:image.getHeight()}}finally{image.destroy()}
    }
    this.sources.set(id,{bytes,info});return info
  }
  release(id:string){this.sources.delete(id)}
  /** Registers a handwriting font's TrueType bytes for typed signatures. */
  addFont(name:string,buffer:ArrayBuffer){
    if(!isHandwriting(name)) throw new Error('Unknown signature font.')
    const bytes=new Uint8Array(buffer).slice(),font=new mupdf.Font(name.replaceAll(' ',''),bytes)
    try{if(font.encodeCharacter('A')<=0) throw new Error('The signature font could not be read.')}finally{font.destroy()}
    this.fonts.set(name,bytes)
  }
  private source(id:string,kind:'pdf'|'image',allowLocked=false) {const value=this.sources.get(id);if(!value||value.info.kind!==kind) throw new Error('A source is missing. Add the file again.');if(value.info.locked&&!allowLocked) throw new Error('This PDF is password-protected. Remove the password with the Unlock tool first.');return value}
  build(spec:UtilitySpec):UtilityArtifact {
    if(spec.kind==='compress'||spec.kind==='redact'||spec.kind==='sanitize') return this.rewrite(spec)
    if(spec.kind==='protect'||spec.kind==='unlock') return this.password(spec)
    if(spec.kind==='fill') return this.fill(spec)
    if(spec.kind==='ocr') return this.ocr(spec)
    const doc=new mupdf.PDFDocument()
    try {
      if(spec.kind==='pages') this.assemble(doc,spec.pages)
      else this.images(doc,spec.sources,spec.paper,spec.margin)
      if(spec.kind==='pages'&&spec.crop) this.crop(doc,spec.crop)
      if(spec.kind==='pages'&&spec.stamp) this.stamp(doc,spec.stamp)
      this.progress?.('Saving and checking the result…')
      const bytes=save(doc), reopened=openPdf(bytes)
      try {return {bytes:bytes.buffer,preview:render(reopened,0,0.65,1),pageCount:reopened.countPages(),plan:spec.kind==='pages'?structuredClone(spec.pages):undefined}}
      finally{reopened.destroy()}
    } finally {doc.destroy()}
  }
  private rewrite(spec:Extract<UtilitySpec,{kind:'compress'|'redact'|'sanitize'}>):UtilityArtifact {
    const source=this.source(spec.source,'pdf'),doc=openPdf(source.bytes)
    try {
      let summary='',previewPage=0,pattern:RegExp|undefined
      if(spec.kind==='compress') {
        if(!['lossless','balanced','small'].includes(spec.level)) throw new Error('Choose a compression level.')
        const images=spec.level==='lossless'?0:recompressImages(doc,compressLevels[spec.level],this.progress)
        if(images) summary=`${images} ${images===1?'image':'images'} re-encoded. `
      } else if(spec.kind==='sanitize') {
        summary=sanitize(doc,this.progress)
      } else {
        if(!Array.isArray(spec.terms)||!Array.isArray(spec.patterns)||spec.terms.some(term=>typeof term!=='string')) throw new Error('The redaction request is malformed.')
        const terms=spec.terms.map(term=>term.trim()).filter(Boolean)
        if(terms.length>200||terms.some(term=>term.length>200)||!spec.patterns.every(kind=>kind==='email'||kind==='phone')) throw new Error('Use up to 200 search terms of at most 200 characters each.')
        if(!terms.length&&!spec.patterns.length) throw new Error('Enter at least one word or phrase, or pick emails or phone numbers.')
        pattern=redactionPattern(terms,spec.patterns,spec.matchCase)
        const result=redactText(doc,pattern,this.progress)
        if(!result.matches) throw new Error('Nothing matched, so nothing was redacted. Check the spelling, or turn off “Match case”. Scanned pages need Make searchable (OCR) first.')
        previewPage=result.pages[0]
        summary=`${result.matches} ${result.matches===1?'match':'matches'} removed on ${result.pages.length} ${result.pages.length===1?'page':'pages'}. `
      }
      this.progress?.('Saving and checking the result…')
      const bytes=save(doc,spec.kind==='compress'?compressSaveOptions:'garbage=4,compress'),reopened=openPdf(bytes)
      try {
        if(pattern) for(let index=0;index<reopened.countPages();index++){
          // Verify against the saved file itself: redacted text must not be extractable any more.
          const page=reopened.loadPage(index)
          try{if(findOnPage(page,pattern).length) throw new Error(`Redaction could not be verified on page ${index+1}: matching text is still extractable. Nothing was saved.`)}finally{page.destroy()}
        }
        if(spec.kind==='sanitize'){const left=hiddenData(reopened);if(left.length) throw new Error(`Hidden data could not be removed (${left.join(', ')}). Nothing was saved.`)}
        if(spec.kind==='compress'){
          const before=source.bytes.byteLength,after=bytes.byteLength,saved=Math.round((1-after/before)*100)
          summary+=after<before?`${formatSize(before)} → ${formatSize(after)}, ${saved}% smaller.`:`${formatSize(before)} → ${formatSize(after)}. This file was already compact; keep the original.`
        }
        return {bytes:bytes.buffer,preview:render(reopened,previewPage,0.65,1),pageCount:reopened.countPages(),summary:summary.trim()}
      } finally{reopened.destroy()}
    } finally{doc.destroy()}
  }
  /** Pages without any extractable text: the ones OCR should read. */
  textless(id:string):number[] {
    const doc=openPdf(this.source(id,'pdf').bytes),result:number[]=[]
    try{for(let index=0;index<doc.countPages();index++)if(!pageText(doc,index))result.push(index)}finally{doc.destroy()}
    return result
  }
  private ocr(spec:Extract<UtilitySpec,{kind:'ocr'}>):UtilityArtifact {
    const source=this.source(spec.source,'pdf')
    if(!Array.isArray(spec.pages)||!spec.pages.length) throw new Error('No scanned pages to make searchable.')
    const doc=openPdf(source.bytes)
    try{
      if(new Set(spec.pages.map(p=>p.page)).size!==spec.pages.length||spec.pages.some(p=>!Number.isInteger(p.page)||p.page<0||p.page>=doc.countPages()||!Array.isArray(p.words)||p.words.length>20000||p.words.some(w=>typeof w.text!=='string'||w.text.length>200||w.box?.length!==4||!w.box.every(Number.isFinite)||w.box[2]<=0||w.box[3]<=0))) throw new Error('The recognised text is malformed.')
      const font=new mupdf.Font('Helvetica'),fontRef=doc.addSimpleFont(font)
      let words=0
      try{
        for(const {page:index,words:found} of spec.pages){
          if(pageText(doc,index)) throw new Error(`Page ${index+1} already has text, so it was not read again.`)
          const usable=found.map(w=>({...w,text:[...w.text.trim()].map(c=>winAnsiCode(c)===undefined?'?':c).join('')})).filter(w=>w.text)
          if(!usable.length) continue
          this.progress?.(`Adding searchable text to page ${index+1}…`)
          const page=doc.loadPage(index)
          try{
            const [bx,by]=page.getBounds()
            // Invisible text (render mode 3) sized and stretched to each word's box: selectable and
            // searchable, and redaction finds it over the scanned pixels it covers. MuPDF's Helvetica
            // text box spans 1.075 em above the baseline and 0.299 em below (measured), so the box matches the word.
            const ops=usable.map(({text,box:[x,y,w,h]})=>{const size=h/1.374,advance=[...text].reduce((sum,c)=>sum+font.advanceGlyph(font.encodeCharacter(c)),0)*size;return `BT /F ${size} Tf ${(100*w/Math.max(advance,0.01)).toFixed(2)} Tz 1 0 0 -1 ${bx+x} ${by+y+size*1.075} Tm ${literal(text)} Tj ET`})
            appendPageForm(doc,page,`q 3 Tr ${ops.join(' ')} Q`,{Font:{F:fontRef}},'MarginOcr')
            words+=usable.length
          }finally{page.destroy()}
        }
      }finally{fontRef.destroy();font.destroy()}
      if(!words) throw new Error('No text was recognised on the scanned pages. Very faint, handwritten or non-English text may not be readable.')
      this.progress?.('Saving and checking the result…')
      const bytes=save(doc),reopened=openPdf(bytes)
      try{
        const read=spec.pages.filter(p=>p.words.length).map(p=>p.page)
        for(const index of read) if(!pageText(reopened,index)) throw new Error(`The recognised text on page ${index+1} could not be verified. Nothing was saved.`)
        return {bytes:bytes.buffer,preview:render(reopened,read[0],0.65,1),pageCount:reopened.countPages(),summary:`${words} ${words===1?'word':'words'} recognised on ${read.length} scanned ${read.length===1?'page':'pages'}. The pages look the same; their text can now be selected, searched and redacted.`}
      }finally{reopened.destroy()}
    }finally{doc.destroy()}
  }
  private fill(spec:Extract<UtilitySpec,{kind:'fill'}>):UtilityArtifact {
    const source=this.source(spec.source,'pdf')
    if(!spec.values||typeof spec.values!=='object'||Object.values(spec.values).some(v=>typeof v!=='string'||v.length>10000)) throw new Error('The form values are malformed.')
    if(source.info.features?.xfa) throw new Error('This PDF has an XFA form, which cannot be filled here.')
    const fields=new Map((source.info.fields??[]).map(field=>[field.name,field]))
    for(const [name,value] of Object.entries(spec.values)){
      const field=fields.get(name)
      if(!field) throw new Error(`The form has no field named “${name}”.`)
      if(field.readOnly) throw new Error(`“${name}” is read-only.`)
      if(field.type!=='text'&&!(field.type==='checkbox'&&value==='Off')&&!field.options.includes(value)) throw new Error(`“${value}” is not an option for “${name}”.`)
      if(field.type==='text'&&field.maxLen&&value.length>field.maxLen) throw new Error(`“${name}” allows at most ${field.maxLen} characters.`)
    }
    if(!Object.keys(spec.values).length&&!spec.signature) throw new Error('Fill in a field or add a signature first.')
    const doc=openPdf(source.bytes)
    try {
      this.progress?.('Filling form fields…')
      for(let index=0;index<doc.countPages();index++){
        const page=doc.loadPage(index)
        try{for(const widget of page.getWidgets()){
          try{
            const name=widget.getName(),value=spec.values[name]
            if(value===undefined) continue
            if(widget.isText()) widget.setTextValue(value)
            else if(widget.isChoice()) widget.setChoiceValue(value)
            else if(widget.isCheckbox()||widget.isRadioButton()){
              const on=onState(widget),checked=widget.getValue()===on&&on!==''
              const want=widget.isCheckbox()?value!=='Off':value===on
              if(want!==checked&&(want||widget.isCheckbox())) widget.toggle()
            }
            widget.update()
          }finally{widget.destroy()}
        }}finally{page.destroy()}
      }
      if(spec.signature) this.sign(doc,spec.signature)
      if(spec.flatten){this.progress?.('Flattening the form…');doc.bake(false,true)}
      this.progress?.('Saving and checking the result…')
      const bytes=save(doc),reopened=openPdf(bytes)
      try{
        if(!spec.flatten){
          // Verify against the saved file: every requested value must read back.
          const saved=new Map(formFields(reopened).map(field=>[field.name,field.value]))
          for(const [name,value] of Object.entries(spec.values)) if(saved.get(name)!==value&&!(value==='Off'&&!saved.get(name))) throw new Error(`“${name}” could not be filled. Nothing was saved.`)
        }
        const count=Object.keys(spec.values).length
        return {bytes:bytes.buffer,preview:render(reopened,spec.signature?.page??0,0.65,1),pageCount:reopened.countPages(),summary:[count&&`${count} ${count===1?'field':'fields'} filled`,spec.signature&&`signature added on page ${spec.signature.page+1}`,spec.flatten&&'form flattened'].filter(Boolean).join(', ').replace(/^./,c=>c.toUpperCase())+'.'}
      }finally{reopened.destroy()}
    }finally{doc.destroy()}
  }
  private sign(doc:mupdf.PDFDocument,signature:Signature){
    const [fx,fy,fw,fh]=signature.box
    if(!Number.isInteger(signature.page)||signature.page<0||signature.page>=doc.countPages()||!signature.box.every(Number.isFinite)||fx<0||fy<0||fw<=0.01||fh<=0.005||fx+fw>1.0001||fy+fh>1.0001||(!signature.text===!signature.image)) throw new Error('Place the signature inside the page.')
    this.progress?.(`Adding the signature to page ${signature.page+1}…`)
    const page=doc.loadPage(signature.page)
    try{
      const [bx,by,bx1,by1]=page.getBounds(),x=bx+fx*(bx1-bx),y=by+fy*(by1-by),w=fw*(bx1-bx),h=fh*(by1-by)
      if(signature.text!==undefined){
        const text=signature.text.trim()
        if(!text||text.length>80||!supportedText(text)) throw new Error(`Type a signature of up to 80 characters. ${unsupportedMessage}`)
        const name=signature.font??'Times-Italic',handwriting=isHandwriting(name),bytes=handwriting?this.fonts.get(name):undefined
        if(!(handwriting||REPLACEMENT_FONTS.includes(name))||(signature.size!==undefined&&(!Number.isFinite(signature.size)||signature.size<4||signature.size>144))) throw new Error('Choose an available font and a size from 4 to 144 points.')
        if(handwriting&&!bytes) throw new Error('The handwriting font has not loaded yet. Try again.')
        const font=bytes?new mupdf.Font(name.replaceAll(' ',''),bytes):new mupdf.Font(name),ref=bytes?subsetFont(doc,font,text):doc.addSimpleFont(font)
        try{
          const advance=[...text].reduce((sum,c)=>sum+font.advanceGlyph(font.encodeCharacter(c)),0),size=signature.size??fitSize(advance,w,h)
          if(!fits(advance,size,w,h)) throw new Error('The typed signature does not fit its box. Make the box bigger or the font smaller.')
          appendPageForm(doc,page,`q BT /F ${size} Tf 0.07 0.1 0.25 rg 1 0 0 -1 ${x+(w-advance*size)/2} ${y+h/2+size*0.3} Tm ${literal(text)} Tj ET Q`,{Font:{F:ref}},'MarginSignature')
        }finally{ref.destroy();font.destroy()}
      } else {
        const image=new mupdf.Image(this.source(signature.image!,'image').bytes)
        try{
          // Fit inside the box, keeping the image's proportions.
          const scale=Math.min(w/image.getWidth(),h/image.getHeight()),dw=image.getWidth()*scale,dh=image.getHeight()*scale,ref=doc.addImage(image)
          try{appendPageForm(doc,page,`q ${dw} 0 0 ${-dh} ${x+(w-dw)/2} ${y+(h+dh)/2} cm /Im Do Q`,{XObject:{Im:ref}},'MarginSignature')}finally{ref.destroy()}
        }finally{image.destroy()}
      }
    }finally{page.destroy()}
  }
  private password(spec:Extract<UtilitySpec,{kind:'protect'|'unlock'}>):UtilityArtifact {
    if(typeof spec.password!=='string') throw new Error('The password request is malformed.')
    const source=this.source(spec.source,'pdf',spec.kind==='unlock'),doc=new mupdf.PDFDocument(source.bytes)
    try {
      let options:string
      if(spec.kind==='protect') {
        // mupdf splits save options on commas, so a comma would silently truncate the password.
        if(!/^[\x20-\x7e]{4,127}$/.test(spec.password)||spec.password.includes(',')) throw new Error('Use a password of 4 to 127 basic Latin characters, without commas.')
        options=`garbage=4,compress,encrypt=aes-256,user-password=${spec.password},owner-password=${spec.password}`
      } else {
        if(doc.needsPassword()&&!doc.authenticatePassword(spec.password)) throw new Error('That password is not correct. Nothing was saved.')
        options='garbage=4,compress,encrypt=none'
      }
      this.progress?.('Saving and checking the result…')
      const bytes=save(doc,options),reopened=new mupdf.PDFDocument(bytes)
      try {
        reopened.disableJS()
        // Verify the saved file: protected must demand exactly this password, unlocked must open without one.
        if(spec.kind==='protect'&&(!reopened.needsPassword()||!reopened.authenticatePassword(spec.password))) throw new Error('The password could not be verified on the saved file. Nothing was saved.')
        if(spec.kind==='unlock'&&reopened.needsPassword()) throw new Error('The password could not be removed. Nothing was saved.')
        const pageCount=reopened.countPages()
        return {bytes:bytes.buffer,preview:render(reopened,0,0.65,1),pageCount,summary:spec.kind==='protect'?'Encrypted with AES-256. The password is needed to open this copy.':'Password removed. This copy opens without one.'}
      } finally{reopened.destroy()}
    } finally{doc.destroy()}
  }
  private assemble(output:mupdf.PDFDocument,pages:PlannedPage[]) {
    if(!pages.length) throw new Error('Keep at least one page in the result.')
    for(const entry of pages) {
      const source=this.source(entry.sourceId,'pdf')
      if(!Number.isInteger(entry.page)||entry.page<0||entry.page>=source.info.pageCount||![0,90,180,270].includes(entry.rotation)||(entry.blank!==undefined&&entry.blank!==true)) throw new Error('The page plan has an invalid page or rotation.')
      if(source.info.features?.optionalContent) throw new Error('This PDF has optional-content layers. Page copying cannot preserve their visibility safely; use a locally flattened copy first.')
      if(source.info.features?.xfa) throw new Error('This PDF has XFA forms. Their appearance cannot be preserved safely; use a locally flattened copy first.')
    }
    // One graft map per source preserves resource sharing across interleaved pages.
    const prepared=new Map<string,{doc:mupdf.PDFDocument;map:mupdf.PDFGraftMap}>()
    try {
      for(const [position,entry] of pages.entries()) {
        let source=prepared.get(entry.sourceId)
        if(!source) {
          const doc=openPdf(this.source(entry.sourceId,'pdf').bytes)
          try {doc.bake(true,true); source={doc,map:output.newGraftMap()};prepared.set(entry.sourceId,source)}catch(error){doc.destroy();throw error}
        }
        this.progress?.(`Copying page ${position+1} of ${pages.length}…`)
        if(entry.blank){
          // Same visible size and orientation as its neighbour, so it slots in without a jump.
          const neighbour=source.doc.loadPage(entry.page)
          try{const [x0,y0,x1,y1]=neighbour.getBounds(),blank=output.addPage([0,0,x1-x0,y1-y0],entry.rotation,{},'');try{output.insertPage(-1,blank)}finally{blank.destroy()}}finally{neighbour.destroy()}
          continue
        }
        source.map.graftPage(-1,source.doc,entry.page)
        const original=source.doc.findPage(entry.page), page=output.findPage(position)
        const rotation=original.getInheritable('Rotate'), unit=original.getInheritable('UserUnit'), group=original.getInheritable('Group')
        try {
          page.put('Rotate',((rotation.asNumber()+entry.rotation)%360+360)%360)
          // graftPage's standard list omits UserUnit and transparency Group in this
          // binding. Copy explicitly to retain displayed dimensions/compositing.
          if(!unit.isNull()) page.put('UserUnit',unit.asNumber())
          if(!group.isNull()){const copy=source.map.graftObject(group);try{page.put('Group',copy)}finally{copy.destroy()}}
          // Do not retain hidden actions/interactive objects on copied pages.
          page.delete('Annots');page.delete('AA')
        } finally {rotation.destroy();unit.destroy();group.destroy();original.destroy();page.destroy()}
      }
    } finally {for(const source of prepared.values()){source.map.destroy();source.doc.destroy()}}
  }
  private images(doc:mupdf.PDFDocument,ids:string[],paper:'fit'|'a4',margin:number) {
    if(!ids.length) throw new Error('Add at least one JPG or PNG.')
    if(!['fit','a4'].includes(paper)||!Number.isFinite(margin)||margin<0||margin>100) throw new Error('Choose a paper size and a margin from 0 to 100 points.')
    for(const [index,id] of ids.entries()) {
      this.progress?.(`Placing image ${index+1} of ${ids.length}…`)
      const image=new mupdf.Image(this.source(id,'image').bytes)
      try {
        const iw=image.getWidth(),ih=image.getHeight()
        // Native image pixels map to 72 pt/in. A4 turns to match the image and is covered edge to edge
        // (proportions locked, overhang clipped), so no white bands appear around the picture.
        const landscape=iw>ih,w=paper==='a4'?(landscape?841.89:595.276):iw+margin*2,h=paper==='a4'?(landscape?595.276:841.89):ih+margin*2
        const fill=paper==='a4'?Math.max:Math.min,scale=fill((w-margin*2)/iw,(h-margin*2)/ih),dw=iw*scale,dh=ih*scale
        const reference=doc.addImage(image),page=doc.addPage([0,0,w,h],0,{XObject:{Im:reference}},`q ${margin} ${margin} ${w-margin*2} ${h-margin*2} re W n ${dw} 0 0 ${dh} ${(w-dw)/2} ${(h-dh)/2} cm /Im Do Q`)
        try{doc.insertPage(-1,page)}finally{page.destroy();reference.destroy()}
      } finally{image.destroy()}
    }
  }
  private crop(doc:mupdf.PDFDocument,crop:Crop) {
    const margins=[crop.top,crop.right,crop.bottom,crop.left]
    if(margins.some(m=>!Number.isFinite(m)||m<0||m>5000)||!crop.pages.length||new Set(crop.pages).size!==crop.pages.length||crop.pages.some(p=>!Number.isInteger(p)||p<0||p>=doc.countPages())) throw new Error('Choose valid pages and margins from 0 to 5000 points.')
    for(const index of crop.pages){
      const page=doc.findPage(index),box=page.getInheritable('CropBox'),media=page.getInheritable('MediaBox'),rotate=page.getInheritable('Rotate'),unit=page.getInheritable('UserUnit')
      try{
        const [x0,y0,x1,y1]=(box.isArray()?box:media).asJS() as number[],scale=unit.isNull()?1:unit.asNumber()
        const r=((rotate.asNumber()%360)+360)%360,[t,right,b,l]=margins.map(m=>m/scale)
        // Screen sides → PDF box edges [left x0, bottom y0, right x1, top y1] for each rotation.
        const [dx0,dy0,dx1,dy1]=r===90?[t,l,b,right]:r===180?[right,t,l,b]:r===270?[b,right,t,l]:[l,b,right,t]
        const next=[Math.min(x0,x1)+dx0,Math.min(y0,y1)+dy0,Math.max(x0,x1)-dx1,Math.max(y0,y1)-dy1]
        if(next[2]-next[0]<36/scale||next[3]-next[1]<36/scale) throw new Error(`The margins leave less than half an inch of page ${index+1}. Use smaller margins.`)
        page.put('CropBox',next);page.delete('TrimBox');page.delete('BleedBox');page.delete('ArtBox')
      }finally{box.destroy();media.destroy();rotate.destroy();unit.destroy();page.destroy()}
    }
  }
  private stamp(doc:mupdf.PDFDocument,stamp:Stamp) {
    const positions=['center','top','bottom','top-left','top-right','bottom-left','bottom-right']
    if(!['watermark','numbers'].includes(stamp.kind)||!positions.includes(stamp.position)||!stamp.pages.length||new Set(stamp.pages).size!==stamp.pages.length||stamp.pages.some(p=>!Number.isInteger(p)||p<0||p>=doc.countPages())) throw new Error('Choose valid pages and a position for the stamp.')
    if(!stamp.text||!supportedText(stamp.text)||!/^#[\da-f]{6}$/i.test(stamp.color)||!Number.isFinite(stamp.size)||stamp.size<4||stamp.size>144||!Number.isFinite(stamp.opacity)||stamp.opacity<0.05||stamp.opacity>1||!Number.isSafeInteger(stamp.start)||stamp.start<1||stamp.start+doc.countPages()>Number.MAX_SAFE_INTEGER) throw new Error('Use Latin text (accents are fine), a size from 4 to 144 pt, a valid color/opacity, and a positive starting number.')
    const angle=stamp.angle??0
    if(!(angle==='diagonal'||angle==='diagonal-down'||(typeof angle==='number'&&Number.isFinite(angle)&&angle>=-90&&angle<=90))||(stamp.font!==undefined&&!REPLACEMENT_FONTS.includes(stamp.font))) throw new Error('Choose an angle from -90° to 90° and a standard font.')
    const font=new mupdf.Font(stamp.font??'Helvetica'),fontRef=doc.addSimpleFont(font),size=stamp.size
    try {
      for(const [sequence,index] of stamp.pages.entries()) {
        this.progress?.(`Adding ${stamp.kind==='numbers'?'page numbers':'watermark'} to page ${index+1}…`)
        const page=doc.loadPage(index)
        try {
          const value=stamp.kind==='numbers'?stamp.text.replaceAll('{n}',String(stamp.start+sequence)).replaceAll('{total}',String(stamp.pages.length)):stamp.text
          const bounds=page.getBounds(),width=[...value].reduce((sum,c)=>sum+font.advanceGlyph(font.encodeCharacter(c))*size,0),w=bounds[2]-bounds[0],h=bounds[3]-bounds[1]
          // Diagonals run corner to corner, so they suit every page shape.
          const degrees=angle==='diagonal'?Math.atan2(h,w)*180/Math.PI:angle==='diagonal-down'?-Math.atan2(h,w)*180/Math.PI:angle
          const t=degrees*Math.PI/180,cos=Math.cos(t),sin=Math.sin(t),height=size*0.7 // cap height
          // Half extents of the rotated text box, on screen (y down).
          const hx=Math.abs(cos)*width/2+Math.abs(sin)*height/2,hy=Math.abs(sin)*width/2+Math.abs(cos)*height/2
          // Text matrix for a y-down page: baseline along (cos, -sin), "up" along (-sin, -cos); centred on (cx, cy).
          const show=(cx:number,cy:number)=>`${[cos,-sin,-sin,-cos,cx-cos*width/2+sin*height/2,cy+sin*width/2+cos*height/2].map(pdfNumber).join(' ')} Tm ${literal(value)} Tj`
          const margin=Math.max(18,size*0.5),centres:[number,number][]=[]
          if(stamp.tile){
            // Staggered grid over the whole page; text running past the edge is clipped.
            const stepX=hx*2+size*2,stepY=hy*2+size*1.5
            for(let row=0,y=bounds[1]+stepY/2;y-hy<bounds[3];row++,y+=stepY)for(let x=bounds[0]+(row%2?stepX/2:0);x-hx<bounds[2];x+=stepX)centres.push([x,y])
          } else {
            if(hx*2>w-24||hy*2>h-24) throw new Error(`The stamp does not fit page ${index+1}. Shorten the text, reduce its size, or change the angle.`)
            const p=stamp.position,cx=p.endsWith('left')?bounds[0]+margin+hx:p.endsWith('right')?bounds[2]-margin-hx:bounds[0]+w/2
            const cy=p.startsWith('top')?bounds[1]+margin+hy:p.startsWith('bottom')?bounds[3]-margin-hy:bounds[1]+h/2
            centres.push([cx,cy])
          }
          appendPageForm(doc,page,`q /G gs BT /F ${size} Tf ${rgb(stamp.color)} rg ${centres.map(([x,y])=>show(x,y)).join(' ')} ET Q`,{Font:{F:fontRef},ExtGState:{G:{Type:'ExtGState',ca:stamp.opacity,CA:stamp.opacity}}},'MarginStamp')
        } finally{page.destroy()}
      }
    } finally{fontRef.destroy();font.destroy()}
  }
  // No progress label: thumbnails load in the background without the busy bar.
  thumbnail(id:string,pageNumber:number,width:number):RenderedPage {
    if(!Number.isFinite(width)||width<16||width>600) throw new Error('Thumbnail width must be 16 to 600 pixels.')
    const doc=openPdf(this.source(id,'pdf').bytes)
    try{
      if(!Number.isInteger(pageNumber)||pageNumber<0||pageNumber>=doc.countPages()) throw new Error('Choose an existing page.')
      const page=doc.loadPage(pageNumber);let bounds;try{bounds=page.getBounds()}finally{page.destroy()}
      return render(doc,pageNumber,width/(bounds[2]-bounds[0]),1)
    }finally{doc.destroy()}
  }
  exportImage(id:string,pageNumber:number,format:'png'|'jpeg',dpi:number):ImageExport {
    if(!['png','jpeg'].includes(format)||!Number.isFinite(dpi)||dpi<36||dpi>300) throw new Error('Choose PNG/JPG and a resolution from 36 to 300 dpi.')
    const doc=openPdf(this.source(id,'pdf').bytes)
    try {
      if(!Number.isInteger(pageNumber)||pageNumber<0||pageNumber>=doc.countPages()) throw new Error('Choose an existing page.')
      this.progress?.(`Rendering page ${pageNumber+1} as ${format==='png'?'PNG':'JPG'}…`)
      const page=doc.loadPage(pageNumber)
      try {
        const scale=boundedScale(page.getBounds(),dpi/72,1),pixmap=page.toPixmap(mupdf.Matrix.scale(scale,scale),mupdf.ColorSpace.DeviceRGB,false,true)
        try{return {bytes:(format==='png'?pixmap.asPNG():pixmap.asJPEG(90)).slice().buffer,format,width:pixmap.getWidth(),height:pixmap.getHeight(),requestedDpi:dpi,actualDpi:scale*72}}finally{pixmap.destroy()}
      } finally{page.destroy()}
    } finally{doc.destroy()}
  }
  dispose(){this.sources.clear()}
}

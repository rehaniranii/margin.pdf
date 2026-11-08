import * as mupdf from 'mupdf'
import type { ImageExport, PlannedPage, Stamp, UtilityArtifact, UtilitySource, UtilitySpec } from '../model/utilities'
import { pdfFeatures } from './pdf-features'
import { imageDimensions } from './image-assets'
import { openPdf, render } from './mupdf-adapter'
import { appendPageForm } from './page-form'
import { boundedScale } from '../geometry/page'
import { compressLevels, compressSaveOptions, findOnPage, recompressImages, redactText, redactionPattern } from './rewrite'

const literal=(text:string)=>`(${text.replace(/[\\()]/g,'\\$&')})`
const rgb=(color:string)=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).join(' ')
function save(doc:mupdf.PDFDocument,options='garbage=4,compress') { const buffer=doc.saveToBuffer(options);try{return buffer.asUint8Array().slice()}finally{buffer.destroy()} }

export const formatSize=(bytes:number)=>bytes<1024*1024?`${Math.max(1,Math.round(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(1)} MB`

export class PdfUtilities {
  private sources=new Map<string,{bytes:Uint8Array<ArrayBuffer>;info:UtilitySource}>()
  constructor(private progress?:(label:string)=>void) {}
  add(id:string,kind:'pdf'|'image',buffer:ArrayBuffer):UtilitySource {
    if (!id||this.sources.has(id)) throw new Error('This source is already registered.')
    const bytes=new Uint8Array(buffer).slice()
    let info:UtilitySource
    if(kind==='pdf') {
      this.progress?.('Inspecting PDF features and signatures…')
      const doc=openPdf(bytes)
      try { info={id,kind,pageCount:doc.countPages(),features:pdfFeatures(doc)} } finally {doc.destroy()}
    } else {
      const {width,height}=imageDimensions(bytes)
      if(!width||!height||width*height>32_000_000) throw new Error('This image exceeds the 32-million-pixel decoding budget. Resize it locally first.')
      const image=new mupdf.Image(bytes)
      try {info={id,kind,pageCount:1,width:image.getWidth(),height:image.getHeight()}}finally{image.destroy()}
    }
    this.sources.set(id,{bytes,info});return info
  }
  release(id:string){this.sources.delete(id)}
  private source(id:string,kind:'pdf'|'image') {const value=this.sources.get(id);if(!value||value.info.kind!==kind) throw new Error('A source is missing. Add the file again.');return value}
  build(spec:UtilitySpec):UtilityArtifact {
    if(spec.kind==='compress'||spec.kind==='redact') return this.rewrite(spec)
    const doc=new mupdf.PDFDocument()
    try {
      if(spec.kind==='pages') this.assemble(doc,spec.pages,spec.acceptFlattening)
      else this.images(doc,spec.sources,spec.paper,spec.margin)
      if(spec.kind==='pages'&&spec.stamp) this.stamp(doc,spec.stamp)
      this.progress?.('Saving and checking the result…')
      const bytes=save(doc), reopened=openPdf(bytes)
      try {return {bytes:bytes.buffer,preview:render(reopened,0,0.65,1),pageCount:reopened.countPages(),plan:spec.kind==='pages'?structuredClone(spec.pages):undefined}}
      finally{reopened.destroy()}
    } finally {doc.destroy()}
  }
  private rewrite(spec:Extract<UtilitySpec,{kind:'compress'|'redact'}>):UtilityArtifact {
    const source=this.source(spec.source,'pdf'),doc=openPdf(source.bytes)
    try {
      let summary='',previewPage=0,pattern:RegExp|undefined
      if(spec.kind==='compress') {
        if(!['lossless','balanced','small'].includes(spec.level)) throw new Error('Choose a compression level.')
        const images=spec.level==='lossless'?0:recompressImages(doc,compressLevels[spec.level],this.progress)
        if(images) summary=`${images} ${images===1?'image':'images'} re-encoded. `
      } else {
        if(!Array.isArray(spec.terms)||!Array.isArray(spec.patterns)||spec.terms.some(term=>typeof term!=='string')) throw new Error('The redaction request is malformed.')
        const terms=spec.terms.map(term=>term.trim()).filter(Boolean)
        if(terms.length>200||terms.some(term=>term.length>200)||!spec.patterns.every(kind=>kind==='email'||kind==='phone')) throw new Error('Use up to 200 search terms of at most 200 characters each.')
        if(!terms.length&&!spec.patterns.length) throw new Error('Enter at least one word or phrase, or pick emails or phone numbers.')
        pattern=redactionPattern(terms,spec.patterns,spec.matchCase)
        const result=redactText(doc,pattern,this.progress)
        if(!result.matches) throw new Error('Nothing matched, so nothing was redacted. Check the spelling, or turn off “Match case”. Scanned pages contain no searchable text.')
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
        if(spec.kind==='compress'){
          const before=source.bytes.byteLength,after=bytes.byteLength,saved=Math.round((1-after/before)*100)
          summary+=after<before?`${formatSize(before)} → ${formatSize(after)}, ${saved}% smaller.`:`${formatSize(before)} → ${formatSize(after)}. This file was already compact; keep the original.`
        }
        return {bytes:bytes.buffer,preview:render(reopened,previewPage,0.65,1),pageCount:reopened.countPages(),summary:summary.trim()}
      } finally{reopened.destroy()}
    } finally{doc.destroy()}
  }
  private assemble(output:mupdf.PDFDocument,pages:PlannedPage[],accepted:boolean) {
    if(!accepted) throw new Error('Review and accept the flattening and signature notice before generating a PDF.')
    if(!pages.length) throw new Error('Keep at least one page in the result.')
    for(const entry of pages) {
      const source=this.source(entry.sourceId,'pdf')
      if(!Number.isInteger(entry.page)||entry.page<0||entry.page>=source.info.pageCount||![0,90,180,270].includes(entry.rotation)) throw new Error('The page plan has an invalid page or rotation.')
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
        // Native image pixels map to 72 pt/in; A4 fits with locked proportions.
        const w=paper==='a4'?595.276:iw+margin*2,h=paper==='a4'?841.89:ih+margin*2
        const scale=Math.min((w-margin*2)/iw,(h-margin*2)/ih),dw=iw*scale,dh=ih*scale
        const reference=doc.addImage(image),page=doc.addPage([0,0,w,h],0,{XObject:{Im:reference}},`q ${dw} 0 0 ${dh} ${(w-dw)/2} ${(h-dh)/2} cm /Im Do Q`)
        try{doc.insertPage(-1,page)}finally{page.destroy();reference.destroy()}
      } finally{image.destroy()}
    }
  }
  private stamp(doc:mupdf.PDFDocument,stamp:Stamp) {
    if(!['watermark','numbers'].includes(stamp.kind)||!['center','bottom'].includes(stamp.position)||!stamp.pages.length||new Set(stamp.pages).size!==stamp.pages.length||stamp.pages.some(p=>!Number.isInteger(p)||p<0||p>=doc.countPages())) throw new Error('Choose valid pages for the stamp.')
    if(!/^[\x20-\x7e]+$/.test(stamp.text)||!/^#[\da-f]{6}$/i.test(stamp.color)||!Number.isFinite(stamp.size)||stamp.size<4||stamp.size>144||!Number.isFinite(stamp.opacity)||stamp.opacity<0.05||stamp.opacity>1||!Number.isSafeInteger(stamp.start)||stamp.start<1||stamp.start+doc.countPages()>Number.MAX_SAFE_INTEGER) throw new Error('Use basic Latin text, a size from 4 to 144 pt, a valid color/opacity, and a positive starting number.')
    const font=new mupdf.Font('Helvetica'),fontRef=doc.addSimpleFont(font)
    try {
      for(const [sequence,index] of stamp.pages.entries()) {
        this.progress?.(`Adding ${stamp.kind==='numbers'?'page numbers':'watermark'} to page ${index+1}…`)
        const page=doc.loadPage(index)
        try {
          const value=stamp.kind==='numbers'?stamp.text.replaceAll('{n}',String(stamp.start+sequence)).replaceAll('{total}',String(stamp.pages.length)):stamp.text
          const bounds=page.getBounds(),width=[...value].reduce((sum,c)=>sum+font.advanceGlyph(font.encodeCharacter(c))*stamp.size,0),w=bounds[2]-bounds[0],h=bounds[3]-bounds[1]
          if(width>w-24||stamp.size*1.5>h-24) throw new Error(`The stamp does not fit page ${index+1}. Shorten the text or reduce its size.`)
          const x=bounds[0]+(w-width)/2,y=stamp.position==='center'?bounds[1]+h/2+stamp.size*0.35:bounds[3]-Math.max(18,stamp.size*0.5)
          appendPageForm(doc,page,`q /G gs BT /F ${stamp.size} Tf ${rgb(stamp.color)} rg 1 0 0 -1 ${x} ${y} Tm ${literal(value)} Tj ET Q`,{Font:{F:fontRef},ExtGState:{G:{Type:'ExtGState',ca:stamp.opacity,CA:stamp.opacity}}},'MarginStamp')
        } finally{page.destroy()}
      }
    } finally{fontRef.destroy();font.destroy()}
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

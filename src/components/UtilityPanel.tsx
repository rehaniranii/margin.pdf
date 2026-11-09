import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { RenderedPage } from '../model/document'
import type { ReplacementFont } from '../model/document'
import type { StampPosition } from '../model/utilities'
import { FontSelect } from './FontSelect'
import type { PdfFeatures } from '../model/utilities'
import type { Stamp } from '../model/utilities'
import type { CompressLevel, ImageExport, PlannedPage, RedactPattern, UtilityArtifact, UtilitySource, UtilitySpec } from '../model/utilities'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { useDocumentActivity } from '../offline/useDocumentActivity'
import { PdfWorkerClient } from '../workers/client'
import { OcrClient } from '../workers/ocr-client'
import { parsePages } from '../utilities/page-ranges'
import { downloadFile, downloadPdf } from '../export/download'
import { usePageImage } from './PagePreview'
import { DropZone } from './DropZone'
import { moveTo, useDragSort } from './useDragSort'
import { isHandwriting } from '../model/fonts'
import { handwritingUrls } from './handwriting'
import { FillSign, drawnSignature, initialFill } from './FillSign'

export type UtilityTab='organize'|'merge'|'extract'|'from-images'|'to-images'|'watermark'|'numbers'|'compress'|'redact'|'protect'|'unlock'|'sanitize'|'crop'|'fill'|'ocr'
const tabs:{id:UtilityTab;title:string}[]=[{id:'organize',title:'Organize pages'},{id:'merge',title:'Merge PDFs'},{id:'extract',title:'Extract / split'},{id:'from-images',title:'Images to PDF'},{id:'to-images',title:'Pages to images'},{id:'watermark',title:'Watermark'},{id:'numbers',title:'Page numbers'},{id:'compress',title:'Compress'},{id:'redact',title:'Redact'},{id:'protect',title:'Protect with password'},{id:'unlock',title:'Unlock'},{id:'sanitize',title:'Remove hidden data'},{id:'crop',title:'Crop pages'},{id:'fill',title:'Fill and sign'},{id:'ocr',title:'Make searchable (OCR)'}]
type Source=UtilitySource & {name:string}
const allPages=(source:UtilitySource):PlannedPage[]=>Array.from({length:source.pageCount},(_,page)=>({sourceId:source.id,page,rotation:0}))
function cycleDialogFocus(event:KeyboardEvent<HTMLDialogElement>) {
 if(event.key!=='Tab')return
 const dialog=event.currentTarget
 const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')).filter(element=>element.tabIndex>=0&&!element.closest('[disabled],[hidden]')&&element.getClientRects().length>0)
 const first=controls[0],last=controls[controls.length-1]
 if(!first){event.preventDefault();dialog.focus();return}
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
function move<T>(items:T[],index:number,delta:number){const next=items.slice();[next[index],next[index+delta]]=[next[index+delta],next[index]];return next}

// `page` renders the tool inline on its own route (no dialog, no tab list); `initialFile` is loaded once the worker is ready.
export function UtilityPanel({current,onClose,onOpen,initialTab,page,initialFile}:{initialTab?:UtilityTab;current?:{bytes:ArrayBuffer;name:string;count:number};onClose:()=>void;onOpen:(bytes:ArrayBuffer,name:string,hasLocalCopy:boolean)=>void;page?:boolean;initialFile?:File}) {
 const dialog=useRef<HTMLDialogElement&HTMLElement>(null),worker=useRef<PdfWorkerClient|null>(null),ocr=useRef<OcrClient>(undefined),locked=useRef(false),epoch=useRef(0)
 const [tab,setTab]=useState<UtilityTab>(initialTab??(current?'organize':'from-images')),[busy,setBusy]=useState('Starting page tools…'),[error,setError]=useState(''),[notice,setNotice]=useState('')
 useDocumentActivity(!!busy)
 const [sources,setSources]=useState<Source[]>([]),[mergeIds,setMergeIds]=useState<string[]>([]),[imageIds,setImageIds]=useState<string[]>([]),[plan,setPlan]=useState<PlannedPage[]>([])
 const [windowStart,setWindowStart]=useState(0),[range,setRange]=useState(current?`1-${current.count}`:'1')
 const [split,setSplit]=useState(false),[downloads,setDownloads]=useState<number[]>([]),[artifact,setArtifact]=useState<UtilityArtifact>(),[outputName,setOutputName]=useState('result.pdf')
 const [format,setFormat]=useState<'png'|'jpeg'>('png'),[dpi,setDpi]=useState(144),[imageResult,setImageResult]=useState<ImageExport>(),[paper,setPaper]=useState<'fit'|'a4'>('fit')
 const [artifactDownloaded,setArtifactDownloaded]=useState(false)
 const [level,setLevel]=useState<CompressLevel>('balanced'),[terms,setTerms]=useState(''),[redactKinds,setRedactKinds]=useState<RedactPattern[]>([]),[matchCase,setMatchCase]=useState(false),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[margins,setMargins]=useState({top:36,right:36,bottom:36,left:36})
 const [fill,setFill]=useState(initialFill),[signPage,setSignPage]=useState<{url:string;width:number;height:number;dpi:number;page:number;source:UtilitySource}>(),pad=useRef<HTMLCanvasElement>(null),rendered=useRef<{page:number;source:UtilitySource}>(undefined)
 const [thumbs,setThumbs]=useState<Record<string,string>>({}),thumbOwner=useRef<UtilitySource>(undefined),requestedThumbs=useRef(new Set<number>())
 const dragPlan=useDragSort((from,to)=>{invalidate();setPlan(old=>moveTo(old,from,to))}),dragMerge=useDragSort((from,to)=>{invalidate();setMergeIds(old=>moveTo(old,from,to))}),dragImages=useDragSort((from,to)=>{invalidate();setImageIds(old=>moveTo(old,from,to))})
 // These rewrite the source file itself, so the page-copy notice and checkbox do not apply.
 const copies=!['from-images','to-images','compress','redact','protect','unlock','sanitize','fill','ocr'].includes(tab)
 useUnsavedChangesWarning(!!artifact&&!artifactDownloaded)
 const [text,setText]=useState('DRAFT'),[size,setSize]=useState(initialTab==='numbers'?12:36),[color,setColor]=useState('#667085'),[opacity,setOpacity]=useState(initialTab==='numbers'?100:25),[start,setStart]=useState(1),[position,setPosition]=useState<StampPosition>(initialTab==='numbers'?'bottom':'center')
 const [angle,setAngle]=useState<'0'|'diagonal'|'diagonal-down'|'90'|'custom'>('diagonal'),[customAngle,setCustomAngle]=useState(30),[tile,setTile]=useState(false),[stampFont,setStampFont]=useState<ReplacementFont>(initialTab==='numbers'?'Helvetica':'Helvetica-Bold')
 const previewUrl=usePageImage(artifact?.preview), active=sources.find(source=>source.id==='current'),title=tabs.find(value=>value.id===tab)!.title
 const signed=sources.some(source=>source.features?.signed)
 // What a page copy loses, listed only when the chosen files actually have it.
 const involved=(tab==='merge'?mergeIds.map(id=>sources.find(source=>source.id===id)):[active]).flatMap(source=>source?.features?[source.features]:[])
 const has=(test:(features:PdfFeatures)=>boolean)=>involved.some(test)
 const losses=[has(f=>f.links>0)&&'links are removed',has(f=>f.bookmarks)&&'bookmarks are removed',has(f=>f.annotations>0)&&'comments become part of the page',has(f=>f.widgets>0)&&'form fields become flat and can no longer be filled in',has(f=>f.signed)&&'the digital signature is no longer valid'].filter((loss):loss is string=>!!loss)
 function invalidate(){setArtifact(undefined);setDownloads([]);setImageResult(undefined);setNotice('')}
 async function job(action:(client:PdfWorkerClient,token:number)=>Promise<void>,label:string){
  if(locked.current||!worker.current)return
  locked.current=true;const token=epoch.current;setBusy(label);setError('');setNotice('')
  try{await action(worker.current,token)}catch(reason){if(token===epoch.current)setError(reason instanceof Error?reason.message:'The operation failed. The working document is unchanged.')}
  finally{if(token===epoch.current){locked.current=false;setBusy('')}}
 }
 async function initialize(){
  worker.current=new PdfWorkerClient(setBusy,'tools')
  await job(async(client,token)=>{
   if(current){const info=await client.request<UtilitySource>({type:'tool-source',id:'current',kind:'pdf',bytes:current.bytes.slice(0)});if(token!==epoch.current)return;setSources([{...info,name:current.name}]);setMergeIds(['current']);setPlan(allPages(info))}
  },'Checking the current PDF…')
 }
 useEffect(()=>{if(!page)dialog.current?.showModal();void initialize().then(()=>{if(initialFile)void(tab==='from-images'?addFiles([initialFile],'image'):tab==='merge'?addFiles([initialFile],'pdf'):choosePdf(initialFile))});return()=>{epoch.current++;worker.current?.dispose();ocr.current?.dispose()}},[])
 useEffect(()=>{
  if(tab!=='fill'||fill.mode==='none'||!active||active.locked||!Number.isInteger(fill.page)||fill.page<1||fill.page>active.pageCount||(rendered.current?.page===fill.page&&rendered.current.source===active))return
  // Tried once per page and source; a failed render shows its error instead of retrying.
  void job(async(client,token)=>{rendered.current={page:fill.page,source:active};const image=await client.request<ImageExport>({type:'tool-image',sourceId:'current',page:fill.page-1,format:'png',dpi:72});if(token!==epoch.current)return;setSignPage(old=>{if(old)URL.revokeObjectURL(old.url);return {url:URL.createObjectURL(new Blob([image.bytes],{type:'image/png'})),width:image.width,height:image.height,dpi:image.actualDpi,page:fill.page,source:active}})},`Rendering page ${fill.page}…`)
 },[tab,fill.mode,fill.page,active,busy])
 useEffect(()=>{
  // Thumbnails for the visible window, one at a time, cached per page of the current source.
  if(tab!=='organize'||!active||active.locked)return
  if(thumbOwner.current!==active){thumbOwner.current=active;requestedThumbs.current.clear();setThumbs(old=>{Object.values(old).forEach(URL.revokeObjectURL);return {}})}
  const owner=active,client=worker.current,wanted=[...new Set(plan.slice(windowStart,windowStart+40).map(entry=>entry.page))].filter(page=>!requestedThumbs.current.has(page))
  if(!client||!wanted.length)return
  wanted.forEach(page=>requestedThumbs.current.add(page))
  let stopped=false
  void(async()=>{for(const [index,page] of wanted.entries()){
   // Stopped by a newer window: hand the unrequested pages back so the next run fetches them.
   if(stopped){wanted.slice(index).forEach(rest=>requestedThumbs.current.delete(rest));return}
   try{const image=await client.request<RenderedPage>({type:'tool-thumb',sourceId:'current',page,width:240});if(thumbOwner.current!==owner)return;const url=URL.createObjectURL(new Blob([image.png],{type:'image/png'}));setThumbs(old=>({...old,[page]:url}))}catch{requestedThumbs.current.delete(page);return}
  }})()
  return()=>{stopped=true}
 },[tab,active,plan,windowStart])
 const latestThumbs=useRef(thumbs);latestThumbs.current=thumbs
 useEffect(()=>()=>{Object.values(latestThumbs.current).forEach(URL.revokeObjectURL)},[])
 // Live preview for stamps: the first selected page, rebuilt quietly a moment after each change.
 const [live,setLive]=useState<{image:RenderedPage;page:number}>(),[liveError,setLiveError]=useState(''),liveSeq=useRef(0)
 const liveUrl=usePageImage(live?.image)
 const stampSpec=(pages:number[]):Stamp=>({kind:tab==='numbers'?'numbers':'watermark',text:tab==='numbers'?'Page {n} of {total}':text,size,color,opacity:opacity/100,position,start,pages,font:stampFont,...tab==='watermark'?{angle:angle==='custom'?customAngle:angle==='0'?0:angle==='90'?90:angle,tile}:{}})
 useEffect(()=>{
  if((tab!=='watermark'&&tab!=='numbers')||!active||active.locked){setLive(undefined);return}
  const sequence=++liveSeq.current
  const timer=setTimeout(async()=>{
   let pages:number[]
   try{pages=parsePages(range,active.pageCount)}catch{setLiveError('Enter valid pages to see a preview.');return}
   // One page only, numbered as it will be in the full copy.
   const stamp={...stampSpec([0]),text:tab==='numbers'?`Page {n} of ${pages.length}`:text}
   try{const result=await worker.current?.request<UtilityArtifact>({type:'tool-build',quiet:true,spec:{kind:'pages',pages:[{sourceId:'current',page:pages[0],rotation:0}],stamp}});if(result&&sequence===liveSeq.current){setLive({image:result.preview,page:pages[0]});setLiveError('')}}
   catch(reason){if(sequence===liveSeq.current)setLiveError(reason instanceof Error?reason.message:'The preview could not be drawn.')}
  },350)
  return()=>clearTimeout(timer)
 },[tab,active,range,text,size,color,opacity,position,start,angle,customAngle,tile,stampFont])
 function cancel(){
  epoch.current++;worker.current?.dispose();ocr.current?.dispose();ocr.current=undefined;locked.current=false;setSources([]);setMergeIds([]);setImageIds([]);setPlan([])
  void initialize().then(()=>setNotice('Operation cancelled. Utility input files were released; add them again if needed. Your editor is unchanged.'))
 }
 async function choosePdf(file?:File){
  if(!file)return
  invalidate();await job(async(client,token)=>{const bytes=await file.arrayBuffer();if(token!==epoch.current)return;const info=await client.request<UtilitySource>({type:'tool-source',id:'current',kind:'pdf',bytes});if(token!==epoch.current)return;setSources(old=>[...old,{...info,name:file.name}]);setPlan(allPages(info));setMergeIds(old=>['current',...old]);setRange(`1-${info.pageCount}`)},'Checking the selected PDF…')
 }
 async function addFiles(files:FileList|File[]|null,kind:'pdf'|'image'){
  if(!files?.length)return
  const list=Array.from(files);invalidate()
  await job(async(client,token)=>{
   for(const file of list){const id=crypto.randomUUID(),bytes=await file.arrayBuffer();if(token!==epoch.current)return;const info=await client.request<UtilitySource>({type:'tool-source',id,kind,bytes});if(token!==epoch.current)return;setSources(old=>[...old,{...info,name:file.name}]);if(kind==='pdf')setMergeIds(old=>[...old,id]);else setImageIds(old=>[...old,id])}
  },'Reading local files…')
 }
 function removeSource(id:string,kind:'pdf'|'image'){
  invalidate();if(kind==='pdf')setMergeIds(old=>old.filter(value=>value!==id));else setImageIds(old=>old.filter(value=>value!==id))
  if(id!=='current'){setSources(old=>old.filter(source=>source.id!==id));void worker.current?.request({type:'tool-release',id}).catch(()=>{})}
 }
 function selectedPages(){if(!active)throw new Error('Open a PDF in the editor first.');return parsePages(range,active.pageCount)}
 async function generate(spec:UtilitySpec,name:string,download=false){
  await job(async(client,token)=>{const result=await client.request<UtilityArtifact>({type:'tool-build',spec});if(token!==epoch.current)return;setArtifact(result);setArtifactDownloaded(download);setOutputName(name);setImageResult(undefined);if(download)downloadPdf(result.bytes.slice(0),name)},'Generating a separate PDF…')
 }
 async function submit(event:FormEvent){event.preventDefault();setError('');invalidate()
  try{
   if(tab==='from-images'){await generate({kind:'images',sources:imageIds,paper,margin:0},'images.pdf');return}
   if(tab==='to-images'||(tab==='extract'&&split)){setWindowStart(0);setDownloads(selectedPages());return}
   const base=(active?.name??'document').replace(/\.pdf$/i,'')
   if(tab==='compress'){await generate({kind:'compress',source:'current',level},`${base}-compressed.pdf`);return}
   if(tab==='fill'){
    let signature
    if(fill.mode==='type'){
     const font=fill.font
     // Handwriting fonts are embedded, so the engine needs their bytes (self-hosted, cached offline).
     if(isHandwriting(font))await job(async client=>{const response=await fetch(handwritingUrls[font]);if(!response.ok)throw new Error('The handwriting font could not be loaded.');await client.request({type:'tool-font',name:font,bytes:await response.arrayBuffer()})},'Loading the handwriting font…')
     signature={page:fill.page-1,box:fill.box,text:fill.text,font,size:fill.size}
    }
    else if(fill.mode==='draw'||fill.mode==='image'){
     const bytes=fill.mode==='draw'?await drawnSignature(pad.current):await fill.file?.arrayBuffer()
     if(!bytes)throw new Error(fill.mode==='draw'?'Draw your signature first.':'Choose a signature image first.')
     await job(async client=>{await client.request({type:'tool-release',id:'signature'});await client.request({type:'tool-source',id:'signature',kind:'image',bytes})},'Reading the signature…')
     signature={page:fill.page-1,box:fill.box,image:'signature'}
    }
    await generate({kind:'fill',source:'current',values:fill.values,signature,flatten:fill.flatten},`${base}-${signature?'signed':'filled'}.pdf`);return
   }
   if(tab==='ocr'){
    // Read each textless page: render it at 300 dpi in the PDF worker, recognise it in the OCR worker.
    const pages:Extract<UtilitySpec,{kind:'ocr'}>['pages']=[];let complete=false
    await job(async(client,token)=>{
     const textless=await client.request<number[]>({type:'tool-textless',sourceId:'current'})
     if(token!==epoch.current)return
     if(!textless.length)throw new Error('Every page already has searchable text, so there is nothing to read.')
     ocr.current??=new OcrClient()
     for(const [index,page] of textless.entries()){
      const image=await client.request<ImageExport>({type:'tool-image',sourceId:'current',page,format:'png',dpi:300})
      if(token!==epoch.current)return
      setBusy(`Reading text on page ${page+1} (${index+1} of ${textless.length})…`)
      const words=await ocr.current.recognize(image.bytes)
      if(token!==epoch.current)return
      const scale=72/image.actualDpi
      pages.push({page,words:words.map(word=>({text:word.text,box:[word.left*scale,word.top*scale,word.width*scale,word.height*scale]}))})
     }
     complete=true
    },'Starting text recognition…')
    if(complete)await generate({kind:'ocr',source:'current',pages},`${base}-searchable.pdf`)
    return
   }
   if(tab==='sanitize'){await generate({kind:'sanitize',source:'current'},`${base}-clean.pdf`);return}
   if(tab==='protect'){if(password!==confirm)throw new Error('The two passwords do not match.');await generate({kind:'protect',source:'current',password},`${base}-protected.pdf`);return}
   if(tab==='unlock'){await generate({kind:'unlock',source:'current',password},`${base}-unlocked.pdf`);return}
   if(tab==='redact'){await generate({kind:'redact',source:'current',terms:terms.split('\n'),patterns:redactKinds,matchCase},`${base}-redacted.pdf`);return}
   let pages:PlannedPage[]=tab==='organize'?plan:tab==='merge'?mergeIds.flatMap(id=>allPages(sources.find(source=>source.id===id)!)):allPages(active!)
   if(tab==='extract')pages=selectedPages().map(page=>({sourceId:'current',page,rotation:0}))
   const spec:UtilitySpec={kind:'pages',pages}
   if(tab==='crop')spec.crop={...margins,pages:selectedPages()}
   if(tab==='watermark'||tab==='numbers')spec.stamp=stampSpec(selectedPages())
   await generate(spec,`${tab}.pdf`)
  }catch(reason){setError(reason instanceof Error?reason.message:'Check the selected pages.')}
 }
 async function downloadPage(page:number){
  if(tab==='extract'){await generate({kind:'pages',pages:[{sourceId:'current',page,rotation:0}]},`page-${page+1}.pdf`,true);return}
  await job(async(client,token)=>{const result=await client.request<ImageExport>({type:'tool-image',sourceId:'current',page,format,dpi});if(token!==epoch.current)return;setImageResult(result);downloadFile(result.bytes,`page-${page+1}.${format==='jpeg'?'jpg':'png'}`,`image/${format}`)},`Exporting page ${page+1}…`)
 }
 function switchTab(next:UtilityTab){setWindowStart(0);setTab(next);invalidate();setError('');if(next==='numbers'){setSize(12);setOpacity(100);setPosition('bottom');setStampFont('Helvetica')}else if(next==='watermark'){setSize(36);setOpacity(25);setPosition('center');setStampFont('Helvetica-Bold')}}
 const list=(ids:string[],kind:'pdf'|'image')=><ol className="utility-source-list">{ids.map((id,index)=>{const source=sources.find(source=>source.id===id)!;return <li key={id} {...(kind==='pdf'?dragMerge:dragImages)(index)}><span className="drag-handle" aria-hidden="true">⠿</span><span><strong>{source.name}</strong><small>{kind==='pdf'?`${source.pageCount} pages`: `${source.width} × ${source.height} pixels`}{source.features?.signed?' · signature detected':''}</small></span><button type="button" aria-label={`Move ${source.name} earlier`} disabled={index===0} onClick={()=>{invalidate();kind==='pdf'?setMergeIds(move(ids,index,-1)):setImageIds(move(ids,index,-1))}}>↑</button><button type="button" aria-label={`Move ${source.name} later`} disabled={index===ids.length-1} onClick={()=>{invalidate();kind==='pdf'?setMergeIds(move(ids,index,1)):setImageIds(move(ids,index,1))}}>↓</button><button type="button" aria-label={`Remove ${source.name}`} onClick={()=>removeSource(id,kind)}>×</button></li>})}</ol>
 const noCurrent=!active&&!['merge','from-images'].includes(tab)
 const Shell=(page?'section':'dialog') as 'dialog'
 return <Shell ref={dialog} className={page?'utility-dialog utility-page':'utility-dialog'} aria-labelledby={page?undefined:'utility-title'} aria-label={page?title:undefined} onKeyDown={page?undefined:cycleDialogFocus} onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
  {!page&&<header className="utility-header"><div><h2 id="utility-title">Page tools</h2><p>Generate a local copy. Your working document stays unchanged.</p></div><button aria-label="Close page tools" disabled={!!busy} onClick={onClose}>×</button></header>}
  {!page&&<nav className="utility-nav" aria-label="PDF utilities">{tabs.map(value=><button key={value.id} aria-pressed={tab===value.id} disabled={!!busy} onClick={()=>switchTab(value.id)}>{value.title}</button>)}</nav>}
  {busy&&<div className="job-progress" role="status"><progress/><span>{busy}</span><button onClick={cancel}>Cancel operation</button></div>}
  {error&&<div className="error-banner" role="alert">{error}</div>}{notice&&<div className="notice-banner" role="status">{notice}</div>}
  <div className="utility-layout"><form onSubmit={submit} className="utility-form"><h3>{title}</h3>{noCurrent&&<DropZone label="Drop a PDF here" hint="or click to choose one from this device" accept="application/pdf,.pdf" disabled={!!busy} onFiles={files=>void choosePdf(files[0])}/>}{active&&tab!=='from-images'&&<p className="field-help">Source: {active.name} · {active.locked?'password-protected':`${active.pageCount} pages`}</p>}<fieldset disabled={!!busy||noCurrent} className="utility-fields" onChange={invalidate}>
   
   {tab==='organize'&&<><p className="field-help">Drag pages to reorder them, or use the arrows. Rotate (↻), duplicate (⧉), add a blank page after (+), or remove (×). Rotations shown here are additional to the original orientation. A blank page matches the size of the page above it.</p><div className="page-plan">{plan.slice(windowStart,windowStart+40).map((entry,offset)=>{const index=offset+windowStart,name=entry.blank?`blank page at position ${index+1}`:`page ${entry.page+1} at position ${index+1}`,insert=(copy:PlannedPage)=>{invalidate();setPlan([...plan.slice(0,index+1),copy,...plan.slice(index+1)])};return <div className="plan-card" key={index} {...dragPlan(index)}><div className="plan-thumb">{entry.blank?<span className="plan-blank"/>:thumbs[entry.page]?<img src={thumbs[entry.page]} alt="" draggable={false} style={{transform:`rotate(${entry.rotation}deg)`}}/>:<span className="plan-loading"/>}</div><strong>{index+1}. {entry.blank?'Blank':`Page ${entry.page+1}`}{entry.rotation?<small> +{entry.rotation}°</small>:null}</strong><div className="plan-tools"><button type="button" aria-label={`Move ${name} earlier`} title="Move earlier" disabled={index===0} onClick={()=>{invalidate();setPlan(move(plan,index,-1))}}>←</button><button type="button" aria-label={`Move ${name} later`} title="Move later" disabled={index===plan.length-1} onClick={()=>{invalidate();setPlan(move(plan,index,1))}}>→</button><button type="button" aria-label={`Rotate ${name} clockwise`} title="Rotate" onClick={()=>{invalidate();setPlan(plan.map((p,i)=>i===index?{...p,rotation:((p.rotation+90)%360) as PlannedPage['rotation']}:p))}}>↻</button><button type="button" aria-label={`Duplicate ${name}`} title="Duplicate" onClick={()=>insert({...entry})}>⧉</button><button type="button" aria-label={`Insert a blank page after ${name}`} title="Insert blank page after" onClick={()=>insert({...entry,blank:true})}>+</button><button type="button" aria-label={`Remove ${name}`} title="Remove" disabled={plan.length===1} onClick={()=>{invalidate();setPlan(plan.filter((_,i)=>i!==index));setWindowStart(Math.max(0,Math.min(windowStart,plan.length-2)))}}>×</button></div></div>})}</div>{plan.length>40&&<div className="utility-actions"><button type="button" disabled={!windowStart} onClick={()=>setWindowStart(Math.max(0,windowStart-40))}>Previous 40</button><span>{windowStart+1}–{Math.min(plan.length,windowStart+40)} / {plan.length}</span><button type="button" disabled={windowStart+40>=plan.length} onClick={()=>setWindowStart(windowStart+40)}>Next 40</button></div>}<button type="button" onClick={()=>{invalidate();if(active)setPlan(allPages(active));setWindowStart(0)}}>Reset page plan</button></>}
   {tab==='merge'&&<><p className="field-help">Files merge in this order. The current PDF includes all applied edits.</p><DropZone compact multiple label="Add PDFs" hint="Drop files or click to choose" accept="application/pdf,.pdf" disabled={!!busy} onFiles={files=>void addFiles(files,'pdf')}/>{list(mergeIds,'pdf')}{active&&!mergeIds.includes('current')&&<button type="button" onClick={()=>{invalidate();setMergeIds(old=>['current',...old])}}>Include current PDF</button>}</>}
   {tab==='from-images'&&<><DropZone compact multiple label="Add JPG or PNG images" hint="Drop files or click to choose" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={!!busy} onFiles={files=>void addFiles(files,'image')}/>{list(imageIds,'image')}<label>Page size<select value={paper} onChange={event=>setPaper(event.target.value as 'a4'|'fit')}><option value="fit">Match each image (fills the page, nothing cropped)</option><option value="a4">A4, filled edge to edge (edges may be trimmed)</option></select></label><p className="field-help">Every image fills its page with no white border. A4 pages turn landscape for wide images.</p></>}
   {['extract','to-images','watermark','numbers','crop'].includes(tab)&&<><label>Pages<input aria-label="Pages to process" value={range} onChange={event=>setRange(event.target.value)} placeholder="1-3, 5"/></label><p className="field-help">Use numbers or ascending ranges, separated by commas. Order is preserved. No duplicates.</p></>}
   {tab==='extract'&&<label className="utility-check"><input type="checkbox" checked={split} onChange={event=>setSplit(event.target.checked)}/>Split into separate one-page PDFs</label>}
   {tab==='to-images'&&<><label>Image format<select value={format} onChange={event=>setFormat(event.target.value as 'png'|'jpeg')}><option value="png">PNG</option><option value="jpeg">JPG</option></select></label><label>Resolution (dpi)<input type="number" min="36" max="300" value={Number.isFinite(dpi)?dpi:''} onChange={event=>setDpi(event.target.valueAsNumber)}/></label><p className="field-help">One image at a time, with a white background. Output is capped at 4096 pixels per edge and about 8 million pixels; actual resolution is reported after rendering. Forms/annotations appear as rendered; links, bookmarks, searchability and signatures do not exist in an image.</p></>}
   {(tab==='watermark'||tab==='numbers')&&<>{tab==='watermark'?<label>Watermark text<input value={text} onChange={event=>setText(event.target.value)}/></label>:<><p className="field-help">Adds “Page n of total” in the order of the selected pages. Total means the number of selected pages.</p><label>Start numbering at<input type="number" min="1" step="1" value={Number.isFinite(start)?start:''} onChange={event=>setStart(event.target.valueAsNumber)}/></label></>}<div className="utility-two"><label>Size (pt)<input type="number" min="4" max="144" value={Number.isFinite(size)?size:''} onChange={event=>setSize(event.target.valueAsNumber)}/></label><label>Opacity (%)<input type="number" min="5" max="100" value={Number.isFinite(opacity)?opacity:''} onChange={event=>setOpacity(event.target.valueAsNumber)}/></label></div>
   {tab==='watermark'&&<><fieldset className="choice-list inline"><legend>Angle</legend>{([['0','Horizontal'],['diagonal','Diagonal ↗'],['diagonal-down','Diagonal ↘'],['90','Vertical'],['custom','Custom']] as const).map(([id,label])=><label key={id} className="utility-check"><input type="radio" name="stamp-angle" checked={angle===id} onChange={()=>setAngle(id)}/>{label}</label>)}</fieldset>{angle==='custom'&&<label>Angle (degrees, counter-clockwise)<input type="number" min="-90" max="90" value={Number.isFinite(customAngle)?customAngle:''} onChange={event=>setCustomAngle(event.target.valueAsNumber)}/></label>}<fieldset className="choice-list inline"><legend>Layout</legend><label className="utility-check"><input type="radio" name="stamp-layout" checked={!tile} onChange={()=>setTile(false)}/>Once</label><label className="utility-check"><input type="radio" name="stamp-layout" checked={tile} onChange={()=>setTile(true)}/>Repeated across the page</label></fieldset></>}
   <div className="utility-two">{!(tab==='watermark'&&tile)&&<label>Position<select value={position} onChange={event=>setPosition(event.target.value as StampPosition)}>{([['center','Center'],['top','Top center'],['bottom','Bottom center'],['top-left','Top left'],['top-right','Top right'],['bottom-left','Bottom left'],['bottom-right','Bottom right']] as const).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}<label>Font<FontSelect id="stamp-font" label="Stamp font" value={stampFont} onChange={setStampFont}/></label></div>
   <label>Color<input type="color" value={color} onChange={event=>setColor(event.target.value)}/></label><p className="field-help">{tab==='watermark'?'Diagonal runs corner to corner on each page. Repeated text is cut off at the page edge; a single stamp that does not fit is rejected. ':'A stamp that does not fit is rejected. '}Latin letters with accents (é, ü, ñ), curly quotes, dashes and € work. Stamps appear above existing content and can overlap it; inspect the result.</p></>}
   {tab==='compress'&&<><fieldset className="choice-list"><legend>How small?</legend>{([['lossless','Lossless','Repacks the file and its fonts. Pages look exactly the same.'],['balanced','Balanced','Also shrinks large photos to about 2200 px and re-saves them as JPEG. Good for sharing.'],['small','Smallest','Photos to about 1400 px at lower quality. Best for email; zoomed-in photos look softer.']] as const).map(([id,label,hint])=><label key={id} className="choice"><input type="radio" name="compress-level" checked={level===id} onChange={()=>setLevel(id)}/><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset><div className="utility-policy"><strong>What stays the same</strong><p>Text, links, bookmarks and form fields are kept. Text and vector drawings are never degraded; only photos change at Balanced and Smallest. Images with transparency are left as they are.</p><p>{signed?'A digital signature was detected. ':''}Saving a new copy removes any digital signature’s validity.</p></div></>}
   {tab==='redact'&&<><label>Words or phrases to remove<textarea rows={4} value={terms} onChange={event=>setTerms(event.target.value)} placeholder={'Jane Doe\nAccount 4417\nProject Falcon'} spellCheck={false}/></label><p className="field-help">One per line. A phrase is still found when it wraps onto the next line.</p><fieldset className="choice-list inline"><legend>Also find</legend>{([['email','Email addresses'],['phone','Phone numbers']] as const).map(([id,label])=><label key={id} className="utility-check"><input type="checkbox" checked={redactKinds.includes(id)} onChange={event=>setRedactKinds(old=>event.target.checked?[...old,id]:old.filter(kind=>kind!==id))}/>{label}</label>)}<label className="utility-check"><input type="checkbox" checked={matchCase} onChange={event=>setMatchCase(event.target.checked)}/>Match case</label></fieldset><div className="utility-policy"><strong>This is real redaction</strong><p>Matched text is deleted from the page, not just covered: it can’t be copied, searched or recovered from the result. Any part of an image under a match is blacked out too. The result is re-checked before you can download it.</p><p>Only searchable text is found. Run Make searchable (OCR) on scanned pages first. Document metadata, bookmarks, form values and attachments are not searched. {signed?'A digital signature was detected; ':''}Redacting removes any signature’s validity.</p></div></>}
   {tab==='crop'&&<><div className="utility-two">{(['top','right','bottom','left'] as const).map(side=><label key={side}>{side[0].toUpperCase()+side.slice(1)} (pt)<input type="number" min="0" max="5000" value={Number.isFinite(margins[side])?margins[side]:''} onChange={event=>setMargins(old=>({...old,[side]:event.target.valueAsNumber}))}/></label>)}</div><p className="field-help">Sides are as the page appears on screen. 36 pt is half an inch. Cropping hides the trimmed area; content there is still in the file, so use Redact for anything private.</p></>}
   {tab==='fill'&&active&&!active.locked&&<FillSign fields={active.fields??[]} pageCount={active.pageCount} state={fill} onChange={setFill} pad={pad} pageImage={signPage?.page===fill.page&&signPage.source===active?signPage:undefined}/>}
   {tab==='ocr'&&<div className="utility-policy"><strong>How it works</strong><p>Pages that are pictures of text, like scans and photos, are read and given an invisible text layer. They look exactly the same, but their text can be selected, copied and searched, and Redact can then find and black out words on them. Pages that already have text are left alone.</p><p>English only. Expect a second or two per page; nothing leaves this device. Recognition is not perfect on faint, skewed, handwritten or very small text, so check important results.</p></div>}
   {tab==='sanitize'&&<div className="utility-policy"><strong>What is removed</strong><p>Document metadata (author, title, software, dates), XMP, JavaScript and automatic actions, attachments, links, bookmarks, private application data and earlier saved versions. Comments and form fields are flattened, so what you see stays but is no longer editable.</p><p>Visible text is not changed: use Redact for words on the page. Files with layers or XFA forms are refused. {signed?'A digital signature was detected; ':''}A new copy removes any signature’s validity.</p></div>}
   {tab==='protect'&&<><label>Password<input type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={event=>setConfirm(event.target.value)}/></label><p className="field-help">4 to 127 basic Latin characters, no commas.</p><div className="utility-policy"><strong>Keep the password safe</strong><p>The copy is encrypted with AES-256. There is no recovery: if the password is lost, so is the file. The password never leaves this tab.</p><p>{signed?'A digital signature was detected. ':''}Saving a new copy removes any digital signature’s validity.</p></div></>}
   {tab==='unlock'&&<><label>Current password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label><p className="field-help">{active&&!active.locked?'This PDF opens without a password; unlocking removes its editing and printing restrictions, if any.':'The password you use to open this PDF.'}</p><div className="utility-policy"><strong>Only for files you may open</strong><p>Unlocking needs the real password; nothing is guessed or cracked. The result is an unencrypted copy, so store it with the same care.</p></div></>}
   {copies&&!!losses.length&&<p className="field-help copy-note">In the new copy: {losses.join('; ')}. Your original file is unchanged.</p>}
   <button className="primary" type="submit" disabled={!!busy||noCurrent}>{tab==='to-images'||(tab==='extract'&&split)?'Prepare downloads':tab==='compress'?'Compress':tab==='redact'?'Find and redact':tab==='protect'?'Protect PDF':tab==='sanitize'?'Remove hidden data':tab==='fill'?'Fill and sign':tab==='ocr'?'Make searchable':tab==='unlock'?'Unlock PDF':tab==='watermark'?'Create watermarked PDF':tab==='numbers'?'Add page numbers':'Generate preview'}</button>
  </fieldset></form>
  <section className="utility-result" aria-label="Generated result"><h3>Result</h3>{artifact?<>{artifact.summary&&<p className="utility-summary" role="status">{artifact.summary}</p>}<p>{artifact.pageCount} {artifact.pageCount===1?'page':'pages'} · {tab==='redact'?'First redacted page':'First page'} preview</p>{previewUrl&&<img className="utility-preview" src={previewUrl} alt={tab==='redact'?'First redacted page of generated PDF':'First page of generated PDF'}/>}<div className="utility-actions"><button disabled={!!busy} className="primary" onClick={()=>{downloadPdf(artifact.bytes.slice(0),outputName);setArtifactDownloaded(true)}}>Download PDF</button>{tab!=='protect'&&<button disabled={!!busy} onClick={()=>onOpen(artifact.bytes.slice(0),outputName,artifactDownloaded)}>Open result in editor</button>}</div><p className="field-help">Opening the result starts a new edit history. Added objects and form/annotation appearances become source page content. Download your working PDF first if you want to keep that version.</p></>:(tab==='watermark'||tab==='numbers')&&active?<div className="live-preview"><p>Live preview · page {(live?.page??0)+1}</p>{liveError?<p className="inline-error" role="status">{liveError}</p>:liveUrl?<img className="utility-preview" src={liveUrl} alt="Preview of the stamped page"/>:<p className="field-help">Drawing preview…</p>}<p className="field-help">Updates as you change the options. Create the PDF to stamp every selected page.</p></div>:<p className="field-help">Your generated copy will appear here. Nothing changes in the editor until you open a result.</p>}
   {!!downloads.length&&<><p>{downloads.length} separate downloads. Click each file to generate and save it; no automatic batch downloads.</p><div className="download-list">{downloads.slice(windowStart,windowStart+40).map(page=><button key={page} disabled={!!busy} onClick={()=>void downloadPage(page)}>Download page {page+1} {tab==='extract'?'PDF':format==='png'?'PNG':'JPG'}</button>)}</div>{downloads.length>40&&<div className="utility-actions"><button disabled={!!busy||!windowStart} onClick={()=>setWindowStart(Math.max(0,windowStart-40))}>Previous 40</button><button disabled={!!busy||windowStart+40>=downloads.length} onClick={()=>setWindowStart(windowStart+40)}>Next 40</button></div>}</>}
   {imageResult&&<p role="status">Saved {imageResult.width} × {imageResult.height} pixels, {Number(imageResult.actualDpi.toFixed(1))} dpi{imageResult.actualDpi<imageResult.requestedDpi-.1?' (reduced to stay within the render budget)':''}.</p>}
  </section></div>
 </Shell>
}

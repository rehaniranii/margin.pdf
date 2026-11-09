import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { CompressLevel, ImageExport, PlannedPage, RedactPattern, UtilityArtifact, UtilitySource, UtilitySpec } from '../model/utilities'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { useDocumentActivity } from '../offline/useDocumentActivity'
import { PdfWorkerClient } from '../workers/client'
import { parsePages } from '../utilities/page-ranges'
import { downloadFile, downloadPdf } from '../export/download'
import { usePageImage } from './PagePreview'
import { DropZone } from './DropZone'

export type UtilityTab='organize'|'merge'|'extract'|'from-images'|'to-images'|'watermark'|'numbers'|'compress'|'redact'|'protect'|'unlock'
const tabs:{id:UtilityTab;title:string}[]=[{id:'organize',title:'Organize pages'},{id:'merge',title:'Merge PDFs'},{id:'extract',title:'Extract / split'},{id:'from-images',title:'Images to PDF'},{id:'to-images',title:'Pages to images'},{id:'watermark',title:'Watermark'},{id:'numbers',title:'Page numbers'},{id:'compress',title:'Compress'},{id:'redact',title:'Redact'},{id:'protect',title:'Protect with password'},{id:'unlock',title:'Unlock'}]
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
 const dialog=useRef<HTMLDialogElement&HTMLElement>(null),worker=useRef<PdfWorkerClient|null>(null),locked=useRef(false),epoch=useRef(0)
 const [tab,setTab]=useState<UtilityTab>(initialTab??(current?'organize':'from-images')),[busy,setBusy]=useState('Starting page tools…'),[error,setError]=useState(''),[notice,setNotice]=useState('')
 useDocumentActivity(!!busy)
 const [sources,setSources]=useState<Source[]>([]),[mergeIds,setMergeIds]=useState<string[]>([]),[imageIds,setImageIds]=useState<string[]>([]),[plan,setPlan]=useState<PlannedPage[]>([])
 const [windowStart,setWindowStart]=useState(0),[range,setRange]=useState(current?`1-${current.count}`:'1'),[accepted,setAccepted]=useState(false)
 const [split,setSplit]=useState(false),[downloads,setDownloads]=useState<number[]>([]),[artifact,setArtifact]=useState<UtilityArtifact>(),[outputName,setOutputName]=useState('result.pdf')
 const [format,setFormat]=useState<'png'|'jpeg'>('png'),[dpi,setDpi]=useState(144),[imageResult,setImageResult]=useState<ImageExport>(),[paper,setPaper]=useState<'fit'|'a4'>('a4'),[margin,setMargin]=useState(24)
 const [artifactDownloaded,setArtifactDownloaded]=useState(false)
 const [level,setLevel]=useState<CompressLevel>('balanced'),[terms,setTerms]=useState(''),[redactKinds,setRedactKinds]=useState<RedactPattern[]>([]),[matchCase,setMatchCase]=useState(false),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('')
 // These rewrite the source file itself, so the page-copy notice and checkbox do not apply.
 const copies=!['from-images','to-images','compress','redact','protect','unlock'].includes(tab)
 useUnsavedChangesWarning(!!artifact&&!artifactDownloaded)
 const [text,setText]=useState('DRAFT'),[size,setSize]=useState(initialTab==='numbers'?12:36),[color,setColor]=useState('#667085'),[opacity,setOpacity]=useState(initialTab==='numbers'?100:25),[start,setStart]=useState(1),[position,setPosition]=useState<'center'|'bottom'>(initialTab==='numbers'?'bottom':'center')
 const previewUrl=usePageImage(artifact?.preview), active=sources.find(source=>source.id==='current'),title=tabs.find(value=>value.id===tab)!.title
 const signed=sources.some(source=>source.features?.signed),incomplete=sources.some(source=>source.features?.signatureCheckIncomplete)
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
 useEffect(()=>{if(!page)dialog.current?.showModal();void initialize().then(()=>{if(initialFile)void(tab==='from-images'?addFiles([initialFile],'image'):tab==='merge'?addFiles([initialFile],'pdf'):choosePdf(initialFile))});return()=>{epoch.current++;worker.current?.dispose()}},[])
 function cancel(){
  epoch.current++;worker.current?.dispose();locked.current=false;setSources([]);setMergeIds([]);setImageIds([]);setPlan([]);setAccepted(false)
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
   if(tab==='from-images'){await generate({kind:'images',sources:imageIds,paper,margin},'images.pdf');return}
   if(tab==='to-images'||(tab==='extract'&&split)){if(tab==='extract'&&!accepted)throw new Error('Review the output notice first.');setWindowStart(0);setDownloads(selectedPages());return}
   const base=(active?.name??'document').replace(/\.pdf$/i,'')
   if(tab==='compress'){await generate({kind:'compress',source:'current',level},`${base}-compressed.pdf`);return}
   if(tab==='protect'){if(password!==confirm)throw new Error('The two passwords do not match.');await generate({kind:'protect',source:'current',password},`${base}-protected.pdf`);return}
   if(tab==='unlock'){await generate({kind:'unlock',source:'current',password},`${base}-unlocked.pdf`);return}
   if(tab==='redact'){await generate({kind:'redact',source:'current',terms:terms.split('\n'),patterns:redactKinds,matchCase},`${base}-redacted.pdf`);return}
   let pages:PlannedPage[]=tab==='organize'?plan:tab==='merge'?mergeIds.flatMap(id=>allPages(sources.find(source=>source.id===id)!)):allPages(active!)
   if(tab==='extract')pages=selectedPages().map(page=>({sourceId:'current',page,rotation:0}))
   const spec:UtilitySpec={kind:'pages',pages,acceptFlattening:accepted}
   if(tab==='watermark'||tab==='numbers')spec.stamp={kind:tab==='numbers'?'numbers':'watermark',text:tab==='numbers'?'Page {n} of {total}':text,size,color,opacity:opacity/100,position,start,pages:selectedPages()}
   await generate(spec,`${tab}.pdf`)
  }catch(reason){setError(reason instanceof Error?reason.message:'Check the selected pages.')}
 }
 async function downloadPage(page:number){
  if(tab==='extract'){await generate({kind:'pages',pages:[{sourceId:'current',page,rotation:0}],acceptFlattening:accepted},`page-${page+1}.pdf`,true);return}
  await job(async(client,token)=>{const result=await client.request<ImageExport>({type:'tool-image',sourceId:'current',page,format,dpi});if(token!==epoch.current)return;setImageResult(result);downloadFile(result.bytes,`page-${page+1}.${format==='jpeg'?'jpg':'png'}`,`image/${format}`)},`Exporting page ${page+1}…`)
 }
 function switchTab(next:UtilityTab){setWindowStart(0);setTab(next);invalidate();setError('');if(next==='numbers'){setSize(12);setOpacity(100);setPosition('bottom')}else if(next==='watermark'){setSize(36);setOpacity(25);setPosition('center')}}
 const list=(ids:string[],kind:'pdf'|'image')=><ol className="utility-source-list">{ids.map((id,index)=>{const source=sources.find(source=>source.id===id)!;return <li key={id}><span><strong>{source.name}</strong><small>{kind==='pdf'?`${source.pageCount} pages`: `${source.width} × ${source.height} pixels`}{source.features?.signed?' · signature detected':''}</small></span><button type="button" aria-label={`Move ${source.name} earlier`} disabled={index===0} onClick={()=>{invalidate();kind==='pdf'?setMergeIds(move(ids,index,-1)):setImageIds(move(ids,index,-1))}}>↑</button><button type="button" aria-label={`Move ${source.name} later`} disabled={index===ids.length-1} onClick={()=>{invalidate();kind==='pdf'?setMergeIds(move(ids,index,1)):setImageIds(move(ids,index,1))}}>↓</button><button type="button" aria-label={`Remove ${source.name}`} onClick={()=>removeSource(id,kind)}>×</button></li>})}</ol>
 const noCurrent=!active&&!['merge','from-images'].includes(tab)
 const Shell=(page?'section':'dialog') as 'dialog'
 return <Shell ref={dialog} className={page?'utility-dialog utility-page':'utility-dialog'} aria-labelledby={page?undefined:'utility-title'} aria-label={page?title:undefined} onKeyDown={page?undefined:cycleDialogFocus} onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
  {!page&&<header className="utility-header"><div><h2 id="utility-title">Page tools</h2><p>Generate a local copy. Your working document stays unchanged.</p></div><button aria-label="Close page tools" disabled={!!busy} onClick={onClose}>×</button></header>}
  {!page&&<nav className="utility-nav" aria-label="PDF utilities">{tabs.map(value=><button key={value.id} aria-pressed={tab===value.id} disabled={!!busy} onClick={()=>switchTab(value.id)}>{value.title}</button>)}</nav>}
  {busy&&<div className="job-progress" role="status"><progress/><span>{busy}</span><button onClick={cancel}>Cancel operation</button></div>}
  {error&&<div className="error-banner" role="alert">{error}</div>}{notice&&<div className="notice-banner" role="status">{notice}</div>}
  <div className="utility-layout"><form onSubmit={submit} className="utility-form"><h3>{title}</h3>{noCurrent&&<DropZone label="Drop a PDF here" hint="or click to choose one from this device" accept="application/pdf,.pdf" disabled={!!busy} onFiles={files=>void choosePdf(files[0])}/>}{active&&tab!=='from-images'&&<p className="field-help">Source: {active.name} · {active.locked?'password-protected':`${active.pageCount} pages`}</p>}<fieldset disabled={!!busy||noCurrent} className="utility-fields" onChange={invalidate}>
   
   {tab==='organize'&&<><p className="field-help">Move, rotate clockwise, or remove pages. Rotations shown here are additional to the original orientation.</p><div className="page-plan">{plan.slice(windowStart,windowStart+40).map((entry,offset)=>{const index=offset+windowStart;return <div className="plan-row" key={entry.page}><strong>Page {entry.page+1}</strong><span>+{entry.rotation}°</span><button type="button" aria-label={`Move page ${entry.page+1} earlier`} disabled={index===0} onClick={()=>{invalidate();setPlan(move(plan,index,-1))}}>↑</button><button type="button" aria-label={`Move page ${entry.page+1} later`} disabled={index===plan.length-1} onClick={()=>{invalidate();setPlan(move(plan,index,1))}}>↓</button><button type="button" aria-label={`Rotate page ${entry.page+1} clockwise`} onClick={()=>{invalidate();setPlan(plan.map((p,i)=>i===index?{...p,rotation:((p.rotation+90)%360) as PlannedPage['rotation']}:p))}}>↻</button><button type="button" aria-label={`Remove page ${entry.page+1}`} disabled={plan.length===1} onClick={()=>{invalidate();setPlan(plan.filter((_,i)=>i!==index));setWindowStart(Math.max(0,Math.min(windowStart,plan.length-2)))}}>×</button></div>})}</div>{plan.length>40&&<div className="utility-actions"><button type="button" disabled={!windowStart} onClick={()=>setWindowStart(Math.max(0,windowStart-40))}>Previous 40</button><span>{windowStart+1}–{Math.min(plan.length,windowStart+40)} / {plan.length}</span><button type="button" disabled={windowStart+40>=plan.length} onClick={()=>setWindowStart(windowStart+40)}>Next 40</button></div>}<button type="button" onClick={()=>{invalidate();if(active)setPlan(allPages(active));setWindowStart(0)}}>Reset page plan</button></>}
   {tab==='merge'&&<><p className="field-help">Files merge in this order. The current PDF includes all applied edits.</p><DropZone compact multiple label="Add PDFs" hint="Drop files or click to choose" accept="application/pdf,.pdf" disabled={!!busy} onFiles={files=>void addFiles(files,'pdf')}/>{list(mergeIds,'pdf')}{active&&!mergeIds.includes('current')&&<button type="button" onClick={()=>{invalidate();setMergeIds(old=>['current',...old])}}>Include current PDF</button>}</>}
   {tab==='from-images'&&<><DropZone compact multiple label="Add JPG or PNG images" hint="Drop files or click to choose" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={!!busy} onFiles={files=>void addFiles(files,'image')}/>{list(imageIds,'image')}<label>Paper<select value={paper} onChange={event=>setPaper(event.target.value as 'a4'|'fit')}><option value="a4">A4, image centered to fit</option><option value="fit">Match image dimensions (72 pixels per inch)</option></select></label><label>Margin (pt)<input type="number" min="0" max="100" value={Number.isFinite(margin)?margin:''} onChange={event=>setMargin(event.target.valueAsNumber)}/></label></>}
   {['extract','to-images','watermark','numbers'].includes(tab)&&<><label>Pages<input aria-label="Pages to process" value={range} onChange={event=>setRange(event.target.value)} placeholder="1-3, 5"/></label><p className="field-help">Use numbers or ascending ranges, separated by commas. Order is preserved. No duplicates.</p></>}
   {tab==='extract'&&<label className="utility-check"><input type="checkbox" checked={split} onChange={event=>setSplit(event.target.checked)}/>Split into separate one-page PDFs</label>}
   {tab==='to-images'&&<><label>Image format<select value={format} onChange={event=>setFormat(event.target.value as 'png'|'jpeg')}><option value="png">PNG</option><option value="jpeg">JPG</option></select></label><label>Resolution (dpi)<input type="number" min="36" max="300" value={Number.isFinite(dpi)?dpi:''} onChange={event=>setDpi(event.target.valueAsNumber)}/></label><p className="field-help">One image at a time, with a white background. Output is capped at 4096 pixels per edge and about 8 million pixels; actual resolution is reported after rendering. Forms/annotations appear as rendered; links, bookmarks, searchability and signatures do not exist in an image.</p></>}
   {(tab==='watermark'||tab==='numbers')&&<>{tab==='watermark'?<label>Watermark text<input value={text} onChange={event=>setText(event.target.value)}/></label>:<><p className="field-help">Adds “Page n of total” in the order of the selected pages. Total means the number of selected pages.</p><label>Start numbering at<input type="number" min="1" step="1" value={Number.isFinite(start)?start:''} onChange={event=>setStart(event.target.valueAsNumber)}/></label></>}<div className="utility-two"><label>Size (pt)<input type="number" min="4" max="144" value={Number.isFinite(size)?size:''} onChange={event=>setSize(event.target.valueAsNumber)}/></label><label>Opacity (%)<input type="number" min="5" max="100" value={Number.isFinite(opacity)?opacity:''} onChange={event=>setOpacity(event.target.valueAsNumber)}/></label></div><label>Position<select value={position} onChange={event=>setPosition(event.target.value as 'center'|'bottom')}><option value="center">Center</option><option value="bottom">Bottom center</option></select></label><label>Color<input type="color" value={color} onChange={event=>setColor(event.target.value)}/></label><p className="field-help">Helvetica, basic Latin. A stamp that does not fit is rejected. Stamps appear above existing content and can overlap it; inspect the result.</p></>}
   {tab==='compress'&&<><fieldset className="choice-list"><legend>How small?</legend>{([['lossless','Lossless','Repacks the file and its fonts. Pages look exactly the same.'],['balanced','Balanced','Also shrinks large photos to about 2200 px and re-saves them as JPEG. Good for sharing.'],['small','Smallest','Photos to about 1400 px at lower quality. Best for email; zoomed-in photos look softer.']] as const).map(([id,label,hint])=><label key={id} className="choice"><input type="radio" name="compress-level" checked={level===id} onChange={()=>setLevel(id)}/><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset><div className="utility-policy"><strong>What stays the same</strong><p>Text, links, bookmarks and form fields are kept. Text and vector drawings are never degraded; only photos change at Balanced and Smallest. Images with transparency are left as they are.</p><p>{signed?'A digital signature was detected. ':''}Saving a new copy removes any digital signature’s validity.</p></div></>}
   {tab==='redact'&&<><label>Words or phrases to remove<textarea rows={4} value={terms} onChange={event=>setTerms(event.target.value)} placeholder={'Jane Doe\nAccount 4417\nProject Falcon'} spellCheck={false}/></label><p className="field-help">One per line. A phrase is still found when it wraps onto the next line.</p><fieldset className="choice-list inline"><legend>Also find</legend>{([['email','Email addresses'],['phone','Phone numbers']] as const).map(([id,label])=><label key={id} className="utility-check"><input type="checkbox" checked={redactKinds.includes(id)} onChange={event=>setRedactKinds(old=>event.target.checked?[...old,id]:old.filter(kind=>kind!==id))}/>{label}</label>)}<label className="utility-check"><input type="checkbox" checked={matchCase} onChange={event=>setMatchCase(event.target.checked)}/>Match case</label></fieldset><div className="utility-policy"><strong>This is real redaction</strong><p>Matched text is deleted from the page, not just covered: it can’t be copied, searched or recovered from the result. Any part of an image under a match is blacked out too. The result is re-checked before you can download it.</p><p>Only searchable text is found. Scanned pages are images and need OCR first. Document metadata, bookmarks, form values and attachments are not searched. {signed?'A digital signature was detected; ':''}Redacting removes any signature’s validity.</p></div></>}
   {tab==='protect'&&<><label>Password<input type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={event=>setConfirm(event.target.value)}/></label><p className="field-help">4 to 127 basic Latin characters, no commas.</p><div className="utility-policy"><strong>Keep the password safe</strong><p>The copy is encrypted with AES-256. There is no recovery: if the password is lost, so is the file. The password never leaves this tab.</p><p>{signed?'A digital signature was detected. ':''}Saving a new copy removes any digital signature’s validity.</p></div></>}
   {tab==='unlock'&&<><label>Current password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label><p className="field-help">{active&&!active.locked?'This PDF opens without a password; unlocking removes its editing and printing restrictions, if any.':'The password you use to open this PDF.'}</p><div className="utility-policy"><strong>Only for files you may open</strong><p>Unlocking needs the real password; nothing is guessed or cracked. The result is an unencrypted copy, so store it with the same care.</p></div></>}
   {copies&&<div className="utility-policy"><strong>Before you generate</strong><p>Forms and annotations become static page content using their current appearances. Their interactivity and comment data are removed. Links, bookmarks, attachments, document metadata, tags and page labels are not copied. Missing appearances may not be visible. No whole-document sanitization is promised.</p><p>{signed?'A digital signature was detected.':'PDF transformations cannot preserve digital signatures.'} Generating this copy removes signature validity; a visible signature appearance may remain. This is detection, not certificate verification.{incomplete?' Some objects could not be inspected; other signatures may be present.':''}</p><p>PDFs with optional-content layers or XFA forms need a locally flattened copy first.</p><label className="utility-check"><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)}/>I understand these changes to the generated copy.</label></div>}
   <button className="primary" type="submit" disabled={!!busy||noCurrent||(copies&&!accepted)}>{tab==='to-images'||(tab==='extract'&&split)?'Prepare downloads':tab==='compress'?'Compress':tab==='redact'?'Find and redact':tab==='protect'?'Protect PDF':tab==='unlock'?'Unlock PDF':'Generate preview'}</button>
  </fieldset></form>
  <section className="utility-result" aria-label="Generated result"><h3>Result</h3>{artifact?<>{artifact.summary&&<p className="utility-summary" role="status">{artifact.summary}</p>}<p>{artifact.pageCount} {artifact.pageCount===1?'page':'pages'} · {tab==='redact'?'First redacted page':'First page'} preview</p>{previewUrl&&<img className="utility-preview" src={previewUrl} alt={tab==='redact'?'First redacted page of generated PDF':'First page of generated PDF'}/>}<div className="utility-actions"><button disabled={!!busy} className="primary" onClick={()=>{downloadPdf(artifact.bytes.slice(0),outputName);setArtifactDownloaded(true)}}>Download PDF</button>{tab!=='protect'&&<button disabled={!!busy} onClick={()=>onOpen(artifact.bytes.slice(0),outputName,artifactDownloaded)}>Open result in editor</button>}</div><p className="field-help">Opening the result starts a new edit history. Added objects and form/annotation appearances become source page content. Download your working PDF first if you want to keep that version.</p></>:<p className="field-help">Your generated copy will appear here. Nothing changes in the editor until you open a result.</p>}
   {!!downloads.length&&<><p>{downloads.length} separate downloads. Click each file to generate and save it; no automatic batch downloads.</p><div className="download-list">{downloads.slice(windowStart,windowStart+40).map(page=><button key={page} disabled={!!busy} onClick={()=>void downloadPage(page)}>Download page {page+1} {tab==='extract'?'PDF':format==='png'?'PNG':'JPG'}</button>)}</div>{downloads.length>40&&<div className="utility-actions"><button disabled={!!busy||!windowStart} onClick={()=>setWindowStart(Math.max(0,windowStart-40))}>Previous 40</button><button disabled={!!busy||windowStart+40>=downloads.length} onClick={()=>setWindowStart(windowStart+40)}>Next 40</button></div>}</>}
   {imageResult&&<p role="status">Saved {imageResult.width} × {imageResult.height} pixels, {Number(imageResult.actualDpi.toFixed(1))} dpi{imageResult.actualDpi<imageResult.requestedDpi-.1?' (reduced to stay within the render budget)':''}.</p>}
  </section></div>
 </Shell>
}

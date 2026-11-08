import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PdfWorkerClient } from './workers/client'
import type { OpenResult } from './workers/protocol'
import type { AddedObject, EditorTool, EditorView, ImageAssetInfo, ObjectBox, Point, SessionCheckpoint, TextEdit, TextRegion, WorkingDocument } from './model/document'
import { PagePreview } from './components/PagePreview'
import { PageRail } from './components/PageRail'
import { TextProperties } from './components/TextProperties'
import { downloadPdf } from './export/download'
import { ThemeToggle } from './theme'
import { ToolBar } from './components/ToolBar'
import { ObjectProperties } from './components/ObjectProperties'
import type { ToolDefaults } from './components/ObjectProperties'
import { clampBox, inkFromPoints, pointerToPage } from './geometry/objects'

export default function App() {
  const client = useRef<PdfWorkerClient | null>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const checkpoint = useRef<SessionCheckpoint | undefined>(undefined)
  const assetFiles = useRef(new Map<string, { bytes: ArrayBuffer; info: ImageAssetInfo }>())
  const replacingImage = useRef<string | undefined>(undefined)
  const zoomAnchor = useRef<{ point: Point; viewport: Point } | undefined>(undefined)
  const resetScroll = useRef(false)
  const [document, setDocument] = useState<WorkingDocument>()
  const [view, setView] = useState<EditorView>()
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(0.9)
  const [busy, setBusy] = useState('Starting PDF engine…')
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<string>()
  const [dirty, setDirty] = useState(false)
  const [showRegions, setShowRegions] = useState(true)
  const [tool, setTool] = useState<EditorTool>('edit')
  const [objectSelection, setObjectSelection] = useState<string>()
  const [pendingImage, setPendingImage] = useState<ImageAssetInfo>()
  const [defaults, setDefaults] = useState<ToolDefaults>({ color:'#2859cf',lineWidth:2,opacity:0.25,purpose:'note' })
  const toolDefaults = useRef<Partial<Record<EditorTool,ToolDefaults>>>({})
  const [spacePan, setSpacePan] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [notice, setNotice] = useState('')
  const [pageInput, setPageInput] = useState('1')
  const [zoomInput, setZoomInput] = useState('90')
  const selectedObject = view?.objects.find(object => object.id === objectSelection && object.page === page)

  useEffect(() => {
    client.current = new PdfWorkerClient(setBusy)
    void loadSample()
    return () => { generation.current++; client.current?.dispose() }
  }, [])

  async function run(action: (worker: PdfWorkerClient, token: number) => Promise<void>, label: string) {
    if (!client.current || inFlight.current) return
    inFlight.current = true
    const token = ++generation.current
    setBusy(label); setError(''); setNotice('')
    try { await action(client.current, token) }
    catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : 'The document could not be processed.') }
    finally { if (token === generation.current) { setBusy(''); inFlight.current = false } }
  }

  function commitView(next: EditorView) {
    const previous = checkpoint.current
    if (previous) {
      const frames = previous.frames.slice(0,next.historyLength)
      frames[next.historyPosition] = { edits:next.edits,objects:next.objects }
      checkpoint.current = { frames,position:next.historyPosition,pdf:next.checkpointPdf ?? previous.pdf,revision:next.revision }
    }
    setView({ ...next,checkpointPdf:undefined })
    setDocument(current => current ? { ...current, edits: next.edits,objects:next.objects, revision: next.revision } : current)
    const used = new Set([...next.assetIds,...pendingImage ? [pendingImage.id] : []])
    for (const id of assetFiles.current.keys()) if (!used.has(id)) assetFiles.current.delete(id)
  }

  function acceptOpen(token: number, result: OpenResult, name: string, kind: 'sample' | 'local') {
    if (token !== generation.current) return
    const sourceId = crypto.randomUUID()
    setDocument({ source: { id: sourceId, name, kind, bytes: result.source }, pages: Array.from({ length: result.info.pageCount }, (_, i) => ({ sourceId, sourcePage: i, rotation: 0 })), edits: [], objects: [], revision: 0 })
    checkpoint.current = { frames:[{edits:[],objects:[]}],position:0,pdf:result.source,revision:0 }
    assetFiles.current.clear(); setPendingImage(undefined); setObjectSelection(undefined); setTool('edit')
    resetScroll.current = true
    setView(result.view); setZoom(result.scale); setPage(0); setPageInput('1'); setZoomInput(String(Math.round(result.scale*100))); setSelection(undefined); setDirty(false)
  }

  const openingOptions = () => ({ width: (preview.current?.clientWidth ?? 700) - 60, dpr: window.devicePixelRatio })
  async function loadSample() {
    if (dirty) { setError('Apply or discard your text changes before opening another document.'); return }
    await run(async (worker, token) => acceptOpen(token, await worker.request<OpenResult>({ type: 'sample', ...openingOptions() }), 'A little room to edit.pdf', 'sample'), 'Generating sample…')
  }

  async function openFile(file?: File) {
    if (!file) return
    await run(async (worker, token) => {
      const bytes = await file.arrayBuffer()
      if (token !== generation.current) return
      acceptOpen(token, await worker.request<OpenResult>({ type: 'open', bytes, ...openingOptions() }), file.name, 'local')
    }, 'Opening and checking PDF text…')
  }

  async function navigate(nextPage: number, nextZoom = zoom) {
    if (dirty && nextPage !== page) { setError('Apply or discard your text changes before switching pages.'); return }
    if (nextPage === page && nextZoom !== zoom && view) {
      const stage = preview.current?.querySelector<HTMLElement>('.page-stage'), paper = preview.current?.querySelector<HTMLElement>('.page-paper')
      if (stage && paper) {
        const frame = stage.getBoundingClientRect(), viewport: Point = [stage.clientWidth/2,Math.min(stage.clientHeight/2,250)]
        zoomAnchor.current = { point:pointerToPage([frame.left+viewport[0],frame.top+viewport[1]],paper.getBoundingClientRect(),view.image),viewport }
      }
    }
    await run(async (worker, token) => {
      const result = await worker.request<EditorView>({ type: 'view', page: nextPage, scale: nextZoom, dpr: window.devicePixelRatio })
      if (token !== generation.current) return
      commitView(result); setZoom(nextZoom); setZoomInput(String(Math.round(nextZoom*100)))
      if (nextPage !== page) { setSelection(undefined); setObjectSelection(undefined); setDirty(false); resetScroll.current = true }
      setPage(nextPage); setPageInput(String(nextPage+1))
    }, 'Rendering page…')
  }

  useLayoutEffect(() => {
    const stage = preview.current?.querySelector<HTMLElement>('.page-stage'), paper = preview.current?.querySelector<HTMLElement>('.page-paper')
    if (!stage || !paper || !view) return
    if (resetScroll.current) { stage.scrollLeft = 0; stage.scrollTop = 0; resetScroll.current = false; zoomAnchor.current = undefined }
    else if (zoomAnchor.current) {
      const anchor = zoomAnchor.current, frame = stage.getBoundingClientRect(), rect = paper.getBoundingClientRect(), image = view.image
      stage.scrollLeft += rect.left + (anchor.point[0]*image.rasterScale-image.pixelOrigin[0])/image.width*rect.width - frame.left-anchor.viewport[0]
      stage.scrollTop += rect.top + (anchor.point[1]*image.rasterScale-image.pixelOrigin[1])/image.height*rect.height - frame.top-anchor.viewport[1]
      zoomAnchor.current = undefined
    }
  },[view?.image,zoom])

  function fitWholePage() {
    if (!view) return
    const stage = preview.current?.querySelector<HTMLElement>('.page-stage')
    if (!stage) return
    void navigate(page,Math.max(0.1,Math.min(4,(stage.clientWidth-60)/(view.image.bounds[2]-view.image.bounds[0]),(stage.clientHeight-65)/(view.image.bounds[3]-view.image.bounds[1]))))
  }

  function fitPage() {
    if (!view || !preview.current) return
    void navigate(page, Math.max(0.1, Math.min(4, (preview.current.clientWidth - 60) / (view.image.bounds[2] - view.image.bounds[0]))))
  }

  function selectRegion(region: TextRegion) {
    if (dirty && selection !== region.id) { setError('Apply or discard your text changes before selecting another region.'); return }
    setSelection(region.id); setError('')
  }

  async function applyEdit(edit: TextEdit) {
    await run(async (worker, token) => {
      const result = await worker.request<EditorView>({ type: 'edit', edit, scale: zoom, dpr: window.devicePixelRatio })
      if (token === generation.current) { commitView(result); setDirty(false) }
    }, 'Removing original text and verifying replacement…')
  }

  async function history(type: 'undo' | 'redo') {
    if (dirty) { setError('Apply or discard your text changes before using document history.'); return }
    await run(async (worker, token) => {
      const result = await worker.request<EditorView>({ type, page, scale: zoom, dpr: window.devicePixelRatio })
      if (token === generation.current) commitView(result)
    }, type === 'undo' ? 'Undoing change…' : 'Redoing change…')
  }

  function chooseTool(next: EditorTool) {
    if (dirty) { setError('Apply or discard your property changes before changing tools.'); return }
    if (pendingImage && next !== 'image') {
      const id = pendingImage.id; setPendingImage(undefined); assetFiles.current.delete(id)
      void client.current?.request({type:'release-image',id}).catch(() => {})
    }
    setTool(next); setSelection(undefined); setObjectSelection(undefined); setError('')
    setDefaults(toolDefaults.current[next] ?? {color:next==='highlight'?'#ffe16b':'#2859cf',lineWidth:2,opacity:0.25,purpose:'note'})
  }

  function selectObject(id?: string) {
    if (dirty && objectSelection !== id) { setError('Apply or discard object property changes first.'); return }
    setObjectSelection(id); setSelection(undefined); setError('')
  }

  async function putObject(object: AddedObject) {
    await run(async (worker,token) => {
      const result = await worker.request<EditorView>({type:'object',object,scale:zoom,dpr:window.devicePixelRatio})
      if (token === generation.current) { commitView(result); setObjectSelection(object.id); setSelection(undefined); setDirty(false) }
    },'Adding or updating PDF object…')
  }

  async function deleteObject() {
    if (!selectedObject) return
    await run(async (worker,token) => {
      const result = await worker.request<EditorView>({type:'delete-object',id:selectedObject.id,page,scale:zoom,dpr:window.devicePixelRatio})
      if (token === generation.current) { commitView(result); setObjectSelection(undefined); setDirty(false) }
    },'Deleting object…')
  }

  function createObject(kind: EditorTool, box: ObjectBox, points: Point[]) {
    if (!view) return
    const base = {id:crypto.randomUUID(),page,box}
    let object: AddedObject
    if (kind === 'text') object = {...base,kind:'text',text:'New text',font:'Helvetica',size:16,color:defaults.color}
    else if (kind === 'image') {
      if (!pendingImage) { replacingImage.current = undefined; imageInput.current?.click(); return }
      const width = Math.min(180,view.image.bounds[2]-view.image.bounds[0]-4), height = width*pendingImage.height/pendingImage.width
      const scale = Math.min(1,(view.image.bounds[3]-view.image.bounds[1]-4)/height)
      object = {...base,kind:'image',assetId:pendingImage.id,box:clampBox({...box,width:width*scale,height:height*scale},view.image.bounds)}
    } else if (kind === 'highlight') object = {...base,kind:'highlight',color:defaults.color,opacity:defaults.opacity}
    else if (kind === 'rectangle') object = {...base,kind:'rectangle',color:defaults.color,lineWidth:defaults.lineWidth}
    else if (kind === 'ink') object = {...base,kind:'ink',...inkFromPoints(points,defaults.lineWidth,view.image.bounds),color:defaults.color,lineWidth:defaults.lineWidth,purpose:defaults.purpose}
    else return
    void putObject(object)
    if (kind !== 'ink') { setTool('select'); setPendingImage(undefined) }
  }

  function placeAtCenter() {
    if (!view) return
    const bounds=view.image.bounds, width=Math.min(tool==='text'?200:tool==='image'?180:120,bounds[2]-bounds[0]-4)
    const height=tool==='image'&&pendingImage ? width*pendingImage.height/pendingImage.width : tool==='text'?60:tool==='highlight'?24:70
    createObject(tool,clampBox({x:(bounds[0]+bounds[2]-width)/2,y:(bounds[1]+bounds[3]-height)/2,width,height},bounds),[])
  }

  function chooseImage() { replacingImage.current = selectedObject?.kind === 'image' ? selectedObject.id : undefined; imageInput.current?.click() }
  async function importImage(file?: File) {
    if (!file) return
    await run(async (worker,token) => {
      const bytes = await file.arrayBuffer(), id = crypto.randomUUID(), backup = bytes.slice(0)
      if (token !== generation.current) return
      const info = await worker.request<ImageAssetInfo>({type:'import-image',asset:{id,bytes}})
      if (token !== generation.current) return
      if (pendingImage) { assetFiles.current.delete(pendingImage.id); await worker.request({type:'release-image',id:pendingImage.id}) }
      assetFiles.current.set(id,{bytes:backup,info})
      const target = view?.objects.find(object => object.id === replacingImage.current)
      if (target?.kind === 'image' && view) {
        const box = clampBox({...target.box,height:target.box.width*info.height/info.width},view.image.bounds)
        const ratio = info.width/info.height; box.width = box.height*ratio
        const result = await worker.request<EditorView>({type:'object',object:{...target,assetId:id,box},scale:zoom,dpr:window.devicePixelRatio})
        if (token === generation.current) { commitView(result); setDirty(false) }
      } else { setPendingImage(info); setTool('image'); setObjectSelection(undefined) }
    },'Reading JPG/PNG on this device…')
    replacingImage.current = undefined
  }

  async function recover() {
    const saved = checkpoint.current
    generation.current++; inFlight.current = true; setRecovering(true)
    client.current?.dispose(); client.current = new PdfWorkerClient(setBusy)
    setPendingImage(undefined); setSpacePan(false)
    if (!saved || !document) { inFlight.current = false; setRecovering(false); setBusy(''); setNotice('Operation cancelled. Open a PDF to begin.'); return }
    const token = generation.current
    setBusy('Restoring last applied changes…'); setError('')
    try {
      const ids = new Set(saved.frames.flatMap(frame => frame.objects.flatMap(object => object.kind === 'image' ? [object.assetId] : [])))
      const assets = [...ids].map(id => { const asset = assetFiles.current.get(id); if (!asset) throw new Error('A recovery image is missing. The visible PDF has not been cleared.'); return {id,bytes:asset.bytes.slice(0)} })
      for (const id of assetFiles.current.keys()) if (!ids.has(id)) assetFiles.current.delete(id)
      const result = await client.current.request<EditorView>({type:'restore',source:document.source.bytes.slice(0),checkpoint:{...saved,pdf:saved.pdf.slice(0)},assets,page,scale:zoom,dpr:window.devicePixelRatio})
      if (token === generation.current) { commitView(result); setNotice('Operation cancelled. Your last applied changes and history were restored.') }
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : 'Recovery failed. Your visible workspace is retained; try recovery again.') }
    finally { if (token === generation.current) { inFlight.current = false; setRecovering(false); setBusy('') } }
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if (element.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]')) return
      if (event.code === 'Space') { event.preventDefault(); setSpacePan(true); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && document && !busy) { event.preventDefault(); if (event.shiftKey ? view?.canRedo : view?.canUndo) void history(event.shiftKey ? 'redo' : 'undo') }
      else if (event.key === 'Escape') { setSpacePan(false); if (!dirty) { setSelection(undefined); setObjectSelection(undefined) } }
      else if (!busy && !dirty && selectedObject && ['Delete','Backspace'].includes(event.key)) { event.preventDefault(); void deleteObject() }
      else if (!busy && !dirty && selectedObject && event.key.startsWith('Arrow')) {
        const step = event.shiftKey ? 10 : 1, box = {...selectedObject.box}
        if (event.key === 'ArrowLeft') box.x -= step; else if (event.key === 'ArrowRight') box.x += step; else if (event.key === 'ArrowUp') box.y -= step; else if (event.key === 'ArrowDown') box.y += step
        event.preventDefault(); void putObject({...selectedObject,box:clampBox(box,view!.image.bounds)})
      } else if (!busy && !dirty && document && ['PageUp','PageDown'].includes(event.key)) { event.preventDefault(); void navigate(Math.max(0,Math.min(document.pages.length-1,page+(event.key === 'PageUp' ? -1 : 1)))) }
    }
    const release = (event: KeyboardEvent) => { if (event.code === 'Space') setSpacePan(false) }
    const blur = () => setSpacePan(false)
    window.addEventListener('keydown',listener); window.addEventListener('keyup',release); window.addEventListener('blur',blur)
    return () => {window.removeEventListener('keydown',listener);window.removeEventListener('keyup',release);window.removeEventListener('blur',blur)}
  },[document,busy,view,dirty,page,zoom,selectedObject])

  function clear() {
    generation.current++; inFlight.current = false
    client.current?.dispose(); client.current = new PdfWorkerClient(setBusy)
    checkpoint.current = undefined; assetFiles.current.clear(); setObjectSelection(undefined); setPendingImage(undefined); setTool('edit'); setRecovering(false); setNotice('');
    setDocument(undefined); setView(undefined); setPage(0); setSelection(undefined); setDirty(false); setError(''); setBusy('')
  }

  function exportPdf() {
    if (!document || !checkpoint.current || busy || dirty) return
    const base=document.source.name.replace(/\.pdf$/i,'')
    downloadPdf(checkpoint.current.pdf.slice(0),document.edits.length||document.objects.length?`${base}-edited.pdf`:document.source.name)
  }

  const selected = view?.text.regions.find(region => region.id === selection)
  const applied = view?.edits.find(edit => edit.regionId === selection)
  const supported = view?.text.regions.filter(region => !region.unsupported).length ?? 0

  return <div className="app-shell">
    <header className="app-header">
      <a href="./" className="brand" aria-label="margin.pdf home"><span className="brand-mark" aria-hidden="true">m<span>.</span></span>margin<span className="brand-extension">.pdf</span></a>
      <div className="local-badge"><span/>On your device</div>
      <div className="header-actions"><ThemeToggle/><button className="secondary" onClick={() => input.current?.click()} disabled={!!busy || dirty}><span aria-hidden="true">↥</span> Open PDF</button><button className="primary" disabled={!document || !!busy || dirty} onClick={exportPdf} title={dirty ? 'Apply or discard text changes before export' : 'Download the PDF shown in the preview'}>Export PDF <span aria-hidden="true">↓</span></button></div>
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,.jpg,.jpeg,.png" hidden onChange={event => { void importImage(event.target.files?.[0]); event.target.value = '' }}/><input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={event => { void openFile(event.target.files?.[0]); event.target.value = '' }}/>
    </header>
    <div className="document-bar"><div className="document-identity"><span className="file-symbol" aria-hidden="true">PDF</span><strong title={document?.source.name}>{document?.source.name ?? 'No document open'}</strong>{document?.source.kind === 'sample' && <span className="sample-badge">Sample</span>}{document && document.edits.length + document.objects.length > 0 && <span className="edited-badge">{document.edits.length + document.objects.length} changes</span>}</div><div className="history-actions"><button aria-label="Undo document change" title="Undo (Ctrl/Cmd+Z)" disabled={!!busy || !view?.canUndo || dirty} onClick={() => history('undo')}>↶ <span>Undo</span></button><button aria-label="Redo document change" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!!busy || !view?.canRedo || dirty} onClick={() => history('redo')}>↷ <span>Redo</span></button><button className="text-button" onClick={clear}>Clear workspace</button></div></div>
    <ToolBar tool={tool} busy={!!busy || !document} onChoose={chooseTool}/>
    <main className="workspace">
      <PageRail count={document?.pages.length ?? 0} active={page} image={view?.image} busy={!!busy} onSelect={navigate}/>
      <section ref={preview} className="document-area" aria-label="PDF preview">
        <div className="viewer-toolbar"><label className="regions-toggle"><input type="checkbox" checked={showRegions} onChange={event => setShowRegions(event.target.checked)}/> Text regions</label><div className="viewer-controls"><button aria-label="Zoom out" disabled={!document || !!busy || zoom <= 0.1} onClick={() => navigate(page, Math.max(0.1, zoom - 0.1))}>−</button><form className="zoom-form" onSubmit={event => {event.preventDefault();const value=Number(zoomInput);if (!Number.isFinite(value)||value<10||value>400) setError('Enter zoom from 10% to 400%.');else void navigate(page,value/100)}}><input aria-label="Zoom percent" inputMode="numeric" value={zoomInput} onChange={event=>setZoomInput(event.target.value)} disabled={!!busy || !document}/><span>%</span><button className="visually-hidden" type="submit">Apply zoom</button></form><button aria-label="Zoom in" disabled={!document || !!busy || zoom >= 4} onClick={() => navigate(page, Math.min(4, zoom + 0.1))}>+</button><button className="fit-button" aria-label="Fit page width" disabled={!document || !!busy} onClick={fitPage}>Width</button><button className="fit-button" aria-label="Fit whole page" disabled={!document || !!busy} onClick={fitWholePage}>Page</button><span className="toolbar-divider"/><button aria-label="Previous page" disabled={!document || !!busy || page === 0} onClick={() => navigate(page - 1)}>‹</button><form className="page-jump" onSubmit={event=>{event.preventDefault();const value=Number(pageInput);if (!Number.isInteger(value)||value<1||value>(document?.pages.length??0)) setError(`Enter a page from 1 to ${document?.pages.length??0}.`);else void navigate(value-1)}}><input aria-label="Go to page number" inputMode="numeric" value={pageInput} onChange={event=>setPageInput(event.target.value)} disabled={!document || !!busy}/><span>/ {document?.pages.length??0}</span><button className="visually-hidden" type="submit">Go to page</button></form><button aria-label="Next page" disabled={!document || !!busy || page + 1 >= document.pages.length} onClick={() => navigate(page + 1)}>›</button></div></div>
        {busy && <div className="job-progress" role="status"><progress aria-label="Document processing"/><span>{busy}</span><button disabled={recovering} onClick={recover}>{recovering ? 'Restoring…' : 'Cancel operation'}</button></div>}
        {notice && <div className="notice-banner" role="status">{notice}</div>}
        {error && <div className="error-banner" role="alert">{error}{checkpoint.current && <button onClick={recover}>Recover workspace</button>}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {view?.text.message && <div className="notice-banner">{view.text.message}</div>}
        {document && view && !view.text.message && !supported && <div className="notice-banner">This page has text, but none meets the supported editing checks. Select an amber region for details.</div>}
        <div className="page-stage" aria-busy={!!busy}><PagePreview image={view?.image} page={page} zoom={zoom} regions={view?.text.regions} edits={view?.edits} selected={selection} busy={!!busy} showRegions={showRegions} onSelect={selectRegion} tool={spacePan ? 'pan' : tool} objects={view?.objects.filter(object=>object.page===page)} selectedObject={objectSelection} dirty={dirty} strokeWidth={defaults.lineWidth} onSelectObject={selectObject} onPutObject={putObject} onCreateObject={createObject}/>{!document && !busy && <div className="empty-actions"><button className="primary" onClick={() => input.current?.click()}>Open PDF</button><button className="secondary" onClick={loadSample}>Open sample</button></div>}</div>
        <footer className="viewer-footer"><span role="status">{busy || (dirty ? 'Unapplied property changes' : document && (document.edits.length || document.objects.length) ? 'Actual edited PDF preview' : document ? `${supported} supported text regions on this page` : 'Open a PDF to begin')}</span><span>No uploads. No account.</span></footer>
      </section>
      {tool === 'edit' ? <TextProperties key={document?.source.id ?? 'empty'} region={selected} applied={applied} revision={view?.revision ?? 0} busy={!!busy} onApply={applyEdit} onDirty={setDirty}/> : <ObjectProperties key={document?.source.id ?? 'empty'} object={selectedObject} revision={view?.revision??0} tool={tool} defaults={defaults} asset={selectedObject?.kind==='image' ? assetFiles.current.get(selectedObject.assetId)?.info : pendingImage} busy={!!busy} onDefaults={value=>{toolDefaults.current[tool]=value;setDefaults(value)}} onApply={putObject} onDelete={deleteObject} onDirty={setDirty} onChooseImage={chooseImage} onPlace={placeAtCenter}/>}
    </main>
    <div className="foundation-note">PDF editor <span>Choose text, apply a change, and export the PDF. Your original file stays unchanged.</span><button className="text-button" onClick={loadSample} disabled={!!busy || dirty}>Open fresh sample</button></div>
  </div>
}

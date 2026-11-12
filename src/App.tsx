import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PdfWorkerClient } from './workers/client'
import type { OpenResult } from './workers/protocol'
import type { AddedObject, AddedText, EditorTool, EditorView, ImageAssetInfo, ObjectBox, Point, Rect, RenderedPage, SessionCheckpoint, TextEdit, TextRegion, WorkingDocument } from './model/document'
import type { PdfFeatures } from './model/utilities'
import { textDraft } from './model/text-draft'
import { toggleRange } from './model/fonts'
import type { StyledValue } from './components/RichTextField'
import { UtilityPanel } from './components/UtilityPanel'
import type { UtilityTab } from './components/UtilityPanel'
import type { InlineDraft } from './components/InlineTextEditor'
import { PagePreview } from './components/PagePreview'
import { PageRail } from './components/PageRail'
import { PageStack } from './components/PageStack'
import { InstallButton } from './components/InstallButton'
import { TextProperties } from './components/TextProperties'
import { downloadPdf } from './export/download'
import { takeHandOff } from './handoff'
import { ToolBar } from './components/ToolBar'
import { ObjectProperties } from './components/ObjectProperties'
import type { ToolDefaults } from './components/ObjectProperties'
import { clampBox, inkFromPoints, pointerToPage } from './geometry/objects'
import { exportCheckpoint, needsExport, planSignature } from './model/export-state'
import type { ExportCheckpoint } from './model/export-state'
import { useUnsavedChangesWarning } from './hooks/useUnsavedChangesWarning'
import { useDocumentActivity } from './offline/useDocumentActivity'

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
  const requestedUtility=useRef(new URLSearchParams(location.hash.split('?')[1]).get('tool'))
  const [initialUtility,setInitialUtility]=useState<UtilityTab>()
  const clipboardContext = useRef('')
  const lastPointer = useRef<Point | undefined>(undefined)
  const resetScroll = useRef(false)
  const [document, setDocument] = useState<WorkingDocument>()
  const [downloaded,setDownloaded] = useState<ExportCheckpoint>()
  const [view, setView] = useState<EditorView>()
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(0.9)
  const [busy, setBusy] = useState('Starting PDF engine…')
  useDocumentActivity(!!busy)
  // Controls dim and the progress bar appears only if work takes a moment. Quick edits
  // would otherwise flash every button. `run`'s inFlight guard still blocks double actions.
  const [slowBusy, setSlowBusy] = useState(false)
  useEffect(() => { if (!busy) { setSlowBusy(false); return } const timer = setTimeout(() => setSlowBusy(true), 400); return () => clearTimeout(timer) }, [!!busy])
  const shown = slowBusy ? busy : ''
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<string>()
  const [propertyDirty, setDirty] = useState(false)
  const [showRegions, setShowRegions] = useState(false)
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
  const [utilitiesOpen,setUtilitiesOpen] = useState(false)
  const [features,setFeatures] = useState<PdfFeatures>()
  // Page-list thumbnails, fetched one at a time so they never delay real work. A new document
  // clears them; an edit, undo or redo re-renders only pages whose edits or added items changed,
  // keeping the old preview on screen until the new one is ready.
  const [thumbs,setThumbs] = useState<Record<number,string>>({})
  const [pageSizes,setPageSizes] = useState<Rect[]>([])
  // Per-page version for the continuous page stack: a page re-renders when its edits or added items change.
  const pageStamps = useMemo(() => { const next: Record<number,string> = {}; for (const item of [...view?.edits ?? [], ...view?.objects ?? []]) next[item.page] = (next[item.page] ?? '') + JSON.stringify(item); return next }, [view?.revision, document?.source.id])
  const stampFor = useCallback((index: number) => pageStamps[index] ?? '', [pageStamps])
  const renderPage = useCallback((index: number, scale: number) => client.current!.request<RenderedPage>({ type: 'page-image', page: index, scale, dpr: window.devicePixelRatio }), [])
  const thumbsRef = useRef(thumbs); thumbsRef.current = thumbs
  const thumbQueue = useRef<number[]>([])
  const thumbRunning = useRef(false)
  const thumbStamp = useRef<Record<number,number>>({})
  const pageSignatures = useRef<Record<number,string>>({})
  const docId = document?.source.id
  const docIdRef = useRef(docId)
  useEffect(() => { docIdRef.current = docId; thumbQueue.current = []; thumbStamp.current = {}; pageSignatures.current = {}; setThumbs(old => { Object.values(old).forEach(URL.revokeObjectURL); return {} }) }, [docId])
  useEffect(() => () => { Object.values(thumbsRef.current).forEach(URL.revokeObjectURL) }, [])
  useEffect(() => {
    if (!view) return
    const next: Record<number,string> = {}
    for (const item of [...view.edits, ...view.objects]) next[item.page] = (next[item.page] ?? '') + JSON.stringify(item)
    const changed = [...new Set([...Object.keys(next), ...Object.keys(pageSignatures.current)].map(Number))].filter(index => next[index] !== pageSignatures.current[index])
    pageSignatures.current = next
    for (const index of changed) {
      thumbStamp.current[index] = (thumbStamp.current[index] ?? 0) + 1
      if (thumbsRef.current[index] && !thumbQueue.current.includes(index)) thumbQueue.current.unshift(index)
    }
    if (changed.length) void pumpThumbs()
  }, [view?.revision, docId])
  async function pumpThumbs() {
    if (thumbRunning.current) return
    thumbRunning.current = true
    try {
      while (thumbQueue.current.length && client.current) {
        const page = thumbQueue.current.shift()!, doc = docIdRef.current, stamp = thumbStamp.current[page] ?? 0
        try {
          const image = await client.current.request<RenderedPage>({ type: 'thumbnail', page, width: 200 })
          // Discard if the document was replaced or this page changed again meanwhile (it is queued again).
          if (doc !== docIdRef.current) continue
          if (stamp !== (thumbStamp.current[page] ?? 0)) { if (!thumbQueue.current.includes(page)) thumbQueue.current.push(page); continue }
          const url = URL.createObjectURL(new Blob([image.png], { type: 'image/png' }))
          setThumbs(old => { if (old[page]) URL.revokeObjectURL(old[page]); return { ...old, [page]: url } })
        } catch { /* a cleared or replaced document */ }
      }
    } finally { thumbRunning.current = false }
  }
  function needThumb(page: number) { if (!document || thumbQueue.current.includes(page)) return; thumbQueue.current.push(page); void pumpThumbs() }
  const [draftText,setDraftText] = useState<TextEdit>()
  const [inlineSource,setInlineSource] = useState(false)
  const [inlineAdded,setInlineAdded] = useState<AddedText>()
  const selectedObject = view?.objects.find(object => object.id === objectSelection && object.page === page)
  const selected = view?.text.regions.find(region => region.id === selection)
  const applied = view?.edits.find(edit => edit.regionId === selection)
  const dirty = propertyDirty || !!inlineAdded && (selectedObject?.kind!=='text'||inlineAdded.text!==selectedObject.text)
  const unexported = needsExport(document,downloaded)
  useUnsavedChangesWarning(unexported || dirty)
  clipboardContext.current = JSON.stringify([document?.source.id,page,tool,selection,objectSelection,dirty,view?.revision,utilitiesOpen])

  useEffect(() => {
    const requested=requestedUtility.current;requestedUtility.current=null
    const handed=takeHandOff()
    if(handed)void openFile(handed.file,handed.hasLocalCopy)
    else if(requested&&['organize','merge','extract','from-images','to-images','watermark','numbers','compress','redact','protect','unlock','sanitize','crop','fill','ocr'].includes(requested)){setInitialUtility(requested as UtilityTab);setUtilitiesOpen(true);setBusy('')}else setBusy('')
    return () => { generation.current++; client.current?.dispose() }
  }, [])

  async function run(action: (worker: PdfWorkerClient, token: number) => Promise<void>, label: string) {
    if (inFlight.current) return
    client.current ??= new PdfWorkerClient(setBusy)
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

  function acceptOpen(token: number, result: OpenResult, name: string, kind: 'sample' | 'local', hasLocalCopy = true) {
    if (token !== generation.current) return
    lastPointer.current=undefined
    setFeatures(result.info.features);setInlineSource(false);setInlineAdded(undefined);setDraftText(undefined)
    const sourceId = crypto.randomUUID()
    setDownloaded(hasLocalCopy ? { sourceId,plan:planSignature({edits:[],objects:[]}) } : undefined)
    setDocument({ source: { id: sourceId, name, kind, bytes: result.source }, pages: Array.from({ length: result.info.pageCount }, (_, i) => ({ sourceId, sourcePage: i, rotation: 0 })), edits: [], objects: [], revision: 0 })
    checkpoint.current = { frames:[{edits:[],objects:[]}],position:0,pdf:result.source,revision:0 }
    assetFiles.current.clear(); setPendingImage(undefined); setObjectSelection(undefined); setTool('edit')
    resetScroll.current = true; setPageSizes(result.info.sizes ?? [])
    setView(result.view); setZoom(result.scale); setPage(0); setPageInput('1'); setZoomInput(String(Math.round(result.scale*100))); setSelection(undefined); setDirty(false)
  }

  const openingOptions = () => ({ width: (preview.current?.clientWidth ?? 700) - 60, dpr: window.devicePixelRatio })
  async function openFile(file?: File, hasLocalCopy = true) {
    if (!file) return
    await run(async (worker, token) => {
      const bytes = await file.arrayBuffer()
      if (token !== generation.current) return
      acceptOpen(token, await worker.request<OpenResult>({ type: 'open', bytes, ...openingOptions() }), file.name, 'local',hasLocalCopy)
    }, 'Opening and checking PDF text…')
  }

  // keepScroll: the user scrolled to this page in the stack, so leave the scroll position alone.
  async function navigate(nextPage: number, nextZoom = zoom, keepScroll = false) {
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
      if (nextPage !== page) { setSelection(undefined); setObjectSelection(undefined); setDirty(false); resetScroll.current = !keepScroll }
      setPage(nextPage); setPageInput(String(nextPage+1))
    }, 'Rendering page…')
  }

  useLayoutEffect(() => {
    const stage = preview.current?.querySelector<HTMLElement>('.page-stage'), paper = preview.current?.querySelector<HTMLElement>('.page-paper')
    if (!stage || !paper || !view) return
    if (resetScroll.current) {
      // Bring the chosen page's top into view; pages are stacked in one scrolling column.
      const slot = stage.querySelector<HTMLElement>(`[data-page="${page}"]`)
      stage.scrollLeft = 0; stage.scrollTop = slot ? stage.scrollTop + slot.getBoundingClientRect().top - stage.getBoundingClientRect().top - 16 : 0
      resetScroll.current = false; zoomAnchor.current = undefined
    }
    else if (zoomAnchor.current) {
      const anchor = zoomAnchor.current, frame = stage.getBoundingClientRect(), rect = paper.getBoundingClientRect(), image = view.image
      stage.scrollLeft += rect.left + (anchor.point[0]*image.rasterScale-image.pixelOrigin[0])/image.width*rect.width - frame.left-anchor.viewport[0]
      stage.scrollTop += rect.top + (anchor.point[1]*image.rasterScale-image.pixelOrigin[1])/image.height*rect.height - frame.top-anchor.viewport[1]
      zoomAnchor.current = undefined
    }
    // Tell the page stack this position was set by the editor, not scrolled to by the user.
    stage.dataset.scrolledTo = String(Math.round(stage.scrollTop))
  },[view?.image,zoom])

  function activatePage(index: number) { if (index !== page && !dirty && !inFlight.current) void navigate(index, zoom, true) }

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
    setSelection(region.id); setError(''); if(selection!==region.id)setInlineSource(false)
  }

  function beginInline(region?:TextRegion) {
    if(!region||busy)return
    if(dirty&&selection!==region.id){setError('Apply or cancel your current draft first.');return}
    selectRegion(region)
    if(region.unsupported){setError(region.unsupported);return}
    if(selection!==region.id||!draftText)setDraftText(textDraft(region,view?.edits.find(edit=>edit.regionId===region.id)))
    setInlineSource(true);setInlineAdded(undefined)
  }
  function changeText(edit:TextEdit){setDraftText(edit);if(selected)setDirty(JSON.stringify(edit)!==JSON.stringify(textDraft(selected,applied)))}
  function beginAddedInline(object:AddedObject){if(object.kind!=='text'||busy||dirty)return;setObjectSelection(object.id);setInlineSource(false);setInlineAdded(structuredClone(object))}
  function cancelInline(){setInlineSource(false);setInlineAdded(undefined);if(selected)setDraftText(textDraft(selected,applied));setDirty(false)}

  async function applyEdit(edit: TextEdit) {
    await run(async (worker, token) => {
      const result = await worker.request<EditorView>({ type: 'edit', edit, scale: zoom, dpr: window.devicePixelRatio })
      if (token === generation.current) { commitView(result); setDirty(false);setInlineSource(false) }
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
    setTool(next); setSelection(undefined); setObjectSelection(undefined); setError('');setInlineSource(false);setInlineAdded(undefined)
    setDefaults(toolDefaults.current[next] ?? {color:next==='highlight'?'#ffe16b':'#2859cf',lineWidth:2,opacity:0.25,purpose:'note'})
  }

  function selectObject(id?: string) {
    if (dirty && objectSelection !== id) { setError('Apply or discard object property changes first.'); return }
    setObjectSelection(id); setSelection(undefined); setError('')
  }

  async function putObject(object: AddedObject) {
    await run(async (worker,token) => {
      const result = await worker.request<EditorView>({type:'object',object,scale:zoom,dpr:window.devicePixelRatio})
      if (token === generation.current) { commitView(result); setObjectSelection(object.id); setSelection(undefined); setDirty(false);setInlineAdded(object.kind==='text'&&!inlineAdded&&!view?.objects.some(old=>old.id===object.id)?structuredClone(object):undefined) }
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
  async function importImage(file?: File, immediate = false, at?:Point) {
    if (!file) return
    await run(async (worker,token) => {
      const bytes = await file.arrayBuffer(), id = crypto.randomUUID(), backup = bytes.slice(0)
      if (token !== generation.current) return
      const info = await worker.request<ImageAssetInfo>({type:'import-image',asset:{id,bytes}})
      if (token !== generation.current) return
      if (pendingImage) { assetFiles.current.delete(pendingImage.id); await worker.request({type:'release-image',id:pendingImage.id}) }
      assetFiles.current.set(id,{bytes:backup,info})
      const target = view?.objects.find(object => object.id === replacingImage.current)
      try {
      if (target?.kind === 'image' && view) {
        const box = clampBox({...target.box,height:target.box.width*info.height/info.width},view.image.bounds)
        const ratio = info.width/info.height; box.width = box.height*ratio
        const result = await worker.request<EditorView>({type:'object',object:{...target,assetId:id,box},scale:zoom,dpr:window.devicePixelRatio})
        if (token === generation.current) { commitView(result); setDirty(false) }
      } else if(immediate&&view) {
        const bounds=view.image.bounds,w=Math.min(180,bounds[2]-bounds[0]-4),h=w*info.height/info.width,scale=Math.min(1,(bounds[3]-bounds[1]-4)/h),width=w*scale,height=h*scale
        const box=clampBox({x:at?.[0]??(bounds[0]+bounds[2]-width)/2,y:at?.[1]??(bounds[1]+bounds[3]-height)/2,width,height},bounds)
        const object:AddedObject={kind:'image',id:crypto.randomUUID(),page,box,assetId:id}
        const result=await worker.request<EditorView>({type:'object',object,scale:zoom,dpr:window.devicePixelRatio})
        if(token===generation.current){setPendingImage(undefined);commitView(result);setTool('select');setSelection(undefined);setInlineSource(false);setInlineAdded(undefined);setObjectSelection(object.id);setDirty(false)}
      } else { setPendingImage(info); setTool('image'); setObjectSelection(undefined) }
      } catch(reason) {assetFiles.current.delete(id);await worker.request({type:'release-image',id}).catch(()=>{});throw reason}
    },'Reading JPG/PNG on this device…')
    replacingImage.current = undefined
  }

  async function recover() {
    const saved = checkpoint.current
    generation.current++; inFlight.current = true; setRecovering(true)
    client.current?.dispose(); client.current = null
    setPendingImage(undefined); setSpacePan(false)
    if (!saved || !document) { inFlight.current = false; setRecovering(false); setBusy(''); setNotice('Operation cancelled. Open a PDF to begin.'); return }
    client.current = new PdfWorkerClient(setBusy)
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
      if(utilitiesOpen)return
      const element = event.target as HTMLElement
      if (element.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]')) return
      if (event.code === 'Space') { event.preventDefault(); setSpacePan(true); return }
      // Cmd/Ctrl+B and I with nothing focused: restyle the selected line's draft, or the selected text box.
      const styleKey = !busy && document && ['b','i'].includes(event.key.toLowerCase()) && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
      const toggle = event.key.toLowerCase() === 'b' ? 'bold' : 'italic'
      if (styleKey && tool === 'edit' && selected && !selected.unsupported) { event.preventDefault(); const base = draftText ?? textDraft(selected, applied); changeText({...base, spans: undefined, ...toggleRange(base.text, base.font, base.spans, 0, 0, toggle)}); return }
      if (styleKey && !dirty && selectedObject?.kind === 'text') { event.preventDefault(); void putObject({...selectedObject, spans: undefined, ...toggleRange(selectedObject.text, selectedObject.font, selectedObject.spans, 0, 0, toggle)}); return }
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
  },[document,busy,view,dirty,page,zoom,selectedObject,utilitiesOpen,tool,selected,draftText,applied])

  function clear() {
    generation.current++; inFlight.current = false
    client.current?.dispose(); client.current = null
    checkpoint.current = undefined; assetFiles.current.clear(); setObjectSelection(undefined); setPendingImage(undefined); setTool('edit'); setRecovering(false); setNotice('');
    if(input.current)input.current.value=''
    if(imageInput.current)imageInput.current.value=''
    replacingImage.current=undefined;lastPointer.current=undefined;zoomAnchor.current=undefined
    setInlineSource(false);setInlineAdded(undefined);setDraftText(undefined);setFeatures(undefined)
    setDocument(undefined);setPageSizes([]);setDownloaded(undefined); setView(undefined); setPage(0); setSelection(undefined); setDirty(false); setError(''); setBusy('')
  }

  function exportPdf() {
    if (!document || !checkpoint.current || busy || dirty) return
    const base=document.source.name.replace(/\.pdf$/i,'')
    downloadPdf(checkpoint.current.pdf.slice(0),document.edits.length||document.objects.length?`${base}-edited.pdf`:document.source.name)
    setDownloaded(exportCheckpoint(document))
  }

  const supported = view?.text.regions.filter(region => !region.unsupported).length ?? 0
  useEffect(()=>{setDraftText(selected?textDraft(selected,applied):undefined);if(tool==='edit')setDirty(false)},[selection,view?.revision])

  function pasteText(value:string){
    if(!view||busy||dirty)return
    if(selected&&!selected.unsupported&&tool==='edit'){
      const edit={...textDraft(selected,applied),text:value};setDraftText(edit);setInlineSource(true);setDirty(JSON.stringify(edit)!==JSON.stringify(textDraft(selected,applied)))
    }else if(selected?.unsupported&&tool==='edit'){setError(selected.unsupported)}
    else if(selectedObject?.kind==='text') {setInlineAdded({...selectedObject,text:value});setDirty(value!==selectedObject.text)}
    else {
      const bounds=view.image.bounds,width=Math.min(260,bounds[2]-bounds[0]-4),height=Math.min(100,bounds[3]-bounds[1]-4)
      const box=clampBox({x:lastPointer.current?.[0]??(bounds[0]+bounds[2]-width)/2,y:lastPointer.current?.[1]??(bounds[1]+bounds[3]-height)/2,width,height},bounds)
      const draft:AddedText={kind:'text',id:crypto.randomUUID(),page,box,text:value,font:'Helvetica',size:16,color:defaults.color};setTool('select');setSelection(undefined);setObjectSelection(draft.id);setInlineAdded(draft);setDirty(true)
    }
  }
  async function pasteFromClipboard(){
    if(!view||busy||dirty)return
    const context=clipboardContext.current,token=generation.current
    const stillCurrent=()=>{if(context===clipboardContext.current&&token===generation.current)return true;setNotice('Paste cancelled because the workspace changed. Paste again in the current document.');return false}
    try{
      if(!navigator.clipboard?.read)throw new Error('Use Ctrl/Cmd+V over the document to paste, or choose a local image.')
      const items=await navigator.clipboard.read();if(!stillCurrent())return
      for(const item of items){const image=item.types.find(type=>type==='image/png'||type==='image/jpeg');if(image){const blob=await item.getType(image);if(!stillCurrent())return;replacingImage.current=undefined;await importImage(new File([blob],image==='image/png'?'pasted.png':'pasted.jpg',{type:image}),true,lastPointer.current);return}}
      const text=items.find(item=>item.types.includes('text/plain'));if(text){const value=await (await text.getType('text/plain')).text();if(stillCurrent())pasteText(value);return}
      setError('The clipboard has no supported text or JPG/PNG image. Copy text or an image first.')
    }catch{setError('Clipboard access is unavailable. Use Ctrl/Cmd+V over the document, or choose a local image.')}
  }
  useEffect(()=>{
    const nativeField=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"],dialog')
    const copy=(event:ClipboardEvent)=>{
      if(utilitiesOpen||nativeField(event.target)||window.getSelection()?.toString())return
      const value=tool==='edit'&&selected?(applied?.text??selected.text):selectedObject?.kind==='text'?selectedObject.text:undefined
      if(value!==undefined){event.preventDefault();event.clipboardData?.setData('text/plain',value)}
    }
    const paste=(event:ClipboardEvent)=>{
      if(utilitiesOpen||nativeField(event.target)||!view||busy)return
      if(dirty){event.preventDefault();setError('Apply or cancel your draft before pasting another object.');return}
      const file=Array.from(event.clipboardData?.files??[]).find(file=>file.type==='image/png'||file.type==='image/jpeg')
      if(file){event.preventDefault();replacingImage.current=undefined;void importImage(file,true,lastPointer.current);return}
      const value=event.clipboardData?.getData('text/plain');if(value){event.preventDefault();pasteText(value)}
    }
    window.addEventListener('copy',copy);window.addEventListener('paste',paste)
    return()=>{window.removeEventListener('copy',copy);window.removeEventListener('paste',paste)}
  },[utilitiesOpen,view,busy,dirty,page,zoom,selection,objectSelection,tool])
  let inlineDraft:InlineDraft|undefined
  if(inlineSource&&selected&&draftText)inlineDraft={...draftText,bounds:selected.bounds,direction:selected.direction,multiline:false,wrap:(selected.lines??1)>1}
  else if(inlineAdded)inlineDraft={...inlineAdded,bounds:[inlineAdded.box.x,inlineAdded.box.y,inlineAdded.box.x+inlineAdded.box.width,inlineAdded.box.y+inlineAdded.box.height],multiline:true}
  function updateInline(value:StyledValue){if(inlineSource&&draftText)changeText({...draftText,...value});else if(inlineAdded){const next={...inlineAdded,...value};setInlineAdded(next);setDirty(selectedObject?.kind!=='text'||JSON.stringify([next.text,next.font,next.spans])!==JSON.stringify([selectedObject.text,selectedObject.font,selectedObject.spans]))}}
  function applyInline(){if(inlineSource&&draftText)void applyEdit(draftText);else if(inlineAdded)void putObject(inlineAdded)}
  function openTools(){if(dirty||busy)return;setInitialUtility(undefined);setUtilitiesOpen(true);setInlineSource(false);setInlineAdded(undefined)}

  return <div className="app-shell">
    <header className="app-header">
      <a href="./" className="brand" aria-label="margin.pdf home"><span className="brand-mark" aria-hidden="true"/>margin<span className="brand-extension">.pdf</span></a>
      <div className="document-identity"><strong title={document?.source.name}>{document?.source.name ?? 'No document open'}</strong>{document && document.edits.length + document.objects.length > 0 && <span className="edited-badge">{document.edits.length + document.objects.length} {document.edits.length + document.objects.length === 1 ? 'change' : 'changes'}</span>}{(document||busy)&&<button className="icon-button" aria-label="Clear workspace" title={busy?"Cancel and close document":"Close document"} onClick={clear}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>}</div>
      <div className="header-actions"><div className="history-actions"><button aria-label="Undo document change" title="Undo (Ctrl/Cmd+Z)" disabled={!!shown || !view?.canUndo || dirty} onClick={() => history('undo')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button><button aria-label="Redo document change" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!!shown || !view?.canRedo || dirty} onClick={() => history('redo')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/></svg></button></div><InstallButton className="secondary editor-install" label="Install"/><button className="secondary" onClick={() => input.current?.click()} disabled={!!shown || dirty}><span aria-hidden="true">↥</span> Open PDF</button><button className="primary" disabled={!document || !!shown || dirty} onClick={exportPdf} title={dirty ? 'Apply or discard text changes before export' : 'Download the PDF shown in the preview'}>Export PDF <span aria-hidden="true">↓</span></button></div>
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,.jpg,.jpeg,.png" hidden onChange={event => { void importImage(event.target.files?.[0]); event.target.value = '' }}/><input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={event => { void openFile(event.target.files?.[0]); event.target.value = '' }}/>
    </header>
    <div className="workspace-tools"><ToolBar tool={tool} busy={!!shown || !document} onChoose={chooseTool}/><label className="regions-toggle" title="Outline every piece of text that can be edited"><input type="checkbox" checked={showRegions} onChange={event => setShowRegions(event.target.checked)}/> Show editable text</label><div className="viewer-controls"><button aria-label="Zoom out" disabled={!document || !!shown || zoom <= 0.1} onClick={() => navigate(page, Math.max(0.1, zoom - 0.1))}>−</button><form className="zoom-form" onSubmit={event => {event.preventDefault();const value=Number(zoomInput);if (!Number.isFinite(value)||value<10||value>400) setError('Enter zoom from 10% to 400%.');else void navigate(page,value/100)}}><input aria-label="Zoom percent" inputMode="numeric" value={zoomInput} onChange={event=>setZoomInput(event.target.value)} disabled={!!shown || !document}/><span>%</span><button className="visually-hidden" type="submit">Apply zoom</button></form><button aria-label="Zoom in" disabled={!document || !!shown || zoom >= 4} onClick={() => navigate(page, Math.min(4, zoom + 0.1))}>+</button><button className="fit-button" aria-label="Fit page width" disabled={!document || !!shown} onClick={fitPage}>Width</button><button className="fit-button" aria-label="Fit whole page" disabled={!document || !!shown} onClick={fitWholePage}>Page</button><span className="toolbar-divider"/><button aria-label="Previous page" disabled={!document || !!shown || page === 0} onClick={() => navigate(page - 1)}>‹</button><form className="page-jump" onSubmit={event=>{event.preventDefault();const value=Number(pageInput);if (!Number.isInteger(value)||value<1||value>(document?.pages.length??0)) setError(`Enter a page from 1 to ${document?.pages.length??0}.`);else void navigate(value-1)}}><input aria-label="Go to page number" inputMode="numeric" value={pageInput} onChange={event=>setPageInput(event.target.value)} disabled={!document || !!shown}/><span>/ {document?.pages.length??0}</span><button className="visually-hidden" type="submit">Go to page</button></form><button aria-label="Next page" disabled={!document || !!shown || page + 1 >= document.pages.length} onClick={() => navigate(page + 1)}>›</button></div><div className="clipboard-tools"><button disabled={!!shown||dirty||!document} onClick={pasteFromClipboard} title="Paste text or an image (Ctrl/Cmd+V)">Paste</button>{selected&&<button disabled={!!shown} onClick={()=>{if(!navigator.clipboard?.writeText){setError('Use Ctrl/Cmd+C to copy the selected text.');return}void navigator.clipboard.writeText(applied?.text??selected.text).catch(()=>setError('Use Ctrl/Cmd+C to copy the selected text.'))}}>Copy text</button>}<button onClick={openTools} disabled={!!shown||dirty}>Page tools</button></div></div>
    <main className="workspace">
      <PageRail count={document?.pages.length ?? 0} active={page} image={view?.image} thumbs={thumbs} busy={!!shown} onSelect={navigate} onNeedThumb={needThumb}/>
      <section ref={preview} className="document-area" aria-label="PDF preview" onPointerMove={event=>{const paper=preview.current?.querySelector<HTMLElement>('.page-paper');if(paper&&view&&paper.contains(event.target as Node))lastPointer.current=pointerToPage([event.clientX,event.clientY],paper.getBoundingClientRect(),view.image)}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=busy||dirty?'none':'copy'}}} onDrop={event=>{event.preventDefault();if(busy||dirty){setError('Apply or cancel your draft before dropping a file.');return}const pdf=Array.from(event.dataTransfer.files).find(file=>file.type==='application/pdf'||/\.pdf$/i.test(file.name));if(pdf){void openFile(pdf);return}const file=Array.from(event.dataTransfer.files).find(file=>file.type==='image/png'||file.type==='image/jpeg');if(!file){setError(document?'Drop a PDF to open it, or a JPG or PNG to place it on the page.':'Drop a PDF to open it.');return}const paper=preview.current?.querySelector<HTMLElement>('.page-paper'),point=paper&&view?pointerToPage([event.clientX,event.clientY],paper.getBoundingClientRect(),view.image):undefined;replacingImage.current=undefined;void importImage(file,true,point)}}>
        {shown && <div className="job-progress" role="status"><progress aria-label="Document processing"/><span>{shown}</span><button disabled={recovering} onClick={recover}>{recovering ? 'Restoring…' : 'Cancel operation'}</button></div>}
        {notice && <div className="notice-banner" role="status">{notice}</div>}
        {features?.signed&&<div className="notice-banner">Digital signature detected. Editing and page transformations may invalidate it. This editor does not verify certificates; save the original separately.</div>}
        {features?.signatureCheckIncomplete&&<div className="notice-banner">Some PDF objects could not be inspected for signatures. Changes may invalidate signatures in this document.</div>}
        {error && <div className="error-banner" role="alert">{error}{checkpoint.current && <button onClick={recover}>Recover workspace</button>}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {view?.text.message && <div className="notice-banner">{view.text.message}</div>}
        {document && view && !view.text.message && !supported && <div className="notice-banner">This page has text, but none meets the supported editing checks. Select an amber region for details.</div>}
        <div className="page-stage" aria-busy={!!busy}>{document && pageSizes.length ? <PageStack sizes={pageSizes} zoom={zoom} active={page} activeImage={view?.image} thumbs={thumbs} stamp={stampFor} busy={!!busy} render={renderPage} onNeedThumb={needThumb} onActivate={activatePage}><PagePreview image={view?.image} page={page} zoom={zoom} regions={view?.text.regions} edits={view?.edits} selected={selection} busy={!!shown} showRegions={showRegions} onSelect={selectRegion} tool={spacePan ? 'pan' : tool} objects={view?.objects.filter(object=>object.page===page)} selectedObject={objectSelection} dirty={dirty} strokeWidth={defaults.lineWidth} onSelectObject={selectObject} onPutObject={putObject} onCreateObject={createObject} onInline={beginInline} onEditObjectText={beginAddedInline} inlineDraft={inlineDraft} onInlineChange={updateInline} onInlineApply={applyInline} onInlineCancel={cancelInline}/></PageStack> : <PagePreview image={view?.image} page={page} zoom={zoom} regions={view?.text.regions} edits={view?.edits} selected={selection} busy={!!shown} showRegions={showRegions} onSelect={selectRegion} tool={spacePan ? 'pan' : tool} objects={view?.objects.filter(object=>object.page===page)} selectedObject={objectSelection} dirty={dirty} strokeWidth={defaults.lineWidth} onSelectObject={selectObject} onPutObject={putObject} onCreateObject={createObject} onInline={beginInline} onEditObjectText={beginAddedInline} inlineDraft={inlineDraft} onInlineChange={updateInline} onInlineApply={applyInline} onInlineCancel={cancelInline}/>}{!document && !busy && <div className="empty-actions"><button className="primary" onClick={() => input.current?.click()}>Open PDF</button></div>}</div>
        <footer className="viewer-footer"><span role="status">{shown || (dirty ? 'Unapplied changes — apply and export before refreshing' : unexported ? 'Unexported changes — export before refreshing or closing' : document && (document.edits.length || document.objects.length) ? 'Actual edited PDF preview' : document ? `${supported} supported text regions on this page` : 'Open a PDF to begin')}</span></footer>
      </section>
      {tool === 'edit' ? <TextProperties key={document?.source.id ?? 'empty'} region={selected} applied={applied} draft={draftText} busy={!!shown} onApply={applyEdit} onChange={changeText} onInline={()=>beginInline(selected)}/> : <ObjectProperties key={document?.source.id ?? 'empty'} object={selectedObject} revision={view?.revision??0} tool={tool} defaults={defaults} asset={selectedObject?.kind==='image' ? assetFiles.current.get(selectedObject.assetId)?.info : pendingImage} busy={!!shown||!!inlineAdded} onDefaults={value=>{toolDefaults.current[tool]=value;setDefaults(value)}} onApply={putObject} onDelete={deleteObject} onDirty={setDirty} onChooseImage={chooseImage} onPlace={placeAtCenter}/>}
    </main>
    {utilitiesOpen&&<UtilityPanel initialTab={initialUtility} current={document&&checkpoint.current?{bytes:checkpoint.current.pdf,name:document.source.name,count:document.pages.length}:undefined} onClose={()=>setUtilitiesOpen(false)} onOpen={(bytes,name,hasLocalCopy)=>{setUtilitiesOpen(false);void openFile(new File([bytes],name,{type:'application/pdf'}),hasLocalCopy)}}/>}

  </div>
}

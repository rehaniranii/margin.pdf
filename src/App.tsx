import { useEffect, useRef, useState } from 'react'
import { PdfWorkerClient } from './workers/client'
import type { OpenResult } from './workers/protocol'
import type { EditorView, TextEdit, TextRegion, WorkingDocument } from './model/document'
import { PagePreview } from './components/PagePreview'
import { PageRail } from './components/PageRail'
import { TextProperties } from './components/TextProperties'
import { downloadPdf } from './export/download'
import { ThemeToggle } from './theme'

export default function App() {
  const client = useRef<PdfWorkerClient | null>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLElement>(null)
  const [document, setDocument] = useState<WorkingDocument>()
  const [view, setView] = useState<EditorView>()
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(0.9)
  const [busy, setBusy] = useState('Starting PDF engine…')
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<string>()
  const [dirty, setDirty] = useState(false)
  const [showRegions, setShowRegions] = useState(true)

  useEffect(() => {
    client.current = new PdfWorkerClient()
    void loadSample()
    return () => { generation.current++; client.current?.dispose() }
  }, [])

  async function run(action: (worker: PdfWorkerClient, token: number) => Promise<void>, label: string) {
    if (!client.current || inFlight.current) return
    inFlight.current = true
    const token = ++generation.current
    setBusy(label); setError('')
    try { await action(client.current, token) }
    catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : 'The document could not be processed.') }
    finally { if (token === generation.current) { setBusy(''); inFlight.current = false } }
  }

  function commitView(next: EditorView) {
    setView(next)
    setDocument(current => current ? { ...current, edits: next.edits, revision: next.revision } : current)
  }

  function acceptOpen(token: number, result: OpenResult, name: string, kind: 'sample' | 'local') {
    if (token !== generation.current) return
    const sourceId = crypto.randomUUID()
    setDocument({ source: { id: sourceId, name, kind, bytes: result.source }, pages: Array.from({ length: result.info.pageCount }, (_, i) => ({ sourceId, sourcePage: i, rotation: 0 })), edits: [], revision: 0 })
    setView(result.view); setZoom(result.scale); setPage(0); setSelection(undefined); setDirty(false)
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
    await run(async (worker, token) => {
      const result = await worker.request<EditorView>({ type: 'view', page: nextPage, scale: nextZoom, dpr: window.devicePixelRatio })
      if (token !== generation.current) return
      commitView(result); setZoom(nextZoom)
      if (nextPage !== page) { setSelection(undefined); setDirty(false) }
      setPage(nextPage)
    }, 'Rendering page…')
  }

  function fitPage() {
    if (!view || !preview.current) return
    void navigate(page, Math.max(0.1, Math.min(2, (preview.current.clientWidth - 60) / (view.image.bounds[2] - view.image.bounds[0]))))
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

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if (element.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && document && !busy) {
        event.preventDefault()
        if (event.shiftKey ? view?.canRedo : view?.canUndo) void history(event.shiftKey ? 'redo' : 'undo')
      } else if (event.key === 'Escape' && !dirty) setSelection(undefined)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [document, busy, view, dirty, page, zoom])

  function clear() {
    generation.current++; inFlight.current = false
    client.current?.dispose(); client.current = new PdfWorkerClient()
    setDocument(undefined); setView(undefined); setPage(0); setSelection(undefined); setDirty(false); setError(''); setBusy('')
  }

  async function exportPdf() {
    await run(async (worker, token) => {
      const bytes = await worker.request<ArrayBuffer>({ type: 'export' })
      const base = document?.source.name.replace(/\.pdf$/i, '') ?? 'margin-pdf'
      if (token === generation.current) downloadPdf(bytes, document?.edits.length ? `${base}-edited.pdf` : document?.source.name ?? 'margin-pdf.pdf')
    }, 'Preparing local download…')
  }

  const selected = view?.text.regions.find(region => region.id === selection)
  const applied = view?.edits.find(edit => edit.regionId === selection)
  const supported = view?.text.regions.filter(region => !region.unsupported).length ?? 0

  return <div className="app-shell">
    <header className="app-header">
      <a href="./" className="brand" aria-label="margin.pdf home"><span className="brand-mark" aria-hidden="true">m<span>.</span></span>margin<span className="brand-extension">.pdf</span></a>
      <div className="local-badge"><span/>On your device</div>
      <div className="header-actions"><ThemeToggle/><button className="secondary" onClick={() => input.current?.click()} disabled={!!busy || dirty}><span aria-hidden="true">↥</span> Open PDF</button><button className="primary" disabled={!document || !!busy || dirty} onClick={exportPdf} title={dirty ? 'Apply or discard text changes before export' : 'Download the PDF shown in the preview'}>Export PDF <span aria-hidden="true">↓</span></button></div>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={event => { void openFile(event.target.files?.[0]); event.target.value = '' }}/>
    </header>
    <div className="document-bar"><div className="document-identity"><span className="file-symbol" aria-hidden="true">PDF</span><strong title={document?.source.name}>{document?.source.name ?? 'No document open'}</strong>{document?.source.kind === 'sample' && <span className="sample-badge">Sample</span>}{document && document.edits.length > 0 && <span className="edited-badge">{document.edits.length} edited</span>}</div><div className="history-actions"><button aria-label="Undo document change" title="Undo (Ctrl/Cmd+Z)" disabled={!!busy || !view?.canUndo || dirty} onClick={() => history('undo')}>↶ <span>Undo</span></button><button aria-label="Redo document change" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!!busy || !view?.canRedo || dirty} onClick={() => history('redo')}>↷ <span>Redo</span></button><button className="text-button" onClick={clear}>Clear workspace{busy ? ' / cancel' : ''}</button></div></div>
    <main className="workspace">
      <PageRail count={document?.pages.length ?? 0} active={page} image={view?.image} busy={!!busy} onSelect={navigate}/>
      <section ref={preview} className="document-area" aria-label="PDF preview">
        <div className="viewer-toolbar"><label className="regions-toggle"><input type="checkbox" checked={showRegions} onChange={event => setShowRegions(event.target.checked)}/> Text regions</label><div className="viewer-controls"><button aria-label="Zoom out" disabled={!document || !!busy || zoom <= 0.1} onClick={() => navigate(page, Math.max(0.1, zoom - 0.1))}>−</button><output aria-label="Zoom level">{Math.round(zoom * 100)}%</output><button aria-label="Zoom in" disabled={!document || !!busy || zoom >= 2} onClick={() => navigate(page, Math.min(2, zoom + 0.1))}>+</button><button className="fit-button" aria-label="Fit page width" disabled={!document || !!busy} onClick={fitPage}>Fit</button><span className="toolbar-divider"/><button aria-label="Previous page" disabled={!document || !!busy || page === 0} onClick={() => navigate(page - 1)}>‹</button><span>{document ? `${page + 1} / ${document.pages.length}` : '0 / 0'}</span><button aria-label="Next page" disabled={!document || !!busy || page + 1 >= document.pages.length} onClick={() => navigate(page + 1)}>›</button></div></div>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {view?.text.message && <div className="notice-banner">{view.text.message}</div>}
        {document && view && !view.text.message && !supported && <div className="notice-banner">This page has text, but none meets the supported editing checks. Select an amber region for details.</div>}
        <div className="page-stage" aria-busy={!!busy}><PagePreview image={view?.image} page={page} zoom={zoom} regions={view?.text.regions} edits={view?.edits} selected={selection} busy={!!busy} showRegions={showRegions} onSelect={selectRegion}/>{!document && !busy && <div className="empty-actions"><button className="primary" onClick={() => input.current?.click()}>Open PDF</button><button className="secondary" onClick={loadSample}>Open sample</button></div>}</div>
        <footer className="viewer-footer"><span role="status">{busy || (dirty ? 'Unapplied text changes' : document?.edits.length ? 'Verified edited PDF preview' : document ? `${supported} supported text regions on this page` : 'Open a PDF to begin')}</span><span>No uploads. No account.</span></footer>
      </section>
      <TextProperties key={document?.source.id ?? 'empty'} region={selected} applied={applied} revision={view?.revision ?? 0} busy={!!busy} onApply={applyEdit} onDirty={setDirty}/>
    </main>
    <div className="foundation-note">Existing-text editor <span>Choose text, apply a change, and export the PDF. Your original file stays unchanged.</span><button className="text-button" onClick={loadSample} disabled={!!busy || dirty}>Open fresh sample</button></div>
  </div>
}

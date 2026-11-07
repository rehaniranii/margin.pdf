import type * as mupdf from 'mupdf'
import type { EditorView, TextEdit } from '../model/document'
import { openPdf, render } from './mupdf-adapter'
import { analyzePage } from './text-analysis'
import type { Analysis } from './text-analysis'
import { compileTextEdits } from './text-edit'

// History stores compact edit plans, not copies of every PDF. A candidate must
// compile, reopen, verify, and render successfully before any state is committed.
export class EditorSession {
  readonly source: Uint8Array<ArrayBuffer>
  private sourceDoc: mupdf.PDFDocument
  private currentDoc: mupdf.PDFDocument
  private bytes: Uint8Array<ArrayBuffer>
  private history: TextEdit[][] = [[]]
  private position = 0
  private revision = 0
  private cache = new Map<number, Analysis>()
  constructor(source: Uint8Array<ArrayBuffer>) {
    this.source = source.slice()
    this.sourceDoc = openPdf(this.source)
    this.currentDoc = this.sourceDoc
    this.bytes = this.source
  }
  get count() { return this.sourceDoc.countPages() }
  bounds(index: number) {
    const page = this.sourceDoc.loadPage(index)
    try { return page.getBounds() } finally { page.destroy() }
  }
  private analysis(page: number): Analysis {
    const cached = this.cache.get(page)
    if (cached) { this.cache.delete(page); this.cache.set(page, cached); return cached }
    const value = analyzePage(this.sourceDoc, page)
    this.cache.set(page, value)
    if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value!)
    return value
  }
  view(page: number, scale: number, dpr: number): EditorView {
    return { image: render(this.currentDoc, page, scale, dpr), text: this.analysis(page).view, edits: structuredClone(this.history[this.position]), revision: this.revision, canUndo: this.position > 0, canRedo: this.position + 1 < this.history.length }
  }
  apply(edit: TextEdit, scale: number, dpr: number): EditorView {
    const plan = this.history[this.position].filter(old => old.regionId !== edit.regionId || old.page !== edit.page)
    const next = [...plan, structuredClone(edit)]
    const view = this.compile(next, edit.page, scale, dpr)
    this.history = [...this.history.slice(0, this.position + 1), next]
    this.position++
    return { ...view, canUndo: true, canRedo: false }
  }
  undo(page: number, scale: number, dpr: number): EditorView { return this.move(-1, page, scale, dpr) }
  redo(page: number, scale: number, dpr: number): EditorView { return this.move(1, page, scale, dpr) }
  private move(delta: number, page: number, scale: number, dpr: number): EditorView {
    const position = this.position + delta
    if (position < 0 || position >= this.history.length) throw new Error('There is no further history in that direction.')
    const view = this.compile(this.history[position], page, scale, dpr)
    this.position = position
    return { ...view, canUndo: position > 0, canRedo: position + 1 < this.history.length }
  }
  private compile(edits: TextEdit[], page: number, scale: number, dpr: number): EditorView {
    const bytes = compileTextEdits(this.source, edits, index => this.analysis(index))
    const candidate = openPdf(bytes)
    try {
      const image = render(candidate, page, scale, dpr)
      const text = this.analysis(page).view
      if (this.currentDoc !== this.sourceDoc) this.currentDoc.destroy()
      this.currentDoc = candidate; this.bytes = bytes; this.revision++
      return { image, text, edits: structuredClone(edits), revision: this.revision, canUndo: false, canRedo: false }
    } catch (error) { candidate.destroy(); throw error }
  }
  export() { return this.bytes.slice().buffer }
  dispose() { if (this.currentDoc !== this.sourceDoc) this.currentDoc.destroy(); this.sourceDoc.destroy(); this.cache.clear() }
}

import type * as mupdf from 'mupdf'
import type { AddedObject, EditPlan, EditorView, ImageAssetInput, SessionCheckpoint, TextEdit } from '../model/document'
import { openPdf, render } from './mupdf-adapter'
import { analyzePage } from './text-analysis'
import type { Analysis } from './text-analysis'
import { compileTextEdits } from './text-edit'
import { compileObjects } from './added-objects'
import { ImageAssets } from './image-assets'

export class EditorSession {
  readonly source: Uint8Array<ArrayBuffer>
  private sourceDoc: mupdf.PDFDocument
  private currentDoc: mupdf.PDFDocument
  private bytes: Uint8Array<ArrayBuffer>
  private history: EditPlan[] = [{ edits: [], objects: [] }]
  private position = 0
  private revision = 0
  private cache = new Map<number, Analysis>()
  private textCache?: { key: string; bytes: Uint8Array<ArrayBuffer> }
  private assets = new ImageAssets()
  private pendingAssets = new Set<string>()
  constructor(source: Uint8Array<ArrayBuffer>, private progress?: (label: string) => void) {
    this.source = source.slice(); this.sourceDoc = openPdf(this.source)
    this.currentDoc = this.sourceDoc; this.bytes = this.source
  }
  get count() { return this.sourceDoc.countPages() }
  bounds(index: number) { const page = this.sourceDoc.loadPage(index); try { return page.getBounds() } finally { page.destroy() } }
  private analysis(page: number): Analysis {
    const cached = this.cache.get(page)
    if (cached) { this.cache.delete(page); this.cache.set(page, cached); return cached }
    this.progress?.(`Checking text on page ${page + 1}…`)
    const value = analyzePage(this.sourceDoc, page); this.cache.set(page, value)
    if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value!)
    return value
  }
  private usedAssets() { return new Set(this.history.flatMap(plan => plan.objects.flatMap(object => object.kind === 'image' ? [object.assetId] : []))) }
  private describe(plan: EditPlan) {
    return { edits: structuredClone(plan.edits), objects: structuredClone(plan.objects), revision: this.revision, canUndo: this.position > 0, canRedo: this.position + 1 < this.history.length, historyPosition: this.position, historyLength: this.history.length, assetIds: [...this.usedAssets()] }
  }
  view(page: number, scale: number, dpr: number): EditorView {
    this.progress?.(`Rendering page ${page + 1}…`)
    return { image: render(this.currentDoc, page, scale, dpr), text: this.analysis(page).view, ...this.describe(this.history[this.position]) }
  }
  apply(edit: TextEdit, scale: number, dpr: number) {
    const current = this.history[this.position]
    return this.push({ objects: current.objects, edits: [...current.edits.filter(old => old.regionId !== edit.regionId || old.page !== edit.page), structuredClone(edit)] }, edit.page, scale, dpr)
  }
  putObject(object: AddedObject, scale: number, dpr: number) {
    const current = this.history[this.position], objects = current.objects.slice(), index = objects.findIndex(old => old.id === object.id)
    if (index < 0) objects.push(structuredClone(object)); else objects[index] = structuredClone(object)
    return this.push({ edits: current.edits, objects }, object.page, scale, dpr)
  }
  deleteObject(id: string, page: number, scale: number, dpr: number) {
    const current = this.history[this.position]
    if (!current.objects.some(object => object.id === id && object.page === page)) throw new Error('Select an added object to delete.')
    return this.push({ edits: current.edits, objects: current.objects.filter(object => object.id !== id) }, page, scale, dpr)
  }
  private push(plan: EditPlan, page: number, scale: number, dpr: number) {
    const result = this.compile(plan, page, scale, dpr)
    this.history = [...this.history.slice(0, this.position + 1), plan]; this.position++
    for (const object of plan.objects) if (object.kind === 'image') this.pendingAssets.delete(object.assetId)
    this.assets.prune(new Set([...this.usedAssets(),...this.pendingAssets]))
    return { ...result, ...this.describe(plan) }
  }
  undo(page: number, scale: number, dpr: number) { return this.move(-1, page, scale, dpr) }
  redo(page: number, scale: number, dpr: number) { return this.move(1, page, scale, dpr) }
  private move(delta: number, page: number, scale: number, dpr: number) {
    const position = this.position + delta
    if (position < 0 || position >= this.history.length) throw new Error('There is no further history in that direction.')
    const result = this.compile(this.history[position], page, scale, dpr)
    this.position = position
    return { ...result, ...this.describe(this.history[position]) }
  }
  private compile(plan: EditPlan, page: number, scale: number, dpr: number): EditorView {
    this.progress?.('Compiling and verifying text changes…')
    const key = JSON.stringify(plan.edits)
    const textBytes = this.textCache?.key === key ? this.textCache.bytes : compileTextEdits(this.source, plan.edits, index => this.analysis(index))
    this.textCache = { key, bytes: textBytes }
    const bytes = compileObjects(textBytes, plan.objects, this.assets, this.progress)
    this.progress?.('Reopening the updated PDF…')
    const candidate = openPdf(bytes)
    try {
      this.progress?.(`Rendering page ${page + 1}…`)
      const image = render(candidate, page, scale, dpr), text = this.analysis(page).view
      if (this.currentDoc !== this.sourceDoc) this.currentDoc.destroy()
      this.currentDoc = candidate; this.bytes = bytes; this.revision++
      return { image, text, ...this.describe(plan), checkpointPdf: bytes.slice().buffer }
    } catch (error) { candidate.destroy(); throw error }
  }
  importImage(input: ImageAssetInput) { this.progress?.('Decoding image locally…'); const info = this.assets.add(input); this.pendingAssets.add(input.id); return info }
  releaseImage(id: string) { this.pendingAssets.delete(id); this.assets.prune(new Set([...this.usedAssets(),...this.pendingAssets])) }
  snapshot(): SessionCheckpoint { return { frames: structuredClone(this.history), position: this.position, pdf: this.export(), revision: this.revision } }
  restore(checkpoint: SessionCheckpoint) {
    if (!checkpoint.frames.length || !Number.isInteger(checkpoint.position) || checkpoint.position < 0 || checkpoint.position >= checkpoint.frames.length) throw new Error('The recovery checkpoint is invalid.')
    for (const plan of checkpoint.frames) for (const object of plan.objects) if (object.kind === 'image') this.assets.get(object.assetId)
    const candidate = openPdf(checkpoint.pdf)
    if (candidate.countPages() !== this.count) { candidate.destroy(); throw new Error('The recovery PDF has an unexpected page count.') }
    if (this.currentDoc !== this.sourceDoc) this.currentDoc.destroy()
    this.currentDoc = candidate; this.bytes = new Uint8Array(checkpoint.pdf).slice(); this.history = structuredClone(checkpoint.frames); this.position = checkpoint.position
    this.revision = checkpoint.revision; this.pendingAssets.clear(); this.assets.prune(this.usedAssets())
  }
  export() { return this.bytes.slice().buffer }
  dispose() { if (this.currentDoc !== this.sourceDoc) this.currentDoc.destroy(); this.sourceDoc.destroy(); this.assets.dispose(); this.cache.clear(); this.textCache = undefined }
}

import { useEffect, useState } from 'react'
import type { AddedObject, EditorTool, ObjectBox, Point, RenderedPage, TextEdit, TextRegion } from '../model/document'
import { regionStyle } from '../geometry/page'
import { ObjectLayer } from './ObjectLayer'
import { InlineTextEditor } from './InlineTextEditor'
import type { InlineDraft } from './InlineTextEditor'

export function usePageImage(page?: RenderedPage) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!page) { setUrl(undefined); return }
    const next = URL.createObjectURL(new Blob([page.png], { type: 'image/png' }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [page])
  return url
}

export function PagePreview({ image, page, zoom, regions = [], edits = [], selected, busy, showRegions = true, onSelect, tool = 'edit', objects = [], selectedObject, dirty = false, strokeWidth = 2, onSelectObject, onPutObject, onCreateObject, onInline, onEditObjectText, inlineDraft, onInlineChange, onInlineApply, onInlineCancel }: { onInline?: (region: TextRegion) => void; onEditObjectText?: (object: AddedObject) => void; inlineDraft?: InlineDraft; onInlineChange?: (text: string) => void; onInlineApply?: () => void; onInlineCancel?: () => void; image?: RenderedPage; page: number; zoom: number; regions?: TextRegion[]; edits?: TextEdit[]; selected?: string; busy?: boolean; showRegions?: boolean; onSelect?: (region: TextRegion) => void; tool?: EditorTool; objects?: AddedObject[]; selectedObject?: string; dirty?: boolean; strokeWidth?: number; onSelectObject?: (id?: string) => void; onPutObject?: (object: AddedObject) => void; onCreateObject?: (tool: EditorTool, box: ObjectBox, points: Point[]) => void }) {
  const url = usePageImage(image)
  if (!image || !url) return <div className="empty-page"><svg className="empty-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h14l8 8v28H14z"/><path d="M28 6v8h8"/><path d="M25 34V21M20 26l5-5 5 5"/></svg><h2>Your document belongs here.</h2><p>Drop a PDF anywhere here, or open one from your device. It never leaves this browser.</p></div>
  const width = (image.bounds[2] - image.bounds[0]) * zoom
  return <div className="document-page page-paper" style={{ width, height: width * image.height / image.width }}>
    <img className="page-bitmap" src={url} draggable={false} alt={`PDF page ${page + 1}`}/>
    <div className={`text-regions ${showRegions && tool === 'edit' ? 'show-regions' : ''} ${tool !== 'edit' ? 'regions-inactive' : ''}`} role="group" aria-label="Existing PDF text" hidden={tool !== 'edit'}>
      {regions.map(region => {
        const edit = edits.find(edit => edit.regionId === region.id)
        const text = edit?.text ?? region.text
        return <button key={region.id} type="button" className={`text-region ${region.id === selected ? 'selected' : ''} ${region.unsupported ? 'unsupported-region' : ''} ${edit ? 'changed-region' : ''}`} style={regionStyle(region.bounds, image)} onClick={() => onSelect?.(region)} onDoubleClick={()=>onInline?.(region)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();onInline?.(region)}}} disabled={busy} aria-pressed={region.id === selected} aria-label={`${region.unsupported ? 'Inspect unsupported text' : 'Edit text'}: ${text || 'Removed line'}`} title={region.unsupported ?? `Edit: ${text || 'Removed line'}`}/>
      })}
    </div>
    <ObjectLayer image={image} tool={tool} objects={objects} selected={selectedObject} busy={!!busy} dirty={dirty} strokeWidth={strokeWidth} onSelect={id=>onSelectObject?.(id)} onEditText={onEditObjectText} onPut={object=>onPutObject?.(object)} onCreate={(kind,box,points)=>onCreateObject?.(kind,box,points)}/>
    {inlineDraft&&<InlineTextEditor draft={inlineDraft} image={image} busy={!!busy} onChange={value=>onInlineChange?.(value)} onApply={()=>onInlineApply?.()} onCancel={()=>onInlineCancel?.()}/>}
  </div>
}

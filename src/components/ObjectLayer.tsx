import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AddedObject, EditorTool, ObjectBox, Point, RenderedPage } from '../model/document'
import { boxBetween, boxRect, clampBox, pointerToPage, resizeBox } from '../geometry/objects'
import type { Corner } from '../geometry/objects'
import { regionStyle } from '../geometry/page'

type Props = { image: RenderedPage; tool: EditorTool; objects: AddedObject[]; selected?: string; busy: boolean; dirty: boolean; strokeWidth: number; onSelect: (id?: string) => void; onEditText?: (object: AddedObject) => void; onPut: (object: AddedObject) => void; onCreate: (tool: EditorTool, box: ObjectBox, points: Point[]) => void }
type Gesture = { pointer: number; start: Point; client: Point; mode: 'create' | 'move' | 'resize' | 'pan'; object?: AddedObject; corner?: Corner; box: ObjectBox; points: Point[]; scroll?: { element: HTMLElement; left: number; top: number } }
const names = { nw: 'top left', ne: 'top right', sw: 'bottom left', se: 'bottom right' }

export function ObjectLayer({ image, tool, objects, selected, busy, dirty, strokeWidth, onSelect, onEditText, onPut, onCreate }: Props) {
  const layer = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ id: string; time: number; client: Point } | undefined>(undefined)
  const [ghost, setGhost] = useState<Gesture | null>(null)
  const [interactionError, setInteractionError] = useState('')
  function cancel() { const g = gesture.current; if (g && layer.current?.hasPointerCapture(g.pointer)) layer.current.releasePointerCapture(g.pointer); gesture.current = null; setGhost(null) }
  useEffect(() => { cancel(); lastTap.current = undefined }, [tool, image, busy])
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener) }, [])
  const local = (event: ReactPointerEvent): Point => {
    const point = pointerToPage([event.clientX,event.clientY], layer.current!.getBoundingClientRect(), image)
    return [Math.max(image.bounds[0],Math.min(image.bounds[2],point[0])),Math.max(image.bounds[1],Math.min(image.bounds[3],point[1]))]
  }
  function down(event: ReactPointerEvent) {
    if (busy || tool === 'edit' || event.button !== 0 || !event.isPrimary) return
    if ((tool === 'ink' || tool === 'rectangle') && (!Number.isFinite(strokeWidth) || strokeWidth < 0.5 || strokeWidth > 24)) { setInteractionError('Enter a line width from 0.5 to 24 points before drawing.'); return }
    if (dirty && tool !== 'pan') { setInteractionError('Apply or discard property changes before drawing or dragging.'); return }
    event.preventDefault(); setInteractionError('')
    const point = local(event), element = event.target as HTMLElement
    const id = element.closest<HTMLElement>('[data-object-id]')?.dataset.objectId
    const object = objects.find(object => object.id === id)
    let mode: Gesture['mode'] = 'create'
    const corner = element.dataset.corner as Corner | undefined
    if (tool === 'pan') mode = 'pan'
    else if (tool === 'select') { onSelect(object?.id); if (!object) return; mode = corner ? 'resize' : 'move' }
    const scroll = layer.current?.closest<HTMLElement>('.page-stage')
    gesture.current = { pointer: event.pointerId, start: point, client: [event.clientX,event.clientY], mode, object, corner, box: object?.box ?? { x:point[0],y:point[1],width:0,height:0 }, points: [point], scroll: scroll ? { element:scroll,left:scroll.scrollLeft,top:scroll.scrollTop } : undefined }
    layer.current!.setPointerCapture(event.pointerId)
  }
  function move(event: ReactPointerEvent) {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    const point = local(event)
    if (g.mode === 'pan' && g.scroll) { g.scroll.element.scrollLeft = g.scroll.left - (event.clientX-g.client[0]); g.scroll.element.scrollTop = g.scroll.top - (event.clientY-g.client[1]); return }
    if (g.mode === 'move') g.box = clampBox({ ...g.object!.box, x:g.object!.box.x+point[0]-g.start[0],y:g.object!.box.y+point[1]-g.start[1] },image.bounds)
    else if (g.mode === 'resize') g.box = resizeBox(g.object!.box,g.corner!,point,image.bounds,g.object!.kind === 'image')
    else {
      g.box = boxBetween(g.start,point)
      const last = g.points[g.points.length-1]
      if (Math.hypot(last[0]-point[0],last[1]-point[1]) > 0.25) g.points.push(point)
    }
    setGhost({ ...g })
  }
  function up(event: ReactPointerEvent) {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    move(event); cancel()
    if (g.mode === 'pan') return
    if (g.object) {
      if (JSON.stringify(g.box) !== JSON.stringify(g.object.box)) { lastTap.current = undefined; onPut({ ...g.object,box:g.box }) }
      else if (g.object.kind === 'text' && g.mode === 'move') {
        // Pointer capture retargets native click/dblclick to the layer. Recognize
        // stationary double taps here while retaining reliable captured dragging.
        const previous = lastTap.current
        if (previous?.id === g.object.id && event.timeStamp - previous.time < 500 && Math.hypot(event.clientX-previous.client[0],event.clientY-previous.client[1]) < 8) {
          lastTap.current = undefined; onEditText?.(g.object)
        } else lastTap.current = { id:g.object.id,time:event.timeStamp,client:[event.clientX,event.clientY] }
      }
      return
    }
    const moved = g.box.width > 2 || g.box.height > 2
    const sizes = tool === 'text' ? [200,60] : tool === 'highlight' ? [120,24] : [120,70]
    const box = moved ? { ...g.box,width:Math.max(2,g.box.width),height:Math.max(2,g.box.height) } : clampBox({ x:g.start[0],y:g.start[1],width:sizes[0],height:sizes[1] },image.bounds)
    onCreate(tool,box,g.points)
  }
  const origin = image.pixelOrigin.map(p => p / image.rasterScale)
  return <div ref={layer} className={`object-layer tool-${tool} ${busy ? 'object-layer-busy' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
    {tool === 'select' && objects.map(object => <div key={object.id} className={`object-hit ${object.id === selected ? 'object-selected' : ''}`} style={regionStyle(boxRect(object.box),image)}>
      <button data-object-id={object.id} className="object-body" aria-label={`Select added ${object.kind === 'ink' && object.purpose === 'visual-signature' ? 'visual signature' : object.kind}`} aria-pressed={object.id === selected} disabled={busy} onClick={() => onSelect(object.id)} onDoubleClick={()=>{if(object.kind==='text')onEditText?.(object)}} onKeyDown={event=>{if(event.key==='Enter'&&object.kind==='text')onEditText?.(object)}} onFocus={() => { if (!dirty) onSelect(object.id) }}/>
      {object.id === selected && (['nw','ne','sw','se'] as Corner[]).map(corner => <button key={corner} data-object-id={object.id} data-corner={corner} className={`resize-handle handle-${corner}`} aria-label={`Drag to resize ${names[corner]}; keyboard users can use size fields`} disabled={busy}/>)}
    </div>)}
    {ghost && <svg className="gesture-preview" viewBox={`${origin[0]} ${origin[1]} ${image.width/image.rasterScale} ${image.height/image.rasterScale}`} aria-hidden="true">{ghost.mode === 'create' && tool === 'ink' ? <polyline points={ghost.points.map(p => p.join(',')).join(' ')} fill="none" stroke="#2859cf" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/> : <rect x={ghost.box.x} y={ghost.box.y} width={ghost.box.width} height={ghost.box.height} fill="#2859cf10" stroke="#2859cf" strokeWidth="1" strokeDasharray="4 3"/>}</svg>}
    {interactionError && <span className="gesture-error" role="status">{interactionError}</span>}
  </div>
}

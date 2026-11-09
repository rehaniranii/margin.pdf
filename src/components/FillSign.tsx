import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ReplacementFont } from '../model/document'
import type { FormField, Signature } from '../model/utilities'
import { fontCss } from '../model/fonts'
import { fitSize, fits } from '../model/signature-fit'
import { DropZone } from './DropZone'
import { FontSelect } from './FontSelect'

export type SignMode = 'none' | 'type' | 'draw' | 'image'
// `size` undefined = fit the text to the box.
export type FillState = { values: Record<string, string>; mode: SignMode; text: string; font: ReplacementFont; size?: number; file?: File; page: number; box: Signature['box']; flatten: boolean }
export const initialFill: FillState = { values: {}, mode: 'none', text: '', font: 'Times-Italic', page: 1, box: [0.55, 0.82, 0.35, 0.08], flatten: false }
export type PageImage = { url: string; width: number; height: number; dpi: number }

// Text width in em for a standard font, measured with the matching browser font (close to the PDF metrics).
function measure(text: string, font: ReplacementFont) {
  const css = fontCss(font), context = document.createElement('canvas').getContext('2d')!
  context.font = `${css.fontStyle} ${css.fontWeight} 100px ${css.fontFamily}`
  return context.measureText(text).width / 100
}

// The drawing pad's PNG, or undefined when nothing was drawn.
export async function drawnSignature(canvas: HTMLCanvasElement | null) {
  if (!canvas || canvas.dataset.empty !== 'false') return undefined
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  return blob ? await blob.arrayBuffer() : undefined
}

export function FillSign({ fields, pageCount, state, onChange, pageImage, pad }: { fields: FormField[]; pageCount: number; state: FillState; onChange: (next: FillState) => void; pageImage?: PageImage; pad: React.RefObject<HTMLCanvasElement | null> }) {
  const set = (patch: Partial<FillState>) => onChange({ ...state, ...patch })
  const value = (field: FormField) => state.values[field.name] ?? field.value
  const put = (field: FormField, next: string) => set({ values: { ...state.values, [field.name]: next } })
  return <>
    <fieldset className="choice-list"><legend>Form fields</legend>
      {fields.length ? fields.map(field => {
        const label = <>{field.name}<small> · page {field.page + 1}{field.readOnly ? ' · read-only' : ''}</small></>
        if (field.type === 'checkbox') return <label key={field.name} className="utility-check"><input type="checkbox" disabled={field.readOnly} checked={value(field) !== 'Off' && value(field) !== ''} onChange={event => put(field, event.target.checked ? field.options[0] : 'Off')}/><span>{label}</span></label>
        if (field.type === 'radio' || field.type === 'choice') return <label key={field.name}><span>{label}</span><select disabled={field.readOnly} value={field.options.includes(value(field)) ? value(field) : ''} onChange={event => put(field, event.target.value)}><option value="" disabled>Choose…</option>{field.options.map(option => <option key={option}>{option}</option>)}</select></label>
        return <label key={field.name}><span>{label}</span>{field.multiline ? <textarea rows={3} disabled={field.readOnly} maxLength={field.maxLen || undefined} value={value(field)} onChange={event => put(field, event.target.value)}/> : <input type={field.password ? 'password' : 'text'} disabled={field.readOnly} maxLength={field.maxLen || undefined} value={value(field)} onChange={event => put(field, event.target.value)}/>}</label>
      }) : <p className="field-help">This PDF has no fillable form fields. You can still add a signature.</p>}
    </fieldset>
    <fieldset className="choice-list inline"><legend>Signature</legend>
      {([['none', 'None'], ['type', 'Type'], ['draw', 'Draw'], ['image', 'Image']] as const).map(([id, text]) => <label key={id} className="utility-check"><input type="radio" name="sign-mode" checked={state.mode === id} onChange={() => set({ mode: id })}/>{text}</label>)}
    </fieldset>
    {state.mode === 'type' && <>
      <label>Your name<input value={state.text} maxLength={80} onChange={event => set({ text: event.target.value })} placeholder="Jane Doe"/></label>
      <div className="utility-two">
        <label>Font<FontSelect id="signature-font" label="Signature font" value={state.font} onChange={font => set({ font })}/></label>
        <label>Size (pt)<input type="number" min="4" max="144" placeholder="Fit to box" value={state.size ?? ''} onChange={event => set({ size: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : undefined })}/></label>
      </div>
    </>}
    {state.mode === 'draw' && <SignaturePad pad={pad}/>}
    {state.mode === 'image' && <><DropZone compact label={state.file ? state.file.name : 'Choose a signature image'} hint="PNG with a transparent background works best" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onFiles={files => set({ file: files[0] })}/></>}
    {state.mode !== 'none' && <>
      <div className="utility-two">
        <label>Page<input type="number" min="1" max={pageCount} value={Number.isFinite(state.page) ? state.page : ''} onChange={event => set({ page: event.target.valueAsNumber })}/></label>
        <label>Width (%)<input type="range" min="5" max="100" value={Math.round(state.box[2] * 100)} onChange={event => { const w = event.target.valueAsNumber / 100, [x, y, , h] = state.box; set({ box: [Math.min(x, 1 - w), y, w, Math.min(h * w / state.box[2], 1 - y)] }) }}/></label>
      </div>
      {pageImage ? <Placement image={pageImage} box={state.box} onBox={box => set({ box })} typed={state.mode === 'type' ? { text: state.text.trim(), font: state.font, size: state.size } : undefined}/> : <p className="field-help">Rendering page…</p>}
      <p className="field-help">Drag the box, or press anywhere on the page, to place the signature. Drag a corner to resize it freely. This is a visual signature, like signing a printout; it is not a certificate-based digital signature.</p>
    </>}
    <label className="utility-check"><input type="checkbox" checked={state.flatten} onChange={event => set({ flatten: event.target.checked })}/>Flatten the form so values can no longer be changed</label>
  </>
}

function Placement({ image, box, onBox, typed }: { image: PageImage; box: Signature['box']; onBox: (box: Signature['box']) => void; typed?: { text: string; font: ReplacementFont; size?: number } }) {
  const [x, y, w, h] = box
  // While dragging, the box lives in local state so only this component re-renders; the form gets it on release.
  type Gesture = { kind: 'move'; grab: [number, number] } | { kind: 'resize'; anchor: [number, number]; sx: number; sy: number; offset: [number, number] }
  const [live, setLive] = useState<Signature['box']>(), gesture = useRef<Gesture>(undefined)
  const at = (event: PointerEvent<HTMLDivElement>): [number, number] => { const rect = event.currentTarget.getBoundingClientRect(); return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height] }
  const next = ([px, py]: [number, number]): Signature['box'] => {
    const g = gesture.current!
    if (g.kind === 'move') return [Math.max(0, Math.min(1 - w, px - g.grab[0])), Math.max(0, Math.min(1 - h, py - g.grab[1])), w, h]
    // Free resize: each axis follows the pointer, at least 5% wide and 2% tall, never past the page edge.
    const [ax, ay] = g.anchor, cx = px - g.offset[0], cy = py - g.offset[1]
    const nw = Math.max(0.05, Math.min(g.sx > 0 ? 1 - ax : ax, g.sx * (cx - ax))), nh = Math.max(0.02, Math.min(g.sy > 0 ? 1 - ay : ay, g.sy * (cy - ay)))
    return [g.sx > 0 ? ax : ax - nw, g.sy > 0 ? ay : ay - nh, nw, nh]
  }
  const [lx, ly, lw, lh] = live ?? box
  // Typed preview in page points, drawn with container-relative units so it scales with the preview.
  const pageW = image.width * 72 / image.dpi, pageH = image.height * 72 / image.dpi
  const advance = typed?.text ? measure(typed.text, typed.font) : 0
  const size = typed?.text ? typed.size ?? fitSize(advance, lw * pageW, lh * pageH) : 0
  const overflow = !!typed?.text && !fits(advance, size, lw * pageW, lh * pageH)
  return <div className={`sign-placement${live ? ' dragging' : ''}`}
    onPointerDown={event => {
      if (event.button !== 0) return
      const point = at(event), corner = (event.target as HTMLElement).dataset.corner
      if (corner) {
        // Resize from the opposite corner, which stays fixed.
        const sx = corner.includes('e') ? 1 : -1, sy = corner.includes('s') ? 1 : -1
        // offset: where on the handle it was grabbed, so the corner does not jump to the pointer.
        gesture.current = { kind: 'resize', anchor: [sx > 0 ? x : x + w, sy > 0 ? y : y + h], sx, sy, offset: [point[0] - (sx > 0 ? x + w : x), point[1] - (sy > 0 ? y + h : y)] }
      } else {
        const inside = point[0] >= x && point[0] <= x + w && point[1] >= y && point[1] <= y + h
        // Grabbing the box keeps the pointer where it held it; pressing elsewhere centres the box there.
        gesture.current = { kind: 'move', grab: inside ? [point[0] - x, point[1] - y] : [w / 2, h / 2] }
      }
      event.currentTarget.setPointerCapture(event.pointerId); setLive(next(point))
    }}
    onPointerMove={event => { if (gesture.current) setLive(next(at(event))) }}
    onPointerUp={event => { if (!gesture.current) return; const result = next(at(event)); gesture.current = undefined; setLive(undefined); onBox(result) }}
    onPointerCancel={() => { gesture.current = undefined; setLive(undefined) }}>
    <img src={image.url} alt="Page to sign" draggable={false}/>
    <span className={`sign-box${typed?.text ? ' typed' : ''}${overflow ? ' overflow' : ''}`} style={{ left: `${lx * 100}%`, top: `${ly * 100}%`, width: `${lw * 100}%`, height: `${lh * 100}%` }}>
      {typed?.text ? <span className="sign-text" style={{ ...fontCss(typed.font), fontSize: `${size / pageW * 100}cqw` }}>{typed.text}</span> : 'Signature'}
      {overflow && <span className="visually-hidden" role="status">The text is too big for the box. Make the box bigger or the size smaller.</span>}
      {(['nw', 'ne', 'sw', 'se'] as const).map(corner => <span key={corner} className={`sign-handle ${corner}`} data-corner={corner} aria-hidden="true"/>)}
    </span>
  </div>
}

function SignaturePad({ pad }: { pad: React.RefObject<HTMLCanvasElement | null> }) {
  const last = useRef<[number, number]>(undefined), [empty, setEmpty] = useState(true)
  const point = (event: PointerEvent<HTMLCanvasElement>): [number, number] => { const rect = event.currentTarget.getBoundingClientRect(); return [(event.clientX - rect.left) * event.currentTarget.width / rect.width, (event.clientY - rect.top) * event.currentTarget.height / rect.height] }
  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return
    const context = event.currentTarget.getContext('2d')!, next = point(event)
    context.lineWidth = 3; context.lineCap = 'round'; context.strokeStyle = '#141a40'
    context.beginPath(); context.moveTo(...last.current); context.lineTo(...next); context.stroke()
    last.current = next; event.currentTarget.dataset.empty = 'false'; setEmpty(false)
  }
  const clear = () => { const canvas = pad.current; if (!canvas) return; canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height); canvas.dataset.empty = 'true'; setEmpty(true) }
  return <div className="sign-pad">
    <canvas ref={pad} width={600} height={180} data-empty="true" aria-label="Signature drawing pad"
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); last.current = point(event) }}
      onPointerMove={draw} onPointerUp={() => { last.current = undefined }} onPointerCancel={() => { last.current = undefined }}/>
    <button type="button" disabled={empty} onClick={clear}>Clear</button>
  </div>
}

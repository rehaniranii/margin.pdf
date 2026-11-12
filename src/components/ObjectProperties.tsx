import { useEffect, useRef, useState } from 'react'
import type { AddedObject, EditorTool, ImageAssetInfo } from '../model/document'
import { FontSelect } from './FontSelect'
import { StyleToggles, stylesIn } from './StyleToggles'
import { RichTextField } from './RichTextField'
import type { RichTextHandle } from './RichTextField'

export type ToolDefaults = { color: string; lineWidth: number; opacity: number; purpose: 'note' | 'visual-signature' }

const toolTitles: Partial<Record<EditorTool, string>> = { select: 'Select', text: 'Add text', image: 'Add image', highlight: 'Highlight', rectangle: 'Box', ink: 'Draw', pan: 'Pan' }
const objectTitles: Record<AddedObject['kind'], string> = { text: 'Text box', image: 'Image', highlight: 'Highlight', rectangle: 'Box', ink: 'Drawing' }
const toolHints: Partial<Record<EditorTool, string>> = {
  select: 'Click something you added to move, resize, change or delete it.',
  text: 'Click or drag on the page to add a text box, then type.',
  highlight: 'Drag over the page to highlight.',
  rectangle: 'Drag on the page to draw a box.',
  ink: 'Draw on the page with a mouse, pen or finger.',
  pan: 'Drag to move around the page. Holding Space does the same.',
}

export function ObjectProperties({ object, revision, tool, defaults, asset, busy, onDefaults, onApply, onDelete, onDirty, onChooseImage, onPlace }: { object?: AddedObject; revision: number; tool: EditorTool; defaults: ToolDefaults; asset?: ImageAssetInfo; busy: boolean; onDefaults: (value: ToolDefaults) => void; onApply: (object: AddedObject) => void; onDelete: () => void; onDirty: (dirty: boolean) => void; onChooseImage: () => void; onPlace: () => void }) {
  const [draft,setDraft] = useState(object)
  const [thumbnail,setThumbnail] = useState<string>()
  useEffect(() => { setDraft(object); onDirty(false) },[object?.id,revision])
  useEffect(() => { if (!asset) { setThumbnail(undefined); return }; const url = URL.createObjectURL(new Blob([asset.thumbnail],{type:'image/png'})); setThumbnail(url); return () => URL.revokeObjectURL(url) },[asset?.id])
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(object)
  useEffect(() => { onDirty(dirty) },[dirty])
  const update = (value: Partial<AddedObject>) => setDraft(current => current ? { ...current,...value } as AddedObject : current)
  const field = useRef<RichTextHandle>(null)
  const [range, setRange] = useState<[number, number]>([0, 0])
  function boxField(key: 'x'|'y'|'width'|'height', value: number) {
    if (!draft) return
    const box = { ...draft.box,[key]:value }
    if (draft.kind === 'image' && asset && (key === 'width' || key === 'height')) { if (key === 'width') box.height = value * asset.height / asset.width; else box.width = value * asset.width / asset.height }
    update({box})
  }
  const color = (id: string, value: string, onChange: (value: string) => void) => <div className="field swatch"><label htmlFor={id}>Color</label><input id={id} type="color" value={value} onChange={event => onChange(event.target.value)}/></div>
  const line = (id: string, value: number, onChange: (value: number) => void) => <div className="field size"><label htmlFor={id}>Line</label><input id={id} aria-label="Line width (pt)" type="number" min="0.5" max="24" step="0.5" value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.valueAsNumber)}/></div>
  const opacity = (id: string, value: number, onChange: (value: number) => void) => <div className="field size"><label htmlFor={id}>Opacity</label><input id={id} aria-label="Opacity (%)" type="number" min="5" max="75" value={Number.isFinite(value) ? Math.round(value * 100) : ''} onChange={event => onChange(event.target.valueAsNumber / 100)}/></div>

  return <aside className="properties object-properties" aria-label="Added object properties">
    <h2 className="panel-heading">{draft ? objectTitles[draft.kind] : toolTitles[tool] ?? 'Tools'}</h2>
    {draft ? <form className="text-form" onSubmit={event => { event.preventDefault(); onApply(draft) }}><fieldset className="object-form-fields" disabled={busy}>
      {draft.kind === 'text' && <>
        <label id="added-text-label">Text</label>
        <RichTextField ref={field} id="added-text" className="paragraph" label="Text content" multiline text={draft.text} font={draft.font} spans={draft.spans} disabled={busy}
          onChange={value => update({text:value.text,font:value.font,spans:value.spans})} onSelection={setRange}/>
        <div className="style-row">
          <div className="field grow"><label htmlFor="added-font">Font</label><FontSelect id="added-font" label="Font" value={draft.font} onChange={font => update({font})}/></div>
          <div className="field size"><label htmlFor="added-size">Size</label><input id="added-size" aria-label="Size (pt)" type="number" min="4" max="144" step="0.5" value={Number.isFinite(draft.size)?draft.size:''} onChange={event => update({size:event.target.valueAsNumber})}/></div>
          {color('object-color', draft.color, value => update({color:value}))}
        </div>
        <div className="style-extra"><span className="style-label">Style</span><StyleToggles {...stylesIn(draft.text, draft.font, draft.spans, range)} disabled={busy} onToggle={style => field.current?.toggle(style)}/></div>
      </>}
      {draft.kind === 'image' && <>{thumbnail && <img className="asset-preview" src={thumbnail} alt="Added image preview"/>}<button type="button" className="link-button" onClick={onChooseImage} disabled={busy || dirty}>Replace image</button></>}
      {draft.kind !== 'text' && draft.kind !== 'image' && <div className="style-row compact">
        {color('object-color', draft.color, value => update({color:value}))}
        {'lineWidth' in draft && line('object-line', draft.lineWidth, value => update({lineWidth:value}))}
        {draft.kind === 'highlight' && opacity('object-opacity', draft.opacity, value => update({opacity:value}))}
      </div>}
      <details className="fine-details"><summary>Position and size</summary>
        <div className="geometry-grid">{(['x','y','width','height'] as const).map(key => <div key={key} className="field"><label htmlFor={`object-${key}`}>{key === 'x' ? 'Left' : key === 'y' ? 'Top' : key === 'width' ? 'Width' : 'Height'}</label><input id={`object-${key}`} type="number" step="any" min={key === 'width' || key === 'height' ? 2 : undefined} value={Number.isFinite(draft.box[key]) ? Number(draft.box[key].toFixed(2)) : ''} onChange={event => boxField(key,event.target.valueAsNumber)}/></div>)}</div>
        <p>In points from the page’s top-left corner.{draft.kind === 'image' ? ' Proportions stay locked.' : ''}</p>
      </details>
      <div className="form-actions">
        <button className="primary" disabled={busy || !dirty}>Apply changes</button>
        {dirty && <button type="button" className="text-button" onClick={() => {setDraft(object);onDirty(false)}}>Discard</button>}
        <button type="button" className="icon-button danger" aria-label="Delete object" title="Delete" disabled={busy} onClick={onDelete}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>
      </div>
      <p className="form-status" role="status">{dirty ? 'Not applied yet.' : tool === 'select' ? 'Drag to move, drag a corner to resize. Arrow keys nudge it.' : ''}</p>
    </fieldset></form>
    : <div className="tool-settings">
      <p className="select-prompt-line">{tool === 'image' ? asset ? 'Click the page where the image should go.' : 'Choose a JPG or PNG, then click the page to place it.' : toolHints[tool] ?? ''}</p>
      {tool === 'image' && <>{thumbnail && <img className="asset-preview" src={thumbnail} alt="Image ready to place"/>}<button className="secondary wide" disabled={busy} onClick={onChooseImage}>{asset ? 'Choose a different image' : 'Choose JPG or PNG'}</button></>}
      {['text','highlight','rectangle','ink'].includes(tool) && <div className="style-row compact">
        {color('tool-color', defaults.color, value => onDefaults({...defaults,color:value}))}
        {(tool === 'ink' || tool === 'rectangle') && line('tool-line', defaults.lineWidth, value => onDefaults({...defaults,lineWidth:value}))}
        {tool === 'highlight' && opacity('tool-opacity', defaults.opacity, value => onDefaults({...defaults,opacity:value}))}
      </div>}
      {tool === 'ink' && <label className="utility-check sign-toggle"><input type="checkbox" checked={defaults.purpose === 'visual-signature'} onChange={event => onDefaults({...defaults,purpose:event.target.checked ? 'visual-signature' : 'note'})}/>This is my signature</label>}
      {!['select','pan','ink'].includes(tool) && <button className="link-button" type="button" disabled={busy || (tool==='image'&&!asset)} onClick={onPlace}>Place at page center</button>}
    </div>}
    <details className="fine-details"><summary>About added items</summary>
      <p>Added text, images and drawings stay editable until you close this document. Export writes them into the PDF. A drawn signature is a picture of your signature, not a certificate-based digital signature.</p>
      <p>To change text that was already in the PDF, use Edit text.</p>
    </details>
  </aside>
}

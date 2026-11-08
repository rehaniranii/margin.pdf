import type { TextEdit, TextRegion } from '../model/document'
import { FontSelect } from './FontSelect'
import { textDraft } from '../model/text-draft'

type Props = { region?: TextRegion; applied?: TextEdit; draft?: TextEdit; busy: boolean; onApply: (edit: TextEdit) => void; onChange: (edit: TextEdit) => void; onInline: () => void }

export function TextProperties({ region, applied, draft: supplied, busy, onApply, onChange, onInline }: Props) {
  const baseline = region ? textDraft(region, applied) : undefined
  const draft = supplied ?? baseline ?? {type:'replace-text' as const,page:0,regionId:'',text:'',font:'Helvetica' as const,size:12,color:'#000000'}
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const unsupportedCharacters = !/^[\x20-\x7e]*$/.test(draft.text)
  const update = (change: Partial<TextEdit>) => onChange({ ...draft, ...change })
  function discard() { if(baseline)onChange(baseline) }
  // Visible labels are short; aria-labels keep the precise names (used by screen readers and release checks).
  return <aside className="properties" aria-label="Text properties">
    <h2 className="panel-heading">Edit text</h2>
    {!region ? <div className="select-prompt">
      <p>Double-click any text on the page to change it.</p>
      <p className="hint">Click once to select it and edit here instead. Turn on <em>Show editable text</em> to see everything you can change.</p>
    </div> : region.unsupported ? <div className="unsupported" role="status"><strong>This text is view-only</strong><p>{region.unsupported}</p><p>The document has not changed.</p></div>
    : <form className="text-form" onSubmit={event => { event.preventDefault(); onApply(draft) }}>
      <label htmlFor="replacement">Text</label>
      <textarea id="replacement" aria-label="Replacement text" rows={2} value={draft.text} onChange={event => update({ text: event.target.value })} disabled={busy} spellCheck={false} aria-describedby="text-support fit-policy"/>
      {unsupportedCharacters && <p className="inline-error" role="status">This replacement contains unsupported characters. Use basic Latin letters, numbers, and punctuation.</p>}
      <div className="style-row">
        <div className="field grow"><label htmlFor="font">Font</label><FontSelect id="font" label="Replacement font" value={draft.font} disabled={busy} onChange={font => update({ font })}/></div>
        <div className="field size"><label htmlFor="font-size">Size</label><input id="font-size" aria-label="Size (pt)" type="number" min="4" max="144" step="0.5" value={Number.isFinite(draft.size) ? draft.size : ''} disabled={busy} onChange={event => update({ size: event.target.valueAsNumber })}/></div>
        <div className="field swatch"><label htmlFor="text-color">Color</label><input id="text-color" aria-label="Text color" type="color" value={draft.color} onChange={event => update({ color: event.target.value })} disabled={busy}/></div>
      </div>
      <div className="form-actions">
        <button className="primary" type="submit" disabled={busy || !dirty || unsupportedCharacters || !Number.isFinite(draft.size)}>Apply changes</button>
        {dirty && <button className="text-button" type="button" onClick={discard} disabled={busy}>Discard</button>}
      </div>
      <p className="form-status" role="status">{dirty ? 'Not applied yet.' : applied ? 'Applied. The page shows the edited PDF.' : ''}</p>
      <button type="button" className="link-button" onClick={onInline} disabled={busy}>Edit on the page instead</button>
      <details className="fine-details"><summary>Fonts and fitting</summary>
        <p id="text-support">Original font: {region.fontName.replace(/^[A-Z]{6}\+/, '')}. The closest standard font is picked for you; letter shapes and spacing may differ slightly.</p>
        <p id="fit-policy">The new text must fit in the original space. If it doesn’t, shorten it or lower the size. Leave it empty to remove the line.</p>
      </details>
    </form>}
    {!region && <details className="fine-details"><summary>What can be edited?</summary>
      <p>Simple horizontal text in basic Latin letters, on normal, rotated or cropped pages. Scanned pages, complex scripts, unusual layouts and overlapping content may be view-only; amber outlines explain why.</p>
      <p>Replacing text is not full document sanitization, and any change can invalidate a digital signature.</p>
    </details>}
  </aside>
}

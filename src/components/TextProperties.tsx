import { useEffect, useState } from 'react'
import type { ReplacementFont, TextEdit, TextRegion } from '../model/document'

type Props = { region?: TextRegion; applied?: TextEdit; revision: number; busy: boolean; onApply: (edit: TextEdit) => void; onDirty: (dirty: boolean) => void }

export function TextProperties({ region, applied, revision, busy, onApply, onDirty }: Props) {
  const initial = (): TextEdit => applied ?? { type: 'replace-text', page: Number(region?.id.split(':')[0] ?? 0), regionId: region?.id ?? '', text: region?.text ?? '', font: (['Helvetica', 'Times-Roman', 'Courier'].includes(region?.fontName ?? '') ? region!.fontName : 'Helvetica') as ReplacementFont, size: Number((region?.fontSize ?? 12).toFixed(2)), color: region?.color ?? '#000000' }
  const [draft, setDraft] = useState<TextEdit>(initial)
  const [baseline, setBaseline] = useState<TextEdit>(initial)
  useEffect(() => {
    const next = initial(); setDraft(next); setBaseline(next); onDirty(false)
    // Navigation/zoom alone must not discard a draft. Source IDs are immutable.
  }, [region?.id, revision])
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  useEffect(() => { onDirty(dirty) }, [dirty])
  const unsupportedCharacters = !/^[\x20-\x7e]*$/.test(draft.text)
  const update = (change: Partial<TextEdit>) => setDraft(current => ({ ...current, ...change }))
  function discard() { setDraft(baseline); onDirty(false) }
  return <aside className="properties" aria-label="Text properties">
    <div className="panel-title"><span className="text-icon" aria-hidden="true">T<span>↔</span></span><div><h2>Edit existing text</h2><p>Fixed layout · Local processing</p></div></div>
    {!region ? <div className="select-prompt"><p>Select a text region on the page.</p><p>Blue outlines mark supported text. Amber outlines explain text that cannot be edited.</p></div> : <>
      <div className="selection-info"><span className="selection-dot"/><div><strong>Selected text</strong><p>{region.text}</p></div></div>
      {region.unsupported ? <div className="unsupported" role="status"><strong>This text is view-only</strong><p>{region.unsupported}</p><p>The document has not changed.</p></div> : <form onSubmit={event => { event.preventDefault(); onApply(draft) }}>
        <label htmlFor="replacement">Replacement text</label>
        <textarea id="replacement" rows={3} value={draft.text} onChange={event => update({ text: event.target.value })} disabled={busy} spellCheck={false} aria-describedby="text-support fit-policy"/>
        {unsupportedCharacters && <p className="inline-error" role="status">This replacement contains unsupported characters. Use basic Latin letters, numbers, and punctuation.</p>}
        <div className="style-fields"><div><label htmlFor="font">Replacement font</label><select id="font" value={draft.font} disabled={busy} onChange={event => update({ font: event.target.value as ReplacementFont })}><option value="Helvetica">Helvetica</option><option value="Times-Roman">Times Roman</option><option value="Courier">Courier</option></select></div><div><label htmlFor="font-size">Size (pt)</label><input id="font-size" type="number" min="4" max="144" step="0.5" value={Number.isFinite(draft.size) ? draft.size : ''} disabled={busy} onChange={event => update({ size: event.target.valueAsNumber })}/></div></div>
        <div className="color-field"><label htmlFor="text-color">Text color</label><input id="text-color" type="color" value={draft.color} onChange={event => update({ color: event.target.value })} disabled={busy}/><span>{draft.color}</span></div>
        <p className="field-help" id="text-support">Original font: {region.fontName}. A replacement font is used; embedded or subset fonts are not reused. Font shape and spacing may differ.</p>
        <div className="fit-policy" id="fit-policy"><strong>Keep within the original text area</strong><p>Overflow is rejected. Shorten the text or reduce its size to fit. Leave the text empty to remove this span.</p></div>
        <button className="primary wide" type="submit" disabled={busy || !dirty || unsupportedCharacters || !Number.isFinite(draft.size)}>Apply changes</button>
        {dirty && <button className="text-button wide discard-button" type="button" onClick={discard} disabled={busy}>Discard unapplied changes</button>}
        <p className="field-help" role="status">{dirty ? 'Changes are unapplied. Apply them to update the PDF preview before exporting.' : applied ? 'Applied. The preview shows the actual edited PDF.' : 'Select and change the text, then apply to preview the PDF.'}</p>
      </form>}
    </>}
    <div className="scope-note"><h3>Supported text, clearly bounded</h3><p>Simple horizontal source text in basic Latin. Rotated and cropped pages are supported. Scans, complex scripts, unusual transforms, overlapping content, and some text encodings may be view-only.</p><p>Text replacement is not comprehensive document sanitization. PDF changes can invalidate digital signatures.</p></div>
  </aside>
}

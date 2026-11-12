import { useRef, useState } from 'react'
import type { TextEdit, TextRegion } from '../model/document'
import { FontSelect } from './FontSelect'
import { StyleToggles, stylesIn } from './StyleToggles'
import { RichTextField } from './RichTextField'
import type { RichTextHandle } from './RichTextField'
import { textDraft } from '../model/text-draft'
import { supportedText, unsupportedMessage, webAddress } from '../model/text-encoding'

type Props = { region?: TextRegion; applied?: TextEdit; draft?: TextEdit; busy: boolean; onApply: (edit: TextEdit) => void; onChange: (edit: TextEdit) => void; onInline: () => void }

export function TextProperties({ region, applied, draft: supplied, busy, onApply, onChange, onInline }: Props) {
  const baseline = region ? textDraft(region, applied) : undefined
  const draft = supplied ?? baseline ?? {type:'replace-text' as const,page:0,regionId:'',text:'',font:'Helvetica' as const,size:12,color:'#000000'}
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const unsupportedCharacters = !supportedText(draft.text)
  const badLink = draft.link !== undefined && !webAddress(draft.link)
  const update = (change: Partial<TextEdit>) => onChange({ ...draft, ...change })
  const field = useRef<RichTextHandle>(null)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const pressed = stylesIn(draft.text, draft.font, draft.spans, range)
  function discard() { if(baseline)onChange(baseline) }
  // Visible labels are short; aria-labels keep the precise names (used by screen readers and release checks).
  return <aside className="properties" aria-label="Text properties">
    <h2 className="panel-heading">Edit text</h2>
    {!region ? <div className="select-prompt">
      <p>Double-click any text on the page to change it.</p>
      <p className="hint">Click once to select it and edit here instead. Turn on <em>Show editable text</em> to see everything you can change.</p>
    </div> : region.unsupported ? <div className="unsupported" role="status"><strong>This text is view-only</strong><p>{region.unsupported}</p><p>The document has not changed.</p></div>
    : <form className="text-form" onSubmit={event => { event.preventDefault(); onApply(draft) }}>
      <label id="replacement-label">{(region.lines ?? 1) > 1 ? `Paragraph · ${region.lines} lines` : 'Text'}</label>
      {/* Select words and press Cmd/Ctrl+B or I (or the buttons below) to style only them. Spans are reset when the text changes outside this field. */}
      <RichTextField ref={field} id="replacement" className={(region.lines ?? 1) > 1 ? 'paragraph' : ''} label="Replacement text" describedBy="text-support fit-policy" text={draft.text} font={draft.font} spans={draft.spans} disabled={busy}
        onChange={value => update({ text: value.text, font: value.font, spans: value.spans })} onSelection={setRange}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.closest('form')?.querySelector<HTMLButtonElement>('button[type=submit]')?.click() }}/>
      {region.scan && <p className="scan-note" role="note">Scanned text: the old words are covered with the paper colour from the scan, and the new text is drawn on top in the ink colour. On shaded or textured paper the patch may show.</p>}
      {unsupportedCharacters && <p className="inline-error" role="status">This replacement contains unsupported characters. {unsupportedMessage}</p>}
      {region.link && <div className="style-row link-row"><div className="field"><label htmlFor="link-target">Link goes to</label><input id="link-target" aria-label="Link address" type="url" value={draft.link ?? ''} onChange={event => update({ link: event.target.value.trim() })} disabled={busy} spellCheck={false} aria-invalid={badLink}/></div></div>}
      {badLink && <p className="inline-error" role="status">Enter a link that starts with https://, http://, mailto: or tel:.</p>}
      <div className="style-row">
        <div className="field grow"><label htmlFor="font">Font</label><FontSelect id="font" label="Replacement font" value={draft.font} disabled={busy} onChange={font => update({ font })}/></div>
        <div className="field size"><label htmlFor="font-size">Size</label><input id="font-size" aria-label="Size (pt)" type="number" min="1" max="144" step="any" value={Number.isFinite(draft.size) ? draft.size : ''} disabled={busy} onChange={event => update({ size: event.target.valueAsNumber })}/></div>
        <div className="field swatch"><label htmlFor="text-color">Color</label><input id="text-color" aria-label="Text color" type="color" value={draft.color} onChange={event => update({ color: event.target.value })} disabled={busy}/></div>
      </div>
      <div className="style-extra"><span className="style-label">Style</span><StyleToggles bold={pressed.bold} italic={pressed.italic} disabled={busy} onToggle={style => field.current?.toggle(style)}/></div>
      <div className="form-actions">
        <button className="primary" type="submit" disabled={busy || !dirty || unsupportedCharacters || badLink || !Number.isFinite(draft.size)}>Apply changes</button>
        {dirty && <button className="text-button" type="button" onClick={discard} disabled={busy}>Discard</button>}
      </div>
      <p className="form-status" role="status">{dirty ? 'Not applied yet.' : applied ? 'Applied. The page shows the edited PDF.' : (region.lines ?? 1) > 1 ? `Your text wraps to fit up to ${region.lines} lines.` : ''}</p>
      <button type="button" className="link-button" onClick={onInline} disabled={busy}>Edit on the page instead</button>
      <details className="fine-details"><summary>Fonts and fitting</summary>
        <p id="text-support">Original font: {region.fontName.replace(/^[A-Z]{6}\+/, '')}. The closest standard font is picked for you; letter shapes and spacing may differ slightly.</p>
        <p id="fit-policy">The new text can grow into the empty space around it, shown by the dashed outline on the page. Lines that end at the right margin grow to the left. If it still doesn’t fit, the letters are narrowed slightly; beyond that, shorten it or lower the size. Leave it empty to remove the line.</p>
      </details>
    </form>}
    {!region && <details className="fine-details"><summary>What can be edited?</summary>
      <p>Simple horizontal text in Latin letters (accents included), on normal, rotated or cropped pages. Scanned pages, complex scripts, unusual layouts and overlapping content may be view-only; amber outlines explain why.</p>
      <p>Replacing text is not full document sanitization, and any change can invalidate a digital signature.</p>
    </details>}
  </aside>
}

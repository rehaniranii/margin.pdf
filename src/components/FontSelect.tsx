import type { ReplacementFont } from '../model/document'
import { FONT_FAMILIES, MATCHED_FAMILIES, STYLE_LABELS } from '../model/fonts'

const styles = Object.keys(STYLE_LABELS) as (keyof typeof STYLE_LABELS)[]
const name = (label: string, style: keyof typeof STYLE_LABELS) => style === 'regular' ? label : `${label} ${STYLE_LABELS[style].toLowerCase()}`

// Matched fonts are listed first: they keep the original's letter widths (Carlito for Calibri, Caladea for Cambria, Latin Modern for LaTeX).
export function FontSelect({ id, label, value, disabled, onChange }: { id: string; label: string; value: ReplacementFont; disabled?: boolean; onChange: (font: ReplacementFont) => void }) {
  return <select id={id} aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value as ReplacementFont)}>
    {MATCHED_FAMILIES.map(family => <optgroup key={family.label} label={`${family.label} (matches ${family.matches})`}>
      {styles.map(style => <option key={style} value={family[style]}>{name(family.label, style)}</option>)}
    </optgroup>)}
    {FONT_FAMILIES.map(family => <optgroup key={family.label} label={family.label}>
      {styles.map(style => <option key={style} value={family[style]}>{name(family.label, style)}</option>)}
    </optgroup>)}
  </select>
}

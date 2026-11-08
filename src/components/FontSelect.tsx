import type { ReplacementFont } from '../model/document'
import { FONT_FAMILIES, STYLE_LABELS } from '../model/fonts'

export function FontSelect({ id, label, value, disabled, onChange }: { id: string; label: string; value: ReplacementFont; disabled?: boolean; onChange: (font: ReplacementFont) => void }) {
  return <select id={id} aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value as ReplacementFont)}>
    {FONT_FAMILIES.map(family => <optgroup key={family.label} label={family.label}>
      {(Object.keys(STYLE_LABELS) as (keyof typeof STYLE_LABELS)[]).map(style => <option key={style} value={family[style]}>{style === 'regular' ? family.label : `${family.label} ${STYLE_LABELS[style].toLowerCase()}`}</option>)}
    </optgroup>)}
  </select>
}

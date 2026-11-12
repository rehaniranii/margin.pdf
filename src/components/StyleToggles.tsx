import type { ReplacementFont, TextSpan } from '../model/document'
import { charStyles } from '../model/fonts'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const key = (letter: string) => `${mac ? '⌘' : 'Ctrl+'}${letter}`

/** Whether all of text[start, end) (all of the text when nothing is selected) is bold / italic. */
export function stylesIn(text: string, font: ReplacementFont, spans: TextSpan[] | undefined, [start, end]: [number, number]) {
  const styles = charStyles(text, font, spans).slice(...(start < end ? [start, end] : [0, text.length]))
  const all = (style: 'bold' | 'italic') => styles.length ? styles.every(char => char[style]) : charStyles('x', font)[0][style]
  return { bold: all('bold'), italic: all('italic') }
}

// mousedown is cancelled so the text field keeps its focus and selection: the style applies to the selected words.
export function StyleToggles({ bold, italic, disabled, onToggle }: { bold: boolean; italic: boolean; disabled?: boolean; onToggle: (style: 'bold' | 'italic') => void }) {
  return <div className="style-toggles" role="group" aria-label="Text style">
    <button type="button" className="style-toggle bold" aria-pressed={bold} aria-label="Bold" title={`Bold (${key('B')}): the selected words, or all of the text`} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => onToggle('bold')}>B</button>
    <button type="button" className="style-toggle italic" aria-pressed={italic} aria-label="Italic" title={`Italic (${key('I')}): the selected words, or all of the text`} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => onToggle('italic')}>I</button>
  </div>
}

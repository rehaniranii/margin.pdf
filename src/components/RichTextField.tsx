import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { ReplacementFont, TextSpan } from '../model/document'
import { charStyles, fromStyles, toggleRange } from '../model/fonts'

export type StyledValue = { text: string; font: ReplacementFont; spans?: TextSpan[] }
export type RichTextHandle = { toggle: (style: 'bold' | 'italic') => void; selection: () => [number, number] }
type Props = StyledValue & {
  label: string; id?: string; className?: string; style?: CSSProperties; multiline?: boolean; disabled?: boolean; autoSelect?: boolean; describedBy?: string
  onChange: (value: StyledValue) => void
  onSelection?: (range: [number, number]) => void
  /** Called after the field's own keys (Cmd/Ctrl+B, I, line breaks): Enter to apply, Escape to cancel. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}
type CharStyle = { bold: boolean; italic: boolean }

// The DOM is the source of truth while typing; each character's style comes from its <span data-b data-i>.
// New text typed into a span takes that span's style, like any text editor.
function read(root: Node, base: CharStyle) {
  let text = ''
  const styles: CharStyle[] = []
  const walk = (node: Node, style: CharStyle) => {
    if (node.nodeType === Node.TEXT_NODE) { const value = (node.nodeValue ?? '').replace(/ /g, ' '); text += value; for (let i = 0; i < value.length; i++) styles.push(style); return }
    if (!(node instanceof HTMLElement) && !(node instanceof DocumentFragment)) return
    if (node instanceof HTMLElement) {
      if (node.tagName === 'BR') { if (node.nextSibling || node.parentNode !== root) { text += '\n'; styles.push(style) } return }
      // Some browsers wrap a new line in a <div>.
      if ((node.tagName === 'DIV' || node.tagName === 'P') && node !== root && text) { text += '\n'; styles.push(style) }
      if (node.dataset.b !== undefined) style = { bold: node.dataset.b === '1', italic: node.dataset.i === '1' }
    }
    node.childNodes.forEach(child => walk(child, style))
  }
  walk(root, base)
  return { text, styles }
}
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function html(text: string, styles: CharStyle[]) {
  let out = '', i = 0
  while (i < text.length) {
    let j = i + 1
    while (j < text.length && styles[j].bold === styles[i].bold && styles[j].italic === styles[i].italic) j++
    out += `<span data-b="${styles[i].bold ? 1 : 0}" data-i="${styles[i].italic ? 1 : 0}" style="font-weight:${styles[i].bold ? 700 : 400};font-style:${styles[i].italic ? 'italic' : 'normal'}">${escape(text.slice(i, j)).replace(/\n/g, '<br>')}</span>`
    i = j
  }
  // A trailing line break needs a second <br> to show its empty line.
  return text.endsWith('\n') ? out + '<br>' : out
}
const same = (a: { text: string; styles: CharStyle[] }, b: { text: string; styles: CharStyle[] }) => a.text === b.text && a.styles.every((style, i) => style.bold === b.styles[i].bold && style.italic === b.styles[i].italic)

/** Character offset of a DOM position inside `root`. */
function offsetOf(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange(); range.setStart(root, 0); range.setEnd(node, offset)
  return read(range.cloneContents(), { bold: false, italic: false }).text.length
}
/** DOM position of a character offset inside `root`. */
function positionOf(root: HTMLElement, target: number): [Node, number] {
  let count = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) { const length = node.nodeValue?.length ?? 0; if (count + length >= target) return [node, target - count]; count += length }
    else if ((node as HTMLElement).tagName === 'BR') { if (count + 1 > target) return [node.parentNode!, [...node.parentNode!.childNodes].indexOf(node as ChildNode)]; count++ }
  }
  return [root, root.childNodes.length]
}

export const RichTextField = forwardRef<RichTextHandle, Props>(function RichTextField({ text, font, spans, label, id, className, style, multiline, disabled, autoSelect, describedBy, onChange, onSelection, onKeyDown }, ref) {
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef<[number, number]>(undefined)
  const base = (): CharStyle => charStyles('x', font)[0]
  const selection = (): [number, number] => {
    const element = root.current, current = getSelection()
    if (!element || !current?.rangeCount || !element.contains(current.anchorNode)) return [0, 0]
    const range = current.getRangeAt(0)
    return [offsetOf(element, range.startContainer, range.startOffset), offsetOf(element, range.endContainer, range.endOffset)]
  }
  const select = ([start, end]: [number, number]) => {
    const element = root.current, current = getSelection()
    if (!element || !current) return
    const range = document.createRange(); range.setStart(...positionOf(element, start)); range.setEnd(...positionOf(element, end))
    current.removeAllRanges(); current.addRange(range)
  }
  const toggle = (which: 'bold' | 'italic') => {
    const range = selection()
    pending.current = range
    onChange({ text, spans: undefined, ...toggleRange(text, font, spans, range[0], range[1], which) })
  }
  useImperativeHandle(ref, () => ({ toggle, selection }))

  // Re-render the DOM only when the value differs from what it shows (an outside change or a toggle), keeping the selection.
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const wanted = { text, styles: charStyles(text, font, spans) }
    if (!same(read(element, base()), wanted)) {
      const focused = document.activeElement === element, keep = pending.current ?? (focused ? selection() : undefined)
      element.innerHTML = html(wanted.text, wanted.styles)
      if (keep) select(keep)
    } else if (pending.current) select(pending.current)
    pending.current = undefined
  })
  useLayoutEffect(() => {
    if (!autoSelect || !root.current) return
    root.current.focus(); select([0, text.length])
  }, [])

  return <div ref={root} id={id} className={`rich-text ${className ?? ''}`} style={style} role="textbox" aria-label={label} aria-multiline={multiline || undefined} aria-describedby={describedBy}
    aria-disabled={disabled || undefined} contentEditable={!disabled} suppressContentEditableWarning spellCheck={false}
    onInput={() => { const element = root.current!, value = read(element, base()); onChange({ text: value.text, spans: undefined, ...fromStyles(value.text, font, value.styles) }) }}
    onSelect={() => onSelection?.(selection())} onKeyUp={() => onSelection?.(selection())} onMouseUp={() => onSelection?.(selection())}
    onKeyDown={event => {
      const key = event.key.toLowerCase(), command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
      if (command && (key === 'b' || key === 'i')) { event.preventDefault(); event.stopPropagation(); toggle(key === 'b' ? 'bold' : 'italic'); return }
      if (command && key === 'u') { event.preventDefault(); return } // no underline in PDF replacement fonts
      if (event.key === 'Enter' && multiline && !(event.metaKey || event.ctrlKey)) { event.preventDefault(); document.execCommand('insertLineBreak'); return }
      if (event.key === 'Enter' && !multiline) event.preventDefault()
      onKeyDown?.(event)
    }}
    onPaste={event => { event.preventDefault(); const value = event.clipboardData.getData('text/plain'); document.execCommand('insertText', false, multiline ? value : value.replace(/\s*\n\s*/g, ' ')) }}
    onDrop={event => event.preventDefault()}/>
})

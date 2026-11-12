import type { MatchedFont, ReplacementFont, TextSpan } from './document'
export type { MatchedFont, ReplacementFont }

// The 12 standard PDF fonts: every viewer has them, so nothing is embedded.
export const FONT_FAMILIES = [
  { label: 'Helvetica', css: 'Helvetica, Arial, sans-serif', regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' },
  { label: 'Times', css: '"Times New Roman", Times, serif', regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic' },
  { label: 'Courier', css: '"Courier New", Courier, monospace', regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique', boldItalic: 'Courier-BoldOblique' },
] as const

// Bundled fonts that keep the original's letter widths, so edited text takes the same space. `matches` names the original.
export const MATCHED_FAMILIES = [
  { label: 'Carlito', matches: 'Calibri', css: 'Carlito, Calibri, sans-serif', regular: 'Carlito-Regular', bold: 'Carlito-Bold', italic: 'Carlito-Italic', boldItalic: 'Carlito-BoldItalic' },
  { label: 'Caladea', matches: 'Cambria', css: 'Caladea, Cambria, serif', regular: 'Caladea-Regular', bold: 'Caladea-Bold', italic: 'Caladea-Italic', boldItalic: 'Caladea-BoldItalic' },
  { label: 'Latin Modern', matches: 'LaTeX', css: '"Latin Modern", "Latin Modern Roman", serif', regular: 'LatinModern-Regular', bold: 'LatinModern-Bold', italic: 'LatinModern-Italic', boldItalic: 'LatinModern-BoldItalic' },
] as const
export const MATCHED_FONTS: readonly MatchedFont[] = MATCHED_FAMILIES.flatMap(family => [family.regular, family.bold, family.italic, family.boldItalic])
export const isMatched = (font: string): font is MatchedFont => (MATCHED_FONTS as readonly string[]).includes(font)

// Self-hosted OFL script fonts for typed signatures, embedded (subset) into the PDF.
export const HANDWRITING_FONTS = ['Dancing Script', 'Great Vibes'] as const
export type HandwritingFont = typeof HANDWRITING_FONTS[number]
export type SignatureFont = ReplacementFont | HandwritingFont
export const isHandwriting = (font: string): font is HandwritingFont => (HANDWRITING_FONTS as readonly string[]).includes(font)

export const STYLE_LABELS = { regular: 'Regular', bold: 'Bold', italic: 'Italic', boldItalic: 'Bold italic' } as const
type Style = keyof typeof STYLE_LABELS

export function fontParts(font: ReplacementFont) {
  for (const family of [...MATCHED_FAMILIES, ...FONT_FAMILIES]) for (const style of Object.keys(STYLE_LABELS) as Style[]) if (family[style] === font) return { family, style }
  return { family: FONT_FAMILIES[0] as (typeof FONT_FAMILIES)[number] | (typeof MATCHED_FAMILIES)[number], style: 'regular' as Style }
}

/** Closest font for an embedded font name such as "ABCDEF+Arial-BoldMT", "Calibri,Bold" or LaTeX's "CMBX12". */
export function closestFont(name: string): ReplacementFont {
  const base = name.replace(/^[A-Z]{6}\+/, '')
  // LaTeX: Computer Modern / Latin Modern roman (cmr, cmbx, cmti, cmsl, cmbxti; sfrm, sfbx from cm-super). Sans and typewriter fall through.
  const tex = /^(?:cm|sf)(r|bx|ti|sl|bxti|bxsl|mi|b|csc)\d*$/i.exec(base) ?? /^lmroman\d*-?(.*)$/i.exec(base)
  if (tex) {
    const style = tex[1].toLowerCase(), bold = /bx|^b$|bold/.test(style), italic = /ti|sl|mi|italic|oblique/.test(style)
    return MATCHED_FAMILIES[2][bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular']
  }
  const bold = /bold|black|heavy|semibold|demi/i.test(base), italic = /italic|oblique/i.test(base)
  const style = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular'
  if (/calibri/i.test(base)) return MATCHED_FAMILIES[0][style]
  if (/cambria/i.test(base) && !/math/i.test(base)) return MATCHED_FAMILIES[1][style]
  const family = /times|roman|serif|georgia|garamond|cambria|book|minion|palatino|baskerville/i.test(base) && !/sans/i.test(base) ? FONT_FAMILIES[1]
    : /courier|mono|consol|menlo|code|^cmtt|^sftt/i.test(base) ? FONT_FAMILIES[2] : FONT_FAMILIES[0]
  return family[style]
}

/** CSS for previewing a standard font on screen (on-page editor). */
export function fontCss(font: SignatureFont) {
  if (isHandwriting(font)) return { fontFamily: `"${font}", cursive`, fontWeight: 400, fontStyle: 'normal' } as const
  const { family, style } = fontParts(font)
  return { fontFamily: family.css, fontWeight: style === 'bold' || style === 'boldItalic' ? 700 : 400, fontStyle: style === 'italic' || style === 'boldItalic' ? 'italic' : 'normal' } as const
}

/** The same family with bold or italic switched on or off (Helvetica-Bold + italic = Helvetica-BoldOblique). */
export function toggleStyle(font: ReplacementFont, toggle: 'bold' | 'italic'): ReplacementFont {
  const { family, style } = fontParts(font)
  const bold = style === 'bold' || style === 'boldItalic', italic = style === 'italic' || style === 'boldItalic'
  const next = toggle === 'bold' ? [!bold, italic] : [bold, !italic]
  return family[next[0] && next[1] ? 'boldItalic' : next[0] ? 'bold' : next[1] ? 'italic' : 'regular']
}
export const isBold = (font: ReplacementFont) => /bold/i.test(fontParts(font).style)
export const isItalic = (font: ReplacementFont) => /italic/i.test(fontParts(font).style)


/** `font`'s family in the given weight and slant. */
export function styledFont(font: ReplacementFont, bold: boolean, italic: boolean): ReplacementFont {
  return fontParts(font).family[bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular']
}

type CharStyle = { bold: boolean; italic: boolean }
/** Bold/italic of each UTF-16 position of `text` (the editors' selection offsets). */
export function charStyles(text: string, font: ReplacementFont, spans?: TextSpan[]): CharStyle[] {
  if (!spans) return Array.from({ length: text.length }, () => ({ bold: isBold(font), italic: isItalic(font) }))
  return spans.flatMap(span => Array.from({ length: span.text.length }, () => ({ bold: span.bold, italic: span.italic })))
}

/** Consecutive equal styles merged into spans. One style for everything is stored as the font instead (no spans). */
export function fromStyles(text: string, font: ReplacementFont, styles: CharStyle[]): { font: ReplacementFont; spans?: TextSpan[] } {
  if (!text.length) return { font }
  if (styles.every(style => style.bold === styles[0].bold && style.italic === styles[0].italic)) return { font: styledFont(font, styles[0].bold, styles[0].italic) }
  const spans: TextSpan[] = []
  styles.forEach((style, i) => {
    const last = spans[spans.length - 1]
    if (last && last.bold === style.bold && last.italic === style.italic) last.text += text[i]
    else spans.push({ text: text[i], ...style })
  })
  return { font, spans }
}

/** Bold or italic switched for `text[start, end)` (the whole text when nothing is selected): on unless the range already has it everywhere. */
export function toggleRange(text: string, font: ReplacementFont, spans: TextSpan[] | undefined, start: number, end: number, toggle: 'bold' | 'italic') {
  if (start >= end) [start, end] = [0, text.length]
  if (!text.length) return { font: toggleStyle(font, toggle) }
  const styles = charStyles(text, font, spans)
  const on = !styles.slice(start, end).every(style => style[toggle])
  for (let i = start; i < end; i++) styles[i] = { ...styles[i], [toggle]: on }
  return fromStyles(text, font, styles)
}

/** The text as runs of one font each. Throws if the spans do not spell out exactly `text`. */
export function styledRuns(text: string, font: ReplacementFont, spans?: TextSpan[]): { text: string; font: ReplacementFont }[] {
  if (!spans) return text ? [{ text, font }] : []
  if (spans.map(span => span.text).join('') !== text) throw new Error('The bold and italic parts do not match the text. Retype the text and try again.')
  return spans.filter(span => span.text).map(span => ({ text: span.text, font: styledFont(font, span.bold, span.italic) }))
}

import type { ReplacementFont } from './document'
export type { ReplacementFont }

// The 12 standard PDF fonts: every viewer has them, so nothing is embedded.
export const FONT_FAMILIES = [
  { label: 'Helvetica', css: 'Helvetica, Arial, sans-serif', regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' },
  { label: 'Times', css: '"Times New Roman", Times, serif', regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic' },
  { label: 'Courier', css: '"Courier New", Courier, monospace', regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique', boldItalic: 'Courier-BoldOblique' },
] as const

// Self-hosted OFL script fonts for typed signatures, embedded (subset) into the PDF.
export const HANDWRITING_FONTS = ['Dancing Script', 'Great Vibes'] as const
export type HandwritingFont = typeof HANDWRITING_FONTS[number]
export type SignatureFont = ReplacementFont | HandwritingFont
export const isHandwriting = (font: string): font is HandwritingFont => (HANDWRITING_FONTS as readonly string[]).includes(font)

export const STYLE_LABELS = { regular: 'Regular', bold: 'Bold', italic: 'Italic', boldItalic: 'Bold italic' } as const
type Style = keyof typeof STYLE_LABELS

export function fontParts(font: ReplacementFont) {
  for (const family of FONT_FAMILIES) for (const style of Object.keys(STYLE_LABELS) as Style[]) if (family[style] === font) return { family, style }
  return { family: FONT_FAMILIES[0], style: 'regular' as Style }
}

/** Closest standard font for an embedded font name such as "ABCDEF+Arial-BoldMT" or "Georgia-Italic". */
export function closestFont(name: string): ReplacementFont {
  const base = name.replace(/^[A-Z]{6}\+/, '')
  const family = /times|roman|serif|georgia|garamond|cambria|book|minion|palatino|baskerville/i.test(base) && !/sans/i.test(base) ? FONT_FAMILIES[1]
    : /courier|mono|consol|menlo|code/i.test(base) ? FONT_FAMILIES[2] : FONT_FAMILIES[0]
  const bold = /bold|black|heavy|semibold|demi/i.test(base), italic = /italic|oblique/i.test(base)
  return family[bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular']
}

/** CSS for previewing a standard font on screen (on-page editor). */
export function fontCss(font: SignatureFont) {
  if (isHandwriting(font)) return { fontFamily: `"${font}", cursive`, fontWeight: 400, fontStyle: 'normal' } as const
  const { family, style } = fontParts(font)
  return { fontFamily: family.css, fontWeight: style === 'bold' || style === 'boldItalic' ? 700 : 400, fontStyle: style === 'italic' || style === 'boldItalic' ? 'italic' : 'normal' } as const
}

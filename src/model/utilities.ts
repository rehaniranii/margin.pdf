import type { RenderedPage } from './document'
import type { ReplacementFont, SignatureFont } from './fonts'

export type PdfFeatures = { annotations: number; widgets: number; links: number; bookmarks: boolean; signed: boolean; signatureCheckIncomplete: boolean; optionalContent: boolean; xfa: boolean }
// checkbox/radio `options` are their on-states; an unticked checkbox has value 'Off'.
export type FormField = { name: string; type: 'text' | 'checkbox' | 'radio' | 'choice'; value: string; options: string[]; page: number; readOnly: boolean; multiline: boolean; password: boolean; maxLen: number }
// `box` is [x, y, width, height] as fractions of the page as seen on screen.
// Typed signatures: `font` defaults to Times-Italic; no `size` fits the text to the box.
export type Signature = { page: number; box: [number, number, number, number]; text?: string; font?: SignatureFont; size?: number; image?: string }
export type UtilitySource = { id: string; kind: 'pdf' | 'image'; pageCount: number; locked?: boolean; fields?: FormField[]; features?: PdfFeatures; width?: number; height?: number }
// `blank`: an empty page sized like source page `page` (the page it was inserted after).
export type PlannedPage = { sourceId: string; page: number; rotation: 0 | 90 | 180 | 270; blank?: boolean }
export type StampPosition = 'center' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
// angle: degrees counter-clockwise (-90…90), or corner-to-corner diagonals worked out per page.
export type StampAngle = number | 'diagonal' | 'diagonal-down'
export type Stamp = { kind: 'watermark' | 'numbers'; text: string; size: number; color: string; opacity: number; position: StampPosition; start: number; pages: number[]; angle?: StampAngle; tile?: boolean; font?: ReplacementFont }
// Margins in points, as seen on screen (after rotation).
export type Crop = { top: number; right: number; bottom: number; left: number; pages: number[] }
export type CompressLevel = 'lossless' | 'balanced' | 'small'
export type RedactPattern = 'email' | 'phone'
export type UtilitySpec =
  | { kind: 'pages'; pages: PlannedPage[]; stamp?: Stamp; crop?: Crop }
  | { kind: 'images'; sources: string[]; paper: 'fit' | 'a4'; margin: number }
  | { kind: 'compress'; source: string; level: CompressLevel }
  | { kind: 'redact'; source: string; terms: string[]; patterns: RedactPattern[]; matchCase: boolean }
  | { kind: 'sanitize'; source: string }
  // OCR words per page, `box` = [x, y, width, height] in points from the page's top-left as displayed.
  | { kind: 'ocr'; source: string; pages: { page: number; words: { text: string; box: [number, number, number, number] }[] }[] }
  | { kind: 'fill'; source: string; values: Record<string, string>; signature?: Signature; flatten: boolean }
  | { kind: 'protect'; source: string; password: string }
  | { kind: 'unlock'; source: string; password: string }
export type UtilityArtifact = { bytes: ArrayBuffer; preview: RenderedPage; pageCount: number; plan?: PlannedPage[]; summary?: string }
export type ImageExport = { bytes: ArrayBuffer; format: 'png' | 'jpeg'; width: number; height: number; requestedDpi: number; actualDpi: number }

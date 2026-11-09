import type { RenderedPage } from './document'

export type PdfFeatures = { annotations: number; widgets: number; links: number; bookmarks: boolean; signed: boolean; signatureCheckIncomplete: boolean; optionalContent: boolean; xfa: boolean }
export type UtilitySource = { id: string; kind: 'pdf' | 'image'; pageCount: number; locked?: boolean; features?: PdfFeatures; width?: number; height?: number }
export type PlannedPage = { sourceId: string; page: number; rotation: 0 | 90 | 180 | 270 }
export type Stamp = { kind: 'watermark' | 'numbers'; text: string; size: number; color: string; opacity: number; position: 'center' | 'bottom'; start: number; pages: number[] }
export type CompressLevel = 'lossless' | 'balanced' | 'small'
export type RedactPattern = 'email' | 'phone'
export type UtilitySpec =
  | { kind: 'pages'; pages: PlannedPage[]; stamp?: Stamp; acceptFlattening: boolean }
  | { kind: 'images'; sources: string[]; paper: 'fit' | 'a4'; margin: number }
  | { kind: 'compress'; source: string; level: CompressLevel }
  | { kind: 'redact'; source: string; terms: string[]; patterns: RedactPattern[]; matchCase: boolean }
  | { kind: 'protect'; source: string; password: string }
  | { kind: 'unlock'; source: string; password: string }
export type UtilityArtifact = { bytes: ArrayBuffer; preview: RenderedPage; pageCount: number; plan?: PlannedPage[]; summary?: string }
export type ImageExport = { bytes: ArrayBuffer; format: 'png' | 'jpeg'; width: number; height: number; requestedDpi: number; actualDpi: number }

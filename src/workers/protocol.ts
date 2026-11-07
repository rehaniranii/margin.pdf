import type { DocumentInfo, EditorView, TextEdit } from '../model/document'
export type Command =
  | { type: 'open'; bytes: ArrayBuffer; width?: number; dpr?: number }
  | { type: 'sample'; width?: number; dpr?: number }
  | { type: 'view'; page: number; scale: number; dpr: number }
  | { type: 'edit'; edit: TextEdit; scale: number; dpr: number }
  | { type: 'undo' | 'redo'; page: number; scale: number; dpr: number }
  | { type: 'export' }
export type OpenResult = { info: DocumentInfo; source: ArrayBuffer; view: EditorView; scale: number }
export type Result = OpenResult | EditorView | ArrayBuffer
export type Request = { id: number; command: Command }
export type Response = { id: number; result?: Result; error?: string }

import type { AddedObject, DocumentInfo, EditorView, ImageAssetInfo, ImageAssetInput, SessionCheckpoint, TextEdit } from '../model/document'
export type Command =
  | { type: 'open'; bytes: ArrayBuffer; width?: number; dpr?: number }
  | { type: 'sample'; width?: number; dpr?: number }
  | { type: 'view'; page: number; scale: number; dpr: number }
  | { type: 'edit'; edit: TextEdit; scale: number; dpr: number }
  | { type: 'object'; object: AddedObject; scale: number; dpr: number }
  | { type: 'delete-object'; id: string; page: number; scale: number; dpr: number }
  | { type: 'import-image'; asset: ImageAssetInput }
  | { type: 'release-image'; id: string }
  | { type: 'restore'; source: ArrayBuffer; checkpoint: SessionCheckpoint; assets: ImageAssetInput[]; page: number; scale: number; dpr: number }
  | { type: 'undo' | 'redo'; page: number; scale: number; dpr: number }
  | { type: 'export' }
export type OpenResult = { info: DocumentInfo; source: ArrayBuffer; view: EditorView; scale: number }
export type Result = OpenResult | EditorView | ArrayBuffer | ImageAssetInfo | { released: true }
export type Request = { id: number; command: Command }
export type Response = { id: number; result?: Result; error?: string }
export type Progress = { id: number; progress: string }

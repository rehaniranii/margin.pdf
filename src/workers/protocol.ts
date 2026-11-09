import type { AddedObject, DocumentInfo, EditorView, ImageAssetInfo, ImageAssetInput, RenderedPage, SessionCheckpoint, TextEdit } from '../model/document'
import type { ImageExport, UtilityArtifact, UtilitySource, UtilitySpec } from '../model/utilities'
export type Command =
  | { type: 'tool-source'; id: string; kind: 'pdf' | 'image'; bytes: ArrayBuffer }
  | { type: 'tool-release'; id: string }
  // quiet: a live preview; no progress messages, so the busy bar stays hidden.
  | { type: 'tool-build'; spec: UtilitySpec; quiet?: boolean }
  | { type: 'tool-font'; name: string; bytes: ArrayBuffer }
  | { type: 'tool-textless'; sourceId: string }
  | { type: 'tool-thumb'; sourceId: string; page: number; width: number }
  | { type: 'tool-image'; sourceId: string; page: number; format: 'png' | 'jpeg'; dpi: number }
  | { type: 'open'; bytes: ArrayBuffer; width?: number; dpr?: number }
  | { type: 'sample'; width?: number; dpr?: number }
  | { type: 'view'; page: number; scale: number; dpr: number }
  | { type: 'thumbnail'; page: number; width: number }
  | { type: 'page-image'; page: number; scale: number; dpr: number }
  | { type: 'edit'; edit: TextEdit; scale: number; dpr: number }
  | { type: 'object'; object: AddedObject; scale: number; dpr: number }
  | { type: 'delete-object'; id: string; page: number; scale: number; dpr: number }
  | { type: 'import-image'; asset: ImageAssetInput }
  | { type: 'release-image'; id: string }
  | { type: 'restore'; source: ArrayBuffer; checkpoint: SessionCheckpoint; assets: ImageAssetInput[]; page: number; scale: number; dpr: number }
  | { type: 'undo' | 'redo'; page: number; scale: number; dpr: number }
  | { type: 'export' }
export type OpenResult = { info: DocumentInfo; source: ArrayBuffer; view: EditorView; scale: number }
export type Result = number[] | OpenResult | EditorView | RenderedPage | ArrayBuffer | ImageAssetInfo | UtilitySource | UtilityArtifact | ImageExport | { released: true }
export type Request = { id: number; command: Command }
export type Response = { id: number; result?: Result; error?: string }
export type Progress = { id: number; progress: string }

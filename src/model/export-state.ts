import type { EditPlan, WorkingDocument } from './document'

export type ExportCheckpoint = { sourceId: string; plan: string }
export function planSignature(plan: EditPlan): string {
  // Compare content plans, not render revisions: zoom/navigation and undo back to
  // the downloaded plan must not manufacture unexported changes.
  return JSON.stringify({ edits: plan.edits, objects: plan.objects })
}
export function exportCheckpoint(document: WorkingDocument): ExportCheckpoint {
  return { sourceId: document.source.id, plan: planSignature(document) }
}
export function needsExport(document: WorkingDocument | undefined, downloaded: ExportCheckpoint | undefined): boolean {
  return !!document && (document.source.id !== downloaded?.sourceId || planSignature(document) !== downloaded.plan)
}

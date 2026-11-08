import type { EditorTool } from '../model/document'

// `label` stays the accessible name (release checks and screen readers); `short` is what is shown.
const groups: { id: EditorTool; label: string; short: string; icon: string }[][] = [
  [{ id: 'edit', label: 'Edit existing text', short: 'Edit text', icon: 'M5 6V4h14v2M12 4v16M9 20h6' },
   { id: 'select', label: 'Select objects', short: 'Select', icon: 'M5 3l14 8-6 2-2 6z' }],
  [{ id: 'text', label: 'Add text', short: 'Text', icon: 'M4 7V5h11v2M9.5 5v14M7 19h5M17 13v6M14 16h6' },
   { id: 'image', label: 'Add image', short: 'Image', icon: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01' }],
  [{ id: 'highlight', label: 'Highlight', short: 'Highlight', icon: 'M4 20h16M7 16l9-9 3 3-9 9H7z' },
   { id: 'rectangle', label: 'Rectangle', short: 'Box', icon: 'M4 6h16v12H4z' },
   { id: 'ink', label: 'Draw', short: 'Draw', icon: 'M4 18c3-6 5 2 8-3s4-7 8-9' },
   { id: 'pan', label: 'Pan', short: 'Pan', icon: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3' }],
]

export function ToolBar({ tool, busy, onChoose }: { tool: EditorTool; busy: boolean; onChoose: (tool: EditorTool) => void }) {
  return <div className="editing-tools" role="toolbar" aria-label="Editing tools">{groups.map((group, index) => <div className="tool-group" key={index}>{group.map(item =>
    <button key={item.id} className={tool === item.id ? 'active-tool' : ''} aria-label={item.label} title={item.label} aria-pressed={tool === item.id} disabled={busy} onClick={() => onChoose(item.id)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon}/></svg><span>{item.short}</span>
    </button>)}</div>)}</div>
}

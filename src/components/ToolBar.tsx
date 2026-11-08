import type { EditorTool } from '../model/document'
const tools: { id: EditorTool; label: string; symbol: string }[] = [
  { id: 'edit', label: 'Edit existing text', symbol: 'T↔' }, { id: 'select', label: 'Select objects', symbol: '↖' },
  { id: 'text', label: 'Add text', symbol: 'T+' }, { id: 'image', label: 'Add image', symbol: '▧' },
  { id: 'highlight', label: 'Highlight', symbol: '▰' }, { id: 'rectangle', label: 'Rectangle', symbol: '□' },
  { id: 'ink', label: 'Draw', symbol: '✎' }, { id: 'pan', label: 'Pan', symbol: '✥' },
]
export function ToolBar({ tool, busy, onChoose }: { tool: EditorTool; busy: boolean; onChoose: (tool: EditorTool) => void }) {
  return <div className="editing-tools" role="toolbar" aria-label="Editing tools">{tools.map(item => <button key={item.id} className={tool === item.id ? 'active-tool' : ''} aria-pressed={tool === item.id} disabled={busy} onClick={() => onChoose(item.id)}><span aria-hidden="true">{item.symbol}</span>{item.label}</button>)}</div>
}

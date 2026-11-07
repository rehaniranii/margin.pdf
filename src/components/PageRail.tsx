import type { RenderedPage } from '../model/document'
import { usePageImage } from './PagePreview'

export function PageRail({ count, active, image, busy, onSelect }: { count: number; active: number; image?: RenderedPage; busy: boolean; onSelect: (index: number) => void }) {
  const url = usePageImage(image)
  // Numbered navigation is virtualized to a window for very large documents.
  const start = Math.max(0, Math.min(active - 3, count - 7))
  const pages = Array.from({ length: Math.min(count, 7) }, (_, i) => start + i)
  return <aside className="page-rail" aria-label="Document pages">
    <div className="rail-heading"><h2>Pages</h2><span>{count}</span></div>
    {start > 0 && <button disabled={busy} onClick={() => onSelect(0)}>First page</button>}
    <div className="page-list">{pages.map(index => <button className={`page-tile ${index === active ? 'active' : ''}`} key={index} disabled={busy} onClick={() => onSelect(index)} aria-label={`Go to page ${index + 1}`} aria-current={index === active ? 'page' : undefined}>
      <div className="mini-page">{index === active && url ? <img src={url} alt=""/> : <span>Page {index + 1}<small>Preview on selection</small></span>}</div>
      <span className="page-label">{index + 1}{index === active && <span className="active-dot"/>}</span>
    </button>)}</div>
    {start + pages.length < count && <button disabled={busy} onClick={() => onSelect(count - 1)}>Last page</button>}
    {!count && <p className="rail-empty">Your pages will appear here.</p>}
    <p className="rail-note">Original files stay unchanged.</p>
  </aside>
}

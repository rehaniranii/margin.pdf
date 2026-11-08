import { useEffect, useRef, useState } from 'react'
import type { RenderedPage } from '../model/document'
import { usePageImage } from './PagePreview'

type Props = { count: number; active: number; image?: RenderedPage; thumbs: Record<number, string>; busy: boolean; onSelect: (index: number) => void; onNeedThumb: (index: number) => void }

export function PageRail({ count, active, image, thumbs, busy, onSelect, onNeedThumb }: Props) {
  const url = usePageImage(image)
  const list = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState<number[]>([])
  // Only tiles near the viewport ask for a thumbnail, so long documents stay light.
  useEffect(() => {
    const root = list.current?.closest('.page-rail')
    if (!root || !count) return
    const shown = new Set<number>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { const index = Number((entry.target as HTMLElement).dataset.page); if (entry.isIntersecting) shown.add(index); else shown.delete(index) }
      setVisible([...shown].sort((a, b) => a - b))
    }, { root, rootMargin: '300px 0px' })
    list.current?.querySelectorAll('[data-page]').forEach(tile => observer.observe(tile))
    return () => observer.disconnect()
  }, [count])
  useEffect(() => { for (const index of visible) if (index !== active && !thumbs[index]) onNeedThumb(index) }, [visible, thumbs, active])
  useEffect(() => { list.current?.querySelector(`[data-page="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])

  return <aside className="page-rail" aria-label="Document pages">
    <div className="rail-heading"><h2>Pages</h2><span>{count}</span></div>
    <div className="page-list" ref={list}>{Array.from({ length: count }, (_, index) => {
      const src = index === active ? url ?? thumbs[index] : thumbs[index]
      return <button className={`page-tile ${index === active ? 'active' : ''}`} key={index} data-page={index} disabled={busy} onClick={() => onSelect(index)} aria-label={`Go to page ${index + 1}`} aria-current={index === active ? 'page' : undefined}>
        <div className={`mini-page${src ? '' : ' loading'}`}>{src ? <img src={src} alt=""/> : <span aria-hidden="true"/>}</div>
        <span className="page-label">{index + 1}</span>
      </button>
    })}</div>
    {!count && <p className="rail-empty">Pages appear here.</p>}
  </aside>
}

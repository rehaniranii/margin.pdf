import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Rect, RenderedPage } from '../model/document'

type Cached = { url: string; zoom: number; stamp: string }
const NEAR = 2 // sharp renders kept this many pages beyond the visible ones

// Every page stacked for continuous scrolling. Only `active` is the interactive editor page
// (children); the others are images, sharp once visible and the rail thumbnail until then.
export function PageStack({ sizes, zoom, active, activeImage, thumbs, stamp, busy, render, onNeedThumb, onActivate, children }: {
  sizes: Rect[]; zoom: number; active: number; activeImage?: RenderedPage; thumbs: Record<number, string>; stamp: (page: number) => string; busy: boolean
  render: (page: number, zoom: number) => Promise<RenderedPage>; onNeedThumb: (page: number) => void; onActivate: (page: number) => void; children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState<number[]>([]), [images, setImages] = useState<Record<number, Cached>>({})
  const imagesRef = useRef(images); imagesRef.current = images
  const loading = useRef(false), wanted = useRef<number[]>([]), zoomRef = useRef(zoom); zoomRef.current = zoom
  const stage = () => root.current?.closest<HTMLElement>('.page-stage') ?? undefined

  useEffect(() => {
    const scroller = stage(); if (!scroller || !root.current) return
    const observer = new IntersectionObserver(entries => setVisible(old => {
      const next = new Set(old)
      for (const entry of entries) { const page = Number((entry.target as HTMLElement).dataset.page); if (entry.isIntersecting) next.add(page); else next.delete(page) }
      return [...next].sort((a, b) => a - b)
    }), { root: scroller, rootMargin: '25% 0px' })
    root.current.querySelectorAll('[data-page]').forEach(slot => observer.observe(slot))
    return () => observer.disconnect()
  }, [sizes.length])

  // The page leaving edit mode keeps its last full render, so it never flashes to a placeholder.
  const previous = useRef<{ page: number; image?: RenderedPage }>(undefined)
  useLayoutEffect(() => {
    const last = previous.current
    if (last && last.page !== active && last.image) {
      const url = URL.createObjectURL(new Blob([last.image.png], { type: 'image/png' }))
      setImages(old => { if (old[last.page]) URL.revokeObjectURL(old[last.page].url); return { ...old, [last.page]: { url, zoom: zoomRef.current, stamp: stamp(last.page) } } })
    }
    previous.current = { page: active, image: activeImage }
  }, [active, activeImage])

  // Sharp renders for visible pages, one at a time; far-away renders are released to save memory.
  useEffect(() => {
    const near = new Set(visible.flatMap(page => Array.from({ length: NEAR * 2 + 1 }, (_, i) => page - NEAR + i)))
    setImages(old => {
      const kept: Record<number, Cached> = {}
      for (const [page, image] of Object.entries(old)) { if (near.has(Number(page))) kept[Number(page)] = image; else URL.revokeObjectURL(image.url) }
      return Object.keys(kept).length === Object.keys(old).length ? old : kept
    })
    for (const page of visible) if (!thumbs[page]) onNeedThumb(page)
    wanted.current = visible.filter(page => page !== active)
    void pump()
  }, [visible, zoom, active, stamp])
  async function pump() {
    if (loading.current) return
    loading.current = true
    try {
      for (;;) {
        const page = wanted.current.find(page => { const image = imagesRef.current[page]; return !image || image.zoom !== zoomRef.current || image.stamp !== stamp(page) })
        if (page === undefined) return
        const asked = { zoom: zoomRef.current, stamp: stamp(page) }
        let rendered: RenderedPage
        try { rendered = await render(page, asked.zoom) } catch { return }
        const url = URL.createObjectURL(new Blob([rendered.png], { type: 'image/png' }))
        setImages(old => { if (old[page]) URL.revokeObjectURL(old[page].url); return { ...old, [page]: { url, ...asked } } })
        imagesRef.current = { ...imagesRef.current, [page]: { url, ...asked } }
      }
    } finally { loading.current = false }
  }
  useEffect(() => () => Object.values(imagesRef.current).forEach(image => URL.revokeObjectURL(image.url)), [])

  // When scrolling settles, the page across the reading line (a third of the way down) becomes the editable one.
  useEffect(() => {
    const scroller = stage(); if (!scroller) return
    let timer = 0
    const settle = () => {
      // The editor marks scroll positions it set itself (page jumps, zoom); only the user's own scrolling picks a page.
      if (scroller.dataset.scrolledTo === String(Math.round(scroller.scrollTop))) return
      const frame = scroller.getBoundingClientRect(), middle = frame.top + scroller.clientHeight / 3
      let best = active, distance = Infinity
      root.current?.querySelectorAll<HTMLElement>('[data-page]').forEach(slot => {
        const rect = slot.getBoundingClientRect(), gap = middle < rect.top ? rect.top - middle : middle > rect.bottom ? middle - rect.bottom : 0
        if (gap < distance) { distance = gap; best = Number(slot.dataset.page) }
      })
      // Short last pages never reach the reading line, so the very top and bottom pick the first and last page.
      if (scroller.scrollTop <= 1) best = 0
      else if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) best = sizes.length - 1
      if (best !== active) onActivate(best)
    }
    const onScroll = () => { clearTimeout(timer); timer = window.setTimeout(settle, 150) }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    // A scroll that ended while the editor was busy is picked up once it is free.
    if (!busy) onScroll()
    return () => { scroller.removeEventListener('scroll', onScroll); clearTimeout(timer) }
  }, [active, busy, onActivate])

  return <div className="page-stack" ref={root}>
    {sizes.map((bounds, page) => {
      const width = (bounds[2] - bounds[0]) * zoom, height = (bounds[3] - bounds[1]) * zoom, src = images[page]?.url ?? thumbs[page]
      // Behind the editable page: its last render, visible while the sharp preview decodes.
      return <div key={page} className="page-slot" data-page={page} style={{ width, minHeight: height, backgroundImage: page === active && src ? `url(${src})` : undefined }}>
        {page === active ? children : <button type="button" className="page-ghost" style={{ width, height }} aria-label={`Edit page ${page + 1}`} onClick={() => onActivate(page)}>{src && <img src={src} alt="" draggable={false}/>}</button>}
      </div>
    })}
  </div>
}

import { useEffect, useState } from 'react'
import type { RenderedPage, TextEdit, TextRegion } from '../model/document'
import { regionStyle } from '../geometry/page'

export function usePageImage(page?: RenderedPage) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!page) { setUrl(undefined); return }
    const next = URL.createObjectURL(new Blob([page.png], { type: 'image/png' }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [page])
  return url
}

export function PagePreview({ image, page, zoom, regions = [], edits = [], selected, busy, showRegions = true, onSelect }: { image?: RenderedPage; page: number; zoom: number; regions?: TextRegion[]; edits?: TextEdit[]; selected?: string; busy?: boolean; showRegions?: boolean; onSelect?: (region: TextRegion) => void }) {
  const url = usePageImage(image)
  if (!image || !url) return <div className="empty-page"><span className="empty-mark">m.</span><h2>Your document belongs here.</h2><p>Open a PDF from your device or try the sample.</p></div>
  const width = (image.bounds[2] - image.bounds[0]) * zoom
  return <div className="document-page page-paper" style={{ width, height: width * image.height / image.width }}>
    <img className="page-bitmap" src={url} alt={`PDF page ${page + 1}`}/>
    <div className={`text-regions ${showRegions ? 'show-regions' : ''}`} role="group" aria-label="Existing PDF text">
      {regions.map(region => {
        const edit = edits.find(edit => edit.regionId === region.id)
        const text = edit?.text ?? region.text
        return <button key={region.id} type="button" className={`text-region ${region.id === selected ? 'selected' : ''} ${region.unsupported ? 'unsupported-region' : ''} ${edit ? 'changed-region' : ''}`} style={regionStyle(region.bounds, image)} onClick={() => onSelect?.(region)} disabled={busy} aria-pressed={region.id === selected} aria-label={`${region.unsupported ? 'Inspect unsupported text' : 'Edit text'}: ${text || 'Removed line'}`} title={region.unsupported ?? `Edit: ${text || 'Removed line'}`}/>
      })}
    </div>
  </div>
}

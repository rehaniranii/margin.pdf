import type { Rect, RenderedPage } from '../model/document'

// All interface geometry uses MuPDF page points: top-left, y downward, 72 pt/in.
// The renderer handles CropBox and intrinsic page rotation before display scaling.
export function boundedScale(bounds: Rect, requestedScale: number, dpr = 1): number {
  const width = bounds[2] - bounds[0]
  const height = bounds[3] - bounds[1]
  if (![...bounds, requestedScale, dpr].every(Number.isFinite) || width <= 0 || height <= 0 || requestedScale <= 0 || dpr <= 0) {
    throw new Error('This page has invalid dimensions.')
  }
  return Math.min(requestedScale * Math.min(dpr, 2), 3, 4096 / width, 4096 / height, Math.sqrt(8_000_000 / (width * height)))
}

export function pointToDisplay(x: number, y: number, bounds: Rect, scale: number) {
  return { x: (x - bounds[0]) * scale, y: (y - bounds[1]) * scale }
}

// Percentages account for the raster's integer-rounded extent and device origin.
export function regionStyle(bounds: Rect, image: Pick<RenderedPage, 'width' | 'height' | 'rasterScale' | 'pixelOrigin'>) {
  return {
    left: `${(bounds[0] * image.rasterScale - image.pixelOrigin[0]) / image.width * 100}%`,
    top: `${(bounds[1] * image.rasterScale - image.pixelOrigin[1]) / image.height * 100}%`,
    width: `${(bounds[2] - bounds[0]) * image.rasterScale / image.width * 100}%`,
    height: `${(bounds[3] - bounds[1]) * image.rasterScale / image.height * 100}%`,
  }
}

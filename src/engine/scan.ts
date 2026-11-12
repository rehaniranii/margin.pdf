import * as mupdf from 'mupdf'
import type { Rect } from '../model/document'

// Editing text on a scanned page means editing the page photo: cover the old words with the paper colour and draw
// new text in the ink colour. Both colours, and where the photo is blank, are read from a render of the page.
const SCALE = 2

export class PagePixels {
  private pixels: Uint8ClampedArray
  private x: number; private y: number; private width: number; private height: number; private stride: number; private n: number
  constructor(page: mupdf.PDFPage) {
    const pixmap = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false)
    try {
      this.pixels = pixmap.getPixels().slice(); this.x = pixmap.getX(); this.y = pixmap.getY()
      this.width = pixmap.getWidth(); this.height = pixmap.getHeight(); this.stride = pixmap.getStride(); this.n = pixmap.getNumberOfComponents()
    } finally { pixmap.destroy() }
  }
  /** RGB of every pixel inside a page rectangle (skipping `hole`, if given). */
  private colors(rect: Rect, hole?: Rect) {
    const out: number[][] = []
    const [x0, y0, x1, y1] = [Math.floor(rect[0] * SCALE) - this.x, Math.floor(rect[1] * SCALE) - this.y, Math.ceil(rect[2] * SCALE) - this.x, Math.ceil(rect[3] * SCALE) - this.y]
    for (let py = Math.max(0, y0); py < Math.min(this.height, y1); py++) for (let px = Math.max(0, x0); px < Math.min(this.width, x1); px++) {
      if (hole) { const x = (px + this.x) / SCALE, y = (py + this.y) / SCALE; if (x >= hole[0] && x <= hole[2] && y >= hole[1] && y <= hole[3]) continue }
      const offset = py * this.stride + px * this.n
      out.push([this.pixels[offset], this.pixels[offset + 1], this.pixels[offset + 2]])
    }
    return out
  }
  /** The paper: the median colour of a thin ring around `area`. The ink: the darkest tenth inside `ink`. */
  colorsAround(area: Rect, ink: Rect, ring: number) {
    const around = this.colors([area[0] - ring, area[1] - ring, area[2] + ring, area[3] + ring], area)
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 255
    const paper = around.length ? [0, 1, 2].map(c => median(around.map(color => color[c]))) : [255, 255, 255]
    const inside = this.colors(ink).sort((a, b) => luminance(a) - luminance(b))
    const darkest = inside.slice(0, Math.max(1, Math.ceil(inside.length / 10)))
    let color = inside.length ? [0, 1, 2].map(c => Math.round(darkest.reduce((sum, value) => sum + value[c], 0) / darkest.length)) : [0, 0, 0]
    // Too little contrast means the box missed the ink: fall back to black.
    if (Math.abs(luminance(color) - luminance(paper)) < 60) color = [0, 0, 0]
    return { paper: hex(paper), ink: hex(color) }
  }
  /** Whether a page rectangle is empty paper: almost every pixel close to `paper` (scan noise allowed). */
  blank(rect: Rect, paper: string) {
    const target = [1, 3, 5].map(i => parseInt(paper.slice(i, i + 2), 16))
    const colors = this.colors(rect)
    const marked = colors.filter(color => Math.max(...color.map((value, c) => Math.abs(value - target[c]))) > 60).length
    return marked <= colors.length * 0.005
  }
}
const luminance = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b
const hex = (rgb: number[]) => '#' + rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')

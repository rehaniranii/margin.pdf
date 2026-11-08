import * as mupdf from 'mupdf'
import type { ImageAssetInfo, ImageAssetInput } from '../model/document'

export function imageFormat(bytes: Uint8Array): 'png' | 'jpeg' {
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return 'png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg'
  throw new Error('Choose a JPG or PNG image. Other image formats are not supported.')
}

export function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const format = imageFormat(bytes)
  if (format === 'png') {
    if (bytes.length < 24) throw new Error('This PNG is incomplete.')
    const data = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
    return {width:data.getUint32(16),height:data.getUint32(20)}
  }
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) throw new Error('This JPG has an invalid header.')
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 217 || marker === 218) break
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue
    if (offset+2 > bytes.length) break
    const length = bytes[offset]*256+bytes[offset+1]
    if (length < 2 || offset+length > bytes.length) break
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (length < 8) break
      return {height:bytes[offset+3]*256+bytes[offset+4],width:bytes[offset+5]*256+bytes[offset+6]}
    }
    offset += length
  }
  throw new Error('This JPG has incomplete or unsupported dimension information.')
}

export class ImageAssets {
  private images = new Map<string, { image: mupdf.Image; width: number; height: number }>()
  add(input: ImageAssetInput): ImageAssetInfo {
    if (!input.id || this.images.has(input.id)) throw new Error('This image identifier is already in use.')
    const bytes = new Uint8Array(input.bytes)
    const dimensions = imageDimensions(bytes)
    if (!dimensions.width || !dimensions.height || dimensions.width*dimensions.height > 32_000_000) throw new Error('This image exceeds the 32-million-pixel decoding budget or has invalid dimensions. Resize it locally before adding it.')
    const image = new mupdf.Image(bytes)
    const doc = new mupdf.PDFDocument()
    try {
      const width = image.getWidth(), height = image.getHeight()
      // A decode budget bounds one operation's native memory; it is not a usage quota.
      if (width * height > 32_000_000) throw new Error('This image exceeds the 32-million-pixel decoding budget. Resize it locally before adding it.')
      const scale = Math.min(1, 160 / width, 160 / height), w = Math.max(1, width * scale), h = Math.max(1, height * scale)
      const reference = doc.addImage(image)
      const object = doc.addPage([0, 0, w, h], 0, { XObject: { Im: reference } }, `q ${w} 0 0 ${h} 0 0 cm /Im Do Q`)
      doc.insertPage(-1, object); object.destroy(); reference.destroy()
      const page = doc.loadPage(0)
      try {
        const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, true)
        try {
          const thumbnail = pixmap.asPNG().slice().buffer
          this.images.set(input.id, { image, width, height })
          return { id: input.id, width, height, thumbnail }
        } finally { pixmap.destroy() }
      } finally { page.destroy() }
    } catch (error) { image.destroy(); throw error }
    finally { doc.destroy() }
  }
  get(id: string) { const asset = this.images.get(id); if (!asset) throw new Error('This image is no longer available. Add it again.'); return asset }
  prune(used: Set<string>) { for (const [id, asset] of this.images) if (!used.has(id)) { asset.image.destroy(); this.images.delete(id) } }
  dispose() { this.prune(new Set()) }
}

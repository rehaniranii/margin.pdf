import * as mupdf from 'mupdf'
import type { AddedObject, Rect } from '../model/document'
import { validBox } from '../geometry/objects'
import { contains } from '../geometry/affine'
import { pdfLiteral as literal, supportedText, unsupportedMessage } from '../model/text-encoding'
import { REPLACEMENT_FONTS } from './text-edit'
import { appendPageForm } from './page-form'
import { openPdf } from './mupdf-adapter'
import type { ImageAssets } from './image-assets'

const num = (n: number) => Number(n.toFixed(6)).toString()
const rgb = (color: string) => [1,3,5].map(index => num(parseInt(color.slice(index, index + 2), 16) / 255)).join(' ')

export function validateObject(object: AddedObject, bounds: Rect) {
  if (!object.id || !Number.isInteger(object.page) || object.page < 0 || !validBox(object.box, bounds)) throw new Error('Keep the object inside the page with a width and height of at least 2 points.')
  if ('color' in object && !/^#[\da-f]{6}$/i.test(object.color)) throw new Error('Choose a valid object color.')
  if ('lineWidth' in object && (!Number.isFinite(object.lineWidth) || object.lineWidth < 0.5 || object.lineWidth > 24 || object.lineWidth > Math.min(object.box.width, object.box.height))) throw new Error('Choose a line width from 0.5 to 24 points that fits inside the object.')
  if (object.kind === 'highlight' && (!Number.isFinite(object.opacity) || object.opacity < 0.05 || object.opacity > 0.75)) throw new Error('Highlight opacity must be between 5% and 75%.')
  if (object.kind === 'text') {
    if (!object.text.trim() || !object.text.split('\n').every(supportedText)) throw new Error(`Enter visible text. ${unsupportedMessage} No characters are dropped.`)
    if (!REPLACEMENT_FONTS.includes(object.font) || !Number.isFinite(object.size) || object.size < 4 || object.size > 144) throw new Error('Choose an available font and a size from 4 to 144 points.')
    const font = new mupdf.Font(object.font), text = new mupdf.Text()
    try {
      for (const [index, line] of object.text.split('\n').entries()) text.showString(font, [object.size, 0, 0, -object.size, object.box.x + 2, object.box.y + 2 + object.size * (1.1 + index * 1.3)], line)
      const ink = text.getBounds(null as unknown as mupdf.StrokeState, mupdf.Matrix.identity)
      const box: Rect = [object.box.x, object.box.y, object.box.x + object.box.width, object.box.y + object.box.height]
      if (!contains(box, ink)) throw new Error('Added text does not fit its box. Enlarge the box, shorten the text, or reduce the font size.')
    } finally { text.destroy(); font.destroy() }
  }
  if (object.kind === 'ink' && (!object.points.length || object.points.some(point => point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 1)))) throw new Error('This drawing has invalid points. Draw the stroke again.')
  if (!['text','image','highlight','rectangle','ink'].includes(object.kind)) throw new Error('This object type is not supported.')
}

export function compileObjects(source: Uint8Array, objects: AddedObject[], assets: ImageAssets, progress?: (label: string) => void): Uint8Array<ArrayBuffer> {
  if (!objects.length) return source.slice()
  const doc = openPdf(source)
  try {
    if (new Set(objects.map(o => o.id)).size !== objects.length) throw new Error('The object plan contains duplicate identifiers.')
    const groups = new Map<number, AddedObject[]>()
    for (const object of objects) { const list = groups.get(object.page) ?? []; list.push(object); groups.set(object.page, list) }
    for (const [index, pageObjects] of groups) {
      progress?.(`Placing objects on page ${index + 1}…`)
      const page = doc.loadPage(index)
      const owned: { destroy(): void }[] = []
      try {
        const bounds = page.getBounds(), fonts: Record<string, mupdf.PDFObject> = {}, images: Record<string, mupdf.PDFObject> = {}, states: Record<string, unknown> = {}, commands: string[] = []
        for (const [i, object] of pageObjects.entries()) {
          validateObject(object, bounds)
          const { x, y, width: w, height: h } = object.box
          const rect = [x,y,w,h].map(num).join(' ')
          if (object.kind === 'text') {
            const font = new mupdf.Font(object.font); owned.push(font)
            const reference = doc.addSimpleFont(font); owned.push(reference); fonts[`F${i}`] = reference
            for (const [line, value] of object.text.split('\n').entries()) commands.push(`q BT /F${i} ${num(object.size)} Tf ${rgb(object.color)} rg 1 0 0 -1 ${num(x + 2)} ${num(y + 2 + object.size * (1.1 + line * 1.3))} Tm ${literal(value)} Tj ET Q`)
          } else if (object.kind === 'image') {
            const asset = assets.get(object.assetId)
            if (Math.abs(w / h - asset.width / asset.height) > asset.width / asset.height * 0.005) throw new Error('Keep the image’s original proportions when resizing it.')
            const reference = doc.addImage(asset.image); owned.push(reference); images[`Im${i}`] = reference
            // Page space descends; the negative Y image matrix keeps JPG/PNG upright.
            commands.push(`q ${num(w)} 0 0 ${num(-h)} ${num(x)} ${num(y+h)} cm /Im${i} Do Q`)
          } else if (object.kind === 'highlight') {
            states[`G${i}`] = { Type: 'ExtGState', ca: object.opacity, CA: object.opacity, BM: 'Multiply' }
            commands.push(`q /G${i} gs ${rgb(object.color)} rg ${rect} re f Q`)
          } else if (object.kind === 'rectangle') {
            const inset = object.lineWidth / 2
            commands.push(`q ${rgb(object.color)} RG ${num(object.lineWidth)} w ${[x+inset,y+inset,w-object.lineWidth,h-object.lineWidth].map(num).join(' ')} re S Q`)
          } else {
            const margin = object.lineWidth / 2
            const points = object.points.map(([px,py]) => [x + margin + px * (w-2*margin), y + margin + py * (h-2*margin)])
            const [first, ...rest] = points
            const path = [`${first.map(num).join(' ')} m`, ...(rest.length ? rest : [[first[0]+0.001,first[1]]]).map(p => `${p.map(num).join(' ')} l`)].join(' ')
            commands.push(`q ${rgb(object.color)} RG ${num(object.lineWidth)} w 1 J 1 j ${path} S Q`)
          }
        }
        appendPageForm(doc, page, commands.join('\n'), { Font: fonts, XObject: images, ExtGState: states }, 'MarginObjects')
      } finally { owned.reverse().forEach(value => value.destroy()); page.destroy() }
    }
    progress?.('Saving PDF objects…')
    const buffer = doc.saveToBuffer('garbage=4,compress')
    try { return buffer.asUint8Array().slice() } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

import * as mupdf from 'mupdf'

export function cloneDictionary(doc: mupdf.PDFDocument, source: mupdf.PDFObject) {
  const clone = doc.newDictionary()
  if (source.isDictionary()) source.forEach((value, key) => { try { clone.put(key, value) } finally { value.destroy() } })
  return clone
}

// A separate resource dictionary and inverse page transform keep insertions in
// displayed page points, without changing fonts/images shared by source pages.
export function appendPageForm(doc: mupdf.PDFDocument, page: mupdf.PDFPage, contents: string, formResources: unknown, prefix: string) {
  const owned: { destroy(): void }[] = []
  const keep = <T extends { destroy(): void }>(value: T): T => { owned.push(value); return value }
  try {
    const object = keep(page.getObject())
    const inherited = keep(object.getInheritable('Resources'))
    const resources = keep(cloneDictionary(doc, inherited))
    const old = keep(resources.get('XObject'))
    const xObjects = keep(cloneDictionary(doc, old))
    const form = keep(doc.addStream(contents, { Type: 'XObject', Subtype: 'Form', BBox: page.getBounds(), Matrix: mupdf.Matrix.invert(page.getTransform()), Resources: formResources }))
    let name = prefix
    for (let suffix = 0; ; suffix++) { const test = xObjects.get(name); const available = test.isNull(); test.destroy(); if (available) break; name = `${prefix}${suffix}` }
    xObjects.put(name, form); resources.put('XObject', xObjects); object.put('Resources', resources)
    const previous = keep(object.get('Contents'))
    const streams = keep(doc.newArray())
    streams.push(keep(doc.addStream('q\n', {})))
    if (previous.isArray()) previous.forEach(value => { try { streams.push(value) } finally { value.destroy() } })
    else if (!previous.isNull()) streams.push(previous)
    streams.push(keep(doc.addStream(`\nQ\nq /${name} Do Q\n`, {})))
    object.put('Contents', streams)
  } finally { owned.reverse().forEach(object => object.destroy()) }
}

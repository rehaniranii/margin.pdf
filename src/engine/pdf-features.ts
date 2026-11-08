import type * as mupdf from 'mupdf'
import type { PdfFeatures } from '../model/utilities'

// Detection only, never certificate validation. Scan indirect signature dictionaries
// as well as inherited widget fields, including signatures no longer in AcroForm.
export function pdfFeatures(doc: mupdf.PDFDocument): PdfFeatures {
  const result: PdfFeatures = { annotations:0, widgets:0, links:0, bookmarks:false, signed:false, signatureCheckIncomplete:false, optionalContent:false, xfa:false }
  const trailer = doc.getTrailer(), root = trailer.get('Root')
  try {
    const outlines=root.get('Outlines'), layers=root.get('OCProperties'), signature=root.get('Perms','DocMDP'), xfa=root.get('AcroForm','XFA')
    try { result.bookmarks=!outlines.isNull(); result.optionalContent=!layers.isNull(); result.signed=!signature.isNull(); result.xfa=!xfa.isNull() }
    finally { outlines.destroy();layers.destroy();signature.destroy();xfa.destroy() }
  } finally { root.destroy();trailer.destroy() }
  for (let index=1;index<doc.countObjects();index++) {
    const ref=doc.newIndirect(index)
    try {
      const object=ref.resolve()
      try {
        if (!object.isDictionary()) continue
        const type=object.get('Type'), subtype=object.get('Subtype'), range=object.get('ByteRange'), contents=object.get('Contents'), field=object.getInheritable('FT'), value=object.getInheritable('V')
        try {
          if (subtype.asName()==='Link') result.links++
          else if (subtype.asName()==='Widget') result.widgets++
          else if (type.asName()==='Annot') result.annotations++
          if ((range.isArray()&&!contents.isNull()) || (field.asName()==='Sig'&&!value.isNull())) result.signed=true
        } finally { type.destroy();subtype.destroy();range.destroy();contents.destroy();field.destroy();value.destroy() }
      } finally { object.destroy() }
    } catch { result.signatureCheckIncomplete=true }
    finally { ref.destroy() }
  }
  return result
}

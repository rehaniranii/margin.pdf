import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import {openPdf} from '../../src/engine/mupdf-adapter'

const report=JSON.parse(await readFile('output/phase6/workflow-report.json','utf8'))
const doc=openPdf(await readFile('output/phase6/workflow.pdf'))
try{
 const page=doc.loadPage(0),text=page.toStructuredText(''),pix=page.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,true)
 try{
  assert.match(text.asText(),/Margin release\./)
  assert.ok(!text.asText().includes('Original editable line'))
  assert.match(text.asText(),/Nearby content stays\./)
  const rgb=pix.getPixels(),rgba=new Uint8Array(rgb.length/3*4)
  for(let i=0,j=0;i<rgb.length;i+=3,j+=4){rgba.set(rgb.subarray(i,i+3),j);rgba[j+3]=255}
  assert.equal(pix.getWidth(),report.preview.width)
  assert.equal(pix.getHeight(),report.preview.height)
  assert.equal(createHash('sha256').update(rgba).digest('hex'),report.preview.rgbaSha256,'Browser preview and reopened export differ')
 }finally{pix.destroy();text.destroy();page.destroy()}
}finally{doc.destroy()}
console.log('Reopened export text and every RGBA preview pixel match the production browser.')

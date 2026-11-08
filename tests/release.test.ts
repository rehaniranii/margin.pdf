import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import {releaseFixtures} from '../scripts/release/fixtures'
import {EditorSession} from '../src/engine/editor-session'
import {openPdf,render} from '../src/engine/mupdf-adapter'

const fixtures=releaseFixtures()
function pageText(doc:mupdf.PDFDocument,index=0){const page=doc.loadPage(index),text=page.toStructuredText('');try{return text.asText()}finally{text.destroy();page.destroy()}}
for(const [name,fixture]of Object.entries(fixtures)){
 test(`release fixture: ${name}`,()=>{
  const source=fixture.bytes.slice(),session=new EditorSession(source)
  try{
   const view=session.view(0,1,1),region=view.text.regions.find(r=>r.text===fixture.line)
   assert.ok(view.image.width<=4096&&view.image.height<=4096)
   assert.ok(view.image.width*view.image.height<=8_000_000)
   if(fixture.expected==='scanned'){assert.equal(view.text.regions.length,0);assert.match(view.text.message??'',/scanned/);return}
   if(fixture.expected==='restricted'){assert.ok(view.text.regions.length>0);assert.ok(fixture.line?region?.unsupported:view.text.regions.every(r=>!!r.unsupported));return}
   if(fixture.expected==='large'){assert.equal(session.count,name.startsWith('large')?250:1);if(session.count>1)assert.equal(session.view(249,.2,1).text.page,249);return}
   assert.ok(region&&!region.unsupported,`${name} should offer its known simple source line`)
   const preview=session.apply({type:'replace-text',page:0,regionId:region.id,text:'Release verified.',font:'Helvetica',size:14,color:'#2859cf'},1,1)
   const result=session.export(),before=openPdf(source),after=openPdf(result)
   try{
    assert.match(pageText(after),/Release verified\./)
    assert.ok(!pageText(after).includes(fixture.line!),'selected original removed on the edited page')
    assert.match(pageText(after),/Nearby content stays\./)
    assert.equal(after.countPages(),before.countPages())
    if(after.countPages()>1)assert.equal(pageText(after,1),pageText(before,1),'untouched repeated text survives')
    assert.deepEqual(new Uint8Array(render(after,0,1,1).png),new Uint8Array(preview.image.png),'preview and reopened export agree')
    const a=before.loadPage(0),b=after.loadPage(0),left=a.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,true),right=b.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,true)
    try{
     const x0=Math.floor(region.bounds[0])-2,y0=Math.floor(region.bounds[1])-2,x1=Math.ceil(region.bounds[2])+2,y1=Math.ceil(region.bounds[3])+2
     const p=left.getPixels(),q=right.getPixels();assert.equal(p.length,q.length)
     let changes=0
     for(let y=0;y<left.getHeight();y++)for(let x=0;x<left.getWidth();x++)for(let c=0;c<3;c++){
      const i=(y*left.getWidth()+x)*3+c
      if(p[i]!==q[i]){changes++;assert.ok(x>=x0&&x<=x1&&y>=y0&&y<=y1,`neighbor appearance changed at ${x},${y}`)}
     }
     assert.ok(changes>0)
    }finally{left.destroy();right.destroy();a.destroy();b.destroy()}
    if(name==='synthetic-signature.pdf')assert.equal(session.features().signed,true)
    if(name==='form.pdf')assert.equal(session.features().widgets,1)
    if(name==='annotation.pdf')assert.equal(session.features().annotations,1)
   }finally{before.destroy();after.destroy()}
   assert.deepEqual(source,fixture.bytes,'original bytes unchanged')
  }finally{session.dispose()}
 })
}

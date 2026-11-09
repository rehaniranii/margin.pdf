import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import { fixture } from './fixtures'
import { EditorSession } from '../src/engine/editor-session'
import { openPdf, render } from '../src/engine/mupdf-adapter'
import { analyzePage } from '../src/engine/text-analysis'
import { imageDimensions, imageFormat } from '../src/engine/image-assets'
import { boxRect, clampBox, inkFromPoints, pointerToPage, resizeBox } from '../src/geometry/objects'
import type { AddedObject, Point, Rect } from '../src/model/document'

export function testImage(format: 'png' | 'jpeg' = 'png') {
  const alpha = format === 'png', pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB,[0,0,16,16],alpha)
  try {
    const pixels = pixmap.getPixels(), components = alpha ? 4 : 3
    for (let y=0;y<16;y++) for (let x=0;x<16;x++) {
      const color = y<8 ? x<8 ? [255,0,0,255] : [0,255,0,255] : x<8 ? [0,0,255,255] : alpha ? [0,0,0,0] : [255,255,255,255]
      color.slice(0,components).forEach((value,c)=>{pixels[(y*16+x)*components+c]=value})
    }
    return (alpha ? pixmap.asPNG() : pixmap.asJPEG(95)).slice().buffer
  } finally { pixmap.destroy() }
}
const objects: AddedObject[] = [
  {id:'note',page:0,kind:'text',box:{x:20,y:190,width:140,height:40},text:'Added note',font:'Helvetica',size:16,color:'#2859cf'},
  {id:'rect',page:0,kind:'rectangle',box:{x:190,y:200,width:80,height:45},color:'#ee2222',lineWidth:2},
  {id:'highlight',page:0,kind:'highlight',box:{x:20,y:240,width:120,height:20},color:'#ffff00',opacity:0.25},
  {id:'ink',page:0,kind:'ink',box:{x:170,y:270,width:100,height:40},points:[[0,1],[0.5,0],[1,1]],color:'#0000ff',lineWidth:2,purpose:'visual-signature'},
  {id:'image',page:0,kind:'image',box:{x:240,y:60,width:80,height:80},assetId:'asset'},
]

function pixels(bytes: ArrayBuffer, index=0) {
  const doc = openPdf(bytes), page = doc.loadPage(index)
  const pixmap = page.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false)
  try { return {data:pixmap.getPixels().slice(),width:pixmap.getWidth(),height:pixmap.getHeight()} }
  finally {pixmap.destroy();page.destroy();doc.destroy()}
}
function at(image: ReturnType<typeof pixels>, x: number, y: number) { const i=(Math.floor(y)*image.width+Math.floor(x))*3;return [...image.data.slice(i,i+3)] }

for (const rotation of [0,90,180,270] as const) for (const userUnit of [1,2]) test(`all added objects export at displayed coordinates on ${rotation}° cropped UserUnit ${userUnit} pages`,()=>{
  const source=fixture({rotation,crop:[40,50,380,470],userUnit,pages:2}), session=new EditorSession(source)
  try {
    session.importImage({id:'asset',bytes:testImage()})
    const first=session.view(0,1,1)
    session.apply({type:'replace-text',page:0,regionId:'0:0',text:'Revised source',font:'Helvetica',size:first.text.regions[0].fontSize,color:'#000000'},1,1)
    const before=session.export()
    let view=first
    for(const object of objects) view=session.putObject(object,1,1)
    const bytes=session.export(), image=pixels(bytes), base=pixels(before)
    assert.ok(at(image,250,70)[0]>235 && at(image,250,70)[1]<20,'PNG top-left remains red')
    assert.ok(at(image,310,70)[1]>235 && at(image,310,70)[0]<20,'PNG top-right remains green')
    assert.ok(at(image,250,130)[2]>235,'PNG bottom-left remains blue')
    assert.deepEqual(at(image,310,130),at(base,310,130),'PNG transparent corner preserves underlying PDF')
    const highlight=at(image,40,250);assert.ok(highlight[0]>=250 && highlight[1]>=250 && highlight[2]>=185 && highlight[2]<=195,'highlight uses transparency')
    const rect=at(image,190,220);assert.ok(rect[0]>220 && rect[1]<60,'outlined rectangle lies at its specified edge')
    const ink=at(image,220,272);assert.ok(ink[2]>150,'drawing reaches its expected top-center')
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++) {
      const inside=objects.some(object=>{const r=boxRect(object.box);return x>=r[0]-1&&x<=r[2]+1&&y>=r[1]-1&&y<=r[3]+1})
      // MuPDF enables a page transparency compositing pass when alpha objects
      // are present. It can round existing antialiasing by one 8-bit RGB level.
      // Require this exact bound; position/shape changes cause much larger deltas.
      if(!inside) for(let c=0;c<3;c++) assert.ok(Math.abs(image.data[(y*image.width+x)*3+c]-base.data[(y*image.width+x)*3+c])<=1,`outside object changed beyond one compositing level at ${x},${y}`)
    }
    assert.deepEqual(pixels(bytes,1).data,pixels(before,1).data,'unchanged shared second page')
    const doc=openPdf(bytes)
    try {
      const lines=analyzePage(doc,0).view.regions
      assert.ok(lines.some(line=>line.text==='Added note'))
      const line=lines.find(line=>line.text==='Added note')!
      assert.ok(Math.abs(line.origin[0]-22)<0.05 && Math.abs(line.origin[1]-209.6)<0.05,'added text baseline agrees with box geometry')
      const page=doc.loadPage(0),text=page.toStructuredText('')
      try {assert.ok(text.search('Added note',{}).length);assert.ok(text.asText().includes('Revised source'));assert.ok(!text.asText().includes('Original editable line'))}finally{text.destroy();page.destroy()}
      assert.deepEqual(render(doc,0,1,1).png,view.image.png,'export and preview are the same PDF')
    }finally{doc.destroy()}
  }finally{session.dispose()}
})

test('JPG import uses the same upright image path and validates the actual bytes',()=>{
  const session=new EditorSession(fixture())
  try{
    const bytes=testImage('jpeg');assert.equal(imageFormat(new Uint8Array(bytes)),'jpeg')
    const info=session.importImage({id:'asset',bytes});assert.equal(info.width,16);assert.equal(info.height,16)
    session.putObject(objects[4],1,1)
    const image=pixels(session.export());assert.ok(at(image,250,70)[0]>210);assert.ok(at(image,250,130)[2]>210)
    assert.throws(()=>session.importImage({id:'bad',bytes:new TextEncoder().encode('<svg/>').buffer}),/JPG or PNG/)
  }finally{session.dispose()}
})

test('image dimensions are checked before decoding and pending imports survive unrelated edits until released',()=>{
  const session=new EditorSession(fixture())
  try {
    const png=testImage(), jpeg=testImage('jpeg')
    assert.deepEqual(imageDimensions(new Uint8Array(png)),{width:16,height:16})
    assert.deepEqual(imageDimensions(new Uint8Array(jpeg)),{width:16,height:16})
    const oversized=new Uint8Array(png.slice(0)),data=new DataView(oversized.buffer)
    data.setUint32(16,100000);data.setUint32(20,100000)
    assert.throws(()=>session.importImage({id:'oversized',bytes:oversized.buffer}),/decoding budget/)
    session.importImage({id:'asset',bytes:png.slice(0)})
    session.putObject(objects[0],1,1)
    session.putObject(objects[4],1,1)
    session.undo(0,1,1)
    const checkpoint=session.snapshot()
    session.putObject({...objects[1],id:'branch'},1,1)
    assert.ok(!session.view(0,1,1).assetIds.includes('asset'),'branch releases redo-only image')
    assert.throws(()=>session.putObject(objects[4],1,1),/no longer available/)
    assert.ok(checkpoint.frames.some(frame=>frame.objects.some(object=>object.kind==='image')))
    session.importImage({id:'pending',bytes:jpeg.slice(0)})
    session.releaseImage('pending')
    const released:AddedObject={id:'released',page:0,kind:'image',box:objects[4].box,assetId:'pending'}
    assert.throws(()=>session.putObject(released,1,1),/no longer available/)
  } finally {session.dispose()}
})

test('move, resize, edit, deletion, history branching and recovery preserve source and assets',()=>{
  const source=fixture(), session=new EditorSession(source), input=testImage()
  let restored:EditorSession|undefined
  try{
    session.importImage({id:'asset',bytes:input.slice(0)})
    session.putObject(objects[4],1,1)
    session.putObject({...objects[4],box:{x:100,y:250,width:100,height:100}},1,1)
    const beforeDelete=session.export()
    session.deleteObject('image',0,1,1)
    assert.equal(session.view(0,1,1).objects.length,0)
    session.undo(0,1,1);assert.deepEqual(session.export(),beforeDelete)
    const checkpoint=session.snapshot()
    session.dispose()
    restored=new EditorSession(source)
    restored.importImage({id:'asset',bytes:input.slice(0)})
    restored.restore(checkpoint)
    assert.deepEqual(restored.export(),beforeDelete)
    const recovered=restored.view(0,1,1);assert.equal(recovered.canRedo,true);assert.equal(recovered.objects[0].box.width,100)
    restored.redo(0,1,1);assert.equal(restored.view(0,1,1).objects.length,0)
    restored.undo(0,1,1)
    const branch=restored.putObject(objects[0],1,1);assert.equal(branch.canRedo,false);assert.equal(branch.objects.length,2)
    assert.deepEqual(source,fixture(),'source bytes remain immutable')
  }finally{if(restored)restored.dispose();else session.dispose()}
})

test('invalid object transactions do not alter PDF bytes, checkpoint or history',()=>{
  const session=new EditorSession(fixture())
  try{
    session.putObject(objects[0],1,1);const before=session.snapshot()
    for(const invalid of [
      {...objects[0],text:'Emoji 😀'}, {...objects[0],text:'Too long '.repeat(50)}, {...objects[0],box:{x:-1,y:0,width:10,height:10}},
      {...objects[1],lineWidth:NaN}, {...objects[2],opacity:1}, {...objects[3],points:[[2,3]]},objects[4],
    ])assert.throws(()=>session.putObject(invalid as AddedObject,1,1))
    assert.deepEqual(session.snapshot(),before)
    assert.throws(()=>session.putObject(objects[1],0,1),/dimensions/)
    assert.deepEqual(session.snapshot(),before)
    const multiline:AddedObject={id:'note',page:0,kind:'text',font:'Helvetica',size:16,color:'#2859cf',text:'First line\nSecond line',box:{x:20,y:200,width:180,height:65}}
    session.putObject(multiline,1,1)
    const doc=openPdf(session.export());try{assert.ok(analyzePage(doc,0).view.regions.some(region=>region.text.includes('Second line')))}finally{doc.destroy()}
  }finally{session.dispose()}
})

test('pointer coordinates, aspect-locked corner resize, bounds and ink normalization round trip',()=>{
  const image={png:new ArrayBuffer(0),width:600,height:800,bounds:[0,0,300,400] as Rect,rasterScale:2,pixelOrigin:[0,0] as Point}
  assert.deepEqual(pointerToPage([85,120],{left:10,top:20,width:150,height:200},image),[150,200])
  const page:Rect=[0,0,300,400], original={x:20,y:30,width:100,height:50}
  const resized=resizeBox(original,'se',[250,180],page,true);assert.equal(resized.width/resized.height,2)
  const northwest=resizeBox(original,'nw',[0,0],page,false);assert.deepEqual(northwest,{x:0,y:0,width:120,height:80})
  assert.deepEqual(clampBox({x:290,y:390,width:100,height:50},page),{x:200,y:350,width:100,height:50})
  const drawing=inkFromPoints([[30,40],[70,80]],2,page)
  drawing.points.forEach(([x,y],i)=>{const actual=[drawing.box.x+1+x*(drawing.box.width-2),drawing.box.y+1+y*(drawing.box.height-2)];assert.deepEqual(actual,i===0?[30,40]:[70,80])})
})

test('added text accepts accented Latin and line breaks',()=>{
  const session=new EditorSession(fixture())
  try{
    session.putObject({id:'note',page:0,kind:'text',font:'Times-Roman',size:16,color:'#2859cf',text:'Señor Ødegaard\nprix : 12 €',box:{x:20,y:200,width:200,height:65}},1,1)
    const doc=openPdf(session.export());try{const text=analyzePage(doc,0).view.regions.map(region=>region.text).join('\n');assert.match(text,/Señor Ødegaard/);assert.match(text,/prix : 12 €/)}finally{doc.destroy()}
    assert.throws(()=>session.putObject({id:'bad',page:0,kind:'text',font:'Helvetica',size:16,color:'#000000',text:'日本',box:{x:20,y:300,width:100,height:30}},1,1))
  }finally{session.dispose()}
})

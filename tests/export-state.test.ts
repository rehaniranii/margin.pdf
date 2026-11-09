import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddedObject, WorkingDocument } from '../src/model/document'
import { exportCheckpoint, needsExport } from '../src/model/export-state'
import { registerUnloadWarning, unsavedCount } from '../src/hooks/useUnsavedChangesWarning'

function working(id='source'):WorkingDocument {
 return {source:{id,name:'local.pdf',kind:'local',bytes:new ArrayBuffer(0)},pages:[{sourceId:id,sourcePage:0,rotation:0}],edits:[],objects:[],revision:0}
}
const rectangle:AddedObject={id:'rect',page:0,kind:'rectangle',box:{x:10,y:20,width:40,height:50},color:'#000000',lineWidth:2}

test('only content changes since the last export warn; navigation and returning to an exported plan stay clean',()=>{
 const original=working(),initial=exportCheckpoint(original)
 assert.equal(needsExport(undefined,undefined),false)
 assert.equal(needsExport(original,initial),false)
 const edited={...original,objects:[rectangle],revision:1}
 assert.equal(needsExport(edited,initial),true)
 const downloaded=exportCheckpoint(edited)
 assert.equal(needsExport({...edited,revision:12},downloaded),false,'render/recovery revisions are not edits')
 assert.equal(needsExport(original,downloaded),true,'undoing away from a downloaded version needs export')
 assert.equal(needsExport(edited,downloaded),false,'redo back to the downloaded plan is clean')
 assert.equal(needsExport(original,initial),false,'undo all edits back to the original local copy is clean')
 assert.equal(needsExport({...edited,objects:[{...rectangle,box:{...rectangle.box,x:11}}]},downloaded),true,'object movement changes output')
 const text={...original,edits:[{type:'replace-text' as const,page:0,regionId:'0:line',text:'Changed',font:'Helvetica' as const,size:12,color:'#000000'}]}
 assert.equal(needsExport(text,initial),true)
})

test('an undownloaded generated PDF remains protected even with an empty edit history or a reused filename',()=>{
 const generated=working('generated')
 assert.equal(needsExport(generated,undefined),true)
 assert.equal(needsExport(generated,exportCheckpoint(working())),true)
 assert.equal(needsExport(generated,exportCheckpoint(generated)),false)
})

test('the unload listener cancels unloading and its cleanup restores normal behavior',()=>{
 const target=new EventTarget(),remove=registerUnloadWarning(target)
 const refresh=new Event('beforeunload',{cancelable:true})
 target.dispatchEvent(refresh);assert.equal(refresh.defaultPrevented,true)
 remove()
 const afterExport=new Event('beforeunload',{cancelable:true})
 target.dispatchEvent(afterExport);assert.equal(afterExport.defaultPrevented,false)
})

test('unsaved-work warnings are counted so an app update never reloads over them',()=>{
 const before=unsavedCount(),a=registerUnloadWarning(new EventTarget()),b=registerUnloadWarning(new EventTarget())
 assert.equal(unsavedCount(),before+2);a();assert.equal(unsavedCount(),before+1);b();assert.equal(unsavedCount(),before)
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pageviewOnly} from '../src/analytics/privacy'
import {tools} from '../src/tools'

test('analytics uses fixed application pages, never source URL parameters, filenames or custom properties',()=>{
 const event={type:'pageview' as const,url:'https://margin.example/?filename=PRIVATE.pdf#/edit?password=secret',filename:'PRIVATE.pdf',text:'private extracted text'}
 for(const page of ['/',...tools.map(tool=>`/${tool.id}`)]){
  const output=pageviewOnly(event,page,'https://margin.example',true)
  assert.deepEqual(output,{type:'pageview',url:`https://margin.example${page}`})
  assert.ok(!JSON.stringify(output).includes('PRIVATE'))
 }
 assert.equal(pageviewOnly(event,'/PRIVATE.pdf','https://margin.example',true),null)
 assert.equal(pageviewOnly(event,'/edit?password=secret','https://margin.example',true),null)
})
test('offline visits and custom document/edit events are dropped rather than buffered',()=>{
 assert.equal(pageviewOnly({type:'pageview',url:'https://margin.example'},'/edit','https://margin.example',false),null)
 assert.equal(pageviewOnly({type:'event',url:'https://margin.example'},'/edit','https://margin.example',true),null)
})

import type { BeforeSendEvent } from '@vercel/analytics/react'
import { tools } from '../tools'

const pages=new Set(['/',...tools.map(tool=>`/${tool.id}`)])

// Use only application-defined route names. Never forward the browser URL,
// query/hash parameters, document titles, file names or custom event properties.
export function pageviewOnly(event:BeforeSendEvent,page:string,origin:string,online:boolean):BeforeSendEvent|null {
  if(!online||event.type!=='pageview'||!pages.has(page))return null
  return {type:'pageview',url:new URL(page,new URL(origin).origin).href}
}

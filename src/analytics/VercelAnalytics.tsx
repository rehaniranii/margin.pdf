import { useCallback, useEffect, useState } from 'react'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'
import { pageviewOnly } from './privacy'

export function VercelAnalytics({page}:{page:string}) {
  const [online,setOnline]=useState(navigator.onLine)
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine)
    addEventListener('online',update);addEventListener('offline',update)
    return()=>{removeEventListener('online',update);removeEventListener('offline',update)}
  },[])
  const beforeSend=useCallback((event:BeforeSendEvent)=>pageviewOnly(event,page,location.origin,navigator.onLine),[page])
  if(!__MARGIN_ANALYTICS_ENABLED__||!online)return null
  // Explicit paths track this app's hash routes without automatic URL capture.
  // Keep endpoints fixed and same-origin so CSP need not allow a third-party host.
  return <Analytics mode="production" debug={false} route={page} path={page} beforeSend={beforeSend}
    scriptSrc="/_vercel/insights/script.js" viewEndpoint="/_vercel/insights/view"
    eventEndpoint="/_vercel/insights/event" sessionEndpoint="/_vercel/insights/session"/>
}

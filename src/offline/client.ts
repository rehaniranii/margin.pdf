import { activeJobCount } from './activity'
import { unsavedCount } from '../hooks/useUnsavedChangesWarning'
export type DeliveryState = {phase:'checking'|'downloading'|'setup'|'ready'|'error'|'unsupported'|'development';updateWaiting:boolean;message?:string;version?:string}
type CacheStatus={buildId:string;ready:boolean;error?:string;version:string;assetCount:number}
let state:DeliveryState={phase:'checking',updateWaiting:false}
let registration:ServiceWorkerRegistration|undefined
let checking:Promise<void>|undefined
let started=false
const listeners=new Set<()=>void>()
export const deliverySnapshot=()=>state
export const subscribeToDelivery=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}
function set(next:Partial<DeliveryState>){state={...state,...next};listeners.forEach(listener=>listener())}
function ask(worker:ServiceWorker,type:'STATUS'|'REPAIR'):Promise<CacheStatus>{
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('Offline verification timed out. Reconnect and retry.'))},30_000)
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data as CacheStatus)}
    worker.postMessage({type},[channel.port2])
  })
}
async function check(repair=false){
  if(!registration)return
  const active=registration.active
  if(!active){set({phase:'downloading'});return}
  set({phase:repair?'downloading':'checking',updateWaiting:!!registration.waiting})
  try{
    const controller=navigator.serviceWorker.controller
    // Use the page's controller if present, preserving its version during updates.
    const result=await ask(controller??active,repair?'REPAIR':'STATUS')
    if(result.buildId!==__MARGIN_BUILD_ID__){set({phase:'error',message:'A different app version is ready. Export your work and close all margin.pdf tabs before reopening.'});return}
    if(!result.ready){set({phase:'error',message:result.error??'Offline files are incomplete. Reconnect and retry.'});return}
    set({phase:controller?'ready':'setup',message:undefined,updateWaiting:!!registration.waiting,version:result.version.slice(0,8)})
  }catch(error){set({phase:'error',message:error instanceof Error?error.message:'Offline setup could not be verified.'})}
}
export function checkOffline(repair=false){
  if(checking)return checking
  checking=check(repair).finally(()=>{checking=undefined})
  return checking
}
export function startOfflineDelivery(){
  if(started)return;started=true
  if(!import.meta.env.PROD){set({phase:'development'});return}
  if(!('serviceWorker'in navigator)||!window.isSecureContext||!globalThis.crypto?.subtle){set({phase:'unsupported'});return}
  set({phase:'downloading'})
  void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(value=>{
    registration=value
    const watch=()=>{
      set({updateWaiting:!!value.waiting})
      const installing=value.installing
      if(installing)installing.addEventListener('statechange',()=>{
        if(installing.state==='redundant'&&!value.active)set({phase:'error',message:'Offline files could not be downloaded. Reconnect, allow browser storage and retry.'})
        else if(['activated','installed','redundant'].includes(installing.state))void checkOffline()
      })
      void checkOffline()
    }
    value.addEventListener('updatefound',watch);watch()
    navigator.serviceWorker.addEventListener('controllerchange',()=>{void checkOffline()})
    window.addEventListener('focus',()=>{void checkOffline()})
    window.addEventListener('online',()=>{void checkOffline()})
    window.addEventListener('offline',()=>{void checkOffline()})
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void checkOffline()})
  }).catch(()=>set({phase:'error',message:'Offline setup could not start. Check browser storage and reconnect to retry.'}))
}
/** Switches to the downloaded update and reloads. Returns why it cannot, if it cannot. */
export async function applyUpdate():Promise<string|undefined>{
  const waiting=registration?.waiting
  if(!waiting)return 'No update is waiting.'
  if(activeJobCount())return 'Wait for the current operation to finish, then update.'
  if(unsavedCount())return 'Export or download your work first: updating reloads the app.'
  const reply=await new Promise<{ok:boolean;error?:string}>(resolve=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>resolve({ok:false,error:'The update did not respond. Close all margin.pdf tabs and reopen.'}),10_000)
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data)}
    waiting.postMessage({type:'ACTIVATE'},[channel.port2])
  })
  if(!reply.ok)return reply.error
  navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true})
}
export async function retryOfflineDelivery(){
  if(!registration){started=false;startOfflineDelivery();return}
  if(!registration.active){
    set({phase:'downloading'})
    try{await registration.update();await checkOffline()}catch{set({phase:'error',message:'Offline setup could not restart. Reconnect and retry.'})}
    return
  }
  await checkOffline(true)
}

import { useSyncExternalStore } from 'react'
import { activeJobCount, subscribeToJobs } from '../offline/activity'
import { deliverySnapshot, retryOfflineDelivery, subscribeToDelivery } from '../offline/client'

export function OfflineStatus(){
  const status=useSyncExternalStore(subscribeToDelivery,deliverySnapshot)
  const busy=useSyncExternalStore(subscribeToJobs,activeJobCount)>0
  const labels={ready:'Available offline',setup:'Offline files downloaded — reload to finish setup',checking:'Checking offline files…',downloading:'Downloading offline app files…',error:'Offline setup incomplete',unsupported:'Offline delivery unavailable in this browser',development:'Development mode — offline delivery disabled'}
  return <section className="delivery-status" aria-label="Offline and privacy status">
    <span role="status" className={status.phase==='ready'?'offline-ready':''}>{labels[status.phase]}</span>
    {status.phase==='setup'&&<button disabled={busy} onClick={()=>{if(!activeJobCount())location.reload()}}>Reload to enable offline</button>}
    {status.phase==='error'&&<button disabled={busy} onClick={()=>void retryOfflineDelivery()}>Retry offline setup</button>}
    {status.updateWaiting&&<span className="update-note">Update downloaded. Export first, then close all margin.pdf tabs to use it.</span>}
    <details><summary>Privacy &amp; offline</summary><div className="delivery-details">
      <strong>Your documents stay on this device</strong>
      <p>Files, names, passwords, thumbnails and extracted text are never uploaded. No account, advertising, analytics or remote error reporting.</p>
      <p>The offline cache stores application code and its PDF engine. It does not store your working PDFs. Export before refreshing or closing; a refresh or crash can still discard this memory-only session.</p>
      <p>On the first visit, all offline files are verified before setup is ready. Export any work, then reload once to enable offline use. Updates wait until all existing app tabs close; the app never reloads itself during a document operation.</p>
      <p>Browsers can evict offline files or deny storage. Readiness is rechecked when you return to the tab or change connectivity. Reconnect and retry if files are missing. Real device memory limits still apply.</p>
      <p>Clear workspace releases document state and workers; it keeps the offline app files. Downloaded files remain on your device.</p>
      {status.message&&<p role="alert">{status.message}</p>}
    </div></details>
  </section>
}

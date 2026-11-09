// Playwright CLI: run-code --filename scripts/release/offline-browser-check.js
async page => {
 const check=(condition,message)=>{if(!condition)throw new Error(message)}
 const requests=[],errors=[]
 const origin=new URL(page.url()).origin
 page.context().on('request',request=>requests.push({url:request.url(),method:request.method(),bytes:request.postDataBuffer()?.byteLength??0}))
 page.on('pageerror',error=>errors.push(error.message))
 await page.context().setOffline(true)
 try{
  await page.reload()
  await page.getByText('Available offline',{exact:true}).waitFor()
  await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles('output/phase6/fixtures/digital.pdf')
  await page.getByRole('img',{name:'PDF page 1',exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'Fit whole page',exact:true}).click()
  await page.waitForFunction(()=>!document.querySelector('.page-stage[aria-busy="true"]'))
  await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles('output/phase6/fixtures/digital.pdf')
  await page.getByRole('button',{name:'Edit text: Original editable line',exact:true}).dblclick()
  const input=page.getByRole('textbox',{name:'Edit PDF text on page',exact:true})
  await input.fill('Offline edit.')
  await input.press('Enter')
  await page.getByRole('button',{name:'Edit text: Offline edit.',exact:true}).waitFor()
  await page.getByRole('button',{name:'Export PDF',exact:true}).scrollIntoViewIfNeeded()
  const pending=page.waitForEvent('download')
  await page.getByRole('button',{name:'Export PDF',exact:true}).click()
  await(await pending).saveAs('output/phase6/offline-mobile.pdf')
  await page.screenshot({path:'output/phase6/mobile-offline.png',fullPage:true,scale:'css'})
  const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}))
  check(layout.documentWidth<=layout.width,'Phone layout must not overflow the viewport')
  await page.setViewportSize({width:768,height:1024})
  await page.getByRole('button',{name:'Fit whole page',exact:true}).click()
  await page.screenshot({path:'output/phase6/tablet-offline.png',fullPage:true,scale:'css'})
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button',{name:'Page tools',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByRole('button',{name:'Page numbers',exact:true}).click()
  await dialog.getByRole('button',{name:'Generate preview',exact:true}).click()
  await dialog.getByRole('img',{name:'First page of generated PDF',exact:true}).waitFor()
  const utilityDownload=page.waitForEvent('download')
  await dialog.getByRole('button',{name:'Download PDF',exact:true}).click()
  await(await utilityDownload).saveAs('output/phase6/offline-numbered.pdf')
  await dialog.getByRole('button',{name:'Close page tools',exact:true}).click()
  const closed=Promise.all(page.workers().map(worker=>worker.waitForEvent('close',{timeout:10_000})))
  await page.getByRole('button',{name:'Clear workspace',exact:true}).click()
  await closed
  await page.getByText('Your document belongs here.',{exact:true}).waitFor()
  check(page.workers().length===0,'Clear workspace must terminate document workers')
  const storage=await page.evaluate(async()=>{
   const cacheKeys=await caches.keys(),cached=[]
   for(const key of cacheKeys){const cache=await caches.open(key);cached.push(...(await cache.keys()).map(request=>request.url))}
   return {databases:await indexedDB.databases(),localKeys:Object.keys(localStorage),sessionKeys:Object.keys(sessionStorage),cached}
  })
  check(storage.databases.length===0&&storage.sessionKeys.length===0&&storage.localKeys.length===0,'Documents must not enter persistent browser storage')
  check(storage.cached.every(url=>!url.includes('digital.pdf')&&!url.includes('Offline%20edit')),'Document data entered an app cache')
  const staticUrls=new Set([...storage.cached,`${origin}/`,`${origin}/sw.js`])
  check(requests.every(request=>request.method==='GET'&&request.bytes===0&&(request.url.startsWith('blob:')||staticUrls.has(request.url.split('#')[0]))),'Unexpected processing network request')
  check(errors.length===0,'Unexpected browser exception')
  const report={offlineReload:true,phoneLayout:layout,tablet:true,offlineEditExport:true,offlineUtility:true,documentWorkersAfterClear:page.workers().length,storage,requests,errors}
  page.releaseOfflineReport=report
  return report
 }finally{await page.context().setOffline(false)}
}

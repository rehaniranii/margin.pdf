// Final production open -> keyboard edit -> undo/redo -> export -> reopen check.
async page => {
 // The editor starts empty; close a document only if one is open.
 const clear=page.getByRole('button',{name:'Clear workspace',exact:true})
 if(await clear.count())await clear.click()
 await page.getByText('Your document belongs here.',{exact:true}).waitFor()
 const source=page.locator('input[type=file][accept="application/pdf,.pdf"]')
 await source.setInputFiles('output/phase6/fixtures/digital.pdf')
 await page.getByText('digital.pdf',{exact:true}).waitFor()
 await page.waitForFunction(()=>!document.querySelector('.page-stage[aria-busy="true"]'))
 await page.getByRole('button',{name:'Edit text: Original editable line',exact:true}).focus()
 await page.keyboard.press('Enter')
 const input=page.getByRole('textbox',{name:'Edit PDF text on page',exact:true})
 await input.fill('Margin release.')
 await input.press('Enter')
 await page.getByRole('button',{name:'Edit text: Margin release.',exact:true}).waitFor()
 await page.getByRole('button',{name:'Undo document change',exact:true}).click()
 await page.getByRole('button',{name:'Edit text: Original editable line',exact:true}).waitFor()
 await page.getByRole('button',{name:'Redo document change',exact:true}).click()
 await page.getByRole('button',{name:'Edit text: Margin release.',exact:true}).waitFor()
 await page.getByRole('textbox',{name:'Zoom percent',exact:true}).fill('100')
 await page.getByRole('textbox',{name:'Zoom percent',exact:true}).press('Enter')
 await page.waitForFunction(()=>!document.querySelector('.page-stage[aria-busy="true"]'))
 // The editor swaps in a new page image once it has decoded; wait until the shown bitmap matches the 100% zoom.
 await page.waitForFunction(()=>{const img=document.querySelector('img.page-bitmap');return img&&Math.abs(img.naturalWidth-img.parentElement.clientWidth*devicePixelRatio)<=1})
 const preview=await page.locator('img.page-bitmap').evaluate(async img=>{
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0)
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,canvas.width,canvas.height).data))).map(b=>b.toString(16).padStart(2,'0')).join('')
  return {width:canvas.width,height:canvas.height,rgbaSha256:hash}
 })
 const pending=page.waitForEvent('download')
 await page.getByRole('button',{name:'Export PDF',exact:true}).click()
 await(await pending).saveAs('output/phase6/workflow.pdf')
 await page.screenshot({path:'output/phase6/workflow.png',scale:'css'})
 await source.setInputFiles('output/phase6/workflow.pdf')
 await page.getByRole('button',{name:'Edit text: Margin release.',exact:true}).waitFor()
 const report={keyboardEdit:true,undoRedo:true,exportReopen:true,preview,browser:page.context().browser().version()}
 const metadata=page.waitForEvent('download')
 await page.evaluate(value=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='workflow-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)},report)
 await(await metadata).saveAs('output/phase6/workflow-report.json')
 return report
}

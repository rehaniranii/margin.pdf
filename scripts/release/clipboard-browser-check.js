// Requires Chromium clipboard permissions in the QA context, never a runtime dependency.
async page => {
 const check=(condition,message)=>{if(!condition)throw new Error(message)}
 await page.context().grantPermissions(['clipboard-read','clipboard-write'])
 await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles('output/phase6/fixtures/digital.pdf')
 const region=page.getByRole('button',{name:'Edit text: Original editable line',exact:true})
 await region.click()
 await page.getByRole('button',{name:'Copy text',exact:true}).click()
 check(await page.evaluate(()=>navigator.clipboard.readText())==='Original editable line','Selected PDF text should copy')
 await page.evaluate(()=>navigator.clipboard.writeText('Clipboard edit.'))
 await page.locator('body').press('ControlOrMeta+v')
 const input=page.getByRole('textbox',{name:'Edit PDF text on page',exact:true})
 await input.waitFor()
 check(await input.inputValue()==='Clipboard edit.','Native paste should open the selected text draft')
 await input.press('Enter')
 await page.getByRole('button',{name:'Edit text: Clipboard edit.',exact:true}).waitFor()
 await page.locator('body').press('Escape')
 await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48
  const ctx=canvas.getContext('2d');ctx.fillStyle='#2859cf';ctx.fillRect(0,0,64,48);ctx.fillStyle='white';ctx.fillRect(12,12,40,24)
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
  await navigator.clipboard.write([new ClipboardItem({'image/png':blob})])
 })
 await page.locator('body').press('ControlOrMeta+v')
 await page.getByRole('button',{name:'Select added image',exact:true}).waitFor()
 await page.getByRole('button',{name:'Add text',exact:true}).click()
 await page.getByRole('button',{name:'Place at page center',exact:true}).click()
 const added=page.getByRole('textbox',{name:'Edit added text on page',exact:true})
 await added.fill('Added note.')
 await added.press('ControlOrMeta+Enter')
 await added.waitFor({state:'detached'})
 const pending=page.waitForEvent('download')
 await page.getByRole('button',{name:'Export PDF',exact:true}).click()
 await(await pending).saveAs('output/phase6/clipboard-objects.pdf')
 await page.screenshot({path:'output/phase6/clipboard-objects.png',scale:'css'})
 return {copy:true,nativeTextPaste:true,nativeImagePaste:true,addedText:true,objectCount:await page.locator('.object-hit').count()}
}

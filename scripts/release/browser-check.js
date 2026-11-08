// Playwright CLI: run-code --filename scripts/release/browser-check.js
// Run against a clean production editor after offline setup and release:fixtures.
async page => {
 const check=(condition,message)=>{if(!condition)throw new Error(message)}
 const results=[]
 await page.getByText('Available offline',{exact:true}).waitFor()
 await page.setViewportSize({width:1440,height:1000})
 for(const [file,line,kind]of [
  ['digital.pdf','Original editable line','editable'],
  ['rotated-cropped.pdf','Original editable line','editable'],
  ['rotated-180-cropped.pdf','Original editable line','editable'],
  ['rotated-270-cropped.pdf','Original editable line','editable'],
  ['embedded-subset.pdf','Original embedded line','editable'],
  ['annotation.pdf','Original editable line','editable'],
  ['form.pdf','Original editable line','editable'],
  ['synthetic-signature.pdf','Original editable line','editable'],
  ['scanned.pdf','','scanned'],
  ['overlapping-link.pdf','Original editable line','restricted'],
  ['unusual-transform.pdf','Skewed source','restricted'],
  ['large-250-pages.pdf','Original editable line','large'],
  ['oversized-page.pdf','','oversized']
 ]){
  await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles(`output/phase6/fixtures/${file}`)
  await page.getByText(file,{exact:true}).waitFor()
  await page.getByRole('button',{name:'Export PDF',exact:true}).waitFor({state:'visible'})
  await page.waitForFunction(()=>!document.querySelector('.page-stage[aria-busy="true"]'))
  if(kind==='editable'){
   await page.getByRole('button',{name:`Edit text: ${line}`,exact:true}).dblclick()
   const input=page.getByRole('textbox',{name:'Edit PDF text on page',exact:true})
   if(file.startsWith('rotated')){
    const boxes=await input.evaluate(element=>{const box=element.getBoundingClientRect(),parent=element.parentElement.getBoundingClientRect();return {w:box.width,h:box.height,pw:parent.width,ph:parent.height,transform:getComputedStyle(element).transform}})
    check(Math.abs(boxes.w-boxes.pw)<1&&Math.abs(boxes.h-boxes.ph)<1,'Rotated inline field must match the selected region')
    await page.screenshot({path:`output/phase6/inline-${file}.png`,scale:'css'})
   }
   if(file==='digital.pdf'){
    await input.fill('Café')
    await page.getByText('This replacement contains unsupported characters. Use basic Latin letters, numbers, and punctuation.',{exact:true}).waitFor()
    check(await page.getByRole('button',{name:'Apply changes',exact:true}).isDisabled(),'Unsupported characters must block Apply')
   }
   await input.fill('QA edit.')
   await page.getByLabel('Replacement font',{exact:true}).selectOption('Courier')
   await page.getByLabel('Size (pt)',{exact:true}).fill('14')
   await page.getByLabel('Text color',{exact:true}).fill('#2859cf')
   await input.press('Enter')
   await page.getByRole('button',{name:'Edit text: QA edit.',exact:true}).waitFor()
   if(file==='synthetic-signature.pdf')check(await page.getByText(/signature/i).count()>0,'Signature warning must be visible')
   const pending=page.waitForEvent('download')
   await page.getByRole('button',{name:'Export PDF',exact:true}).click()
   await(await pending).saveAs(`output/phase6/browser-${file}`)
  }else if(kind==='scanned'){
   await page.getByText(/No editable text was found/).waitFor()
   check(await page.locator('.text-region').count()===0,'Scans must not offer fabricated text')
  }else if(kind==='restricted'){
   await page.getByRole('button',{name:`Inspect unsupported text: ${line}`,exact:true}).click()
   await page.getByText('This text is view-only',{exact:true}).waitFor()
  }else if(kind==='large'){
   await page.getByRole('textbox',{name:'Go to page number',exact:true}).fill('250')
   await page.getByRole('textbox',{name:'Go to page number',exact:true}).press('Enter')
   await page.getByRole('img',{name:'PDF page 250',exact:true}).waitFor()
   check(await page.locator('.page-tile').count()<=7,'Large document navigation must stay windowed')
   await page.screenshot({path:'output/phase6/large-document.png',scale:'css'})
  }else{
   const size=await page.locator('img.page-bitmap').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}))
   check(size.width<=4096&&size.height<=4096&&size.width*size.height<=8_000_000,'Oversized page exceeded the render budget')
   results.push({file,pixels:size.width*size.height})
  }
  results.push({file,result:'passed'})
 }
 page.releaseMatrix=results
 return results
}

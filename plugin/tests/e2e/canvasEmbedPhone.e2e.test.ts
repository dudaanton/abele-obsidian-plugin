import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { enterPhone, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('canvas-embed-phone')
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const dir = 'Sample embed phone'
  ${body}
})()`,
    120_000
  )

describe.skipIf(!available)('canvas embed phone navigation', () => {
  beforeAll(async () => {
    if (!onPhone()) await enterPhone()
    run(`
      if(app.vault.getAbstractFileByPath(dir)) throw Error('Synthetic folder already exists')
      window.__embedPhoneLayout = app.workspace.getLayout()
      await app.vault.createFolder(dir)
      window.__embedPhoneOwned = true
      return true
    `)
  }, 120_000)
  afterAll(async () => {
    run(`
      if(window.__embedPhoneOwned) {
        const leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.getState?.().file?.startsWith(dir+'/'))leaves.push(l)})
        leaves.forEach(l=>l.detach())
        const folder=app.vault.getAbstractFileByPath(dir);if(folder)await app.vault.delete(folder,true)
      }
      if(window.__embedPhoneLayout)await app.workspace.changeLayout(window.__embedPhoneLayout)
      delete window.__embedPhoneLayout;delete window.__embedPhoneOwned;delete window.__embedPhoneLeaf
      return true
    `)
    if (!onPhone()) await reloadApp('app.emulateMobile(false)')
  }, 120_000)
  it('shows the image with Edit after one tap and supports double tap and Back without horizontal overflow', () => {
    expect(
      run<boolean>(`
      await app.vault.create(dir+'/sample.canvas',JSON.stringify({nodes:[{id:'alpha',type:'text',text:'Sample picture',x:0,y:0,width:240,height:120}],edges:[]}))
      const note=await app.vault.create(dir+'/sample-note.md','![[sample.canvas]]')
      const leaf=app.workspace.getLeaf('tab');window.__embedPhoneLeaf=leaf
      await leaf.openFile(note,{state:{mode:'preview'}});await app.workspace.revealLeaf(leaf)
      const until=async test=>{for(let i=0;i<100;i++){if(test())return;await wait(100)}throw Error('Phone image did not open')}
      await until(()=>leaf.view.containerEl.querySelector('.abele-canvas-embed-picture[src]'))
      const image=leaf.view.containerEl.querySelector('.abele-canvas-embed-picture')
      for(const type of ['pointerdown','pointerup'])image.dispatchEvent(new PointerEvent(type,{pointerId:1,pointerType:'touch',clientX:30,clientY:20,bubbles:true,cancelable:true}))
      await until(()=>leaf.view.getViewType()==='abele-canvas-image'&&leaf.view.contentEl.querySelector('.abele-gallery-viewer__image')?.naturalWidth>0)
      await wait(200)
      const edit=leaf.view.containerEl.querySelector('.view-action[aria-label="Edit"]')
      const frame=leaf.view.contentEl.querySelector('.abele-gallery-viewer__image-wrap').getBoundingClientRect()
      const picture=leaf.view.contentEl.querySelector('.abele-gallery-viewer__image')
      const bounds=picture.getBoundingClientRect()
      if(!edit)throw Error('Edit is missing')
      if(frame.left<0||frame.right>innerWidth+1)throw Error('Image overflows the phone')
      if(Math.abs((bounds.left+bounds.right-frame.left-frame.right)/2)>2 || Math.abs((bounds.top+bounds.bottom-frame.top-frame.bottom)/2)>2)
        throw Error('Image is not centered: '+JSON.stringify({frame:frame.toJSON(),bounds:bounds.toJSON(),natural:[picture.naturalWidth,picture.naturalHeight],style:picture.getAttribute('style'),width:getComputedStyle(picture).width}))
      return true
    `)
    ).toBe(true)
    const path = `${shots}/image-edit.png`
    if (onPhone()) screenshot(path)
    else
      run(
        `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
      )
    expect(
      run<boolean>(`
      const leaf=window.__embedPhoneLeaf
      const until=async test=>{for(let i=0;i<100;i++){if(test())return;await wait(100)}throw Error('Phone Back failed: '+leaf.view.getViewType())}
      leaf.view.containerEl.querySelector('.view-action[aria-label="Edit"]').click()
      await until(()=>leaf.view.getViewType()==='abele-canvas')
      await wait(200);await leaf.history.back()
      await until(()=>leaf.view.getViewType()==='abele-canvas-image'&&leaf.view.contentEl.querySelector('.abele-gallery-viewer__image'))
      await wait(200);await leaf.history.back()
      await until(()=>leaf.view.getViewType()==='markdown'&&leaf.view.containerEl.querySelector('.abele-canvas-embed-picture[src]'))
      const image=leaf.view.containerEl.querySelector('.abele-canvas-embed-picture')
      for(let i=0;i<2;i++)for(const type of ['pointerdown','pointerup'])image.dispatchEvent(new PointerEvent(type,{pointerId:1,pointerType:'touch',clientX:30,clientY:20,bubbles:true,cancelable:true}))
      await until(()=>leaf.view.getViewType()==='abele-canvas')
      await wait(200);await leaf.history.back()
      await until(()=>leaf.view.getViewType()==='markdown')
      return leaf.view.file.path.endsWith('/sample-note.md')
    `)
    ).toBe(true)
  }, 120_000)
})

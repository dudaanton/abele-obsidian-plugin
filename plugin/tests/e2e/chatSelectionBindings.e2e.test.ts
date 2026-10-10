import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'
import { measureDesign } from './helpers/designLint'
import {
  BINDING_SETUP,
  BINDING_RESET,
  BINDING_PRELUDE,
  BINDING_CLEANUP,
  BINDING_CHAT,
  BINDING_CARD,
} from './helpers/chatBindings'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('chat-selection-bindings')
// Host chrome remains visible when the phone closes its file-explorer pane.
const nativeChrome = {
  nativeSelector: '.mobile-navbar-action, .workspace-tab-header-inner, .view-header-title',
}
const run = async <T>(code: string): Promise<T> =>
  JSON.parse(
    await evalLong(
      `(async()=>{${WAIT_PRELUDE}${BINDING_PRELUDE}
try{${code}}catch(error){return JSON.stringify({error:String(error.message||error),stack:String(error.stack||'')})}})()`,
      45000
    )
  ) as T

const reopen = () =>
  evalLong(
    `(async()=>{
  const chats=window.__abeleTest.ChatService.getInstance()
  const owner=chats.getSessionByFile(${JSON.stringify(BINDING_CHAT)}), writes=[]
  let revision=owner?.localRevision
  if(owner)Object.defineProperty(owner,'localRevision',{get:()=>revision,set:value=>{writes.push({before:revision,after:value,stack:new Error('Revision writer').stack});revision=value},configurable:true})
  try {await chats.openChatFile(app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CHAT)}));await chats.revealSidebar({focus:false});return 'open'}
  catch(error){throw Error(String(error.message||error)+'; writers: '+JSON.stringify(writes))}
  finally {if(owner)Object.defineProperty(owner,'localRevision',{value:revision,writable:true,configurable:true})}
})()`,
    45000
  )

for (const layout of onPhone() ? ['native phone'] : ['desktop', 'phone layout']) {
  describe.skipIf(!available)(`${layout}: explicit card binding`, () => {
    let size: number[] | undefined
    let saved: unknown
    beforeAll(async () => {
      if (layout === 'phone layout') {
        size = evalJson('require("@electron/remote").getCurrentWindow().getContentSize()')
        await reloadApp('app.emulateMobile(true)')
        evalRaw('require("@electron/remote").getCurrentWindow().setContentSize(390,844)')
      }
      saved = await evalLong(
        `(async()=>{${BINDING_SETUP} return JSON.stringify(bindingOld)})()`,
        45000
      )
    })
    beforeEach(async () => {
      await evalLong(`(async()=>{${BINDING_RESET}return 'reset'})()`, 45000)
    })
    afterAll(async () => {
      if (saved) await evalLong(`(async()=>{${BINDING_CLEANUP}return 'clean'})()`, 45000)
      if (size) {
        evalRaw(
          `require("@electron/remote").getCurrentWindow().setContentSize(${size[0]},${size[1]})`
        )
        await reloadApp('app.emulateMobile(false)')
      }
    })

    it('creates a card, links only captured words, offers card/source actions, reopens and undoes without deleting the card', async () => {
      const result = await run<any>(
        `const result=await bindSample();await wait(700);return JSON.stringify({result,content:owner.allMessages.value[0].content})`
      )
      expect(result.error).toBeUndefined()
      expect(result.result.status).toBe('applied')
      expect(result.content).toBe(`echo **[[${BINDING_CARD.replace(/\.md$/u, '')}|echo]]**`)
      const opened = await run<any>(`
        const details=await until(()=>document.querySelector('.abele-chat-bindings'),5000);details.open=true
        details.querySelector('[aria-label="Card link actions"]').click();await wait(400)
        return JSON.stringify({actions:[...document.querySelectorAll('.menu-item')].map(el=>el.textContent.trim()),infoWidth:details.querySelector('.setting-item-info').getBoundingClientRect().width,height:details.getBoundingClientRect().height,viewportHeight:innerHeight})`)
      expect(opened.error).toBeUndefined()
      expect(opened.infoWidth).toBeGreaterThanOrEqual(100)
      expect(opened.height).toBeLessThan(opened.viewportHeight / 2)
      expect(opened.actions).toEqual(
        expect.arrayContaining(['Open card', 'Copy source link', 'Remove link (undo binding)'])
      )
      const actionsDesign = await measureDesign(
        '.menu',
        `${SHOTS}/${layout}-actions`,
        { nativeSelector: '.menu-item' },
        { requireNative: true }
      )
      expect(actionsDesign.violations).toEqual([])
      await run<any>(
        `const choice=[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Copy source link');choice.click();await wait(400);return JSON.stringify({closed:true})`
      )
      const stateDesign = await measureDesign(
        '.abele-chat-bindings',
        `${SHOTS}/${layout}-applied`,
        nativeChrome,
        { requireNative: true }
      )
      expect(stateDesign.violations).toEqual([])
      const open = await run<any>(`
        document.querySelector('.abele-chat-bindings [aria-label="Card link actions"]').click()
        const action=await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Open card'),5000);action.click();await wait(600)
        const card=await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CARD)}))
        const anchor=owner.allMessages.value[0].selection.anchors[0]
        const open=app.workspace.getActiveFile()?.path
        const leaf=app.workspace.getLeaf(false)
        await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(BINDING_CARD)},mode:'preview'},active:true})
        const backlink=await until(()=>[...leaf.view.containerEl.querySelectorAll('a.internal-link')].find(el=>el.getAttribute('data-href')?.includes('#abele-selection=')),5000);backlink.click()
        const mark=await until(()=>document.querySelector('[data-selection-return]'),5000)
        const quote=mark?.textContent
        const keyboard=['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable===true
        return JSON.stringify({card,source:owner.allMessages.value[0].content,anchor:anchor.id,open,quote,keyboard})`)
      expect(open.error).toBeUndefined()
      expect(open.card).toContain('#abele-selection=')
      expect(open.open).toBe(BINDING_CARD)
      expect(open.quote).toBe('echo')
      expect(open.keyboard).toBe(false)
      await reloadApp('app.plugins.disablePlugin("abele"); app.plugins.enablePlugin("abele")')
      await reopen()
      const removed = await run<any>(`
        const details=await until(()=>document.querySelector('.abele-chat-bindings'),5000);details.open=true
        details.querySelector('[aria-label="Card link actions"]').click()
        const action=await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Remove link (undo binding)'),5000);action.click()
        if(!await until(()=>owner.allMessages.value[0].content==='echo **echo**',5000))throw Error('Inverse did not remove its link')
        return JSON.stringify({content:owner.allMessages.value[0].content,card:!!app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CARD)})})`)
      expect(removed.error).toBeUndefined()
      expect(removed).toMatchObject({ content: 'echo **echo**', card: true })
      const undoneDesign = await measureDesign(
        '.abele-chat-bindings',
        `${SHOTS}/${layout}-undone`,
        nativeChrome,
        { requireNative: true }
      )
      expect(undoneDesign.violations).toEqual([])
    })

    it('reports a missing card without recreating it', async () => {
      const report = await run<any>(`
        const bound=await bindSample();if(bound.status!=='applied')throw Error('Missing-card fixture did not bind')
        const card=app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CARD)}),content=await app.vault.read(card)
        await app.vault.delete(card)
        try {
          const root=document.querySelector('.abele-chat-bindings');root.open=true
          root.querySelector('button').click()
          const action=await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Open card'),5000);action.click()
          await wait(400)
          return JSON.stringify({missing:!app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CARD)}),notice:[...document.querySelectorAll('.notice')].map(el=>el.textContent).find(text=>text.includes('unavailable'))})
        } finally {await app.vault.create(${JSON.stringify(BINDING_CARD)},content)}`)
      expect(report.error).toBeUndefined()
      expect(report.missing).toBe(true)
      expect(report.notice).toContain('unavailable')
      const design = await measureDesign(
        '.abele-chat-bindings',
        `${SHOTS}/${layout}-missing`,
        nativeChrome,
        { requireNative: true }
      )
      expect(design.violations).toEqual([])
    })

    it('bounds a long binding history while leaving the composer on screen', async () => {
      const report = await run<any>(`
        const bound=await bindSample();if(bound.status!=='applied')throw Error('Long-history fixture did not bind')
        const old=owner.bindingRecoveries.value
        try {
        owner.bindingRecoveries.value=Array.from({length:40},(_,i)=>({id:'sample-long-'+i,status:'applied',targetPath:${JSON.stringify(BINDING_CARD)}}))
        await wait(100)
        const root=document.querySelector('.abele-chat-bindings');root.open=true;await wait(200)
        const box=root.getBoundingClientRect(),composer=document.querySelector('.abele-chat-input').getBoundingClientRect()
        return JSON.stringify({height:box.height,viewport:innerHeight,composer:{top:composer.top,bottom:composer.bottom},scrollable:[...root.querySelectorAll('*')].some(el=>el.scrollHeight>el.clientHeight+1&&getComputedStyle(el).overflowY==='auto')})
        } finally {owner.bindingRecoveries.value=old}`)
      expect(report.error).toBeUndefined()
      expect(report.height).toBeLessThan(report.viewport / 2)
      expect(report.composer.top).toBeGreaterThanOrEqual(0)
      expect(report.composer.bottom).toBeLessThanOrEqual(report.viewport)
      expect(report.scrollable).toBe(true)
    })

    it('retries only a failed publication after reopen; uncertain recovery offers no blind replay', async () => {
      const failed = await run<any>(
        `const result=await bindSample(true);await wait(600);return JSON.stringify(result)`
      )
      expect(failed.error).toBeUndefined()
      expect(failed.status).toBe('known-not-written')
      const failureDesign = await measureDesign(
        '.abele-chat-bindings',
        `${SHOTS}/${layout}-recovery`,
        nativeChrome,
        { requireNative: true }
      )
      expect(failureDesign.violations).toEqual([])
      await reloadApp('app.plugins.disablePlugin("abele"); app.plugins.enablePlugin("abele")')
      await reopen()
      const retried = await run<any>(`
        const root=await until(()=>document.querySelector('.abele-chat-bindings'),5000)
        const rows=[...root.querySelectorAll('.setting-item')];const row=rows.find(el=>el.textContent.includes('known-not-written'));row.querySelector('button').click()
        const retry=await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Retry binding only'),5000);retry.click()
        if(!await until(()=>owner.allMessages.value[0].content.includes('[['),5000))throw Error('Binding-only retry did not apply')
        const entries=owner.bindingRecoveries.value
        owner.bindingRecoveries.value=[...entries,{id:'sample-uncertain',targetPath:${JSON.stringify(BINDING_CARD)},status:'uncertain',evidence:'Sample unresolved publication evidence.'}]
        await owner.save();await wait(100)
        const uncertain=[...root.querySelectorAll('.setting-item')].find(el=>el.textContent.includes('uncertain'))
        uncertain.querySelector('button').click();await wait(400)
        const actions=[...document.querySelectorAll('.menu-item')].map(el=>el.textContent.trim())
        return JSON.stringify({actions,operations:owner.allMessages.value[0].decorationOperations.length,card:!!app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CARD)})})`)
      expect(retried.error).toBeUndefined()
      expect(retried.actions).not.toContain('Retry binding only')
      expect(retried.operations).toBe(1)
      expect(retried.card).toBe(true)
      await run<any>(
        `document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(400);return JSON.stringify({closed:true})`
      )
      const uncertainDesign = await measureDesign(
        '.abele-chat-bindings',
        `${SHOTS}/${layout}-uncertain`,
        nativeChrome,
        { requireNative: true }
      )
      expect(uncertainDesign.violations).toEqual([])
    })
  })
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample selection launch probe'
const CHAT = `${DIR}/sample.abchat`
const NOTE = `${DIR}/output.md`
const SCRIPTS = `${DIR}/Scripts`
const SHOTS = shotDir('chat-selection-scripts')
const SCRIPT = `// @name Sample capture words
// @book
// @chat-selection
// @param words string "Words" selection
// @param extra string "Additional context"
await new Promise(resolve => setTimeout(resolve, 800))
await create(${JSON.stringify(NOTE)}, params.words + '\\n\\n' + selection.backlink)
return selection.source.kind`
const PRELUDE = `${WAIT_PRELUDE}
  const config = window.__abeleTest.AbeleConfig.getInstance()
  let scripts = window.__abeleTest.ScriptService.getInstance()
  const chats = window.__abeleTest.ChatService.getInstance(), comments = window.__abeleTest.CommentService.getInstance()
  const shoot = async name => {
    for (const notice of document.querySelectorAll('.notice')) notice.click()
    await wait(200)
    const target = ${JSON.stringify(SHOTS)} + '/' + name + (app.isMobile ? '-phone' : '-desktop') + '.png'
    if (window.__e2eHost) return window.__e2eHost.shot(target)
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(target, image.toPNG())
  }
  const visible = selector => [...document.querySelectorAll(selector)].find(el => el.getBoundingClientRect().width > 0)
  const select = async id => {
    const root = await until(() => visible('[data-ask-message="' + id + '"]'), 5000)
    if (!root) throw Error('Saved message did not render')
    const word = await until(() => root.querySelector('strong'), 5000)
    if (!word) throw Error('Saved words did not render')
    // Native sheets finish closing after their DOM is removed. Wait for the message's
    // geometry and hit target to stay put before sending a gesture to WebKit.
    let previous = '', stableSince = Date.now()
    if (!await until(() => {
      const r = word.getBoundingClientRect(), key = JSON.stringify([r.x,r.y,r.width,r.height])
      if (key !== previous) {previous = key; stableSince = Date.now()}
      return word.isConnected && r.width > 0 && document.elementFromPoint(r.left+r.width/2,r.top+r.height/2) === word && Date.now()-stableSince >= 600
    }, 5000)) throw Error('Saved words did not become a stable gesture target')
    const bounds = word.getBoundingClientRect()
    const events = [], tracking = new AbortController()
    let touches = 0
    for (const type of ['touchstart','touchend','touchcancel','pointerdown','pointerup','pointercancel','selectionchange','contextmenu']) document.addEventListener(type, e => {
      if (e.touches) touches = e.touches.length
      events.push({type, touches, pointerType:e.pointerType, target:e.target?.nodeName, selected:document.getSelection()?.toString(), connected:word.isConnected, elapsed:performance.now(),prevented:e.defaultPrevented})
    }, {capture:true,signal:tracking.signal})
    try {
      if (window.__e2eHost) await window.__e2eHost.longPress(bounds.left + bounds.width/2, bounds.top + bounds.height/2)
      else { const range = document.createRange(); range.selectNodeContents(word); document.getSelection().removeAllRanges(); document.getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange')) }
    if (app.isMobile) {
      const button = await until(() => visible('.abele-chat-selection_placed [aria-label="Run a script on these words…"]'), 5000)
      if (!button) {
        const selection = document.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : null
        const hit = document.elementFromPoint(bounds.left + bounds.width/2, bounds.top + bounds.height/2)
        await shoot('selection-failure')
        throw Error('Selection script button did not appear: ' + JSON.stringify({selection:selection?.toString(),range:range && {start:range.startOffset,end:range.endOffset,startNode:range.startContainer.parentElement?.outerHTML,endNode:range.endContainer.parentElement?.outerHTML},touchDown:touches,connected:word.isConnected,keyboardHeight:getComputedStyle(document.body).getPropertyValue('--keyboard-height'),hit:hit?.outerHTML,events}))
      }
      await shoot('selection-bar')
      button.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))
      document.getSelection().removeAllRanges()
      button.click()
      const choice = await until(() => [...document.querySelectorAll('.abele-selection-script-choice')].find(row => row.textContent.includes('Sample capture words')), 5000)
      if (!choice) throw Error('Native picker did not appear')
      await shoot('script-list')
      choice.click()
    } else {
      root.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,clientX:bounds.left,clientY:bounds.bottom}))
      const choice = await until(() => [...document.querySelectorAll('.menu-item')].find(row => row.textContent.trim() === 'Sample capture words'), 5000)
      if (!choice) throw Error('Pinned script menu did not appear: ' + JSON.stringify([...document.querySelectorAll('.menu-item')].map(el=>el.textContent)))
      await shoot('selection-bar')
      document.getSelection().removeAllRanges()
      choice.click()
    }
    } finally { tracking.abort() }
  }
  const anchorCount = () => chats.getSessionByFile(${JSON.stringify(CHAT)})?.allMessages.value.find(m => m.id === 'answer')?.selection?.anchors.length || 0
  const form = async () => {
    const root = await until(() => visible('.abele-script-form'), 5000)
    if (!root) throw Error('Initial parameter form did not open')
    return root
  }
  const button = (root, label) => [...root.closest('.modal').querySelectorAll('button')].find(el => el.textContent.trim() === label)
`
const run = async <T>(code: string, timeout = 45_000): Promise<T> =>
  JSON.parse(
    await evalLong(
      `(async () => { ${PRELUDE} try { ${code} } catch(error) { return JSON.stringify({error:String(error.message || error),stack:String(error.stack || '')}) } })()`,
      timeout
    )
  ) as T

for (const layout of onPhone() ? ['native phone'] : ['desktop', 'phone layout']) {
  describe.skipIf(!available)(`${layout}: scripts on captured chat selections`, () => {
    let old: any
    let originalSize: number[] | undefined
    beforeAll(async () => {
      if (layout === 'phone layout') {
        originalSize = evalJson('require("@electron/remote").getCurrentWindow().getContentSize()')
        await reloadApp('app.emulateMobile(true)')
        evalRaw('require("@electron/remote").getCurrentWindow().setContentSize(390,844)')
      }
      old = evalJson(
        `({ai:window.__abeleTest.AbeleConfig.getInstance().ai, native:app.vault.getConfig('nativeMenus') ?? null, trust:app.loadLocalStorage('abele-script-trust') ?? null})`
      )
      const result = await run<any>(`
      if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw Error('Fixture already exists')
      await app.vault.createFolder(${JSON.stringify(DIR)}); await app.vault.createFolder(${JSON.stringify(SCRIPTS)})
      const records = [{v:2,k:'meta',type:'abele-chat',title:'Sample selection source',providerId:'',modelId:'',created:''},
        {k:'msg',id:'root',role:'user',content:'A sample request.',timestamp:1},
        {k:'msg',id:'answer',parentId:'root',role:'assistant',content:'echo **echo**',timestamp:2}]
      await app.vault.create(${JSON.stringify(CHAT)}, records.map(JSON.stringify).join('\\n') + '\\n')
      config.ai = {...config.ai,scriptsEnabled:true,scriptsFolder:${JSON.stringify(SCRIPTS)},chatSelectionScripts:[]}
      await config.saveSettings()
      scripts = window.__abeleTest.ScriptService.getInstance()
      window.__abeleTest.ScriptTrust.getInstance().arm([])
      await app.vault.create(${JSON.stringify(SCRIPTS + '/capture.js')}, ${JSON.stringify(SCRIPT)})
      for (let i=0;i<35;i++) await app.vault.create(${JSON.stringify(SCRIPTS)}+'/sample-'+i+'.js', '// @name Sample long script '+i+' with a descriptive label\\n// @description More context for a source-neutral selection script.\\nreturn selection.text')
      await scripts.discover()
      app.vault.setConfig('nativeMenus',app.isMobile)
      await chats.openChatFile(app.vault.getAbstractFileByPath(${JSON.stringify(CHAT)})); await chats.revealSidebar()
      const picker = new window.__abeleTest.SelectionScriptPicker(app,scripts.getAll(),()=>{},'chat')
      picker.open();if(!await until(()=>visible('.abele-selection-script-choice'),5000))throw Error('Long script list did not open')
      await shoot('script-list');picker.close()
      return JSON.stringify({ready:true})
    `)
      expect(result.error).toBeUndefined()
    })
    afterAll(async () => {
      if (!old) return
      const result = await run<any>(`
      document.getSelection()?.removeAllRanges()
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      const comment = comments.commentPath('sample-script-discussion')
      for (const path of [${JSON.stringify(CHAT)}, comment]) { const owner=chats.getSessionByFile(path);if(owner)await chats.closeTab(owner.id) }
      await comments.remove('sample-script-discussion')
      const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)
      config.ai=${JSON.stringify(old.ai)}; await config.saveSettings(); await scripts.discover()
      app.saveLocalStorage('abele-script-trust',${JSON.stringify(old.trust)});window.__abeleTest.ScriptTrust.reset()
      app.vault.setConfig('nativeMenus',${JSON.stringify(old.native)})
      return JSON.stringify({clean:true})
    `)
      expect(result.error).toBeUndefined()
      if (originalSize) {
        evalRaw(
          `require("@electron/remote").getCurrentWindow().setContentSize(${originalSize[0]},${originalSize[1]})`
        )
        await reloadApp('app.emulateMobile(false)')
      }
    })

    it('reviews before the form; cancellation writes no anchor; delayed completion keeps its original tab', async () => {
      const report = await run<any>(`
      await select('answer')
      const review=await until(()=>visible('.abele-script-review'),5000)
      if(!review)throw Error('Script review did not open before parameters')
      const before={anchors:anchorCount(),form:!!visible('.abele-script-form')}
      button(review,'Confirm').click()
      const initial=await form();await shoot('script-form')
      button(initial,'Cancel').click();await wait(200)
      const cancelled={anchors:anchorCount(),output:!!app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})}
      await select('answer');const second=await form()
      const field=[...second.querySelectorAll('input')].find(el=>!el.value);field.value='Sample extra context';field.dispatchEvent(new Event('input',{bubbles:true}))
      const owner=chats.activeSession.value
      chats.createTab()
      button(second,'Run').click()
      if(!await until(()=>app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),8000))throw Error('Script output was not saved')
      const message=owner.allMessages.value.find(m=>m.id==='answer')
      return JSON.stringify({before,cancelled,done:{source:window.__abeleTest.ScriptRuns.getInstance().runs.value[0].source,content:message.content,range:message.selection.anchors[0].snapshot.source.range,otherTab:chats.activeSession.value!==owner}})
    `)
      expect(report.error).toBeUndefined()
      expect(report.before).toEqual({ anchors: 0, form: false })
      expect(report.cancelled).toEqual({ anchors: 0, output: false })
      expect(report.done).toMatchObject({
        source: 'chat-selection',
        content: 'echo **echo**',
        range: { start: 5, end: 9 },
        otherTab: true,
      })
    })

    it('returns from output after reload and supports saved nested discussions without changing Markdown', async () => {
      await reloadApp('app.plugins.disablePlugin("abele"); app.plugins.enablePlugin("abele")')
      const report = await run<any>(`
      const leaf=app.workspace.getLeaf('tab')
      const returnFromNote=async()=>{await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(NOTE)},mode:'preview'},active:true});const link=await until(()=>leaf.view.containerEl.querySelector('a.internal-link'),5000);if(!link)throw Error('Output backlink missing');link.click();if(!await until(()=>document.querySelector('[data-selection-return]'),8000))throw Error('Captured range did not return')}
      try {
        await returnFromNote()
        const returned={quote:document.querySelector('[data-selection-return]').textContent,keyboard:['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)}
        const nested=comments.commentPath('sample-script-discussion')
        await window.__abeleTest.ChatStorage.getInstance().ensureFolder(nested.slice(0,nested.lastIndexOf('/')))
        await app.vault.create(nested,[{v:2,k:'meta',type:'abele-chat',providerId:'',modelId:'',created:'',kind:'comment',anchor:{note:${JSON.stringify(CHAT)},message:'answer',quote:'echo',start:5}}, {k:'msg',id:'nested-answer',role:'assistant',content:'nested **echo**',timestamp:3}].map(JSON.stringify).join('\\n')+'\\n')
        await chats.openChatFile(app.vault.getAbstractFileByPath(nested));await chats.revealSidebar();await wait(300)
        await shoot('nested-discussion')
        await app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
        await select('nested-answer');const nestedForm=await form()
        const field=[...nestedForm.querySelectorAll('input')].find(el=>!el.value);field.value='Nested context';field.dispatchEvent(new Event('input',{bubbles:true}));button(nestedForm,'Run').click()
        if(!await until(()=>app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),8000))throw Error('Nested output missing')
        const owner=chats.activeSession.value,message=owner.allMessages.value.find(m=>m.id==='nested-answer')
        await chats.closeTab(owner.id);await returnFromNote()
        return JSON.stringify({returned,nested:{kind:chats.activeSession.value.kind,quote:document.querySelector('[data-selection-return]').textContent,content:message.content,keyboard:['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)}})
      } finally {leaf.detach()}
    `)
      expect(report.error).toBeUndefined()
      expect(report.returned).toEqual({ quote: 'echo', keyboard: false })
      expect(report.nested).toEqual({
        kind: 'comment',
        quote: 'echo',
        content: 'nested **echo**',
        keyboard: false,
      })
    })

    it('runs the same source-neutral script through the compatible book adapter', async () => {
      const report = await run<any>(`
        const output=app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)});if(output)await app.vault.delete(output)
        const book={text:'sample',sentence:'A sample passage.',title:'Sample book',path:'Books/sample.epub',chapter:'Sample chapter',cfi:'sample-place',language:'en',link:'[[Books/sample.epub#sample-place|Return to book]]'}
        const running=scripts.executeFromSelection(${JSON.stringify(SCRIPTS + '/capture.js')},{kind:'book',book})
        const root=await form(),field=[...root.querySelectorAll('input')].find(el=>!el.value)
        field.value='Book context';field.dispatchEvent(new Event('input',{bubbles:true}));button(root,'Run').click()
        const outcome=await running,record=window.__abeleTest.ScriptRuns.getInstance().runs.value[0]
        return JSON.stringify({outcome,source:record.source,kind:record.selection.source.kind,text:await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))})
      `)
      expect(report.error).toBeUndefined()
      expect(report).toEqual({
        outcome: { status: 'done', output: 'book' },
        source: 'book',
        kind: 'book',
        text: 'sample\n\n[[Books/sample.epub#sample-place|Return to book]]',
      })
    })
  })
}

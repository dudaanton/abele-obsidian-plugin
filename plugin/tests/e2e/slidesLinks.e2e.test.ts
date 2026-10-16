import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-slide-links')

describe.skipIf(!available)('note links with a presentation tab active', () => {
  it('renames a deck through its header and native command and attaches it to the current chat', async () => {
    const r = JSON.parse(
      await evalLong(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),dir='sample-deck-actions'
      const layout=app.workspace.getLayout(),chats=window.__abeleTest.ChatService.getInstance()
      const previous=chats.activeTabId.value,cfg=window.__abeleTest.AbeleConfig.getInstance().ai,enabled=cfg.enabled
      const location=app.vault.getConfig('newFileLocation'),defaultFolder=app.vault.getConfig('newFileFolderPath')
      if(app.vault.getAbstractFileByPath(dir))throw Error('Synthetic folder already exists')
      let session,leaf
      try {
        await app.vault.createFolder(dir)
        await app.vault.createFolder(dir+'/sample-inbox');await app.vault.createFolder(dir+'/sample-journal')
        const daily=await app.vault.create(dir+'/sample-journal/sample-day.md','Sample daily note')
        leaf=app.workspace.getLeaf('tab')
        await leaf.openFile(daily);await app.workspace.revealLeaf(leaf)
        app.vault.setConfig('newFileLocation','folder');app.vault.setConfig('newFileFolderPath',dir+'/sample-inbox')
        if(!app.commands.executeCommandById('abele:new-presentation'))throw Error('New presentation command unavailable')
        await wait(200)
        const input=document.querySelector('.modal input[placeholder="Presentation name"]')
        if(!input)throw Error('Presentation name dialog missing')
        input.value='sample-deck';input.dispatchEvent(new Event('input',{bubbles:true}));await wait(50)
        input.closest('.modal').querySelector('button.mod-cta').click()
        const createdPath=dir+'/sample-inbox/sample-deck.md'
        for(let n=0;n<100&&!app.vault.getAbstractFileByPath(createdPath);n++)await wait(50)
        const file=app.vault.getAbstractFileByPath(createdPath)
        if(!file)throw Error('Presentation was not created in the default new-note folder')
        const bytes=await app.vault.read(file)
        for(let n=0;n<100&&!app.workspace.getLeavesOfType('abele-deck').some(l=>l.view.file===file);n++)await wait(50)
        leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file===file)
        if(!leaf)throw Error('Created deck did not open')
        await app.workspace.revealLeaf(leaf);await wait(300)
        const view=leaf.view,title=view.containerEl.querySelector('.view-header-title')
        if(!title)throw Error('Deck header missing')
        title.click();title.focus();title.textContent='sample-header-renamed'
        title.dispatchEvent(new Event('input',{bubbles:true}))
        title.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(500)
        const header=file.basename==='sample-header-renamed'&&view.getDisplayText()===file.basename
        const command=app.commands.executeCommandById('workspace:edit-file-title')
        await wait(100);title.textContent='sample-command-renamed'
        title.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(500)
        const renamed=command&&file.basename==='sample-command-renamed'
        await app.fileManager.renameFile(file,dir+'/sample-explorer-renamed.md');await wait(200)
        const moved=title.textContent===file.basename&&view.getDisplayText()===file.basename&&await app.vault.read(file)===bytes
        const path=${JSON.stringify(SHOTS)}+'/deck-header-renamed.png'
        if(window.__e2eHost)await window.__e2eHost.shot(path)
        else {require('fs').mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});require('fs').writeFileSync(path,(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG())}
        session=await chats.openBlankChat();if(!session)throw Error('Synthetic chat unavailable')
        cfg.enabled=true
        const action=view.containerEl.querySelector('[aria-label="Attach to a chat"]')
        if(!action)throw Error('Deck attachment action missing')
        action.click();await wait(400)
        const text=chats.pendingInput.value?.text??session.draft.value.text
        const attached=chats.activeSession.value===session&&session.scopeResolver.isInScope(file.path)&&text.includes('sample-explorer-renamed')
        await app.workspace.revealLeaf(leaf)
        const palette=app.commands.executeCommandById('abele:attach-note-to-chat')
        return JSON.stringify({header,renamed,moved,attached,palette})
      } finally {
        if(session){session.draft.value={text:'',attachments:[]};if(chats.pendingInput.value?.tabId===session.id)chats.pendingInput.value=null;await chats.closeTab(session.id)}
        if(previous)chats.switchTab(previous)
        cfg.enabled=enabled
        app.vault.setConfig('newFileLocation',location);app.vault.setConfig('newFileFolderPath',defaultFolder)
        const input=document.querySelector('.modal input[placeholder="Presentation name"]')
        if(input)input.closest('.modal').querySelector('.modal-close-button')?.click()
        const owned=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(dir+'/'))owned.push(l)})
        owned.forEach(l=>l.detach())
        const folder=app.vault.getAbstractFileByPath(dir);if(folder)await app.vault.delete(folder,true)
        await app.workspace.changeLayout(layout)
      }
    })()`)
    )
    expect(r).toEqual({ header: true, renamed: true, moved: true, attached: true, palette: true })
  }, 120_000)

  it('opens chat note links as native Markdown, keeps deck detection, and honors new tabs and source editing', async () => {
    const r = JSON.parse(
      await evalLong(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms))
      const until=async(fn)=>{const end=Date.now()+5000;while(Date.now()<end){if(await fn())return true;await wait(50)}return false}
      const dir='sample-slide-links',deckPath=dir+'/sample-deck.md',notePath=dir+'/sample-note.md',chatPath=dir+'/sample-links.abchat'
      const chats=window.__abeleTest.ChatService.getInstance(),layout=app.workspace.getLayout(),active=chats.activeTabId.value
      if(app.vault.getAbstractFileByPath(dir))throw Error('sample fixture already exists')
      const made=[],leaves=[],r={}
      const shot=async name=>{
        await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),wait(3000).then(()=>{throw Error('window not drawing')})])
        const path=${JSON.stringify(SHOTS)}+'/'+name+'.png'
        if(window.__e2eHost)return await window.__e2eHost.shot(path)
        const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(path,(await require('@electron/remote').getCurrentWindow().capturePage()).toPNG());return path
      }
      try {
        await app.vault.createFolder(dir);made.push(dir)
        const noteText='# Sample ordinary note\\n\\nEditable Markdown content.\\n\\n## Sample section\\nSection text.'
        const note=await app.vault.create(notePath,noteText)
        const deck=await app.vault.create(deckPath,'---\\ntype: presentation\\n---\\n# Sample deck\\n---\\n# Second')
        const records=[{v:2,k:'meta',type:'abele-chat',title:'Sample links',providerId:'',modelId:'',created:''},
          {k:'msg',id:'sample-link-reply',role:'assistant',content:'Open [[sample-slide-links/sample-note#Sample section|Sample note]] or [[sample-slide-links/sample-deck|Sample deck]].',timestamp:1}]
        const chat=await app.vault.create(chatPath,records.map(r=>JSON.stringify(r)).join('\\n')+'\\n')
        if(!await until(()=>app.metadataCache.getFileCache(deck)?.frontmatter?.type==='presentation' && app.metadataCache.getFirstLinkpathDest('sample-slide-links/sample-note',chatPath)))throw Error('fixtures not indexed')
        const leaf=app.workspace.getLeaf('tab');leaves.push(leaf);await leaf.openFile(deck)
        r.initialDeck=leaf.view.getViewType()==='abele-deck'
        await chats.openChatFile(chat);await chats.revealSidebar()
        if(!await until(()=>document.querySelector('[data-ask-message="sample-link-reply"] a.internal-link')))throw Error('chat links did not render')
        const link=()=>[...document.querySelectorAll('[data-ask-message="sample-link-reply"] a.internal-link')].find(a=>a.textContent==='Sample note')
        app.workspace.setActiveLeaf(leaf,{focus:false})
        link().click()
        if(!await until(()=>leaf.view.file?.path===notePath))throw Error('chat note link did not open')
        r.noteType=leaf.view.getViewType();r.noteIsSlide=!!leaf.view.contentEl.querySelector('.abele-slide')
        if(r.noteType!=='markdown') {r.failureShot=await shot('note-wrongly-in-deck');return JSON.stringify(r)}
        await leaf.setViewState({type:'markdown',state:{file:notePath,mode:'source'},active:true})
        // A link opens the file before its text arrives; an edit made sooner is replaced by the load.
        if(!await until(()=>leaf.view.getViewData()===noteText))throw Error('chat-opened note did not load: '+JSON.stringify(leaf.view.getViewData().slice(-40)))
        const editView=leaf.view,beforeEdit=leaf.view.editor.getValue()
        leaf.view.editor.setValue(beforeEdit+'\\nA sample edit.');await leaf.view.save()
        r.editable=await until(async()=>(await app.vault.read(note)).includes('A sample edit.'))
        if(!r.editable)r.editState={type:leaf.view.getViewType(),mode:leaf.view.getMode?.(),editor:leaf.view.editor?.getValue().slice(-40),file:(await app.vault.read(note)).slice(-40),viewFile:leaf.view.file?.path,beforeEdit:beforeEdit.slice(-40),sameView:leaf.view===editView}
        r.noteShot=await shot('chat-note-markdown')
        await leaf.openFile(deck);r.reopenedDeck=leaf.view.getViewType()==='abele-deck'
        const deckViewer=leaf.view.viewer;await deckViewer.go(1)
        await chats.revealSidebar();app.workspace.setActiveLeaf(leaf,{focus:false})
        const before=new Set(app.workspace.getLeavesOfType('markdown'))
        link().dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,metaKey:true,ctrlKey:true}))
        r.newTab=await until(()=>app.workspace.getLeavesOfType('markdown').some(l=>!before.has(l) && l.view.file?.path===notePath))
        r.deckPreserved=leaf.view.getViewType()==='abele-deck' && leaf.view.viewer===deckViewer && deckViewer.index===1
        for(const l of app.workspace.getLeavesOfType('markdown'))if(!before.has(l) && l.view.file?.path===notePath)leaves.push(l)
        const split=app.workspace.createLeafBySplit(leaf,'vertical');leaves.push(split)
        await split.openFile(note)
        r.splitMarkdown=split.view.getViewType()==='markdown' && leaf.view.getViewType()==='abele-deck'
        split.detach()
        await leaf.openFile(deck,{state:{abeleDeckSource:true,mode:'source'}})
        r.deckSource=leaf.view.getViewType()==='markdown' && !!leaf.view.editor
        return JSON.stringify(r)
      } finally {
        const session=chats.getSessionByFile(chatPath);if(session)await chats.closeTab(session.id)
        if(active)chats.switchTab(active)
        for(const l of leaves)if(app.workspace.getLeafById(l.id))l.detach()
        const folder=app.vault.getAbstractFileByPath(dir);if(folder)await app.vault.delete(folder,true)
        await app.workspace.changeLayout(layout)
      }
    })()`)
    )
    expect(r.initialDeck, JSON.stringify(r)).toBe(true)
    expect(r.noteType, JSON.stringify(r)).toBe('markdown')
    expect(r.noteIsSlide, JSON.stringify(r)).toBe(false)
    for (const key of [
      'editable',
      'reopenedDeck',
      'newTab',
      'deckPreserved',
      'splitMarkdown',
      'deckSource',
    ])
      expect(r[key], JSON.stringify(r)).toBe(true)
  })
})

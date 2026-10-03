import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-slide-links')

describe.skipIf(!available)('note links with a presentation tab active', () => {
  it('opens chat note links as native Markdown, keeps deck detection, and honors new tabs and source editing', async () => {
    const r = JSON.parse(
      await evalLong(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms))
      const until=async(fn)=>{const end=Date.now()+5000;while(Date.now()<end){if(fn())return true;await wait(50)}return false}
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
        const note=await app.vault.create(notePath,'# Sample ordinary note\\n\\nEditable Markdown content.\\n\\n## Sample section\\nSection text.')
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
        leaf.view.editor.setValue(leaf.view.editor.getValue()+'\\nA sample edit.');await leaf.view.save()
        r.editable=(await app.vault.read(note)).includes('A sample edit.')
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

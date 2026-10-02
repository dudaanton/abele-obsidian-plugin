import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const PATH = 'sample-agent-deck.md'
const SHOTS = shotDir('abele-slides-agent')
const SOURCE = `---
type: presentation
htmlNetwork: true
---
::slide{layout=title}::
# Sample deck
A short introduction

> [!notes]
> ${'Private detail. '.repeat(200)}

---
# Crowded slide
${Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} explains a sample detail at excessive length.`).join('\n\n')}

---
::slide{layout=split class=sample-clip}::
# Clipped image
::left::
A sample picture
::right::
![Sample](SAMPLE_IMAGE)

---
\`\`\`slide-script
script: Sample nonexistent script
\`\`\`
\`\`\`slide-html
<script>parent.__sampleDeckExecuted=true</script>
<button>Sample action</button>
\`\`\`

\`\`\`css
.sample-clip img { width: 900px; max-width: none; height: 400px; max-height: none; }
\`\`\`
`
const PRELUDE = `
  const t=window.__abeleTest,s=window.__sampleDeckAgent
  const tool=name=>t.createAgentTools().find(x=>x.name===name)
  const call=(name,params)=>tool(name).execute('sample-'+name,params,undefined,s.ctx)
`
let layout: unknown
beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  await evalLong(`(async()=>{
    if(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))throw Error('sample fixture already exists')
    const t=window.__abeleTest,scope=new t.ScopeResolver()
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600
    const paint=canvas.getContext('2d');paint.fillStyle=getComputedStyle(document.body).getPropertyValue('--text-accent').trim()||'black';paint.fillRect(0,0,1200,600)
    window.__sampleDeckAgent={ctx:{scope,interactive:true},pictures:[]}
    const create=t.createAgentTools().find(x=>x.name==='deck_create')
    if(!create)throw Error('deck_create is missing')
    await create.execute('sample-create',{path:${JSON.stringify(PATH)},content:${JSON.stringify(SOURCE)}.replace('SAMPLE_IMAGE',canvas.toDataURL())},undefined,window.__sampleDeckAgent.ctx)
    return true
  })()`)
})
afterAll(async () => {
  if (!available) return
  await evalLong(`(async()=>{
    const s=window.__sampleDeckAgent
    const paths=[${JSON.stringify(PATH)},...(s?.pictures??[])]
    for(const leaf of app.workspace.getLeavesOfType('abele-deck'))if(leaf.view.file?.path===${JSON.stringify(PATH)})leaf.detach()
    for(const path of paths){const file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.delete(file)}
    app.saveLocalStorage('abele-slide-network:'+${JSON.stringify(PATH)},null)
    delete window.__sampleDeckAgent;delete window.__sampleDeckExecuted
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    return true
  })()`)
})

describe.skipIf(!available)('agent deck authoring and inspection', () => {
  it('reads slide structure and edits one slide with a file-write diff', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      const read=await call('deck_read',{path:${JSON.stringify(PATH)}}),data=JSON.parse(read.content[0].text)
      const edit=await call('deck_edit',{path:${JSON.stringify(PATH)},slide:1,content:${JSON.stringify('::slide{layout=title}::\n# Revised deck\nA short introduction\n\n> [!notes]\n> Hidden cue')}})
      const after=JSON.parse((await call('deck_read',{path:${JSON.stringify(PATH)}})).content[0].text)
      return JSON.stringify({count:data.slides.length,layout:data.slides[2].settings.layout,privateNotes:data.slides[0].notes.length,title:after.slides[0].title,diff:edit.details.diff.old!==edit.details.diff.new})
    })()`)
    )
    expect(result).toEqual({
      count: 4,
      layout: 'split',
      privateNotes: 1,
      title: 'Revised deck',
      diff: true,
    })
  })

  it('returns bounded source pages for a deck with a large inline HTML image', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      const path='sample-paged-deck.md'
      if(app.vault.getAbstractFileByPath(path))throw Error('paging fixture exists')
      const source='# Sample\\n\\n> [!notes]\\n> '+ 'Sample detail. '.repeat(1000)+'\\n\\n\`\`\`slide-html\\n<img src="data:image/png;base64,'+'A'.repeat(60000)+'">\\n\`\`\`'
      const file=await app.vault.create(path,source);s.ctx.scope.addFile(path)
      try {
        const first=await call('deck_read',{path}),a=JSON.parse(first.content[0].text)
        const second=await call('deck_read',{path,offset:a.nextOffset}),b=JSON.parse(second.content[0].text)
        return JSON.stringify({firstSize:first.content[0].text.length,secondSize:second.content[0].text.length,structure:a.structure,firstRange:first.seen.chars,secondRange:second.seen.chars,continued:b.offset===a.nextOffset,exact:source.startsWith(a.source+b.source)})
      } finally { await app.vault.delete(file) }
    })()`)
    )
    expect(result.firstSize).toBeLessThanOrEqual(6000)
    expect(result.secondSize).toBeLessThanOrEqual(6000)
    expect(result.structure).toBe('summary')
    expect(result.firstRange[0]).toBe(1)
    expect(result.secondRange[0]).toBe(result.firstRange[1] + 1)
    expect(result.continued).toBe(true)
    expect(result.exact).toBe(true)
  })

  it('measures overflow and clipped media without executing live blocks or asking consent', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      const report=JSON.parse((await call('deck_check',{path:${JSON.stringify(PATH)}})).content[0].text)
      return JSON.stringify({slides:report.slides,executed:!!window.__sampleDeckExecuted,consent:app.loadLocalStorage('abele-slide-network:'+${JSON.stringify(PATH)})??null,dialogs:document.querySelectorAll('.modal-container').length,hosts:document.querySelectorAll('body > div[aria-hidden="true"] .abele-deck').length})
    })()`)
    )
    expect(result.slides).toHaveLength(4)
    expect(result.slides[0].issues).toEqual([])
    expect(result.slides[1].issues.some((i: { kind: string }) => i.kind === 'overflow')).toBe(true)
    expect(result.slides[1].issues.some((i: { kind: string }) => i.kind === 'crowded')).toBe(true)
    expect(result.slides[2].issues.some((i: { kind: string }) => i.kind === 'clipped-media')).toBe(
      true
    )
    expect(result.slides[3].unverified).toHaveLength(2)
    expect(result.executed).toBe(false)
    expect(result.consent).toBeNull()
    expect(result.dialogs).toBe(0)
    expect(result.hosts).toBe(0)
  })

  it('reports unresolved backgrounds and failed video metadata as missing media', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      const path='sample-unavailable-deck.md'
      if(app.vault.getAbstractFileByPath(path))throw Error('media fixture exists')
      const file=await app.vault.create(path,${JSON.stringify('---\ntype: presentation\n---\n::slide{bg="[[sample-deleted.png]]"}::\n# Missing background\n---\n# Missing video\n<video src="data:video/mp4;base64,AAAA" controls></video>')})
      s.ctx.scope.addFile(path)
      try { return (await call('deck_check',{path})).content[0].text }
      finally { await app.vault.delete(file) }
    })()`)
    )
    expect(result.slides[0].issues.some((i: { kind: string }) => i.kind === 'missing-media')).toBe(
      true
    )
    expect(result.slides[1].issues.some((i: { kind: string }) => i.kind === 'missing-media')).toBe(
      true
    )
  })

  it('checks and photographs a third slide with its numbered CSS rules', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      const path='sample-numbered-deck.md'
      if(app.vault.getAbstractFileByPath(path))throw Error('number fixture exists')
      const file=await app.vault.create(path,${JSON.stringify('---\ntype: presentation\n---\n# First\n---\n# Second\n---\n# Third\n```css\n[data-slide="1"] h1 { font-size: 16px }\n[data-slide="3"] h1 { font-size: 900px }\n```')})
      s.ctx.scope.addFile(path)
      try {
        const checked=JSON.parse((await call('deck_check',{path,slide:3})).content[0].text)
        const picture=await call('screenshot',{path,slide:3})
        const saved=picture.content[0].text.split('\\n')[0].replace('Screenshot saved: ','');s.pictures.push(saved)
        const photographed=JSON.parse(picture.content[0].text.split('\\n').slice(1).join('\\n'))
        return JSON.stringify({check:checked.slides[0],picture:photographed})
      } finally { await app.vault.delete(file) }
    })()`)
    )
    expect(result.check.slide).toBe(3)
    expect(result.check.issues.some((i: { kind: string }) => i.kind === 'overflow')).toBe(true)
    expect(result.picture.slide).toBe(3)
    expect(result.picture.issues.some((i: { kind: string }) => i.kind === 'overflow')).toBe(true)
  })

  it('sends a full-size slide picture to the model and saves the same PNG for the chat', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      const leaves=app.workspace.getLeavesOfType('abele-deck').length
      const result=await call('screenshot',{path:${JSON.stringify(PATH)},slide:1})
      const url=result.injectMessages[0].content.find(p=>p.type==='image_url').image_url.url
      const path=result.content[0].text.split('\\n')[0].replace('Screenshot saved: ','')
      s.pictures.push(path)
      const image=new Image();image.src=url;await image.decode()
      const bytes=await app.vault.readBinary(app.vault.getAbstractFileByPath(path))
      const saved='data:image/png;base64,'+btoa(Array.from(new Uint8Array(bytes),b=>String.fromCharCode(b)).join(''))
      ${onPhone() ? `const surface=document.createElement('div');surface.style.cssText='position:fixed;inset:0;z-index:99999;background:var(--background-primary);display:flex;align-items:center;justify-content:center';image.style.cssText='width:100%;height:100%;object-fit:contain';surface.append(image);document.body.append(surface);try{await window.__e2eHost.shot(${JSON.stringify(SHOTS + '/slide-picture.png')})}finally{surface.remove()}` : `const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(${JSON.stringify(SHOTS + '/slide-picture.png')},Buffer.from(url.split(',')[1],'base64'))`}
      return JSON.stringify({width:image.naturalWidth,height:image.naturalHeight,same:saved===url,newTabs:app.workspace.getLeavesOfType('abele-deck').length-leaves,path:!!path})
    })()`)
    )
    expect(result).toEqual({ width: 1280, height: 720, same: true, newTabs: 0, path: true })
  })

  it('shows a bounded slide-edit diff in the existing chat approval card', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      const chats=t.ChatService.getInstance(),previous=chats.activeTabId.value,beforeTabs=new Set(chats.tabOrder.value)
      const tab=chats.createTab();if(beforeTabs.has(tab))throw Error('No free sample chat tab')
      const session=chats.activeSession.value,config=t.AbeleConfig.getInstance(),enabled=config.ai.enabled
      config.ai.enabled=true
      const before=await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))
      try {
        session.scopeResolver.addFile(${JSON.stringify(PATH)})
        session.toolModes.value.deck_edit='ask'
        session.appendChatMessage({id:'sample-deck-approval',role:'tool-call',content:'',timestamp:1,toolCallId:'sample-deck-call',toolName:'deck_edit',toolParams:{path:${JSON.stringify(PATH)},slide:1,content:${JSON.stringify('::slide{layout=title}::\n# Proposed title\nA short introduction')}},toolStatus:'pending'});session.updateVisibleMessages()
        session.pendingToolCalls.value=[{id:'sample-deck-call',name:'deck_edit',type:'toolCall',arguments:{}}]
        await chats.revealSidebar({focus:false})
        const until=async fn=>{for(let i=0;i<40;i++){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,100))}throw Error('Approval did not settle')}
        const card=await until(()=>document.querySelector('.abele-tool-approval'))
        await until(()=>card.querySelector('.cm-editor'))
        // No text entry is part of this preview probe. Dismiss a composer keyboard left
        // by sidebar adoption before measuring the approval actions or photographing them.
        document.activeElement?.blur()
        await new Promise(r=>setTimeout(r,500))
        card.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,300))
        const box=card.getBoundingClientRect(),buttons=[...card.querySelectorAll('button')]
        const approve=buttons.find(b=>b.textContent.trim()==='Approve'),r=approve.getBoundingClientRect()
        if(window.__e2eHost)await window.__e2eHost.shot(${JSON.stringify(SHOTS + '/deck-approval.png')})
        else {const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(${JSON.stringify(SHOTS + '/deck-approval.png')},(await require('@electron/remote').getCurrentWindow().capturePage()).toPNG())}
        return JSON.stringify({diff:card.textContent.includes('Proposed title'),over:Math.max(0,-box.left,box.right-innerWidth),approveVisible:r.top>=0&&r.bottom<=innerHeight,unchanged:before===await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))})
      } finally {
        session.pendingToolCalls.value=[];session.allChatMessages=[];session.activeLeafId=null;session.updateVisibleMessages();config.ai.enabled=enabled
        await chats.closeTab(tab)
        if(previous)chats.switchTab(previous)
      }
    })()`)
    )
    expect(result).toEqual({ diff: true, over: 0, approveVisible: true, unchanged: true })
  })

  it('opens a later slide without activating the first slide network prompt', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      const path='sample-positioned-deck.md',key='abele-slide-network:'+path
      if(app.vault.getAbstractFileByPath(path))throw Error('position fixture exists')
      const file=await app.vault.create(path,${JSON.stringify('---\ntype: presentation\nhtmlNetwork: true\n---\n```slide-html\n<button>Sample</button>\n```\n---\n# Second\n---\n# Requested')})
      s.ctx.scope.addFile(path);app.saveLocalStorage(key,null)
      let done=false,error=null
      const opening=call('present',{path,slide:3}).then(()=>done=true,e=>{error=String(e);done=true})
      try {
        let asked=false
        for(let i=0;i<40;i++) {
          const button=[...document.querySelectorAll('.modal-container button')].find(b=>b.textContent.includes('Keep offline'))
          if(button){asked=true;button.click();break}
          if(done)break
          await new Promise(r=>setTimeout(r,100))
        }
        await opening
        if(error)throw Error(error)
        const view=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===path).view
        return JSON.stringify({asked,index:view.viewer.index+1,consent:app.loadLocalStorage(key)??null})
      } finally {
        for(const leaf of app.workspace.getLeavesOfType('abele-deck'))if(leaf.view.file?.path===path)leaf.detach()
        await app.vault.delete(file);app.saveLocalStorage(key,null)
      }
    })()`)
    )
    expect(result).toEqual({ asked: false, index: 3, consent: null })
  })

  it('opens the requested slide without starting a speaker show', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      ${PRELUDE}
      // A phone drawer overlays the editor by design; clear the preview probe's chat drawer
      // and keyboard so the picture shows the newly selected deck tab, not that overlay.
      document.activeElement?.blur()
      if(window.__e2eHost){app.workspace.rightSplit?.collapse();app.workspace.leftSplit?.collapse();await new Promise(r=>setTimeout(r,500))}
      await call('present',{path:${JSON.stringify(PATH)},slide:3})
      const view=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)}).view
      await view.viewer.ready
      if(window.__e2eHost){await new Promise(r=>setTimeout(r,500));await window.__e2eHost.shot(${JSON.stringify(SHOTS + '/deck-open.png')})}
      return JSON.stringify({slide:view.viewer.index+1,show:!!view.show})
    })()`)
    )
    expect(result).toEqual({ slide: 3, show: false })
  })
})

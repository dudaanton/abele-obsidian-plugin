import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('reply-annotations')
const path = 'AI/Chats/sample-reply-annotations.abchat'
const script = `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => { for (let i=0;i<100;i++) { const value=fn(); if(value) return value; await wait(100) } throw new Error('Expected UI did not appear') }
  const chats=window.__abeleTest.ChatService.getInstance(), comments=window.__abeleTest.CommentService.getInstance()
  const layout=app.workspace.getLayout(), active=chats.activeTabId.value
  const made=[]
  let parent, child
  const report={}
  const PATH=${JSON.stringify(path)}
  const shot=async name => {
    const path=${JSON.stringify(shots)}+'/'+name+'.png'
    if(window.__e2eHost)return window.__e2eHost.shot(path)
    const image=await require('@electron/remote').getCurrentWindow().webContents.capturePage();require('fs').writeFileSync(path,image.toPNG())
  }
  const tap=async el=>{
    if(!window.__e2eHost){el.click();return}
    const r=el.getBoundingClientRect();await window.__e2eHost.tap(r.left+r.width/2,r.top+r.height/2)
  }
  const saved=async file=>(await app.vault.read(file)).trim().split('\\n').map(line=>JSON.parse(line)).filter(r=>r.k==='msg'&&r.id==='sample-reply').at(-1)
  const item=title=>[...document.querySelectorAll('.menu .menu-item')].find(el=>el.querySelector('.menu-item-title')?.textContent.trim()===title)
  const message=()=>document.querySelector('[data-ask-message="sample-reply"]')
  const select=words=>{
    const root=message(), walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT), nodes=[]
    let node, text=''; while(node=walker.nextNode()){nodes.push({node,start:text.length});text+=node.textContent}
    const from=text.indexOf(words), to=from+words.length; if(from<0)throw new Error('No selected words')
    const a=nodes.find(n=>n.start+n.node.length>from), b=nodes.find(n=>n.start+n.node.length>=to)
    const range=document.createRange(); range.setStart(a.node,from-a.start);range.setEnd(b.node,to-b.start)
    const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'))
  }
  try {
    for(const dir of ['AI','AI/Chats'])if(!app.vault.getAbstractFileByPath(dir)){await app.vault.createFolder(dir);made.unshift(dir)}
    if(app.vault.getAbstractFileByPath(PATH))throw new Error('Fixture already exists')
    const source='A **small** lantern lights the garden path. A lantern stays nearby.'
    const records=[{v:2,k:'meta',type:'abele-chat',title:'Sample reply annotations',providerId:'',modelId:'',created:''},{k:'msg',id:'sample-reply',role:'assistant',content:source,timestamp:1}]
    const file=await app.vault.create(PATH,records.map(r=>JSON.stringify(r)).join('\\n')+'\\n')
    await chats.openChatFile(file);await chats.revealSidebar();parent=chats.getSessionByFile(PATH)
    await until(message);await wait(500)
    report.selectable=getComputedStyle(message().querySelector('strong')).webkitUserSelect
    parent.isStreaming.value=true
    select('small lantern')
    const bar=await until(()=>document.querySelector('.abele-chat-selection_placed'))
    const box=bar.getBoundingClientRect()
    report.bar={left:box.left,right:box.right,width:innerWidth,colours:bar.querySelectorAll('[data-highlight-color]').length,actions:bar.querySelectorAll('[data-highlight-action]').length}
    await shot('selection-highlight')
    await tap(bar.querySelector('[data-highlight-action]'))
    await until(()=>message().querySelector('.abele-highlight--yellow'))
    report.created=parent.messages.value[0].highlights[0].color
    report.highlighted=[...message().querySelectorAll('[data-reply-highlight]')].map(el=>el.textContent).join('')
    await tap(message().querySelector('[data-reply-highlight]'))
    await until(()=>item('Make it purple'))
    report.controls=[...document.querySelectorAll('.menu .menu-item-title')].map(el=>el.textContent.trim())
    report.selectionMenu=!!document.querySelector('.abele-chat-selection_placed')
    await shot('highlight-controls')
    await tap(item('Make it purple'))
    await until(()=>message().querySelector('.abele-highlight--purple'))
    await parent.save()
    report.recolored=(await saved(file)).highlights[0].color
    await tap(message().querySelector('[data-reply-highlight]'))
    await until(()=>item('Remove highlight'));await tap(item('Remove highlight'))
    await until(()=>!message().querySelector('[data-reply-highlight]'))
    await parent.save()
    report.removed=(await saved(file)).highlights.length
    await parent.highlightReply('sample-reply','small lantern',2,'purple')
    for(const [quote,color] of [['lights','yellow'],['garden','green'],['path','blue'],['stays','pink'],['nearby','orange']]) {
      const plain='A small lantern lights the garden path. A lantern stays nearby.'
      await parent.highlightReply('sample-reply',quote,plain.indexOf(quote),color)
    }
    await parent.save()
    await wait(300);await shot('all-colours')
    report.swatches=[...message().querySelectorAll('[data-reply-highlight]')].map(el=>getComputedStyle(el).backgroundColor)
    parent.isStreaming.value=false
    await chats.closeTab(parent.id);await chats.openChatFile(file);parent=chats.getSessionByFile(PATH)
    report.reopened=parent.messages.value[0].highlights.length
    await until(message)
    child=await comments.createOnMessage(parent,'sample-reply','small lantern',2)
    await child.addUserNote('Please clarify the selected description.')
    const tool=child.getTools().find(t=>t.name==='propose_reply_revision')
    child.handleAgentEvent({type:'tool_start',toolCallId:'sample-proposal',toolName:tool.name,args:{text:'bright lamp',request:'Please clarify the selected description.'}})
    const result=await tool.execute('sample-proposal',{text:'bright lamp',request:'Please clarify the selected description.'})
    child.handleAgentEvent({type:'tool_end',toolCallId:'sample-proposal',result,isError:false});await child.save()
    report.proposed=result.details.replyProposal.old
    report.unchanged=parent.messages.value[0].content===source
    const review=await until(()=>[...document.querySelectorAll('.abele-ai-chat button')].find(b=>b.textContent.trim()==='Review reply revision'))
    review.click()
    const dialog=await until(()=>document.querySelector('.abele-reply-revision'))
    await until(()=>dialog.querySelector('.cm-editor'));await wait(300)
    const modal=dialog.closest('.modal'), r=modal.getBoundingClientRect()
    report.dialog={left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,buttons:[...modal.querySelectorAll('.abele-modal__footer button')].filter(b=>b.getBoundingClientRect().bottom<=innerHeight).map(b=>b.textContent.trim())}
    await shot('passage-diff')
    ;[...modal.querySelectorAll('button')].find(b=>b.textContent.trim()==='Accept').click()
    await until(()=>parent.messages.value[0].content.includes('bright lamp'))
    report.accepted=parent.messages.value[0].content
    report.original=parent.messages.value[0].revisions[0].before
    await until(()=>!document.querySelector('.abele-reply-revision'))
    chats.switchTab(parent.id);await until(message);await wait(300);await shot('edited-reply')
    ;[...document.querySelectorAll('.abele-ai-chat button')].find(b=>b.textContent.trim()==='View original').click()
    await until(()=>document.querySelector('.modal .abele-markdown'));await wait(300);await shot('original-reply')
    ;[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Undo last revision').click()
    await until(()=>parent.messages.value[0].content===source)
    report.undone=parent.messages.value[0].highlights.length
  } catch(error) {report.error=String(error.stack||error)} finally {
    if(parent)parent.isStreaming.value=false
    document.getSelection().removeAllRanges()
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))
    if(child?.commentId)await comments.remove(child.commentId)
    const session=chats.getSessionByFile(PATH);if(session)await chats.closeTab(session.id)
    const file=app.vault.getAbstractFileByPath(PATH);if(file)await app.vault.delete(file)
    for(const dir of made){const f=app.vault.getAbstractFileByPath(dir);if(f&&!f.children.length)await app.vault.delete(f)}
    if(active)chats.switchTab(active)
    await app.workspace.changeLayout(layout)
  }
  return report
})()`

describe.runIf(available)('reply annotations in phone layout', () => {
  let size: number[] = [],
    report: any
  beforeAll(async () => {
    if (!onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      await reloadApp('app.emulateMobile(true)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
    }
    report = JSON.parse(await evalLong(script, 90_000))
  }, 180_000)
  afterAll(async () => {
    if (!onPhone()) {
      if (size.length)
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
        )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 90_000)
  it('completes without an error', () => expect(report.error).toBeUndefined())
  it('allows native selection in formatted reply text, not only scripted ranges', () => {
    expect(report.selectable).toBe('text')
  })
  it('creates yellow with one action, then offers colours and removal on tap while running', () => {
    expect(report.bar.colours).toBe(0)
    expect(report.bar.actions).toBe(1)
    expect(report.created).toBe('yellow')
    expect(report.controls).toEqual([
      'Make it yellow',
      'Make it green',
      'Make it blue',
      'Make it pink',
      'Make it purple',
      'Make it orange',
      'Remove highlight',
    ])
    expect(report.selectionMenu).toBe(false)
    expect(report.recolored).toBe('purple')
    expect(report.removed).toBe(0)
    expect(new Set(report.swatches).size).toBe(6)
    expect(report.swatches).not.toContain('rgba(0, 0, 0, 0)')
    expect(report.bar.left).toBeGreaterThanOrEqual(0)
    expect(report.bar.right).toBeLessThanOrEqual(report.bar.width)
    expect(report.highlighted).toBe('small lantern')
    expect(report.reopened).toBe(6)
  })
  it('maps formatted text and waits for acceptance, with all decision buttons visible', () => {
    expect(report.proposed).toBe('**small** lantern')
    expect(report.unchanged).toBe(true)
    expect(report.dialog.left).toBeGreaterThanOrEqual(0)
    expect(report.dialog.right).toBeLessThanOrEqual(report.dialog.width)
    expect(report.dialog.bottom).toBeLessThanOrEqual(report.dialog.height)
    expect(report.dialog.buttons).toEqual(['Accept', 'Reject', 'Later'])
  })
  it('changes only the passage, retains the original and undoes it with its highlights', () => {
    expect(report.accepted).toBe('A bright lamp lights the garden path. A lantern stays nearby.')
    expect(report.original).toBe(
      'A **small** lantern lights the garden path. A lantern stays nearby.'
    )
    expect(report.undone).toBe(6)
  })
})

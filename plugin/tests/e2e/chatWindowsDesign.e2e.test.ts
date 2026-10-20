import { describe, expect, it } from 'vitest'
import {
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-chat-windows-design')
const probe = (screen: string) => `(async () => {
  const api = window.__abeleTest, chats = api.ChatService.getInstance()
  const config = api.AbeleConfig.getInstance(), registry = api.AgentRegistry.getInstance()
  const before = JSON.parse(JSON.stringify(config.exportSettings()))
  const oldTab = chats.activeTabId.value, collapsed = app.workspace.rightSplit.collapsed
  const root = 'SampleChatWindowReview'
  if (app.vault.getAbstractFileByPath(root)) throw Error('Synthetic review folder already exists')
  const made = [], report = { states: [], shots: [], overflow: [], error: '', filesStayed: false }
  let owned
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => { const end = Date.now()+8000; while (!fn()) { if (Date.now()>end) throw Error('Synthetic window did not appear'); await wait(30) } }
  const close = async () => {
    const modal = [...document.querySelectorAll('.modal')].find(el => el.getBoundingClientRect().width)
    if (!modal) return
    const cancel = [...modal.querySelectorAll('button')].find(el => el.textContent.trim() === 'Cancel')
    ;(cancel || modal.querySelector('.modal-close-button, .modal-header-button'))?.click()
    await until(() => !modal.isConnected)
  }
  const capture = async (name, selector) => {
    await until(() => document.querySelector(selector)?.getBoundingClientRect().width)
    await wait(250)
    const el = document.querySelector(selector), bounds = el.closest('.modal')?.getBoundingClientRect() || el.getBoundingClientRect()
    const walk = node => {
      const style=getComputedStyle(node), box=node.getBoundingClientRect()
      if (!box.width || style.display === 'none' || style.visibility === 'hidden') return
      if (box.left < Math.max(0,bounds.left)-1 || box.right > Math.min(innerWidth,bounds.right)+1) report.overflow.push(name+':'+node.tagName+':'+node.className+':'+Math.round(box.left)+'..'+Math.round(box.right)+':'+node.textContent.slice(0,80))
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') return
      for (const child of node.children) walk(child)
    }
    walk(el)
    const path=${JSON.stringify(shots)}+'/'+${JSON.stringify(screen)}+'-'+name+'.png'
    const image=await require('@electron/remote').getCurrentWindow().webContents.capturePage()
    require('fs').writeFileSync(path,image.toPNG()); report.states.push(name); report.shots.push(path)
  }
  const file = async (path, text) => { if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic file already exists'); const item=await app.vault.create(path,text); made.push(path); return item }
  try {
    await close()
    await app.vault.createFolder(root)
    for (const [name, fixture, selector] of [
      ['files-empty','chat-artifacts-empty','.abele-chat-artifacts'],
      ['files-missing','chat-artifacts','.abele-chat-artifacts'],
      ['files-long','chat-artifacts-long','.abele-chat-artifacts'],
      ['revision','reply-revision','.abele-reply-revision'],
      ['original','reply-original','.abele-reply-original'],
      ['selection-history','selection-history','.abele-anchor-history'],
      ['selection-missing','selection-unresolved','.abele-anchor-history'],
    ]) {
      void api.openDialog(fixture)
      await capture(name,selector)
      await close()
    }
    const base=await file(root+'/reference.md','Sample original text.\\n')
    const created=root+'/created.md'
    await api.openRewind(base.path,created)
    made.push(created)
    await until(() => document.querySelector('.abele-rewind .tree-item'))
    const filesToggle=[...document.querySelectorAll('.abele-rewind .setting-item')].find(row=>row.querySelector('.setting-item-name')?.textContent==='Put files back')?.querySelector('[role="checkbox"]')
    if (filesToggle?.getAttribute('aria-checked') !== 'false') throw Error('File restoration did not start off')
    const current=await app.vault.read(base)
    await capture('rewind-preview','.abele-rewind')
    filesToggle.click()
    await capture('rewind-selected','.abele-rewind')
    await close()
    report.filesStayed=current===await app.vault.read(base) && !!app.vault.getAbstractFileByPath(created)

    config.ai.chatFolder=root+'/Chats'
    const helper=registry.create({ id:'sample-window-agent',name:'Sample assistant',description:'Helps review sample material.' })
    config.ai.defaultAgentId=helper.id; registry.notifyConfigReloaded()
    await app.vault.createFolder(root+'/Chats'); await app.vault.createFolder(root+'/Chats/Runs')
    const runId='sample-window-helper'
    const run={ type:'abele-run',runId,agentId:helper.id,agentName:'Sample researcher',parentChat:'',parentToolCallId:'sample-delegate',task:'Review sample sources',created:'2034-04-06T12:30:00Z',status:'error',depth:0,branches:[
      {item:'Read the sample source',status:'done',result:'Sample complete',messages:[{id:'sample-run-read',role:'tool-call',content:'',timestamp:1,toolName:'read',toolParams:{path:'Sample/source.md'},toolResult:'Sample source content'}]},
      {item:'Check a second sample source',status:'error',error:'Synthetic source unavailable',messages:[]},
    ]}
    await file(root+'/Chats/Runs/'+runId+'.abchat',JSON.stringify(run))
    const meta={v:2,k:'meta',type:'abele-chat',title:'Sample window conversation',created:'2034-04-06',agentId:helper.id,providerId:'',modelId:'',activeLeafId:'sample-helper-call'}
    const messages=[
      {k:'msg',id:'sample-user',role:'user',content:'Review a sample paragraph.',timestamp:1},
      {k:'msg',id:'sample-answer',role:'assistant',parentId:'sample-user',content:'A sample paragraph with words ready to select.',timestamp:2},
      {k:'msg',id:'sample-helper-call',role:'tool-call',parentId:'sample-answer',content:'',timestamp:3,toolName:'delegate',toolCallId:'sample-delegate',toolStatus:'approved',toolResult:'Sample helper completed with an error.',subAgentRun:{runId,agentName:'Sample researcher',branchCount:2,status:'error'}},
    ]
    const chatFile=await file(root+'/Chats/sample-conversation.abchat',[meta,...messages].map(row=>JSON.stringify(row)).join('\\n')+'\\n')
    owned=chats.createTab(); const session=chats.getSession(owned)
    await session.load(chatFile)
    session.save=async()=>{}
    await chats.revealSidebar({focus:false})
    await capture('helpers-closed','.abele-run')
    document.querySelector('.abele-run > .tree-item-self').click()
    await until(()=>document.querySelector('.abele-run .abele-run-branch'))
    document.querySelector('.abele-run-branch > .tree-item-self').click()
    await until(()=>document.querySelector('.abele-run-msg__tool > .tree-item-self'))
    document.querySelector('.abele-run-msg__tool > .tree-item-self').click()
    await capture('helpers-open','.abele-run')
    if (${JSON.stringify(screen)} === 'phone') {
      const content=document.querySelector('[data-message-id="sample-answer"] [data-find-part="content"]')
      const text=document.createTreeWalker(content,NodeFilter.SHOW_TEXT).nextNode()
      const range=document.createRange(); range.setStart(text,0);range.setEnd(text,Math.min(18,text.length))
      const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange',{bubbles:true}))
      content.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch'}))
      await capture('selection-bar','.abele-chat-selection')
      selection.removeAllRanges();document.dispatchEvent(new Event('selectionchange'))
    }
    const history = document.querySelector('.abele-ai-chat__header-actions [aria-label="Open a chat you have had"]')
    if (history) history.click()
    else {
      document.querySelector('.abele-ai-chat__header-actions [aria-label="More chat actions"]').click()
      await until(() => [...document.querySelectorAll('.menu .menu-item')].some(item => item.textContent.trim() === 'Open a chat you have had'))
      ;[...document.querySelectorAll('.menu .menu-item')].find(item => item.textContent.trim() === 'Open a chat you have had').click()
    }
    await capture('history','.abele-chat-history')
    await close()
  } catch(error) { report.error=String(error.message??error) }
  finally {
    await close()
    document.getSelection()?.removeAllRanges()
    if (owned) await chats.deleteChat(owned)
    if(oldTab)chats.switchTab(oldTab)
    for(const path of made.reverse()) { const item=app.vault.getAbstractFileByPath(path); if(item)await app.vault.delete(item) }
    const folder=app.vault.getAbstractFileByPath(root)
    if(folder)await app.fileManager.trashFile(folder)
    config.applySettings(before);registry.notifyConfigReloaded();await config.saveSettings()
    if(collapsed)app.workspace.rightSplit.collapse()
  }
  return report
})()`

describe('real chat review windows', () => {
  it.each(['desktop', 'phone'])(
    '%s retains synthetic review states and never restores on cancel',
    async (screen) => {
      expect(isObsidianRunning() && hasTestApi()).toBe(true)
      try {
        if (screen === 'phone') {
          await reloadApp('app.emulateMobile(true)')
          evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390,844)")
        }
        const raw = await evalLong(probe(screen), 180_000)
        if (raw.startsWith('Error:')) throw Error(raw)
        const report = JSON.parse(raw) as {
          states: string[]
          shots: string[]
          overflow: string[]
          error: string
          filesStayed: boolean
        }
        console.info(JSON.stringify(report))
        expect(report.error).toBe('')
        expect(report.filesStayed).toBe(true)
        expect(report.shots).toHaveLength(screen === 'phone' ? 13 : 12)
        expect(report.overflow).toEqual([])
      } finally {
        if (screen === 'phone') await restoreDesktopWindow()
      }
    },
    240_000
  )
})

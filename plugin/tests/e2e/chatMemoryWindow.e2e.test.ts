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
const shots = shotDir('abele-chat-memory-window')
const probe = (screen: string) => `(async () => {
  const api = window.__abeleTest, chats = api.ChatService.getInstance()
  const config = api.AbeleConfig.getInstance(), registry = api.AgentRegistry.getInstance()
  const before = JSON.parse(JSON.stringify(config.exportSettings()))
  const oldTab = chats.activeTabId.value, collapsed = app.workspace.rightSplit.collapsed
  const root = 'SampleLongChatMemoryReview'
  if (app.vault.getAbstractFileByPath(root)) throw Error('Synthetic folder already exists')
  const report = { shots: [], states: [], error: '' }
  let owned
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const box = () => document.querySelector('.abele-ai-chat__messages')
  const ids = () => [...box().querySelectorAll('[data-message-id]')].map(el => el.dataset.messageId)
  const settle = async () => { await wait(200); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) }
  const capture = async name => {
    await settle()
    const path = ${JSON.stringify(shots)}+'/'+${JSON.stringify(screen)}+'-'+name+'.png'
    const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
    require('fs').writeFileSync(path,image.toPNG())
    const messages=ids()
    report.shots.push(path)
    report.states.push({name, count:messages.length, first:messages[0], last:messages.at(-1)})
    if(messages.length > 90) throw Error('Unbounded message window')
  }
  const older = async () => {
    box().dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}))
    box().scrollTop=0
    box().dispatchEvent(new Event('scroll'))
    await settle()
  }
  try {
    config.ai.chatFolder=root+'/Chats'
    const helper=registry.create({id:'sample-memory-agent',name:'Sample assistant',description:'Synthetic long chat review.'})
    config.ai.defaultAgentId=helper.id;registry.notifyConfigReloaded()
    await app.vault.createFolder(root);await app.vault.createFolder(root+'/Chats')
    const meta={v:2,k:'meta',type:'abele-chat',title:'Synthetic long chat — 2000 messages',created:'2034-01-01',agentId:helper.id,providerId:'',modelId:'',activeLeafId:'sample-1999'}
    const rows=[meta]
    for(let i=0;i<2000;i++) {
      rows.push({k:'msg',id:'sample-'+i,parentId:i?'sample-'+(i-1):undefined,role:i%2?'assistant':'user',content:'SYNTHETIC MESSAGE '+i+'\\n\\n'+(i%2?'## Sample response\\n\\n':'Sample question: ')+('Sample text for a long conversation. '.repeat(100)),timestamp:i+1})
      rows.push({k:'int',role:'user',content:'Sample internal history. '.repeat(700),timestamp:i+1,chatMessageId:'sample-'+i})
    }
    const file=await app.vault.create(root+'/Chats/Synthetic.abchat',rows.map(row=>JSON.stringify(row)).join('\\n')+'\\n')
    owned=chats.createTab();const session=chats.getSession(owned)
    await session.load(file);session.save=async()=>{}
    await chats.revealSidebar({focus:false});await settle()
    box().scrollTop=box().scrollHeight
    await capture('bottom')
    for(let i=0;i<32;i++) await older()
    box().scrollTop=Math.min(500,box().scrollHeight/4)
    await capture('middle')
    const beforeOlder=ids()[0]
    await older()
    await capture('loading-older')
    if(ids()[0]===beforeOlder) throw Error('Older history did not load')
    for(let i=0;i<40 && ids()[0]!=='sample-0';i++) await older()
    box().scrollTop=0
    await capture('top')
    if(ids()[0]!=='sample-0') throw Error('Beginning unreachable')
  } catch(error) {report.error=String(error.message??error)}
  finally {
    if(owned)await chats.deleteChat(owned)
    if(oldTab)chats.switchTab(oldTab)
    const folder=app.vault.getAbstractFileByPath(root)
    if(folder)await app.fileManager.trashFile(folder)
    config.applySettings(before);registry.notifyConfigReloaded();await config.saveSettings()
    if(collapsed)app.workspace.rightSplit.collapse()
  }
  return report
})()`

describe('bounded synthetic long chat review', () => {
  it.each(['desktop', 'phone'])(
    '%s renders bottom, middle, older page and beginning',
    async (screen) => {
      expect(isObsidianRunning() && hasTestApi()).toBe(true)
      try {
        if (screen === 'phone') {
          await reloadApp('app.emulateMobile(true)')
          evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390,844)")
        }
        const raw = await evalLong(probe(screen), 180_000)
        if (raw.startsWith('Error:')) throw Error(raw)
        const report = JSON.parse(raw) as { error: string; shots: string[]; states: unknown[] }
        console.info(JSON.stringify(report))
        expect(report.error).toBe('')
        expect(report.shots).toHaveLength(4)
      } finally {
        if (screen === 'phone') await restoreDesktopWindow()
      }
    },
    240_000
  )
})

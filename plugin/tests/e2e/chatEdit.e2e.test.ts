import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('chat-edit')

const script = (layout: string) => `(async () => {
  const api = window.__abeleTest
  const chats = api.ChatService.getInstance()
  const previous = chats.activeTabId.value
  const path = 'sample-edit-' + crypto.randomUUID() + '.abchat'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => {
    for (let i = 0; i < 100; i++) { if (fn()) return; await wait(50) }
    throw Error('Edit state did not appear: ' + fn.toString())
  }
  const originalStream = api.OpenAIClient.prototype.stream
  const sent = [], report = []
  let session, file
  const records = [
    {v:2,k:'meta',type:'abele-chat',title:'Sample editing',created:'2025-01-01',activeLeafId:'a2'},
    {k:'msg',id:'q1',role:'user',content:'Plan a sample garden',timestamp:1},
    {k:'msg',id:'a1',parentId:'q1',role:'assistant',content:'Start with herbs',timestamp:2},
    {k:'msg',id:'q2',parentId:'a1',role:'user',content:'Add sample flowers',timestamp:3},
    {k:'msg',id:'a2',parentId:'q2',role:'assistant',content:'Choose spring flowers',timestamp:4},
    {k:'int',role:'user',content:'Plan a sample garden',timestamp:1,chatMessageId:'q1'},
    {k:'int',role:'assistant',content:[{type:'text',text:'Start with herbs'}],timestamp:2,chatMessageId:'a1',model:'sample',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0},stopReason:'stop'},
    {k:'int',role:'user',content:'Add sample flowers',timestamp:3,chatMessageId:'q2'},
    {k:'int',role:'assistant',content:[{type:'text',text:'Choose spring flowers'}],timestamp:4,chatMessageId:'a2',model:'sample',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0},stopReason:'stop'}
  ]
  const row = id => document.querySelector('[data-message-id="' + id + '"]')
  const capture = async name => {
    await wait(350)
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(${JSON.stringify(SHOTS + '/')} + ${JSON.stringify(layout)} + '-' + name + '.png', image.toPNG())
  }
  const edit = async id => {
    row(id).scrollIntoView({block:'center'})
    const direct = row(id).querySelector('[aria-label="Edit"]')
    if (direct) direct.click()
    else {
      row(id).querySelector('[aria-label="More message actions"]').click()
      await until(() => [...document.querySelectorAll('.menu-item')].some(el => el.textContent.trim() === 'Edit'))
      ;[...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === 'Edit').click()
    }
    await until(() => document.querySelector('[aria-label="Cancel editing"]'))
  }
  try {
    file = await app.vault.create(path, records.map(record => JSON.stringify(record)).join('\\n') + '\\n')
    await chats.openChatFile(file)
    await chats.revealSidebar({focus:false})
    session = chats.activeSession.value
    session.resolveModel = () => ({id:'sample',name:'Sample',baseUrl:'https://sample.invalid/v1',apiKey:'',contextWindow:100000,maxTokens:1000})
    session.getTools = () => []
    session.rewind.apply = async () => { throw Error('Editing must not restore files') }
    for (const key of ['generateTitle','generateSummary','generateRecap','autoCompactIfNeeded']) session.summarizer[key] = async () => undefined
    api.OpenAIClient.prototype.stream = async function* (_model, _prompt, input) {
      sent.push(structuredClone(input))
      yield {type:'text_delta',delta:'Revised sample answer'}
      yield {type:'done',message:{role:'assistant',content:[{type:'text',text:'Revised sample answer'}],model:'sample',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0},stopReason:'stop',timestamp:Date.now()}}
    }
    for (const id of ['q1','q2']) {
      session.switchBranch('a2', false)
      await until(() => row(id))
      await edit(id)
      const prefix = session.messages.value.map(m => m.id)
      const emptyHistory = session.messagesForModel().length === 0
      await capture(id + '-editing')
      document.querySelector('[aria-label="Cancel editing"]').click()
      await until(() => session.branchLeafId === 'a2' && row(id))
      await edit(id)
      session.draft.value.text = 'Revised sample question ' + id
      await wait(100)
      const count = sent.length
      document.querySelector('.abele-chat-input__send').click()
      await until(() => sent.length > count && !session.isStreaming.value && session.messages.value.at(-1)?.role === 'assistant')
      await until(() => !document.querySelector('[aria-label="Cancel editing"]'))
      const revised = session.messages.value.find(m => m.content === 'Revised sample question ' + id)
      await until(() => row(revised.id)?.querySelector('.abele-chat-branch'))
      report.push({id,prefix,emptyHistory,visible:session.messages.value.map(m => m.content),history:sent.at(-1).filter(m => m.role === 'user').map(m => m.content),switcher:row(revised.id).querySelector('.abele-chat-branch').textContent.replace(/\\s/g,'')})
      await capture(id + '-revised')
      row(revised.id).querySelector('.abele-chat-branch button').click()
      await until(() => row(id))
      if (session.messages.value.some(m => m.id === revised.id)) throw Error('Original branch contains the edit')
      if (!row(id).querySelector('.abele-chat-branch').textContent.replace(/\\s/g,'').includes('1/2')) throw Error('Original branch switcher is missing')
    }
    return report
  } finally {
    api.OpenAIClient.prototype.stream = originalStream
    if (session) { session.abort(); await chats.deleteChat(session.id) }
    if (file && app.vault.getAbstractFileByPath(path) === file) await app.vault.delete(file)
    if (previous) chats.switchTab(previous)
  }
})()`

describe.skipIf(!available)('editing questions into sibling branches', () => {
  it.each(['desktop', 'phone layout'])(
    'replaces first and middle questions on %s',
    async (layout) => {
      const run = async () => JSON.parse(await evalLong(script(layout), 60_000))
      const result = layout === 'desktop' ? await run() : await withEmulatedPhone(run)
      expect(result).toEqual([
        {
          id: 'q1',
          prefix: [],
          emptyHistory: true,
          visible: ['Revised sample question q1', 'Revised sample answer'],
          history: ['Revised sample question q1'],
          switcher: '2/2',
        },
        {
          id: 'q2',
          prefix: ['q1', 'a1'],
          emptyHistory: false,
          visible: [
            'Plan a sample garden',
            'Start with herbs',
            'Revised sample question q2',
            'Revised sample answer',
          ],
          history: ['Plan a sample garden', 'Revised sample question q2'],
          switcher: '2/2',
        },
      ])
    },
    120_000
  )
})

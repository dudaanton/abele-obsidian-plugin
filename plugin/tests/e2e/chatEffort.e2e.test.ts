import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('chat-effort')

const probe = (phone: boolean) => `(async () => {
  ${WAIT_PRELUDE}
  const api = window.__abeleTest
  const config = api.AbeleConfig.getInstance()
  const chats = api.ChatService.getInstance()
  const registry = api.AgentRegistry.getInstance()
  const previous = JSON.parse(JSON.stringify(config.exportSettings()))
  const oldTab = chats.activeTabId.value
  const collapsed = app.workspace.rightSplit.collapsed
  const originalStream = api.OpenAIClient.prototype.stream
  const path = 'sample-effort-' + crypto.randomUUID() + '.abchat'
  const sent = []
  let session, file
  const visible = selector => [...document.querySelectorAll(selector)].find(el => el.getBoundingClientRect().width > 0)
  const capture = async name => {
    await wait(200)
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(${JSON.stringify(shots + '/')} + name + '.png', image.toPNG())
  }
  const menu = async () => {
    const control = await until(() => visible(${JSON.stringify(phone ? '.abele-agent-selector > .abele-obsidian-icon' : '.abele-chat-effort')}), 8000)
    if (!control) throw Error('Effort control missing')
    control.click()
    if (!await until(() => [...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === 'High'), 5000)) throw Error('Effort menu missing')
  }
  const choose = async text => {
    const item = [...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === text)
    if (!item) throw Error('Effort choice missing: ' + text)
    item.click()
    await wait(200)
  }
  try {
    config.ai.providers = [{id:'sample-provider',name:'Sample provider',baseUrl:'https://sample.invalid/v1',apiKeyId:'',models:[
      {id:'sample-model',name:'Sample balanced',contextWindow:100000,maxTokens:1000,supportsReasoning:true,reasoningEffort:'medium'},
      {id:'sample-other',name:'Sample alternate',contextWindow:100000,maxTokens:1000,supportsReasoning:true,reasoningEffort:'low'}
    ]}]
    const agent = registry.create({name:'Sample reasoning agent',providerId:'sample-provider',modelId:'sample-model'})
    const records = [
      {v:2,k:'meta',type:'abele-chat',title:'Sample thinking',created:'2025-01-01',agentId:agent.id,activeLeafId:'sample-answer'},
      {k:'msg',id:'sample-question',role:'user',content:'Plan a sample garden',timestamp:1},
      {k:'msg',id:'sample-answer',parentId:'sample-question',role:'assistant',content:'Start with herbs.',timestamp:2}
    ]
    file = await app.vault.create(path, records.map(r => JSON.stringify(r)).join('\\n') + '\\n')
    await chats.openChatFile(file)
    await chats.revealSidebar({focus:false})
    session = chats.activeSession.value
    if (!${phone}) {
      if (!await until(() => visible('.abele-chat-effort'), 8000)) throw Error('Control missing')
      if (visible('.abele-chat-effort').classList.contains('abele-chat-effort_own')) throw Error('Unexpected override')
      await capture('desktop-following-model')
    }
    await menu()
    await capture(${JSON.stringify(phone ? 'phone-agent-menu' : 'desktop-menu')})
    await choose('High')
    if (session.reasoningEffort.value !== 'high') throw Error('Choice did not reach chat')
    await session.save()
    await session.load(file)
    if (session.reasoningEffort.value !== 'high' || !session.isOverridden('reasoningEffort')) throw Error('Choice lost after reload')
    if (!${phone}) {
      await capture('desktop-own-level')
      session.activeModelId.value = 'sample-other'
      await session.save()
      await capture('desktop-own-model-and-level')
      const level = visible('.abele-chat-effort .abele-obsidian-icon__text')
      if (!level || level.scrollWidth > level.clientWidth) throw Error('Chat effort label is truncated beside the model')
      // The access button opens the same setup dialog, whose Chat tab holds the level.
      const access = visible('.abele-chat-input__scope')
      if (!access) throw Error('Chat access control missing')
      access.click()
      const tab = await until(() => [...document.querySelectorAll('.abele-chat-setup .abele-tabs__tab')].find(el => el.textContent.trim() === 'Chat'), 5000)
      if (!tab) throw Error('Chat settings tab missing')
      tab.click()
      if (!await until(() => visible('.abele-chat-settings'), 5000)) throw Error('Chat settings missing')
      const row = [...document.querySelectorAll('.abele-chat-settings .setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === 'Effort')
      if (!row || row.querySelector('select')?.value !== 'high') throw Error('Settings effort not synchronized')
      const select = row.querySelector('select')
      select.value = 'low'
      select.dispatchEvent(new Event('change', {bubbles:true}))
      if (!await until(() => session.reasoningEffort.value === 'low', 2000)) throw Error('Settings did not change effort')
      select.value = 'high'
      select.dispatchEvent(new Event('change', {bubbles:true}))
      if (!await until(() => session.reasoningEffort.value === 'high', 2000)) throw Error('Settings did not restore effort')
      await session.save()
      await capture('desktop-settings-chat')
      const close = document.querySelector('.abele-chat-setup').closest('.modal-container').querySelector('.modal-close-button, .modal-header-button')
      if (!close) throw Error('Chat settings close control missing')
      close.click()
      if (!await until(() => !document.querySelector('.abele-chat-setup'), 5000)) throw Error('Chat settings did not close')
    }
    session.getTools = () => []
    for (const key of ['generateTitle','generateSummary','generateRecap','autoCompactIfNeeded']) session.summarizer[key] = async () => undefined
    api.OpenAIClient.prototype.stream = async function* (_model, _prompt, _messages, _tools, options) {
      sent.push(options?.reasoningEffort)
      yield {type:'done',message:{role:'assistant',content:[{type:'text',text:'Sample answer'}],model:'sample-model',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2},stopReason:'stop',timestamp:Date.now()}}
    }
    await session.sendMessage('A sample question')
    if (sent.length !== 1 || sent[0] !== 'high') throw Error('Provider did not receive selected effort: ' + JSON.stringify(sent))
    await menu()
    const follow = [...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim().startsWith('As Sample'))
    if (!follow) throw Error('Follow model choice missing')
    follow.click()
    await session.save()
    await session.load(file)
    if (session.isOverridden('reasoningEffort') || session.reasoningEffort.value !== ${JSON.stringify(phone ? 'medium' : 'low')}) throw Error('Follow model did not persist')
    return JSON.stringify({persisted:true,requested:sent[0],followed:true})
  } finally {
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))
    document.querySelector('.abele-chat-setup')?.closest('.modal-container')?.querySelector('.modal-close-button, .modal-header-button')?.click()
    api.OpenAIClient.prototype.stream = originalStream
    if (session) { session.abort(); await chats.deleteChat(session.id) }
    if (file && app.vault.getAbstractFileByPath(path) === file) await app.vault.delete(file)
    config.applySettings(previous)
    registry.notifyConfigReloaded()
    if (oldTab) chats.switchTab(oldTab)
    if (collapsed) app.workspace.rightSplit.collapse()
  }
})()`

describe.skipIf(!available)('per-chat thinking effort', () => {
  it('persists a desktop choice and sends it to a fake provider', async () => {
    expect(JSON.parse(await evalLong(probe(false)))).toEqual({
      persisted: true,
      requested: 'high',
      followed: true,
    })
  })
  it('persists the phone agent-menu choice and sends it to a fake provider', async () => {
    await withEmulatedPhone(async () => {
      expect(JSON.parse(await evalLong(probe(true)))).toEqual({
        persisted: true,
        requested: 'high',
        followed: true,
      })
    })
  })
})

import { describe, expect, it } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { MESSAGE_ACTIONS_SETUP, MESSAGE_ACTIONS_CLEANUP } from './helpers/messageActions'

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('new chat from the message menu', () => {
  it('opens the copied prefix in another tab without changing the source or starting a turn', () => {
    const result = evalAsync<{
      differentTab: boolean
      differentFile: boolean
      title: string
      contents: string[]
      sourceUnchanged: boolean
      sourceLeaf: string
      idle: boolean
    }>(`(async () => {
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
      const until=async(fn,ms)=>{const end=Date.now()+ms;while(Date.now()<end){if(fn())return true;await wait(50)}return false}
      ${MESSAGE_ACTIONS_SETUP}
      let copied=null
      try {
        const before=await app.vault.read(actionFile)
        const source=actionService.getSession(actionSourceId)
        source.draft.value.text='Unsent sample draft'
        actionRow.querySelector('[aria-label="More message actions"]').click()
        await wait(200)
        const choice=[...document.querySelectorAll('.menu-item')].find(item=>item.querySelector('.menu-item-title')?.textContent.trim()==='New chat from here')
        if(!choice)throw Error('Clone action did not open')
        choice.click()
        if(!await until(()=>actionService.activeSession.value?.id!==actionSourceId&&actionService.activeSession.value?.currentChatFile.value,5000))throw Error('Clone did not open')
        copied=actionService.activeSession.value
        return {
          differentTab:copied.id!==actionSourceId,
          differentFile:copied.currentChatFile.value.path!==actionPath,
          title:copied.chatTitle.value,
          contents:copied.messages.value.map(message=>message.content),
          sourceUnchanged:await app.vault.read(actionFile)===before&&source.draft.value.text==='Unsent sample draft',
          sourceLeaf:source.messages.value.at(-1).id,
          idle:!copied.isStreaming.value&&!copied.isExecutingTool.value&&!copied.pendingToolCalls.value.length
        }
      } finally {
        if(copied)await actionService.deleteChat(copied.id)
        ${MESSAGE_ACTIONS_CLEANUP}
      }
    })()`)
    expect(result).toEqual({
      differentTab: true,
      differentFile: true,
      title: 'Sample conversation (копия)',
      contents: [
        'Explain how a small garden changes with the seasons.',
        'In spring the garden starts growing. In summer it flowers. Autumn brings seeds, and winter gives the soil time to rest.',
      ],
      sourceUnchanged: true,
      sourceLeaf: 'sample-later',
      idle: true,
    })
  })
})

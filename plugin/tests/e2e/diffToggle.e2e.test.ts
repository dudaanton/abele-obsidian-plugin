import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-diff-toggle')

async function inspect(mode: string, fileCards = false) {
  const result = JSON.parse(
    await evalLong(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const chats = window.__abeleTest.ChatService.getInstance(), active = chats.activeTabId.value
    const layout = app.workspace.getLayout()
    const before = Array.from({length: 40}, (_, i) => 'Sample line ' + (i + 1)).join('\\n')
    const after = before.replace('Sample line 20', 'Sample changed line')
    const presenter = {
      id: 'sample-diff-toggle', reference: {kind:'node-session', nodeId:'sample-node', registrationId:'sample-registration', sessionId:'sample-session', title:'Sample comparison'},
      label:{value:'Sample comparison'}, provider:{value:'claude'}, state:{value:'idle'},
      connection:{state:{value:'connected'},error:{value:''}}, error:{value:''}, isStreaming:{value:false},
      draft:{value:{text:'',attachments:[]}}, queued:{value:[]}, rejected:{value:[]},
      messages:{value:${
        fileCards
          ? `[
        {id:'sample-create',toolName:'node_write',toolDiff:{old:'',new:'export const sample = 1\\n'}},
        {id:'sample-edit',toolName:'node_edit',toolDiff:{old:'export const sample = 1\\n',new:'export const sample = 2\\n'}},
        {id:'sample-vault',toolName:'write',toolDiff:{old:'',new:'export const sample = 1\\n'}}
      ].map(message=>({role:'tool-call',content:'',toolParams:{path:'sample.ts'},toolResult:'Saved',toolStatus:'approved',timestamp:0,...message}))`
          : "[{id:'sample-tool',role:'tool-call',content:'',toolName:'Edit',toolParams:{file_path:'sample.txt'},toolResult:'Edited',toolStatus:'approved',toolDiff:{old:before,new:after},timestamp:0}]"
      }},
      projection:{value:{activeRuns:[],queuedInputs:[],children:{},artifacts:[],unknown:[],prompts:[]}},
      send:async()=>{},answer:async()=>{},cancelInput:async()=>{},interrupt:async()=>{},openResource:()=>{},destroy:()=>{}
    }
    const capture = async state => {
      const path = ${JSON.stringify(shots)} + '/${mode}-' + state + '.png'
      const image = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').writeFileSync(path, image.toPNG())
    }
    try {
      chats.nodeSessions.set(presenter.id,presenter)
      chats.tabOrder.value=[...chats.tabOrder.value,presenter.id]
      chats.activeTabId.value=presenter.id
      await chats.revealSidebar({focus:false})
      let root
      for(let i=0;i<100;i++) {
        root=document.querySelector('.abele-node-chat')
        if(root?.querySelector('.abele-chat-run, .abele-chat-msg')) break
        await wait(50)
      }
      const group = root?.querySelector('.abele-chat-run > .abele-tree-item__self[aria-expanded="false"]')
      if(group) { group.click(); await wait(200) }
      if (${fileCards}) {
        const cards = [...root.querySelectorAll('.abele-chat-msg_tool-call')]
        if(cards.length!==3) throw Error('Expected node create, node edit and vault write cards')
        for (const [index, card] of cards.entries()) {
          if(!card.querySelector('.abele-diff')) throw Error('Shared file diff is missing')
          if(!card.querySelector('.abele-chat-tool-files')) throw Error('File path chip is missing')
          if(card.querySelector('[data-find-part="params"]')) throw Error('Raw parameters replaced the primary file card')
          card.scrollIntoView({block:'center'}); await wait(200)
          await capture(['node-create','node-edit','vault-write'][index])
        }
        return JSON.stringify({cards:cards.length})
      }
      if(!root?.querySelector('.abele-diff')) {
        root?.querySelector('.abele-chat-msg__icon')?.click()
        await wait(200)
      }
      const diff=root.querySelector('.abele-diff')
      if(!diff) throw Error('Sample comparison did not render')
      if (${JSON.stringify(mode)} === 'phone') {
        const header = root.querySelector('.abele-ai-chat__header')
        if (!header.firstElementChild?.matches('.abele-drawer-switch.is-shown'))
          throw Error('Node drawer switch is not first in its phone header')
        const drawer = root.closest('.workspace-drawer')
        if (!drawer) throw Error('Node chat is outside the phone drawer')
        for (const selector of ['.workspace-drawer-header', '.workspace-drawer-tab-options']) {
          const row = drawer.querySelector(selector)
          if (!row || getComputedStyle(row).display !== 'none')
            throw Error('Native phone drawer footer is visible: ' + selector)
        }
      }
      diff.scrollIntoView({block:'start'}); await wait(200)
      const initial=diff.querySelectorAll('.abele-diff__fold').length
      await capture('folded')
      const button=diff.querySelector('button[aria-label="Show all lines"]')
      button.click(); await wait(200)
      const expanded=diff.querySelectorAll('.abele-diff__fold').length
      const pressed=button.getAttribute('aria-pressed')
      const label=button.getAttribute('aria-label')
      await capture('expanded')
      button.click(); await wait(200)
      await capture('collapsed')
      return JSON.stringify({initial,expanded,pressed,label,collapsed:diff.querySelectorAll('.abele-diff__fold').length,unpressed:button.getAttribute('aria-pressed'),same:button===diff.querySelector('button[aria-label="Show all lines"]')})
    } finally {
      chats.nodeSessions.delete(presenter.id)
      chats.tabOrder.value=chats.tabOrder.value.filter(id=>id!==presenter.id)
      chats.activeTabId.value=active
      await app.workspace.changeLayout(layout)
    }
  })()`)
  )
  expect(result).toEqual(
    fileCards
      ? { cards: 3 }
      : {
          initial: 2,
          expanded: 0,
          pressed: 'true',
          label: 'Collapse unchanged lines',
          collapsed: 2,
          unpressed: 'false',
          same: true,
        }
  )
}

it('toggles the same comparison control on desktop and phone layouts', async () => {
  await inspect('desktop')
  await withEmulatedPhone(() => inspect('phone'))
})

it('renders node creates and edits beside the ordinary write card on desktop and phone', async () => {
  await inspect('desktop-files', true)
  await withEmulatedPhone(() => inspect('phone-files', true))
})

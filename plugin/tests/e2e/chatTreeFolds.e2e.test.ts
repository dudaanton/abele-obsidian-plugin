import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const SHOTS = shotDir('chat-tree-folds')

const check = async (label: string) => {
  const result = await evalLong(
    `(async () => {
      const service = window.__abeleTest.ChatService.getInstance()
      const prior = service.activeTabId.value
      const stored = app.loadLocalStorage('abele-chat-tree-folds')
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const until = async fn => { for(let i=0;i<150;i++){if(fn())return fn();await wait(50)}throw Error('Tree fold state did not arrive: '+fn) }
      const ids = [], files = []
      let leaf, owned = false
      const priorWidth = app.workspace.rightSplit.containerEl?.getBoundingClientRect().width
      const priorLeft = app.workspace.leftSplit.collapsed, priorRight = app.workspace.rightSplit.collapsed
      const shot = async name => {
        await wait(250)
        const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
        if(window.__e2eHost) await window.__e2eHost.shot(path)
        else require('fs').writeFileSync(path,(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG())
      }
      try {
        leaf = app.isMobile ? null : app.workspace.getLeavesOfType('abele-ai-sidebar-view').find(item=>item.getRoot()===app.workspace.rightSplit)
        if(!leaf){leaf=app.isMobile?app.workspace.getLeaf('tab'):app.workspace.getRightLeaf(true);owned=true;await leaf.setViewState({type:'abele-ai-sidebar-view',active:true})}
        await app.workspace.revealLeaf(leaf)
        if(app.isMobile){app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()}
        else {app.workspace.rightSplit.expand();app.workspace.rightSplit.setSize(420)}
        const root = leaf.view.containerEl
        const current = () => root.querySelector('.abele-chat-switch__current')
        await until(current)
        const parentId=await service.newTab();ids.push(parentId)
        const parent=service.getSession(parentId)
        parent.chatTitle.value='Sample fold parent'
        await parent.createInDirectory(service.folders.path(''))
        files.push(parent.currentChatFile.value)
        const childId=await service.newTab();ids.push(childId)
        const child=service.getSession(childId)
        child.chatTitle.value='Sample nested conversation'
        child.anchor.value={note:parent.currentChatFile.value.path,message:'sample-fold-message',quote:'Sample passage'}
        await child.createInDirectory(service.folders.path(''))
        files.push(child.currentChatFile.value)
        await service.tree.refresh()
        if(current().getAttribute('aria-expanded')!=='true')current().click()
        const row=()=>root.querySelector('[data-chat="'+parentId+'"] > .tree-item-self')
        await until(row)
        if(row().getAttribute('aria-expanded')==='true')row().querySelector('.collapse-icon').click()
        await until(()=>row().getAttribute('aria-expanded')==='false')
        await shot('before-activity')
        child.appendChatMessage({id:'sample-fold-reply',role:'assistant',content:'Sample reply',timestamp:Date.now()})
        child.updateVisibleMessages()
        child.isStreaming.value=true
        await wait(200)
        if(row().getAttribute('aria-expanded')!=='false')throw Error('Activity expanded parent')
        child.isStreaming.value=false
        await service.tree.refresh()
        await wait(200)
        if(row().getAttribute('aria-expanded')!=='false')throw Error('Refresh expanded parent')
        await shot('after-activity')
        current().click();await wait(100);current().click()
        await until(row)
        if(row().getAttribute('aria-expanded')!=='false')throw Error('Reopening tree expanded parent')
        service.switchTab(childId)
        await until(()=>row().getAttribute('aria-expanded')==='true')
        await shot('explicit-selection')
        row().querySelector('.collapse-icon').click()
        await service.tree.refresh();await wait(100)
        if(row().getAttribute('aria-expanded')!=='false')throw Error('Selection was revealed twice')
        return 'true'
      } finally {
        const parentRow=leaf?.view.containerEl.querySelector('[data-chat="'+ids[0]+'"] > .tree-item-self')
        if(parentRow?.getAttribute('aria-expanded')==='false')parentRow.querySelector('.collapse-icon').click()
        for(const id of ids){const session=service.getSession(id);if(session)session.isStreaming.value=false;await service.closeTab(id)}
        for(const file of files)if(app.vault.getAbstractFileByPath(file.path))await app.vault.delete(file)
        if(leaf?.view.containerEl.querySelector('.abele-chat-switch__current')?.getAttribute('aria-expanded')==='true')leaf.view.containerEl.querySelector('.abele-chat-switch__current').click()
        if(owned)leaf?.detach()
        if(!app.isMobile&&priorWidth)app.workspace.rightSplit.setSize(priorWidth)
        if(app.isMobile){if(!priorLeft)app.workspace.leftSplit.expand();if(!priorRight)app.workspace.rightSplit.expand()}
        app.saveLocalStorage('abele-chat-tree-folds',stored)
        if(prior)service.switchTab(prior)
      }
    })()`,
    60_000
  )
  expect(JSON.parse(result)).toBe(true)
}

describe.skipIf(!isObsidianRunning() || !hasTestApi())('chat tree folds', () => {
  it('keeps a parent collapsed through child activity and reveals an explicit selection once', async () => {
    await check(onPhone() ? 'phone' : 'desktop')
  }, 90_000)
  it.skipIf(onPhone())(
    'preserves folds in the phone layout',
    async () => {
      await withEmulatedPhone(() => check('emulated-phone'))
    },
    120_000
  )
})

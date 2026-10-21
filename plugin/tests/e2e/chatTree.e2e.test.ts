import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const SHOTS = shotDir('chat-tree')

const probe = (label: string) => `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => { for (let i = 0; i < 150; i++) { const value = fn(); if (value) return value; await wait(50) } throw Error('Chat tree did not appear: ' + fn.toString()) }
  const clickAt = el => {
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
  }
  const service = window.__abeleTest.ChatService.getInstance()
  const prior = service.activeTabId.value
  const priorNodes = service.closedNodeChats.value.slice(), priorFolders = {...service.nodeFolders.value}
  const sampleNodeId = 'node:sample-tree-registration:sample-tree-session'
  const folder = 'Synthetic navigation sample'
  const path = service.folders.path(folder)
  if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic folder already exists')
  const created = [], files = []
  let leaf, narrowLeaf, ownsLeaf = false, pictureCount = 0
  const priorWidth = app.workspace.rightSplit.containerEl?.getBoundingClientRect().width
  const shot = async name => {
    pictureCount++
    await wait(250)
    const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
    if (window.__e2eHost) return window.__e2eHost.shot(path)
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG())
  }
  try {
    leaf = app.workspace.getLeavesOfType('abele-ai-sidebar-view').find(item => item.getRoot() === app.workspace.rightSplit)
    if (!leaf) {
      leaf = app.workspace.getRightLeaf(true); ownsLeaf = true
      await leaf.setViewState({ type: 'abele-ai-sidebar-view', active: true })
    }
    await app.workspace.revealLeaf(leaf)
    app.workspace.rightSplit.expand()
    if (!app.isMobile) app.workspace.rightSplit.setSize(420)
    app.workspace.setActiveLeaf(leaf, { focus: false })
    const root = leaf.view.containerEl
    const current = () => root.querySelector('.abele-chat-switch__current')
    await until(current)
    const first = service.newTab(); created.push(first)
    const session = service.getSession(first)
    session.chatTitle.value = 'Sample navigation chat'
    current().click()
    await until(() => document.querySelector('.abele-chat-tree'))
    await shot('single')
    document.querySelector('.abele-chat-tree [aria-label="New folder"]').click()
    await until(() => document.querySelector('input[aria-label="Folder name"]'))
    await shot('new-folder')
    const name = document.querySelector('input[aria-label="Folder name"]')
    name.value = folder; name.dispatchEvent(new Event('input', { bubbles: true }))
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await until(() => app.vault.getAbstractFileByPath(path))
    await service.folders.move(first, folder)
    files.push(session.currentChatFile.value)
    service.closedNodeChats.value = [...priorNodes, {reference:{kind:'node-session',nodeId:'sample-tree-node',registrationId:'sample-tree-registration',sessionId:'sample-tree-session',title:'Sample node conversation'},at:1000}]
    await wait(100)
    document.querySelector('.abele-chat-tree__closed > .tree-item-self').click()
    const nodeMenu=async()=>{
      const nodeRow = await until(()=>document.querySelector('[data-chat="'+sampleNodeId+'"]'))
      const nodeMore = nodeRow.querySelector('[aria-label="Sample node conversation: more"]')
      if(nodeMore)clickAt(nodeMore)
      else nodeRow.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:nodeRow.getBoundingClientRect().left+20,clientY:nodeRow.getBoundingClientRect().top+10}))
      await until(()=>document.querySelector('.menu'))
    }
    await nodeMenu()
    await shot('node-menu')
    ;[...document.querySelectorAll('.menu-item')].find(item=>item.textContent.trim()==='Delete').click()
    const deleteMessage=await until(()=>document.querySelector('.abele-confirm__message'))
    if(!deleteMessage.textContent.includes('Files in its folder stay as they are'))throw Error('Node deletion message does not explain file retention')
    await shot('node-delete-confirm')
    ;[...deleteMessage.closest('.modal').querySelectorAll('button')].find(button=>button.textContent.trim()==='Cancel').click()
    await until(()=>!deleteMessage.isConnected)
    await nodeMenu()
    ;[...document.querySelectorAll('.menu-item')].find(item=>item.textContent.includes('Rename…')).click()
    const renameField=await until(()=>document.querySelector('.abele-prompt__field'))
    await shot('node-rename')
    ;[...renameField.closest('.modal').querySelectorAll('button')].find(button=>button.textContent.trim()==='Cancel').click()
    await until(()=>!renameField.isConnected)
    await nodeMenu()
    const moveNode=[...document.querySelectorAll('.menu-item')].find(item=>item.textContent.includes('Move to…'))
    if(!moveNode)throw Error('Node chat has no Move action')
    moveNode.click()
    await until(()=>document.querySelector('.suggestion-item'))
    await shot('node-move-picker')
    ;[...document.querySelectorAll('.suggestion-item')].find(item=>item.textContent.includes(folder)).click()
    await until(()=>service.nodeFolders.value[sampleNodeId]===folder)
    if(!document.querySelector('[data-chat="'+sampleNodeId+'"]'))document.querySelector('.abele-chat-tree__closed > .tree-item-self').click()
    await until(()=>document.querySelector('[data-chat="'+sampleNodeId+'"]'))
    await shot('node-moved')
    service.closedNodeChats.value=priorNodes.slice();service.nodeFolders.value={...priorFolders}
    await service.folders.setAccess(folder, { web_search: 'auto' })
    const second = service.newTab(); created.push(second)
    const child = service.getSession(second)
    child.chatTitle.value = 'A long sample discussion title that keeps the row within its pane'
    child.anchor.value = { note: session.currentChatFile.value.path, message: 'sample-message', quote: 'Sample passage' }
    await child.createInDirectory(path)
    files.push(child.currentChatFile.value)
    current().click()
    service.switchTab(second)
    if (!app.isMobile) app.workspace.rightSplit.setSize(300)
    await wait(300)
    const discussionTitle = current().querySelector('.abele-chat-switch__title').getBoundingClientRect().width
    await shot('discussion-header')
    if (discussionTitle < 80) throw Error('Discussion title collapsed to ' + discussionTitle + 'px')
    if (!app.isMobile) app.workspace.rightSplit.setSize(420)
    current().click()
    service.switchTab(first)
    await until(() => document.querySelector('[data-chat="' + first + '"] time')?.textContent)
    session.error.value = 'Synthetic failure'
    await shot('nested-error-long')
    if (!app.isMobile) {
      current().click()
      narrowLeaf = app.workspace.getLeaf('split')
      await narrowLeaf.setViewState({ type: 'abele-ai-sidebar-view', active: true })
      const switcher = await until(() => narrowLeaf.view.containerEl.querySelector('.abele-chat-switch__current'))
      switcher.click()
      await shot('narrow-nested-error-long')
      narrowLeaf.detach(); narrowLeaf = null
      app.workspace.setActiveLeaf(leaf, { focus: false })
      current().click()
    }
    session.error.value = null
    session.pendingQuestions.value = { questions: [] }
    await shot('waiting')
    session.pendingQuestions.value = null
    session.isStreaming.value = true
    await shot('working')
    session.isStreaming.value = false
    const third = service.newTab(); created.push(third)
    const archived = service.getSession(third)
    archived.chatTitle.value = 'Sample closed discussion'
    archived.anchor.value = { note: session.currentChatFile.value.path, message: 'sample-message', quote: 'Sample passage' }
    await archived.createInDirectory(path)
    files.push(archived.currentChatFile.value)
    const archivedPath = archived.currentChatFile.value.path
    await service.closeTab(third)
    service.switchTab(first)
    if (document.querySelector('.abele-chat-tree')) current().click()
    current().click()
    await until(() => document.querySelector('[data-chat="' + first + '"] [data-chat="' + archivedPath + '"]'))
    await shot('open-and-closed-children')
    document.querySelector('[data-chat="' + first + '"] > .tree-item-self .collapse-icon').click()
    current().click()
    service.switchTab(second)
    current().click()
    await until(() => document.querySelector('[data-chat="' + second + '"] > .tree-item-self.is-active'))
    await shot('current-nested-chat')
    await service.closeTab(first)
    await until(() => !service.tabOrder.value.includes(first))
    if (!document.querySelector('.abele-chat-tree')) current().click()
    await until(() => document.querySelector('.abele-chat-tree__closed'))
    await shot('closed')
    const search = document.querySelector('.abele-chat-tree input[type="search"]')
    search.value = 'Sample navigation'; search.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => document.querySelector('.abele-chat-tree').textContent.includes('No matches'))
    await shot('no-matches')
    document.querySelector('.abele-chat-tree [aria-label="Search closed chats"]').click()
    await until(() => document.querySelector('.abele-chat-tree__chat_closed'))
    await shot('search-closed')
    document.querySelector('.abele-chat-tree__chat_closed .tree-item-self').click()
    await until(() => service.getSessionByFile(files[0].path))
    const reopened = service.getSessionByFile(files[0].path); created.push(reopened.id)
    if (!document.querySelector('.abele-chat-tree')) current().click()
    await until(() => document.querySelector('.abele-chat-tree__folder'))
    const searchAgain = document.querySelector('.abele-chat-tree input[type="search"]')
    searchAgain.value = ''; searchAgain.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(100)
    clickAt(document.querySelector('.abele-chat-tree__folder [aria-label="' + folder + ': more"]'))
    await until(() => document.querySelector('.menu'))
    await shot('folder-menu')
    ;[...document.querySelectorAll('.menu-item')].find(item => item.textContent.includes('Access…')).click()
    await until(() => document.querySelector('.abele-folder-access'))
    await shot('folder-access')
    const modal = document.querySelector('.abele-folder-access')
    const bounds = modal.getBoundingClientRect()
    const overflow = modal.scrollWidth - modal.clientWidth
    const inherited = reopened.toolModes.value.web_search, ownMode = reopened.ownToolModes.value.web_search
    const dismiss = await until(() => modal.closest('.modal-container').querySelector('.modal-close-button, .modal-header-button'))
    dismiss.click()
    await until(() => !document.querySelector('.abele-folder-access'))
    if (!document.querySelector('.abele-chat-tree')) current().click()
    const row = await until(() => document.querySelector('[data-chat="' + reopened.id + '"]'))
    const more = row.querySelector('[aria-label="Sample navigation chat: more"]')
    if (more) clickAt(more)
    else {
      const r = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
    }
    await until(() => document.querySelector('.menu'))
    ;[...document.querySelectorAll('.menu-item')].find(item => item.textContent.includes('Move to…')).click()
    await until(() => document.querySelector('.prompt-input'))
    await shot('move-to')
    ;[...document.querySelectorAll('.suggestion-item')].find(item => item.textContent.includes('Chats (top)')).click()
    await until(() => files.every(file => file.path.slice(0, file.path.lastIndexOf('/')) === service.folders.root.value))
    // An empty selection queues behind the requested move before fixture files are released.
    await service.folders.moveMany([], '')
    return { closedTogether: !service.tabOrder.value.includes(second), inherited, dropped: reopened.toolModes.value.web_search === ownMode, moved: true, overflow, width: bounds.width, viewport: innerWidth, sidebarWidth: root.getBoundingClientRect().width, pictures: pictureCount }
  } finally {
    service.closedNodeChats.value=priorNodes.slice();service.nodeFolders.value={...priorFolders};service.saveTabs()
    for (const id of created) {
      const session = service.getSession(id)
      if (session) { session.isStreaming.value = false; session.pendingQuestions.value = null; await service.closeTab(id) }
    }
    for (const file of files) if (file && app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file)
    const directory = app.vault.getAbstractFileByPath(path)
    if (directory) await app.vault.delete(directory, true)
    narrowLeaf?.detach()
    if (leaf?.view.containerEl.querySelector('.abele-chat-switch__current')?.getAttribute('aria-expanded') === 'true') leaf.view.containerEl.querySelector('.abele-chat-switch__current').click()
    if (ownsLeaf) leaf?.detach()
    if (!app.isMobile && priorWidth) app.workspace.rightSplit.setSize(priorWidth)
    if (prior) service.switchTab(prior)
  }
})()`

describe.skipIf(!isObsidianRunning() || !hasTestApi())('chat tree navigation', () => {
  it('shows folders, nested and closed chats, search and additive access', async () => {
    const result = JSON.parse(await evalLong(probe(onPhone() ? 'phone' : 'desktop'), 120_000))
    expect(result.closedTogether).toBe(true)
    expect(result.inherited).toBe('auto')
    expect(result.dropped).toBe(true)
    expect(result.moved).toBe(true)
    expect(result.overflow).toBeLessThanOrEqual(1)
    expect(result.width).toBeLessThanOrEqual(result.viewport)
    expect(result.pictures).toBe(onPhone() ? 19 : 20)
    if (!onPhone()) {
      expect(result.sidebarWidth).toBeGreaterThanOrEqual(340)
      expect(result.sidebarWidth).toBeLessThanOrEqual(422)
    }
  }, 180_000)

  it.skipIf(onPhone())(
    'fits the same states at 390 by 844',
    async () => {
      const result = await withEmulatedPhone(async () =>
        JSON.parse(await evalLong(probe('emulated-phone'), 120_000))
      )
      expect(result.overflow).toBeLessThanOrEqual(1)
      expect(result.width).toBeLessThanOrEqual(390)
    },
    180_000
  )
})

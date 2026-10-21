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
  const priorNodes = service.closedNodeChats.value.slice()
  const sampleNodeId = 'node:sample-tree-registration:sample-tree-session'
  const folder = 'Synthetic navigation sample'
  const path = service.folders.path('') + '/2099-02'
  if (service.folders.paths.includes(folder)) throw Error('Synthetic folder already exists')
  if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic storage directory already exists')
  await app.vault.createFolder(path)
  const markerContent = '{"fetch_url":"auto"}'
  const marker = await app.vault.create(path + '/_folder.abeleaccess', markerContent)
  await service.folders.reload()
  if (service.folders.paths.includes('2099-02')) throw Error('Disk folder became a logical folder')
  const created = [], files = []
  let leaf, narrowLeaf, ownsLeaf = false, pictureCount = 0
  const priorWidth = app.workspace.rightSplit.containerEl?.getBoundingClientRect().width
  const priorRightCollapsed = app.workspace.rightSplit.collapsed
  const priorLeftCollapsed = app.workspace.leftSplit.collapsed
  const shot = async name => {
    pictureCount++
    await wait(250)
    const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
    if (window.__e2eHost) return window.__e2eHost.shot(path)
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG())
  }
  try {
    leaf = app.isMobile ? null : app.workspace.getLeavesOfType('abele-ai-sidebar-view').find(item => item.getRoot() === app.workspace.rightSplit)
    if (!leaf) {
      leaf = app.isMobile ? app.workspace.getLeaf('tab') : app.workspace.getRightLeaf(true); ownsLeaf = true
      await leaf.setViewState({ type: 'abele-ai-sidebar-view', active: true })
    }
    await app.workspace.revealLeaf(leaf)
    if (app.isMobile) {
      app.workspace.leftSplit.collapse()
      app.workspace.rightSplit.collapse()
    } else app.workspace.rightSplit.expand()
    if (!app.isMobile) app.workspace.rightSplit.setSize(420)
    app.workspace.setActiveLeaf(leaf, { focus: false })
    const root = leaf.view.containerEl
    const current = () => root.querySelector('.abele-chat-switch__current')
    await until(current)
    if (app.isMobile) {
      await wait(400)
      const chat = root.querySelector('.abele-ai-chat').getBoundingClientRect()
      const content = root.querySelector('.view-content').getBoundingClientRect()
      if (Math.abs(chat.left - content.left) > 1 || Math.abs(chat.width - content.width) > 1) throw Error('Chat shifted inside its native content box')
      if (Math.abs(chat.left) > 1 || Math.abs(chat.width - innerWidth) > 1) throw Error('Full-width phone chat leaves a drawer gutter')
      if (root.querySelector('.abele-ai-chat__header .abele-drawer-switch')) throw Error('Phone header still has a duplicate drawer selector')
    }
    const first = service.newTab(); created.push(first)
    const session = service.getSession(first)
    session.chatTitle.value = 'Sample navigation chat'
    await wait(100)
    if (root.querySelector('.abele-chat-parent-back, .abele-comment-trail')) throw Error('Top-level chat has parent navigation')
    await shot('top-level-header')
    current().click()
    await until(() => document.querySelector('.abele-chat-tree'))
    await shot('single')
    document.querySelector('.abele-chat-tree [aria-label="New folder"]').click()
    await until(() => document.querySelector('input[aria-label="Folder name"]'))
    await shot('new-folder')
    const name = document.querySelector('input[aria-label="Folder name"]')
    name.value = folder; name.dispatchEvent(new Event('input', { bubbles: true }))
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await until(() => service.folders.paths.includes(folder))
    await service.folders.setNodeScope(folder, [{ kind: 'node', node_id: 'sample-folder-node', access: 'read' }])
    await session.createInDirectory(path)
    await service.folders.move(first, folder)
    if (session.inheritedNodeScopes[0]?.entries[0]?.node_id !== 'sample-folder-node') throw Error('Folder node access was not inherited')
    if (session.getToolMode('node_command_run') !== 'off' || session.getToolMode('node_delegate') !== 'off') throw Error('Folder file scope enabled command or delegation tools')
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
    await until(()=>service.folders.folderOf(sampleNodeId)===folder)
    if(!document.querySelector('[data-chat="'+sampleNodeId+'"]'))document.querySelector('.abele-chat-tree__closed > .tree-item-self').click()
    await until(()=>document.querySelector('[data-chat="'+sampleNodeId+'"]'))
    await shot('node-moved')
    service.closedNodeChats.value=priorNodes.slice();await service.folders.forgetNode(sampleNodeId)
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
    if (app.isMobile) {
      const openRow = document.querySelector('[data-chat="' + second + '"] > .tree-item-self')
      const closedRow = document.querySelector('[data-chat="' + archivedPath + '"] > .tree-item-self')
      const slot = closedRow.querySelector('.abele-chat-tree__close-slot')
      const close = openRow.querySelector('[aria-label="Close"]')
      if (!slot || Math.abs(slot.getBoundingClientRect().width - close.getBoundingClientRect().width) > 1) throw Error('Closed row does not reserve the close box')
      if (Math.abs(openRow.querySelector('time').getBoundingClientRect().right - closedRow.querySelector('time').getBoundingClientRect().right) > 1) throw Error('Nested timestamps are not aligned')
    }
    await shot('open-and-closed-children')
    document.querySelector('[data-chat="' + first + '"] > .tree-item-self .collapse-icon').click()
    current().click()
    service.switchTab(second)
    current().click()
    await until(() => document.querySelector('[data-chat="' + second + '"] > .tree-item-self.is-active'))
    await shot('current-nested-chat')
    current().click()
    const back = await until(() => root.querySelector('.abele-chat-parent-back'))
    if (!back.classList.contains('clickable-icon') || back.getAttribute('aria-label') !== 'Back to Sample navigation chat') throw Error('Parent Back button missing its title or kit style')
    if (!back.nextElementSibling?.classList.contains('abele-chat-switch')) throw Error('Back is not before the chooser')
    const box = back.getBoundingClientRect(), ink = back.querySelector('svg').getBoundingClientRect()
    if (box.height <= ink.height || parseFloat(getComputedStyle(back).paddingLeft) <= 0) throw Error('Back lost its native box')
    if (app.isMobile && (box.width < 44 || box.height < 44)) throw Error('Back is too small for touch')
    if (root.querySelector('.abele-breadcrumbs')) throw Error('Nested chat still has breadcrumbs')
    if (root.querySelector('.abele-chat-switch__where')) throw Error('Nested chat still shows its folder in the header')
    if (!current().getAttribute('aria-label').includes(folder)) throw Error('Nested chat lost the folder in its tooltip')
    await shot('nested-header-short-parent')
    root.querySelector('.abele-chat-input__scope').click()
    const nodeEditor = await until(() => document.querySelector('.abele-chat-setup .abele-node-scope-editor'))
    await until(() => nodeEditor.textContent.includes('From the folder ' + folder))
    const inheritedEntry = [...nodeEditor.querySelectorAll('.abele-scope-mgr__entry')].find(row => row.textContent.includes('From the folder ' + folder))
    if (!inheritedEntry || inheritedEntry.querySelector('.abele-scope-mgr__entry-remove')) throw Error('Inherited node scope is missing its source or can be removed as an own chip')
    await shot('chat-inherited-node-access')
    nodeEditor.closest('.modal-container').querySelector('.modal-close-button, .modal-header-button').click()
    await until(() => !document.querySelector('.abele-chat-setup'))
    const longParent = 'A long sample parent title that must stay entirely in the tooltip'
    session.chatTitle.value = longParent
    service.switchTab(first); await wait(50); service.switchTab(second)
    await until(() => root.querySelector('.abele-chat-parent-back')?.getAttribute('aria-label') === 'Back to ' + longParent)
    if (root.querySelector('.abele-ai-chat__header').textContent.includes(longParent)) throw Error('Parent title leaked into the header')
    await shot('nested-header-long-parent')
    session.chatTitle.value = 'Sample navigation chat'
    root.querySelector('.abele-chat-parent-back').click()
    await until(() => service.activeTabId.value === first)
    if (app.workspace.activeLeaf !== leaf) throw Error('Back changed the current pane')
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
    await until(() => ![...document.querySelectorAll('.notice')].some(notice => notice.textContent.includes('That message is no longer in this chat')))
    const nodeHeading = document.querySelector('.abele-folder-access .abele-node-scope-editor .abele-section__header').getBoundingClientRect()
    const folderBody = document.querySelector('.abele-folder-access .abele-modal__body').getBoundingClientRect()
    if (nodeHeading.top < folderBody.top - 1 || nodeHeading.bottom > folderBody.bottom + 1) throw Error('Folder access opened scrolled past node access')
    await shot('folder-access')
    const modal = document.querySelector('.abele-folder-access')
    if (!modal.querySelector('.abele-node-scope-editor')?.textContent.includes('sample-folder-node')) throw Error('Folder dialog did not show stored node scope')
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
    await until(() => files.every(file => !service.folders.folderOf(file.path)))
    if (!files.every(file => file.path.startsWith(path + '/'))) throw Error('Tree action moved a transcript')
    if (await app.vault.read(marker) !== markerContent) throw Error('Tree action changed a disk folder access file')
    // An empty selection queues behind the requested move before fixture files are released.
    await service.folders.moveMany([], '')
    for (const destination of ['', folder]) {
      await service.folders.move(reopened.id, destination)
      service.switchTab(reopened.id)
      await wait(100)
      if (current().getAttribute('aria-expanded') === 'true') current().click()
      const previous = service.getSession(reopened.id)
      root.querySelector('[aria-label="Start a new chat"]').click()
      await until(() => service.activeTabId.value !== reopened.id)
      created.push(service.activeTabId.value)
      if (service.getSession(reopened.id) !== previous || !service.tabOrder.value.includes(reopened.id)) throw Error('New chat closed its predecessor')
      if ((service.folders.folderOf(reopened.id) || '') !== destination) throw Error('New chat moved its predecessor')
      await shot(destination ? 'new-chat-preserves-folder' : 'new-chat-preserves-top')
    }
    service.switchTab(reopened.id)
    reopened.handleAgentEvent({type:'stream_event',event:{type:'error',error:'HTTP 503: {"error":"Sample unavailable service"}'}})
    reopened.retrying.value = { attempt: 1, of: 2, secondsLeft: 3 }
    await until(() => root.querySelector('[role="alert"]')?.textContent.includes('The model provider is temporarily unavailable'))
    if (root.querySelector('[role="alert"]').textContent.includes('Sample unavailable service')) throw Error('Raw provider response is visible')
    await shot('provider-unavailable-retrying')
    reopened.error.value = null; reopened.errorPresentation.value = null; reopened.retrying.value = null
    return { closedTogether: !service.tabOrder.value.includes(second), inherited, dropped: reopened.toolModes.value.web_search === ownMode, moved: true, overflow, width: bounds.width, viewport: innerWidth, sidebarWidth: root.getBoundingClientRect().width, pictures: pictureCount }
  } finally {
    service.closedNodeChats.value=priorNodes.slice();service.saveTabs();await service.folders.forgetNode(sampleNodeId)
    for (const id of created) {
      const session = service.getSession(id)
      if (session) { session.isStreaming.value = false; session.pendingQuestions.value = null; await service.closeTab(id) }
    }
    for (const file of files) if (file && app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file)
    await service.folders.remove(folder)
    const directory = app.vault.getAbstractFileByPath(path)
    if (directory) await app.vault.delete(directory, true)
    narrowLeaf?.detach()
    if (leaf?.view.containerEl.querySelector('.abele-chat-switch__current')?.getAttribute('aria-expanded') === 'true') leaf.view.containerEl.querySelector('.abele-chat-switch__current').click()
    if (ownsLeaf) leaf?.detach()
    if (!app.isMobile && priorWidth) app.workspace.rightSplit.setSize(priorWidth)
    if (app.isMobile) {
      if (!priorRightCollapsed) app.workspace.rightSplit.expand()
      if (!priorLeftCollapsed) app.workspace.leftSplit.expand()
    }
    if (prior) service.switchTab(prior)
  }
})()`

describe.skipIf(!isObsidianRunning() || !hasTestApi())('chat tree navigation', () => {
  it.skipIf(onPhone())(
    'keeps the node in the switcher on desktop and at 390 by 844',
    async () => {
      const header = (label: string) => `(async () => {
      const priorWidth = app.workspace.rightSplit.containerEl?.getBoundingClientRect().width;
      try {
        await window.__abeleTest.openNodeSessionFixture('empty');
        if (!app.isMobile) app.workspace.rightSplit.setSize(600);
        await new Promise(resolve => setTimeout(resolve, 500));
        const root = document.querySelector('.abele-node-chat');
        const current = root.querySelector('.abele-chat-switch__current');
        if (!current?.getAttribute('aria-label')?.startsWith('Sample node / ')) throw Error('Node missing from switcher');
        if (root.querySelector('.abele-node-chat__node')) throw Error('Separate node label remains');
        const where = current.querySelector('.abele-chat-switch__where');
        if (!app.isMobile && (!where || !where.getClientRects().length)) throw Error('Node location hidden in a wide header');
        const bounds = current.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.right > innerWidth + 1) throw Error('Node header is clipped');
        const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-node-header.png';
        if (window.__e2eHost) await window.__e2eHost.shot(path);
        else {
          const image = await require('@electron/remote').getCurrentWebContents().capturePage();
          require('fs').writeFileSync(path, image.toPNG());
        }
        return JSON.stringify(true);
      } finally {
        await window.__abeleTest.closeNodeSessionFixture();
        if (!app.isMobile && priorWidth) app.workspace.rightSplit.setSize(priorWidth);
      }
    })()`
      expect(JSON.parse(await evalLong(header('desktop'), 30_000))).toBe(true)
      await withEmulatedPhone(async () => {
        expect(JSON.parse(await evalLong(header('emulated-phone'), 30_000))).toBe(true)
      })
    },
    90_000
  )

  it('shows folders, nested and closed chats, search and additive access', async () => {
    const result = JSON.parse(await evalLong(probe(onPhone() ? 'phone' : 'desktop'), 120_000))
    expect(result.closedTogether).toBe(true)
    expect(result.inherited).toBe('auto')
    expect(result.dropped).toBe(true)
    expect(result.moved).toBe(true)
    expect(result.overflow).toBeLessThanOrEqual(1)
    expect(result.width).toBeLessThanOrEqual(result.viewport)
    expect(result.pictures).toBe(onPhone() ? 26 : 27)
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

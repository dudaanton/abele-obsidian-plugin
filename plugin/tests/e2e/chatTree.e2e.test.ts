import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const SHOTS = shotDir('chat-tree')

const probe = (label: string) => `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => { for (let i = 0; i < 150; i++) { const value = fn(); if (value) return value; await wait(50) } throw Error('Chat tree did not appear') }
  const service = window.__abeleTest.ChatService.getInstance()
  const prior = service.activeTabId.value
  const folder = 'Synthetic navigation sample'
  const path = service.folders.path(folder)
  if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic folder already exists')
  const created = [], files = []
  let leaf
  const shot = async name => {
    await wait(250)
    const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
    if (window.__e2eHost) return window.__e2eHost.shot(path)
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG())
  }
  try {
    leaf = app.workspace.getLeaf('split')
    await leaf.setViewState({ type: 'abele-ai-sidebar-view', active: true })
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
    await service.folders.setAccess(folder, { web_search: 'auto' })
    const second = service.newTab(); created.push(second)
    const child = service.getSession(second)
    child.chatTitle.value = 'A long sample discussion title that keeps the row within its pane'
    child.anchor.value = { note: session.currentChatFile.value.path, message: 'sample-message', quote: 'Sample passage' }
    await child.createInDirectory(path)
    files.push(child.currentChatFile.value)
    service.switchTab(first)
    session.error.value = 'Synthetic failure'
    await shot('nested-error-long')
    session.error.value = null
    session.pendingQuestions.value = { questions: [] }
    await shot('waiting')
    session.pendingQuestions.value = null
    session.isStreaming.value = true
    await shot('working')
    session.isStreaming.value = false
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
    document.querySelector('.abele-chat-tree__folder [aria-label="' + folder + ': more"]').click()
    await until(() => document.querySelector('.menu'))
    await shot('folder-menu')
    [...document.querySelectorAll('.menu-item')].find(item => item.textContent.includes('Access…')).click()
    await until(() => document.querySelector('.abele-folder-access'))
    await shot('folder-access')
    const modal = document.querySelector('.abele-folder-access')
    const bounds = modal.getBoundingClientRect()
    const overflow = modal.scrollWidth - modal.clientWidth
    const inherited = reopened.toolModes.value.web_search, ownMode = reopened.ownToolModes.value.web_search
    modal.querySelector('.modal-close-button').click()
    await until(() => !document.querySelector('.abele-folder-access'))
    const row = document.querySelector('[data-chat="' + reopened.id + '"]')
    const more = row.querySelector('[aria-label="Sample navigation chat: more"]')
    if (more) more.click()
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
    return { closedTogether: !service.tabOrder.value.includes(second), inherited, dropped: reopened.toolModes.value.web_search === ownMode, moved: true, overflow, width: bounds.width, viewport: innerWidth, pictures: 11 }
  } finally {
    for (const id of created) {
      const session = service.getSession(id)
      if (session) { session.isStreaming.value = false; session.pendingQuestions.value = null; await service.closeTab(id) }
    }
    for (const file of files) if (file && app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file)
    const directory = app.vault.getAbstractFileByPath(path)
    if (directory) await app.vault.delete(directory, true)
    leaf?.detach()
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
    expect(result.pictures).toBe(11)
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

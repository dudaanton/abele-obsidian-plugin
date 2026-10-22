import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'
import { withEmulatedPhone } from './helpers/emulatedPhone'

targets('desktop', 'phone')
const shots = shotDir('chat-tree-visibility')

describe.runIf(isObsidianRunning() && hasTestApi())('chat tree visibility', () => {
  it('orders new chats, hides folders and restores them on reopen', async () => {
    const run = async (label: string) => {
      const result = await evalLong(
        `(async () => {
      const service = window.__abeleTest.ChatService.getInstance()
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const until = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await wait(50) } throw Error('Visibility state did not appear: ' + fn) }
      const folder = 'Synthetic visibility collection'
      if (service.folders.paths.includes(folder)) throw Error('Fixture folder already exists')
      const prior = service.activeTabId.value
      const ids = [], files = []
      let leaf, ownsLeaf = false
      const shot = async name => {
        await wait(250)
        const path = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
        if (window.__e2eHost) return window.__e2eHost.shot(path)
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(path, image.toPNG())
      }
      const openTree = async () => {
        if (!document.querySelector('.abele-chat-tree')) leaf.view.containerEl.querySelector('.abele-chat-switch__current').click()
        await until(() => document.querySelector('.abele-chat-tree'))
      }
      const menu = async () => {
        const row = document.querySelector('[data-path="' + folder + '"]')
        const button = row.querySelector('[aria-label="' + folder + ': more"]')
        const bounds = button.getBoundingClientRect()
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }))
        await until(() => document.querySelector('.menu'))
      }
      const action = text => {
        const item = [...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === text)
        if (!item) throw Error('Missing folder action: ' + text)
        item.click()
      }
      const make = async title => {
        const id = await service.newTab(); ids.push(id)
        const session = service.getSession(id)
        session.chatTitle.value = title
        await session.createInDirectory(service.folders.path(''))
        files.push(session.currentChatFile.value)
        return id
      }
      try {
        leaf = app.isMobile ? null : app.workspace.getLeavesOfType('abele-ai-sidebar-view')[0]
        if (!leaf) {
          leaf = app.isMobile ? app.workspace.getLeaf('tab') : app.workspace.getRightLeaf(true)
          ownsLeaf = true
          await leaf.setViewState({ type: 'abele-ai-sidebar-view', active: true })
        }
        await app.workspace.revealLeaf(leaf)
        if (!app.isMobile) app.workspace.rightSplit.expand()
        await until(() => leaf.view.containerEl.querySelector('.abele-chat-switch__current'))
        await service.folders.create('', folder)
        const filed = await make('Sample filed chat')
        await service.folders.move(filed, folder)
        const fresh = await make('Sample newest chat')
        await service.tree.refresh()
        await openTree()
        await until(() => document.querySelector('[data-path="' + folder + '"]'))
        const first = document.querySelector('.abele-chat-tree__list > .tree-item')
        if (first.dataset.chat !== fresh) throw Error('New chat is below folders')
        await shot('new-chat-on-top')
        await menu()
        await shot('menu-open-chats')
        action('Hide folder and close its chats')
        await until(() => !document.querySelector('[data-path="' + folder + '"]'))
        if (service.getSession(filed)) throw Error('Hidden chat still open')
        await shot('hidden')
        document.querySelector('.abele-chat-tree__head [aria-label="Search closed chats"]').click()
        await until(() => document.querySelector('.abele-chat-tree__folder_hidden'))
        await shot('archive-hidden-folder')
        await menu()
        action('Show folder')
        await until(() => !service.folders.isHidden(folder))
        await menu()
        await shot('menu-closed-chats')
        action('Hide folder')
        await until(() => service.folders.isHidden(folder))
        await service.openChatFile(files[0])
        await openTree()
        await until(() => !service.folders.isHidden(folder) && document.querySelector('[data-path="' + folder + '"]'))
        if (!service.tree.root.value.some(entry => entry.kind === 'folder' && entry.path === folder && entry.children.some(chat => chat.kind === 'chat' && chat.open))) throw Error('Reopened chat left its folder')
        await shot('reopened-in-folder')
        return JSON.stringify(true)
      } finally {
        document.querySelector('.menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        for (const file of files) {
          const session = service.getSessionByFile(file.path)
          if (session) await service.closeTab(session.id)
        }
        for (const id of ids) if (service.getSession(id)) await service.closeTab(id)
        if (service.folders.paths.includes(folder)) await service.folders.remove(folder)
        for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file)
        if (prior && service.tabOrder.value.includes(prior)) service.switchTab(prior)
        if (ownsLeaf) leaf?.detach()
      }
    })()`,
        120_000
      )
      expect(JSON.parse(result)).toBe(true)
    }
    await run(onPhone() ? 'phone' : 'desktop')
    if (!onPhone()) await withEmulatedPhone(() => run('emulated-phone'))
  }, 300_000)
})

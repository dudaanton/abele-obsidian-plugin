import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { modalMotion } from './helpers/modalMotion'

targets('desktop', 'phone')
const shots = shotDir('chat-tree-visibility')

describe.runIf(isObsidianRunning() && hasTestApi())('chat tree visibility', () => {
  it('orders new chats, hides folders and restores them on reopen', async () => {
    const run = async (label: string) => {
      const result = await evalLong(
        `(async () => {
      ${modalMotion}
      const service = window.__abeleTest.ChatService.getInstance()
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const until = async (fn, phase = 'Visibility') => { for (let i = 0; i < 150; i++) { if (fn()) return; await wait(50) } throw Error(phase + ' state did not appear: ' + fn) }
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
        const modal = document.querySelector('.abele-chat-tree').closest('.modal')
        if (modal) await modalReady(modal)
      }
      const menu = async () => {
        await until(() => !document.querySelector('.menu'))
        const row = document.querySelector('[data-path="' + folder + '"]')
        const button = row.querySelector('[aria-label="' + folder + ': more"]')
        const bounds = button.getBoundingClientRect()
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }))
        await until(() => document.querySelector('.menu'))
        const labels = [...document.querySelectorAll('.menu-item')].map(item => item.textContent.trim()).filter(Boolean)
        const visibility = labels.find(label => label === 'Hide folder' || label === 'Hide folder and close its chats')
        const expected = service.folders.isHidden(folder)
          ? ['Show folder', 'New chat', 'New folder', 'Access…', 'Rename…', 'Delete']
          : ['New chat', 'New folder', 'Access…', 'Rename…', visibility, 'Delete']
        if (JSON.stringify(labels) !== JSON.stringify(expected)) throw Error('Folder menu order: ' + JSON.stringify(labels))
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
        const filed = await make('Sample filed chat with a long title that needs room in a narrow list')
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
        const originalThemes = ['theme-light', 'theme-dark'].filter(name => document.body.classList.contains(name))
        try {
          for (const theme of ['theme-light', 'theme-dark']) {
            document.body.classList.remove('theme-light', 'theme-dark')
            document.body.classList.add(theme)
            await shot('reopened-in-folder-' + theme)
          }
          if (app.isMobile) {
            const tree = document.querySelector('.abele-chat-tree')
            if (tree.querySelector('.abele-chat-tree__close-slot, [aria-label="Close"], [aria-label^="New chat in "]')) throw Error('Phone tree retains extra row actions')
            for (const text of tree.querySelectorAll('.abele-tree-item__text:not([contenteditable])')) {
              const css = getComputedStyle(text)
              if (css.whiteSpace !== 'nowrap' || css.textOverflow !== 'ellipsis' || css.overflow !== 'hidden') throw Error('Phone tree names must be single-line with ellipsis')
            }
          }
        } finally {
          document.body.classList.remove('theme-light', 'theme-dark')
          document.body.classList.add(...originalThemes)
        }
        const reopened = service.getSessionByFile(files[0].path)
        const chatRow = () => document.querySelector('[data-chat="' + reopened.id + '"] > .tree-item-self')
        const eventAt = (element, type) => {
          const bounds = element.getBoundingClientRect()
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }))
        }
        eventAt(chatRow(), 'contextmenu')
        await until(() => document.querySelector('.menu'))
        action('Rename…')
        await until(() => document.querySelector('[data-chat="' + reopened.id + '"] [contenteditable]'), 'Row-menu rename')
        const editor = () => document.querySelector('[data-chat="' + reopened.id + '"] [contenteditable]')
        if (document.getSelection().toString() !== reopened.chatTitle.value) throw Error('Rename did not select the whole name')
        if (chatRow().querySelector('time, .tree-item-flair-outer')) throw Error('Rename kept row codes or actions')
        await shot('row-rename')
        editor().textContent = 'Manually chosen sample'
        editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        try {
          await until(() => reopened.chatTitle.value === 'Manually chosen sample' && !editor())
        } catch (error) {
          throw Error(error.message + ' ' + JSON.stringify({
            title: reopened.chatTitle.value, destroyed: reopened.isDestroyed,
            active: service.activeTabId.value, renamed: service.tree.renaming.value,
            editor: editor()?.textContent, file: files[0].path,
            current: service.getSessionByFile(files[0].path)?.chatTitle.value,
          }))
        }
        await until(() => files[0].basename === 'Manually chosen sample')
        if (!reopened.manualTitle.value) throw Error('Manual title is not protected')
        const scopeIds = new Map()
        const scopeId = scope => {
          if (!scope) return null
          if (!scopeIds.has(scope)) scopeIds.set(scope, scopeIds.size + 1)
          return scopeIds.get(scope)
        }
        const scopeState = () => {
          const win = chatRow()?.ownerDocument.defaultView ?? window
          const stack = app.keymap.getWindowStack?.(win)
          const describe = scope => scope && ({
            id: scopeId(scope), parent: scopeId(scope.parent),
            keys: scope.keys?.map(binding => ({ key: binding.key, modifiers: binding.modifiers })),
            container: scope.tabFocusContainerEl?.className,
          })
          return { current: describe(stack?.scope), previous: stack?.prevScopes?.map(describe), focus: document.activeElement?.outerHTML }
        }
        const scopeBeforeFocus = scopeState()
        // A keyboard shortcut belongs to the row the user has focused.
        chatRow().focus()
        const scopeBeforeF2 = scopeState()
        chatRow().dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
        try { await until(editor, 'Keyboard rename after commit') } catch (error) {
          throw Error(error.message + ' ' + JSON.stringify({
            renaming: service.tree.renaming.value,
            scopeBeforeFocus, scopeBeforeF2, scopeAfterF2: scopeState(),
            row: chatRow()?.outerHTML,
            focus: document.activeElement?.outerHTML,
            menus: [...document.querySelectorAll('.menu')].map(el => ({ style: el.getAttribute('style'), display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility })),
            sheets: [...document.querySelectorAll('.modal')].map(el => ({ style: el.getAttribute('style'), rect: el.getBoundingClientRect().toJSON() })),
          }))
        }
        editor().textContent = 'Discarded sample'
        editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await until(() => !editor())
        if (reopened.chatTitle.value !== 'Manually chosen sample') throw Error('Escape renamed the chat ' + JSON.stringify({
          title: reopened.chatTitle.value, renaming: service.tree.renaming.value,
          scopeBeforeFocus, scopeBeforeF2, scopeAfterEscape: scopeState(),
        }))
        if (!document.querySelector('.abele-chat-tree')) throw Error('Escape closed the tree instead of cancelling the edit')
        const oldContainer = document.querySelector('.abele-chat-tree').closest('.modal-container')
        document.querySelector('.abele-chat-tree').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await until(() => !document.querySelector('.abele-chat-tree'))
        await modalDetached(oldContainer)
        const more = leaf.view.containerEl.querySelector('.abele-ai-chat__overflow [aria-haspopup="menu"]')
        eventAt(more, 'click')
        await until(() => document.querySelector('.menu'))
        action('Rename…')
        try { await until(editor) } catch (error) {
          throw Error('Header rename: ' + error.message + ' ' + JSON.stringify({
            active: service.activeTabId.value, expected: reopened.id,
            renaming: service.tree.renaming.value,
            tree: !!document.querySelector('.abele-chat-tree'),
            menus: [...document.querySelectorAll('.menu')].map(el => ({ style: el.getAttribute('style'), text: el.textContent.slice(0, 200) })),
            sheets: [...document.querySelectorAll('.modal')].map(el => ({ style: el.getAttribute('style'), rect: el.getBoundingClientRect().toJSON() })),
          }))
        }
        if (document.querySelector('.abele-prompt__field')) throw Error('Header opened a second rename editor')
        if (document.getSelection().toString() !== 'Manually chosen sample') throw Error('Header rename did not select the name')
        await shot('header-rename-in-tree')
        editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await until(() => !editor())
        await menu()
        action('Rename…')
        await until(() => document.querySelector('[data-path="' + folder + '"] [contenteditable]'))
        const folderEditor = document.querySelector('[data-path="' + folder + '"] [contenteditable]')
        await shot('folder-rename')
        folderEditor.textContent = '   '
        folderEditor.dispatchEvent(new FocusEvent('blur'))
        await until(() => !document.querySelector('[data-path="' + folder + '"] [contenteditable]'))
        if (!service.folders.paths.includes(folder)) throw Error('Empty rename removed the folder name')
        return JSON.stringify({ passed: true, scopeBeforeFocus, scopeBeforeF2 })
      } finally {
        service.tree.cancelRename()
        document.querySelector('.abele-chat-tree')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
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
      const { passed, scopeBeforeFocus, scopeBeforeF2 } = JSON.parse(result)
      console.log('Chat tree keyboard scopes:', { scopeBeforeFocus, scopeBeforeF2 })
      expect(passed).toBe(true)
    }
    await run(onPhone() ? 'phone' : 'desktop')
    if (!onPhone()) await withEmulatedPhone(() => run('emulated-phone'))
  }, 300_000)
})

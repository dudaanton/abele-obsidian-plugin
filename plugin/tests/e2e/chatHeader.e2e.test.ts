import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop')
const SHOTS = shotDir('chat-header')
describe.skipIf(!isObsidianRunning() || !hasTestApi())('chat below native pane chrome', () => {
  it('keeps the toolbar and first message below the visible native phone header after reopening', async () => {
    const result = await withEmulatedPhone(async () =>
      JSON.parse(
        await evalLong(
          `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async fn => { for (let i = 0; i < 160; i++) { const v = fn(); if (v) return v; await wait(50) } throw Error('Chat did not appear') }
      const chats = window.__abeleTest.ChatService.getInstance()
      const prior = chats.activeTabId.value, previousLeaf = app.workspace.activeLeaf
      const layout = app.workspace.getLayout()
      let tab = chats.createTab(), session = chats.getSession(tab), chatFile, leaf
      const directory = 'Sample chat header probe'
      let ownsDirectory = false
      const measure = async name => {
        await wait(350)
        const root = leaf.view.containerEl
        const box = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { top: r.top, bottom: r.bottom, height: r.height, position: s.position, paddingTop: s.paddingTop } }
        const native = root.querySelector('.view-header')
        const toolbar = root.querySelector('.abele-ai-chat__header')
        const first = root.querySelector('.abele-chat-msg_user')
        const content = root.querySelector('.view-content')
        const picture = root.querySelector('.abele-chat-msg__image-preview')
        await picture.decode()
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(${JSON.stringify(SHOTS + '/')} + name + '.png', image.toPNG())
        return { native: box(native), toolbar: box(toolbar), first: box(first), content: box(content), chat: box(root.querySelector('.abele-ai-chat')), pixels: picture.naturalWidth, viewport: innerHeight }
      }
      try {
        if (app.vault.getAbstractFileByPath(directory)) throw Error('Synthetic directory already exists')
        await app.vault.createFolder(directory); ownsDirectory = true
        leaf = app.workspace.getLeaf('split')
        await leaf.setViewState({ type: 'abele-ai-sidebar-view', active: true })
        app.workspace.setActiveLeaf(leaf, { focus: false })
        await until(() => leaf.view.containerEl.querySelector('.abele-chat-input'))
        const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64
        canvas.getContext('2d').fillRect(0, 0, 96, 64)
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
        const file = await app.vault.createBinary(directory + '/sample.png', await blob.arrayBuffer())
        await session.addUserNote('Create a synthetic picture')
        session.appendChatMessage({ id: 'sample-header-image', role: 'tool-call', content: '', timestamp: 1, toolName: 'generate_image', toolStatus: 'approved', toolResult: 'Image saved: ' + file.path, toolImagePath: file.path })
        session.updateVisibleMessages()
        await until(() => leaf.view.containerEl.querySelector('.abele-chat-msg__image-preview'))
        const immediate = await measure('phone-immediate')
        await session.save(); chatFile = session.currentChatFile.value
        await chats.closeTab(tab); await chats.openChatFile(chatFile)
        session = chats.getSessionByFile(chatFile.path); tab = session.id
        await until(() => leaf.view.containerEl.querySelector('.abele-chat-msg__image-preview'))
        const reopened = await measure('phone-reopened')
        return { immediate, reopened }
      } finally {
        await chats.closeTab(tab)
        if (prior) chats.switchTab(prior)
        leaf?.detach()
        await app.workspace.changeLayout(layout)
        if (previousLeaf?.view.containerEl.isConnected) app.workspace.setActiveLeaf(previousLeaf, { focus: false })
        if (chatFile && app.vault.getAbstractFileByPath(chatFile.path)) await app.vault.delete(chatFile)
        const folder = app.vault.getAbstractFileByPath(directory)
        if (ownsDirectory && folder) await app.vault.delete(folder, true)
      }
    })()`,
          120_000
        )
      )
    )
    console.log('native chat geometry', JSON.stringify(result))
    for (const state of [result.immediate, result.reopened]) {
      expect(state.native.height).toBeGreaterThan(0)
      expect(state.toolbar.top).toBeGreaterThanOrEqual(state.native.bottom)
      expect(state.first.top).toBeGreaterThanOrEqual(state.toolbar.bottom)
      expect(state.chat.top).toBeGreaterThanOrEqual(state.content.top)
      expect(state.chat.bottom).toBeLessThanOrEqual(state.content.bottom)
      expect(state.chat.bottom).toBeLessThanOrEqual(state.viewport)
      expect(state.pixels).toBe(96)
    }
  }, 180_000)
})

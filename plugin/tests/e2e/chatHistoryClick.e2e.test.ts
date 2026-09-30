/** A real mouse click and a touch tap open a history card without a focus-induced scroll. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-history-click')

interface Result {
  error?: string
  cases: { searchFocused: boolean; path: string; opened: string | null; reveals: number }[]
}

const script = (touch: boolean) => `(async () => {
  const T = window.__abeleTest
  const service = T.ChatService.getInstance()
  const storage = T.ChatStorage.getInstance()
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn) => {
    for (let i = 0; i < 80; i++) { if (fn()) return true; await wait(50) }
    return false
  }
  const layout = app.workspace.getLayout()
  const tabs = [...service.tabOrder.value]
  const active = service.activeTabId.value
  const KEY = 'abele-chat-history-order'
  const order = app.loadLocalStorage(KEY)
  const modal = () => document.querySelector('.abele-chat-history')
  const close = async () => {
    modal()?.closest('.modal-container')?.querySelector('.modal-header-button, .modal-close-button')?.click()
    await until(() => !modal())
  }
  const base = T.AbeleConfig.getInstance().ai.chatFolder.replace(/\\/?\\{\\{.*$/, '').replace(/\\/$/, '')
  const dir = base + '/Sample history tap probe'
  const dirs = [], files = [], report = { cases: [] }
  const scrollIntoView = HTMLElement.prototype.scrollIntoView
  let reveals = 0
  HTMLElement.prototype.scrollIntoView = function (...args) {
    if (this.closest('.abele-chat-history') && !this.matches('input, textarea, [contenteditable="true"]')) reveals++
    return scrollIntoView.apply(this, args)
  }
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const send = (method, params) => cdp.sendCommand(method, params)
  try {
    app.saveLocalStorage(KEY, 'last')
    if (app.vault.getAbstractFileByPath(dir)) throw new Error('scratch folder already exists')
    for (const d of dir.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))) {
      if (!app.vault.getAbstractFileByPath(d)) { await app.vault.createFolder(d); dirs.unshift(d) }
    }
    for (let i = 0; i < 18; i++) {
      const title = 'Sample history tap ' + String(i).padStart(2, '0')
      const path = dir + '/' + title + '.abchat'
      const timestamp = Date.now() + i * 1000
      const records = [
        { v: 2, k: 'meta', type: 'abele-chat', title, summary: 'A sample garden plan with beds, paths and a pond.', providerId: '', modelId: '', created: '2025-01-01' },
        { k: 'msg', id: 'sample-user', role: 'user', content: 'Plan a sample garden.', timestamp },
        { k: 'msg', id: 'sample-answer', parentId: 'sample-user', role: 'assistant', content: 'Sample garden answer ' + i, timestamp: timestamp + 1 },
      ]
      await app.vault.create(path, records.map((r) => JSON.stringify(r)).join('\\n') + '\\n')
      files.push(path)
    }
    await storage.refreshHistory()
    // Never replace the chat that was open before the probe.
    if (!service.canCreateTab) throw new Error('no room for a scratch chat tab')
    service.createTab()
    if (${touch}) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    for (const searchFocused of [false, true]) {
      app.commands.executeCommandById('abele:search-all-chats')
      if (!(await until(() => modal()?.querySelector('.abele-card')))) throw new Error('history did not open')
      await wait(450)
      const search = modal().querySelector('input')
      if (searchFocused) search.focus(); else search.blur()
      await wait(450)
      const list = modal().querySelector('.abele-chat-history__list')
      list.scrollTop = 200
      await wait(150)
      const bounds = list.getBoundingClientRect()
      const candidates = [...list.querySelectorAll('.abele-card')].filter((el) => {
        const r = el.getBoundingClientRect()
        return r.top > bounds.top + 8 && r.bottom < bounds.bottom - 8 && files.includes(el.dataset.path)
      })
      const card = candidates[candidates.length - 1]
      if (!card) throw new Error('no fully visible sample card')
      const r = card.getBoundingClientRect(), path = card.dataset.path
      const x = Math.round(r.left + 24), y = Math.round(r.top + 24)
      reveals = 0
      if (${touch}) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await wait(100)
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
        await wait(100)
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      }
      await until(() => !modal() && service.activeSession.value?.currentChatFile.value?.path === path)
      const opened = !modal() ? service.activeSession.value?.currentChatFile.value?.path ?? null : null
      report.cases.push({ searchFocused, path, opened, reveals })
      // The shell's leaving animation outlives the component's removal from the DOM.
      await wait(450)
      const win = require('@electron/remote').getCurrentWindow()
      const fs = require('fs')
      fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      fs.writeFileSync(${JSON.stringify(SHOTS)} + '/${touch ? 'touch' : 'mouse'}-' + searchFocused + '.png', (await win.webContents.capturePage()).toPNG())
      await close()
    }
  } catch (e) { report.error = String(e?.message || e) }
  finally {
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    if (${touch}) await send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await close()
    for (const id of [...service.tabOrder.value]) if (!tabs.includes(id)) await service.closeTab(id)
    if (active) service.activeTabId.value = active
    service.saveTabs()
    for (const path of files) {
      storage.removeHistoryEntry(path)
      const file = app.vault.getAbstractFileByPath(path)
      if (file) await app.vault.delete(file)
    }
    for (const path of dirs) {
      const folder = app.vault.getAbstractFileByPath(path)
      if (folder && !folder.children.length) await app.vault.delete(folder, true)
    }
    app.saveLocalStorage(KEY, order ?? null)
    await app.workspace.changeLayout(layout)
  }
  return JSON.stringify(report)
})()`

for (const touch of [false, true]) {
  describe.runIf(available)(
    `history opens with one ${touch ? 'phone-layout tap' : 'desktop click'}`,
    () => {
      beforeAll(async () => {
        if (touch) {
          await reloadApp('app.emulateMobile(true)')
          evalRaw(
            `(() => { require('@electron/remote').getCurrentWindow().setContentSize(390, 844); return true })()`
          )
          await reloadApp()
        }
        runCli(['dev:debug', 'on'])
      }, 180_000)

      afterAll(async () => {
        if (touch) await reloadApp('app.emulateMobile(false)')
      }, 180_000)

      it('opens the exact card, with and without focus in the search field', async () => {
        if (touch)
          expect(evalJson<boolean>(`document.body.classList.contains('is-phone')`)).toBe(true)
        const report: Result = JSON.parse(await evalLong(script(touch), 40_000))
        console.log(JSON.stringify(report))
        expect(report.error).toBeUndefined()
        expect(report.cases).toHaveLength(2)
        for (const result of report.cases) {
          expect(result.reveals).toBe(0)
          expect(result.opened).toBe(result.path)
        }
      }, 60_000)
    }
  )
}

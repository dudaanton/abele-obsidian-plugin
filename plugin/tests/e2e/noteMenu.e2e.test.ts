/** Ordered note actions in the live workspace and in the mobile quick-menu sheet. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const TITLES = [
  'Add to agent context',
  'Chat about this',
  'Attach to a chat',
  'Attach a chat to note',
  'Copy wikilink',
]
const shots = shotDir('note-menu')
const script = `(async () => {
  const T = window.__abeleTest
  const svc = T.ChatService.getInstance()
  const storage = T.ChatStorage.getInstance()
  const cfg = T.AbeleConfig.getInstance().ai
  const enabled = cfg.enabled
  const layout = app.workspace.getLayout()
  const activeTab = svc.activeTabId.value
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async fn => {
    for (let i = 0; i < 80; i++) { if (fn()) return; await wait(100) }
    throw new Error('Timed out waiting for the note menu probe')
  }
  const report = { menus: [] }
  const folder = 'sample-menu-fixture'
  const notePath = folder + '/sample-note.md'
  const chatPath = folder + '/sample-chat.abchat'
  let leaf
  let created = false
  let temporaryTab = null
  const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))
  const menuTitles = () => [...document.querySelectorAll('.menu .menu-item-title')].map(e => e.textContent.trim())
  const inputText = () => T.noteFieldView(document.querySelector('.abele-chat-input__editor'))?.state.doc.toString() || document.querySelector('textarea.abele-chat-input__textarea')?.value || ''
  const capture = () => {
    const items = []
    return { items, addSeparator() { return this }, addItem(build) {
      const item = new Proxy({}, { get: (_, key) => value => { if (key === 'setTitle') items.push(value); return item } })
      build(item)
      return this
    } }
  }
  try {
    if (app.vault.getAbstractFileByPath(folder)) throw new Error('Fixture folder already exists')
    cfg.enabled = true
    await app.vault.createFolder(folder)
    created = true
    const note = await app.vault.create(notePath, 'A fabricated sample paragraph.\\n')
    const meta = { v: 2, k: 'meta', type: 'abele-chat', created: '2026-01-01', title: 'Sample menu chat' }
    const msg = { k: 'msg', id: 'sample-message', role: 'user', content: 'A sample conversation', timestamp: 1 }
    const chat = await app.vault.create(chatPath, JSON.stringify(meta) + '\\n' + JSON.stringify(msg) + '\\n')
    await storage.refreshHistory()
    // The fixture lives outside the configured chat folder; register it like a saved chat.
    storage.addHistoryEntry({ path: chatPath, title: 'Sample menu chat', created: '2026-01-01' })
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
    await leaf.openFile(note)
    await leaf.setViewState({ type: 'markdown', state: { file: notePath, mode: 'source', source: false } })
    app.workspace.setActiveLeaf(leaf, { focus: true })
    app.workspace.leftSplit.collapse()
    app.workspace.rightSplit.collapse()
    await wait(500)
    for (const source of ['file-explorer-context-menu', 'tab-header', 'more-options']) {
      const menu = capture()
      app.workspace.trigger('file-menu', menu, note, source, leaf)
      report.menus.push(menu.items.filter(t => ${JSON.stringify(TITLES)}.includes(t)))
    }
    const editorMenu = capture()
    app.workspace.trigger('editor-menu', editorMenu, leaf.view.editor, leaf.view)
    report.menus.push(editorMenu.items.filter(t => ${JSON.stringify(TITLES)}.includes(t)))

    if (!svc.canCreateTab) throw new Error('The probe needs one free chat tab')
    temporaryTab = svc.createTab()
    await svc.openChatFile(chat)
    await svc.revealSidebar()
    const session = svc.getSessionByFile(chatPath)
    svc.pendingInput.value = { text: 'Existing draft', tabId: session.id }
    await until(() => inputText().includes('Existing draft'))
    app.workspace.rightSplit.collapse()
    app.workspace.setActiveLeaf(leaf, { focus: true })
    app.commands.executeCommandById('abele:open-quick-menu')
    await until(() => menuTitles().includes('Attach to a chat'))
    report.quick = menuTitles().filter(t => ${JSON.stringify(TITLES)}.includes(t))
    await wait(300)
    const remote = require('@electron/remote')
    const image = await remote.getCurrentWindow().webContents.capturePage()
    require('fs').writeFileSync(${JSON.stringify(shots)} + (app.isMobile ? '/mobile.png' : '/desktop.png'), image.toPNG())
    const item = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-item-title')?.textContent.trim() === 'Attach to a chat')
    item.click()
    await until(() => document.querySelector('.prompt-input'))
    const input = document.querySelector('.prompt-input')
    input.value = 'Sample menu chat'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(400)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    await until(() => inputText().includes('[[sample-note]]'))
    report.draft = inputText()
    report.scope = session.scopeResolver.isInScope(notePath)
    report.attached = session.touched.value.map(n => n.path)
    report.activeNote = app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view?.file?.path
  } catch (e) {
    report.error = String(e?.message || e)
    report.inputAtError = inputText()
    report.promptAtError = document.querySelector('.prompt')?.textContent
    report.pendingAtError = svc.pendingInput.value
    report.chatAtError = svc.activeSession.value?.currentChatFile.value?.path
  }
  finally {
    escape()
    if (temporaryTab && svc.tabOrder.value.includes(temporaryTab)) await svc.closeTab(temporaryTab)
    if (activeTab && svc.tabOrder.value.includes(activeTab)) svc.switchTab(activeTab)
    if (leaf) leaf.detach()
    const fixture = app.vault.getAbstractFileByPath(folder)
    if (created && fixture) await app.vault.delete(fixture, true)
    cfg.enabled = enabled
    await storage.refreshHistory()
    await app.workspace.changeLayout(layout)
  }
  return JSON.stringify(report)
})()`

interface Report {
  error?: string
  menus: string[][]
  quick: string[]
  draft: string
  scope: boolean
  attached: string[]
  activeNote: string
}
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('note actions in the app', () => {
  let originalSize: [number, number]
  let originalMobile = false
  const reports: Report[] = []
  beforeAll(async () => {
    originalSize = JSON.parse(
      evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
    )
    originalMobile = evalRaw('app.isMobile') === 'true'
    for (const mobile of [false, true]) {
      await reloadApp('app.emulateMobile(' + mobile + ')')
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${mobile ? '390, 844' : '1100, 800'})`
      )
      await reloadApp('window.location.reload()')
      const report = JSON.parse(await evalLong(script, 90_000)) as Report
      console.info(JSON.stringify({ mobile, ...report }, null, 2))
      reports.push(report)
    }
  }, 300_000)
  afterAll(async () => {
    if (originalSize)
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${originalSize.join(',')})`
      )
    await reloadApp('app.emulateMobile(' + originalMobile + ')')
  }, 120_000)

  it('reaches desktop and phone layouts without an error', () => {
    expect(reports).toHaveLength(2)
    expect(reports.map((r) => r.error ?? '')).toEqual(['', ''])
  })
  it('keeps file, editor, tab-header and quick menus in the same order', () => {
    for (const report of reports) {
      expect(report.menus).toEqual([TITLES, TITLES, TITLES, TITLES])
      expect(report.quick).toEqual(TITLES)
    }
  })
  it('inserts into the picked chat beside its draft, without attaching a card or moving the note', () => {
    for (const report of reports) {
      expect(report.draft).toContain('Existing draft')
      expect(report.draft).toContain('[[sample-note]]')
      expect(report.scope).toBe(true)
      expect(report.attached).toEqual([])
      expect(report.activeNote).toBe('sample-menu-fixture/sample-note.md')
    }
  })
})

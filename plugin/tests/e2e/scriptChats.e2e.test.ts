/**
 * Chats linked to a script, in the running app: the list under the code in the script's tab.
 *
 * The unit tier proves which files take a link and that the list follows its model; what only
 * the app can show is the code view actually drawing it — after the editor has been built, and
 * again after the tab is given another file — the command attaching a chat to the script in
 * front, a card opening its chat in the sidebar while the script's tab stays where it was, and
 * a rename carrying the link along.
 *
 * One `eval` runs the sequence and answers with what it saw. It writes one script and one chat
 * of its own and removes both; a scripts folder is set for the run only when none is.
 * Requires Obsidian running on a vault with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, activeVaultName } from './helpers/obsidianCli'

const SCRIPT = 'script-chats-probe'
const CHAT = 'Script chats probe'

interface Report {
  before?: string[]
  attached?: string[]
  afterCode?: boolean
  opened?: { chatInSidebar: boolean; scriptStillOpen: boolean; leaves: number }
  renamed?: string[]
  detached?: string[]
  error?: string
}

const script = `(async () => {
  const T = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 5000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const report = {}
  const created = []
  const createdDirs = []
  const svc = T.ChatService.getInstance()
  const storage = T.ChatStorage.getInstance()
  const cfg = T.AbeleConfig.getInstance().ai
  const oldFolder = cfg.scriptsFolder
  if (!cfg.scriptsFolder) cfg.scriptsFolder = 'Scripts'
  const folder = cfg.scriptsFolder.replace(/\\/+$/, '')
  let scriptPath = folder + '/' + ${JSON.stringify(SCRIPT)} + '.js'
  const base = cfg.chatFolder.replace(/\\/?\\{\\{.*$/, '').replace(/\\/$/, '')
  const chatPath = base + '/' + ${JSON.stringify(CHAT)} + '.abchat'
  let leaf = null

  const cards = () =>
    leaf
      ? [...leaf.view.containerEl.querySelectorAll('.abele-code-chats .abele-card__name')].map((e) =>
          e.textContent.trim()
        )
      : []
  const ensureDir = async (path) => {
    let dir = ''
    for (const part of path.split('/')) {
      dir = dir ? dir + '/' + part : part
      if (!app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir)
        createdDirs.unshift(dir)
      }
    }
  }

  try {
    await ensureDir(folder)
    await ensureDir(base)
    const file = await app.vault.create(scriptPath, '// @name ${SCRIPT}\\nlog("hello")\\n')
    created.push(scriptPath)
    const meta = { v: 2, k: 'meta', type: 'abele-chat', created: '2026-09-26', title: ${JSON.stringify(CHAT)},
      summary: 'A chat the script probe wrote.' }
    const msg = { k: 'msg', id: 'a0', role: 'user', content: 'Hello', timestamp: 1790000000000 }
    await app.vault.create(chatPath, JSON.stringify(meta) + '\\n' + JSON.stringify(msg) + '\\n')
    created.push(chatPath)
    await storage.refreshHistory()

    leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
    app.workspace.setActiveLeaf(leaf, { focus: true })
    await until(() => leaf.view.containerEl.querySelector('.cm-editor'), 8000)
    report.before = cards()

    // ── the command, for the script in front ──
    app.commands.executeCommandById('abele:attach-chat-to-current-note')
    await until(() => document.querySelector('.prompt .prompt-input'))
    const input = document.querySelector('.prompt .prompt-input')
    input.value = ${JSON.stringify(CHAT)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(400)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    await until(() => cards().includes(${JSON.stringify(CHAT)}))
    report.attached = cards()
    // Under the code, not above it.
    const list = leaf.view.containerEl.querySelector('.abele-code-chats')
    const editor = leaf.view.containerEl.querySelector('.cm-editor')
    report.afterCode = !!(list && editor && editor.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)

    // ── a card opens the chat in the sidebar; the script stays ──
    const leavesBefore = app.workspace.getLeavesOfType('abele-code').length
    leaf.view.containerEl.querySelector('.abele-code-chats .abele-card').click()
    await until(() => svc.getSessionByFile(chatPath), 5000)
    await wait(300)
    report.opened = {
      chatInSidebar: svc.activeSession.value?.currentChatFile.value?.path === chatPath,
      scriptStillOpen: leaf.view.file?.path === scriptPath && !!leaf.view.containerEl.isConnected,
      leaves: app.workspace.getLeavesOfType('abele-code').length - leavesBefore,
    }

    // ── a rename carries the link ──
    const renamed = folder + '/' + ${JSON.stringify(SCRIPT)} + '-renamed.js'
    await app.fileManager.renameFile(file, renamed)
    created[0] = renamed
    scriptPath = renamed
    await until(() => cards().includes(${JSON.stringify(CHAT)}) && storage.getHistory().some((e) => (e.notes || []).some((n) => n.path === renamed)), 5000)
    report.renamed = cards()

    // ── detached from the card ──
    leaf.view.containerEl.querySelector('.abele-code-chats .abele-chats-list__detach').click()
    await until(() => cards().length === 0)
    report.detached = cards()
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    if (document.querySelector('.prompt')) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    }
    const session = svc.getSessionByFile(chatPath)
    if (session) svc.closeTab(session.id)
    if (leaf) leaf.detach()
    for (const path of created) {
      const f = app.vault.getAbstractFileByPath(path)
      if (f) await app.vault.delete(f)
    }
    for (const d of createdDirs) {
      const f = app.vault.getAbstractFileByPath(d)
      if (f && f.children && !f.children.length) await app.vault.delete(f, true)
    }
    cfg.scriptsFolder = oldFolder
    await storage.refreshHistory()
  }
  return report
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('chats under a script, in the app', () => {
  let report: Report = {}

  beforeAll(() => {
    const raw = evalRaw(script, 45_000)
    report = JSON.parse(raw) as Report
    console.info(`\n  vault ${activeVaultName()}\n  ${JSON.stringify(report, null, 2)}\n`)
  }, 60_000)

  it('runs to the end', () => {
    expect(report.error ?? '').toBe('')
  })

  it('shows nothing under a script no chat is linked to', () => {
    expect(report.before).toEqual([])
  })

  it('the command attaches a chat to the script in front, and its card appears under the code', () => {
    expect(report.attached).toEqual([CHAT])
    expect(report.afterCode).toBe(true)
  })

  it('a card opens its chat in the sidebar and leaves the script open', () => {
    expect(report.opened).toEqual({ chatInSidebar: true, scriptStillOpen: true, leaves: 0 })
  })

  it('keeps the card when the script is renamed', () => {
    expect(report.renamed).toEqual([CHAT])
  })

  it('the unlink button on the card detaches it', () => {
    expect(report.detached).toEqual([])
  })
})

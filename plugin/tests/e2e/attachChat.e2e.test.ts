/**
 * Attaching a chat to a note by hand, in the running app, from both ends and back.
 *
 * The unit tier proves the link lands in the chat file and the index; what only the app can
 * show is the rest of the road: the link button in the chat's header opening Obsidian's own
 * menu, the note's "more options" menu offering *Attach a chat…* and its picker choosing one,
 * the card appearing under the note and going again when it is detached — and all of it still
 * there once the chat and the note have been closed and opened again.
 *
 * One `eval` runs the whole sequence and answers with what it saw at each step. It writes one
 * note and one chat of its own and removes both; the fixture vault is otherwise left as it was.
 * Requires Obsidian running on a vault with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, activeVaultName } from './helpers/obsidianCli'

const NOTE = 'Attach probe note'
const CHAT = 'Attach probe chat'

interface Step {
  /** Titles of the chat cards under the note. */
  cards: string[]
  /** What the chat file's last metadata record lists in `touched`. */
  file: string[]
  /** The number beside the chat's link button. */
  count: string
}

interface Report {
  chatToNote?: Step
  reopenedChat?: string[]
  reopenedNote?: string[]
  detachFromNote?: Step
  noteToChat?: Step
  chatMenu?: string[]
  detachFromChat?: Step
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
  let leaf = null

  const menuItems = () =>
    [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent.trim())
  const clickMenu = async (title) => {
    if (!(await until(() => menuItems().includes(title)))) {
      throw new Error('no menu item "' + title + '" in ' + JSON.stringify(menuItems()))
    }
    const item = [...document.querySelectorAll('.menu .menu-item')].find(
      (el) => el.querySelector('.menu-item-title')?.textContent.trim() === title
    )
    item.click()
    await until(() => !document.querySelector('.menu'), 2000)
  }
  const escape = () =>
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
    )
  const cards = () =>
    leaf
      ? [...leaf.view.containerEl.querySelectorAll('.abele-chats-list .abele-card__name')].map((e) =>
          e.textContent.trim()
        )
      : []
  const linkButton = () => document.querySelector('.abele-ai-chat .abele-ai-chat__notes')
  const inFile = async (path) => {
    const text = await app.vault.adapter.read(path)
    const metas = text.split('\\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.k === 'meta' || r.type)
    const last = metas[metas.length - 1] || {}
    return (last.touched || []).map((t) => t.path)
  }
  const step = async (chatPath) => ({
    cards: cards(),
    file: await inFile(chatPath),
    count: (linkButton()?.textContent || '').trim(),
  })
  const openNote = async (file) => {
    leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
    app.workspace.setActiveLeaf(leaf, { focus: true })
    await until(() => leaf.view.containerEl.querySelector('.abele-footer-view'), 8000)
  }

  const cfg = T.AbeleConfig.getInstance().ai
  const base = cfg.chatFolder.replace(/\\/?\\{\\{.*$/, '').replace(/\\/$/, '')
  const notePath = ${JSON.stringify(NOTE)} + '.md'
  const chatPath = base + '/' + ${JSON.stringify(CHAT)} + '.abchat'

  try {
    // ── seed ──
    let dir = ''
    for (const part of base.split('/')) {
      dir = dir ? dir + '/' + part : part
      if (!app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir)
        createdDirs.unshift(dir)
      }
    }
    const note = await app.vault.create(notePath, 'A note for the attach probe.\\n')
    created.push(notePath)
    const meta = { v: 2, k: 'meta', type: 'abele-chat', created: '2026-09-25', title: ${JSON.stringify(CHAT)},
      summary: 'A chat the attach probe wrote.' }
    const msg = { k: 'msg', id: 'a0', role: 'user', content: 'Hello', timestamp: 1790000000000 }
    const chat = await app.vault.create(chatPath, JSON.stringify(meta) + '\\n' + JSON.stringify(msg) + '\\n')
    created.push(chatPath)
    await storage.refreshHistory()

    await openNote(note)
    await svc.openChatFile(chat)
    await svc.revealSidebar()
    await until(() => linkButton() && !linkButton().classList.contains('abele-obsidian-icon_disabled'), 8000)
    // The sidebar has the focus now, as it does when the button is pressed; the note is still
    // the file most recently in front, which is what "the note in front" means from there.

    // ── from the chat: attach to the note in front ──
    linkButton().click()
    await clickMenu('Attach to ' + ${JSON.stringify(NOTE)})
    await until(() => cards().includes(${JSON.stringify(CHAT)}))
    report.chatToNote = await step(chatPath)

    // ── both closed and opened again ──
    const session = svc.getSessionByFile(chatPath)
    if (session) svc.closeTab(session.id)
    await wait(300)
    await svc.openChatFile(chat)
    await wait(300)
    report.reopenedChat = (svc.getSessionByFile(chatPath)?.touched.value || []).map((t) => t.path)
    leaf.detach()
    await openNote(note)
    await until(() => cards().length > 0, 5000)
    report.reopenedNote = cards()

    // ── from the note: the unlink button on the card ──
    leaf.view.containerEl.querySelector('.abele-chats-list__detach').click()
    await until(() => cards().length === 0)
    report.detachFromNote = await step(chatPath)

    // ── from the note: the command for the note in front, then the chat picker ──
    // Its "more options" item is Obsidian's own menu, native on a Mac and out of reach of the
    // page; that it is offered there is the unit tier's to say.
    app.commands.executeCommandById('abele:attach-chat-to-current-note')
    await until(() => document.querySelector('.prompt .prompt-input'))
    const input = document.querySelector('.prompt .prompt-input')
    input.value = ${JSON.stringify(CHAT)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(400)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    await until(() => cards().includes(${JSON.stringify(CHAT)}))
    report.noteToChat = await step(chatPath)

    // ── from the chat: detach ──
    linkButton().click()
    await until(() => menuItems().length > 0)
    report.chatMenu = menuItems()
    await clickMenu('Detach from ' + ${JSON.stringify(NOTE)})
    await until(() => cards().length === 0)
    report.detachFromChat = await step(chatPath)
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    if (document.querySelector('.menu, .prompt')) escape()
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
    await storage.refreshHistory()
  }
  return report
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('attaching a chat to a note, in the app', () => {
  let report: Report = {}

  beforeAll(() => {
    const raw = evalRaw(script, 45_000)
    report = JSON.parse(raw) as Report
    console.info(`\n  vault ${activeVaultName()}\n  ${JSON.stringify(report, null, 2)}\n`)
  }, 60_000)

  it('runs to the end', () => {
    expect(report.error ?? '').toBe('')
  })

  it('from the chat: attaches it to the note in front, and the card appears', () => {
    expect(report.chatToNote).toEqual({ cards: [CHAT], file: [`${NOTE}.md`], count: '1' })
  })

  it('is still attached once the chat and the note are opened again', () => {
    expect(report.reopenedChat).toEqual([`${NOTE}.md`])
    expect(report.reopenedNote).toEqual([CHAT])
  })

  it('from the note: the card’s unlink button detaches it', () => {
    expect(report.detachFromNote).toEqual({ cards: [], file: [], count: '' })
  })

  it('from the note: the command picks a chat and attaches it', () => {
    expect(report.noteToChat).toEqual({ cards: [CHAT], file: [`${NOTE}.md`], count: '1' })
  })

  it('from the chat: its menu lists the note, and detaches it', () => {
    expect(report.chatMenu).toContain(`Detach from ${NOTE}`)
    expect(report.detachFromChat).toEqual({ cards: [], file: [], count: '' })
  })
})

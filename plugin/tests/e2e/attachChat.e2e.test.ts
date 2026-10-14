/**
 * Attaching a chat to a note by hand, in the running app, from both ends and back.
 *
 * The unit tier proves the link lands in the chat file and the index; what only the app can
 * show is the rest of the road: the chat header's "Files from this chat" opening the attachment
 * controls, the note's *Attach a chat…* command and its picker choosing one,
 * the card appearing under the note and going again when it is detached — and all of it still
 * there once the chat and the note have been closed and opened again.
 *
 * One `eval` runs the whole sequence and answers with what it saw at each step. It writes one
 * note and one chat of its own and removes both; the fixture vault is otherwise left as it was.
 * Requires Obsidian running on a vault with the development build — see docs/Testing.md.
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalLong, activeVaultName } from './helpers/obsidianCli'
import { dismissOwnNotices } from './helpers/ownNotices'

const RUN = randomUUID()
const NOTE = `Attach probe note ${RUN}`
const CHAT = `Attach probe chat ${RUN}`

interface Step {
  /** Titles of the chat cards under the note. */
  cards: string[]
  /** What the chat file's last metadata record lists in `touched`. */
  file: string[]
  /** The linked-note rows in the "Files from this chat" view (the section is hidden at none). */
  count: number
}

interface Report {
  chatToNote?: Step
  reopenedChat?: string[]
  reopenedNote?: string[]
  detachFromNote?: Step
  noteToChat?: Step
  chatArtifacts?: string[]
  detachedNoteKept?: boolean
  detachFromChat?: Step
  error?: string
}

const script = `(async () => {
  const T = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 5000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const found = fn()
      if (found) return found
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
  const artifacts = () => document.querySelector('.abele-chat-artifacts')
  const openArtifacts = async () => {
    if (artifacts()) return artifacts()
    const more = await until(() => document.querySelector('.abele-ai-chat__overflow [aria-haspopup="menu"]'), 8000)
    if (!more) throw new Error('no chat overflow control')
    more.click()
    const item = await until(() => [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.trim() === 'Files from this chat'))
    if (!item) throw new Error('no "Files from this chat" in the overflow')
    item.click()
    if (!(await until(artifacts))) throw new Error('no Artifacts view')
    return artifacts()
  }
  const closeArtifacts = async () => {
    const view = artifacts()
    if (!view) return
    const close = view.closest('.modal')?.querySelector('.modal-close-button, .modal-header-button')
    if (!close) throw new Error('Files view has no native dismiss action')
    close.click()
    if (!(await until(() => !artifacts()))) throw new Error('Artifacts view did not close')
  }
  const press = async (host, title) => {
    const button = () => [...(host.closest('.modal') || host).querySelectorAll('button')].find((el) => el.textContent.trim() === title)
    if (!(await until(() => button() && !button().disabled)))
      throw new Error('no enabled Artifacts button "' + title + '"')
    button().click()
  }
  const inFile = async (path) => {
    const text = await app.vault.adapter.read(path)
    const metas = text.split('\\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.k === 'meta' || r.type)
    const last = metas[metas.length - 1] || {}
    return (last.touched || []).map((t) => t.path)
  }
  const step = async (chatPath) => {
    const root = await openArtifacts()
    const result = {
      cards: cards(),
      file: await inFile(chatPath),
      count: root.querySelectorAll('section[aria-label="Notes"] .abele-chat-artifacts__row').length,
    }
    await closeArtifacts()
    return result
  }
  const openNote = async (file) => {
    // A new tab goes beside the tab most recently active in the main area. There is none when
    // the last one was just closed, or the one Obsidian put in its place has never been active
    // ("No tab group found"): a tab is then made in the main area directly.
    try { leaf = app.workspace.getLeaf('tab') } catch {
      leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0)
    }
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
    // The sidebar has the focus now, as it does when the button is pressed; the note is still
    // the file most recently in front, which is what "the note in front" means from there.

    // ── from the chat: attach to the note in front ──
    await press(await openArtifacts(), 'Attach current note')
    await until(() => cards().includes(${JSON.stringify(CHAT)}))
    report.chatToNote = await step(chatPath)

    // ── both closed and opened again ──
    const session = svc.getSessionByFile(chatPath)
    if (session) await svc.closeTab(session.id)
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
    // File-review dismissal returns focus to its chat trigger. Select the note again before
    // invoking a command whose target is the active note, as a person would.
    app.workspace.setActiveLeaf(leaf, { focus: true })
    await until(() => app.workspace.getActiveFile()?.path === notePath)
    app.commands.executeCommandById('abele:attach-chat-to-current-note')
    if (!(await until(() => document.querySelector('.prompt .prompt-input')))) throw new Error('The active-note command did not open its chat picker')
    const input = document.querySelector('.prompt .prompt-input')
    input.value = ${JSON.stringify(CHAT)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(400)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    await until(() => cards().includes(${JSON.stringify(CHAT)}))
    report.noteToChat = await step(chatPath)

    // ── from the chat: the linked note's row, its ⋯ menu ──
    const root = await openArtifacts()
    report.chatArtifacts = [...root.querySelectorAll('section[aria-label="Notes"] .abele-chat-artifacts__row .abele-tree-item__text')]
      .map((el) => el.textContent.trim())
    const row = [...root.querySelectorAll('.abele-chat-artifacts__row')].find((el) =>
      el.querySelector('[data-path]')?.getAttribute('data-path') === notePath)
    if (!row) throw new Error('no linked note row in "Files from this chat"')
    // The row's ⋯ is Obsidian's menu; off native for this step so the page can reach it.
    const oldNative = app.vault.getConfig('nativeMenus')
    app.vault.setConfig('nativeMenus', false)
    try { row.querySelector('.abele-chat-artifacts__more').click() } finally { app.vault.setConfig('nativeMenus', oldNative) }
    const unlink = await until(() => [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.trim() === 'Unlink from chat'))
    if (!unlink) throw new Error('no "Unlink from chat" in the row menu')
    unlink.click()
    await until(() => cards().length === 0)
    await until(() => !root.querySelector('section[aria-label="Notes"] .abele-chat-artifacts__row'))
    report.detachFromChat = await step(chatPath)
    report.detachedNoteKept = !!app.vault.getAbstractFileByPath(notePath)
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    try { await closeArtifacts() } catch (e) { report.error = report.error || String(e.message || e) }
    if (document.querySelector('.menu, .prompt')) escape()
    const session = svc.getSessionByFile(chatPath)
    if (session) await svc.closeTab(session.id)
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

  beforeAll(async () => {
    const raw = await evalLong(script, 45_000)
    report = JSON.parse(raw) as Report
    // The probe cleans its files up; the confirmations it showed are its own too.
    dismissOwnNotices('Attached ')
    console.info(`\n  vault ${activeVaultName()}\n  ${JSON.stringify(report, null, 2)}\n`)
  }, 60_000)

  it('runs to the end', () => {
    expect(report.error ?? '').toBe('')
  })

  it('from the chat: attaches it to the note in front, and the card appears', () => {
    expect(report.chatToNote).toEqual({ cards: [CHAT], file: [`${NOTE}.md`], count: 1 })
  })

  it('is still attached once the chat and the note are opened again', () => {
    expect(report.reopenedChat).toEqual([`${NOTE}.md`])
    expect(report.reopenedNote).toEqual([CHAT])
  })

  it('from the note: the card’s unlink button detaches it', () => {
    expect(report.detachFromNote).toEqual({ cards: [], file: [], count: 0 })
  })

  it('from the note: the command picks a chat and attaches it', () => {
    expect(report.noteToChat).toEqual({ cards: [CHAT], file: [`${NOTE}.md`], count: 1 })
  })

  it('from the chat: Files from this chat lists the note, and unlinks without deleting it', () => {
    expect(report.chatArtifacts).toEqual([NOTE])
    expect(report.detachFromChat).toEqual({ cards: [], file: [], count: 0 })
    expect(report.detachedNoteKept).toBe(true)
  })
})

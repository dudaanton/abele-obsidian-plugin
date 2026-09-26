/**
 * A chat file opened the ways Obsidian opens any file lands in the chat panel, and the note in
 * front stays where it was.
 *
 * The unit tier proves `WorkspaceLeaf.openFile` turns a chat away; what only the app can show is
 * that Obsidian's own roads really go through it — a click in the file explorer, a link clicked
 * in a note, the quick switcher, and "open in new tab" — and that none of them leaves the note's
 * tab replaced or a blank tab behind.
 *
 * One `eval` runs the whole sequence and answers with what it saw after each road. It writes one
 * note and one chat of its own and removes both; the fixture vault is otherwise left as it was.
 * Requires Obsidian running on a vault with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, activeVaultName } from './helpers/obsidianCli'

const NOTE = 'Opening probe note'
const CHAT = 'Chat open probe chat'

interface Road {
  /** The file in the note's own tab afterwards. */
  noteTab: string | null
  /** Whether the note's tab is still in the workspace. */
  noteTabAttached: boolean
  /** Tabs in the main area before and after. */
  tabsBefore: number
  tabsAfter: number
  /** Whether a chat tab in the panel has the chat file. */
  inPanel: boolean
  /** Leaves anywhere that hold the chat file. */
  chatLeaves: number
}

interface Report {
  explorer?: Road
  link?: Road
  switcher?: Road | string
  newTab?: Road
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

  const cfg = T.AbeleConfig.getInstance().ai
  const base = cfg.chatFolder.replace(/\\/?\\{\\{.*$/, '').replace(/\\/$/, '')
  const notePath = ${JSON.stringify(NOTE)} + '.md'
  const chatPath = base + '/' + ${JSON.stringify(CHAT)} + '.abchat'

  const mainTabs = () => {
    const out = []
    app.workspace.iterateRootLeaves((l) => out.push(l))
    return out.length
  }
  const chatLeaves = () => {
    let n = 0
    app.workspace.iterateAllLeaves((l) => { if (l.view?.file?.path === chatPath) n++ })
    return n
  }
  const closeChat = async () => {
    const s = svc.getSessionByFile(chatPath)
    if (s) await svc.closeTab(s.id)
    await wait(200)
  }
  const openNote = async (mode) => {
    // The tab before is closed once the new one is there: closed first, the tab Obsidian puts in
    // its place when it was the last has never been active, and leaves nothing to open beside.
    const before = leaf
    // A new tab goes beside the tab most recently active in the main area. There is none when
    // the last one was just closed, or the one Obsidian put in its place has never been active
    // ("No tab group found"): a tab is then made in the main area directly.
    try { leaf = app.workspace.getLeaf('tab') } catch {
      leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0)
    }
    await leaf.setViewState({ type: 'markdown', state: { file: notePath, mode }, active: true })
    if (before && before !== leaf) before.detach()
    app.workspace.setActiveLeaf(leaf, { focus: true })
    await until(() => leaf.view?.file?.path === notePath, 5000)
    await wait(300)
  }
  const road = async (name, mode, act) => {
    await closeChat()
    await openNote(mode)
    const tabsBefore = mainTabs()
    await act()
    await until(() => !!svc.getSessionByFile(chatPath), 5000)
    await wait(500)
    report[name] = {
      noteTab: leaf.view?.file?.path ?? null,
      noteTabAttached: (() => { let found = false; app.workspace.iterateRootLeaves((l) => { if (l === leaf) found = true }); return found })(),
      tabsBefore,
      tabsAfter: mainTabs(),
      inPanel: !!svc.getSessionByFile(chatPath),
      chatLeaves: chatLeaves(),
    }
  }

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
    await app.vault.create(notePath, 'Open the chat: [[' + ${JSON.stringify(CHAT)} + '.abchat]]\\n')
    created.push(notePath)
    const meta = { v: 2, k: 'meta', type: 'abele-chat', created: '2026-09-26', title: ${JSON.stringify(CHAT)},
      summary: 'A chat the open probe wrote.' }
    const msg = { k: 'msg', id: 'a0', role: 'user', content: 'Hello', timestamp: 1790000000000 }
    const chat = await app.vault.create(chatPath, JSON.stringify(meta) + '\\n' + JSON.stringify(msg) + '\\n')
    created.push(chatPath)
    await storage.refreshHistory()

    // ── the file explorer: a plain click on the chat's row ──
    await road('explorer', 'source', async () => {
      const explorer = app.workspace.getLeavesOfType('file-explorer')[0]
      if (explorer?.loadIfDeferred) await explorer.loadIfDeferred()
      app.internalPlugins.getPluginById('file-explorer').instance.revealInFolder(chat)
      app.workspace.setActiveLeaf(leaf, { focus: true })
      const row = await until(() => document.querySelector('.nav-file-title[data-path="' + chatPath + '"]'))
      if (!row) throw new Error('no explorer row for the chat')
      document.querySelector('.nav-file-title[data-path="' + chatPath + '"]').click()
    })

    // ── a link to the chat, clicked in the note ──
    await road('link', 'preview', async () => {
      const link = await until(() => leaf.view.containerEl.querySelector('.markdown-preview-view a.internal-link'))
      if (!link) throw new Error('no link in the note')
      leaf.view.containerEl.querySelector('.markdown-preview-view a.internal-link').click()
    })

    // ── the quick switcher ──
    try {
      await road('switcher', 'source', async () => {
        app.commands.executeCommandById('switcher:open')
        if (!(await until(() => document.querySelector('.prompt .prompt-input')))) throw new Error('no switcher')
        const input = document.querySelector('.prompt .prompt-input')
        input.value = ${JSON.stringify(CHAT)}
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const listed = await until(() =>
          [...document.querySelectorAll('.prompt .suggestion-item')].some((e) => e.textContent.includes(${JSON.stringify(CHAT)})))
        if (!listed) throw new Error('the switcher does not list the chat')
        await wait(300)
        const chosen = document.querySelector('.prompt .suggestion-item.is-selected')?.textContent ?? ''
        if (!chosen.includes(${JSON.stringify(CHAT)})) throw new Error('the switcher put first: ' + chosen)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
      })
    } catch (e) {
      report.switcher = String((e && e.message) || e)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    }

    // ── "open in new tab": a tab made for the chat ──
    await road('newTab', 'source', async () => {
      await app.workspace.getLeaf('tab').openFile(chat)
    })
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    await closeChat()
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

const untouched = (road: Road | string | undefined) => {
  expect(typeof road).toBe('object')
  const r = road as Road
  expect(r.noteTab).toBe(`${NOTE}.md`)
  expect(r.noteTabAttached).toBe(true)
  expect(r.tabsAfter).toBe(r.tabsBefore)
  expect(r.inPanel).toBe(true)
  expect(r.chatLeaves).toBe(0)
}

describe.skipIf(!available)('opening a chat file the ways Obsidian opens files, in the app', () => {
  let report: Report = {}

  beforeAll(() => {
    const raw = evalRaw(script, 60_000)
    report = JSON.parse(raw) as Report
    console.info(`\n  vault ${activeVaultName()}\n  ${JSON.stringify(report, null, 2)}\n`)
  }, 75_000)

  it('runs to the end', () => {
    expect(report.error ?? '').toBe('')
  })

  it('from the file explorer: to the chat panel, the note left in its tab', () => {
    untouched(report.explorer)
  })

  it('from a link in the note: to the chat panel, the note left in its tab', () => {
    untouched(report.link)
  })

  it('from the quick switcher: to the chat panel, the note left in its tab', () => {
    untouched(report.switcher)
  })

  it('into a new tab: to the chat panel, and no blank tab left behind', () => {
    untouched(report.newTab)
  })
})

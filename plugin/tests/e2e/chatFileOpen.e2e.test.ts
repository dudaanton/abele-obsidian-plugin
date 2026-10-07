/**
 * A chat file opened the ways Obsidian opens any file lands in the chat panel, and the tabs in
 * the main area stay as they were — the same ones, holding the same notes, the same one in front.
 *
 * The unit tier proves `WorkspaceLeaf.openFile` turns a chat away; what only the app can show is
 * that Obsidian's own roads really go through it — a click in the file explorer, a link clicked
 * in a note, the quick switcher, each also asking for a new tab, a chat attached to a message
 * clicked in the chat panel — and that none of them replaces a note, leaves a blank tab behind,
 * or brings another tab to the front. Three notes are open in three tabs with the middle one in
 * front, so a neighbour taking its place shows.
 *
 * One `eval` runs the whole sequence and answers with what it saw after each road. It writes
 * three notes and two chats of its own and removes them; the fixture vault is otherwise left as
 * it was. Requires Obsidian running on a vault with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, activeVaultName } from './helpers/obsidianCli'

const NOTES = ['Opening probe first', 'Opening probe note', 'Opening probe last']
const CHAT = 'Chat open probe chat'
const HOST = 'Message with an attachment'

interface Road {
  /** The files in the three tabs afterwards, in order; null for a tab no longer there. */
  tabs: (string | null)[]
  /** The file in front of the tabs' group, and in the tab active last in the main area. */
  inFront: string | null
  mostRecent: string | null
  /** The view type, or the file, of the leaf that is active. */
  active: string | null
  /** Tabs in the main area before and after. */
  tabsBefore: number
  tabsAfter: number
  /** Whether a chat tab in the panel has the chat file. */
  inPanel: boolean
  /** Leaves anywhere that hold the chat file. */
  chatLeaves: number
  /** The user's main-area chat view was neither moved, replaced nor closed. */
  mainChatKept: boolean
  selection?: string
}

type Roads =
  | 'explorer'
  | 'explorerNewTab'
  | 'link'
  | 'linkNewTab'
  | 'switcher'
  | 'switcherNewTab'
  | 'newTab'
  | 'attached'
  | 'selectionLink'

type Report = Partial<Record<Roads, Road | string>> & { error?: string }

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
  const tabs = []
  let mainChat

  const cfg = T.AbeleConfig.getInstance().ai
  const base = cfg.chatFolder.replace(/\\/?\\{\\{.*$/, '').replace(/\\/$/, '')
  const notePaths = ${JSON.stringify(NOTES)}.map((n) => n + '.md')
  const chatPath = base + '/' + ${JSON.stringify(CHAT)} + '.abchat'
  const hostPath = base + '/' + ${JSON.stringify(HOST)} + '.abchat'

  const mainTabs = () => {
    const out = []
    app.workspace.iterateRootLeaves((l) => { out.push(l) })
    return out
  }
  const chatLeaves = () => {
    let n = 0
    app.workspace.iterateAllLeaves((l) => { if (l.view?.file?.path === chatPath) n++ })
    return n
  }
  const closeChats = async () => {
    for (const path of [chatPath, hostPath]) {
      const s = svc.getSessionByFile(path)
      if (s) await svc.closeTab(s.id)
    }
    await wait(200)
  }
  const describeLeaf = (l) => (l ? (l.view?.file?.path ?? l.view?.getViewType() ?? null) : null)
  // Three tabs, one note each, the middle one in front. Opened afresh for every road, so one that
  // goes wrong does not spoil the next; the tabs before are closed once the new ones are there.
  const openNotes = async (mode) => {
    const before = tabs.splice(0)
    for (const path of notePaths) {
      let leaf
      try { leaf = app.workspace.getLeaf('tab') } catch {
        leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0)
      }
      await leaf.setViewState({ type: 'markdown', state: { file: path, mode }, active: true })
      tabs.push(leaf)
    }
    for (const l of before) l.detach()
    app.workspace.setActiveLeaf(tabs[1], { focus: true })
    await until(() => tabs.every((l, i) => l.view?.file?.path === notePaths[i]), 5000)
    await wait(300)
  }
  const middle = () => tabs[1]
  const road = async (name, mode, act) => {
    await closeChats()
    await openNotes(mode)
    const tabsBefore = mainTabs().length
    await act()
    await until(() => !!svc.getSessionByFile(chatPath), 5000)
    await wait(700)
    const attached = new Set(mainTabs())
    const group = middle().parent
    report[name] = {
      tabs: tabs.map((l) => (attached.has(l) ? (l.view?.file?.path ?? null) : null)),
      inFront: describeLeaf(group?.children?.[group.currentTab]),
      mostRecent: describeLeaf(app.workspace.getMostRecentLeaf(app.workspace.rootSplit)),
      active: describeLeaf(app.workspace.activeLeaf),
      tabsBefore,
      tabsAfter: attached.size,
      inPanel: !!svc.getSessionByFile(chatPath) && app.workspace.getLeavesOfType('abele-ai-sidebar-view')
        .some(l => l.getRoot() === app.workspace.rightSplit || l.getRoot() === app.workspace.leftSplit),
      chatLeaves: chatLeaves(),
      mainChatKept: attached.has(mainChat) && mainChat.view.getViewType() === 'abele-ai-sidebar-view',
      selection: [...document.querySelectorAll('[data-selection-return]')].map(el => el.textContent).join(''),
    }
  }
  const tryRoad = async (name, mode, act) => {
    try {
      await road(name, mode, act)
    } catch (e) {
      report[name] = String((e && e.message) || e)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    }
  }
  const mod = { metaKey: true, ctrlKey: true }
  const explorerRow = async (chat) => {
    const explorer = app.workspace.getLeavesOfType('file-explorer')[0]
    if (explorer?.loadIfDeferred) await explorer.loadIfDeferred()
    // Awaited: it ends by making the explorer the active leaf, and left running it did that at
    // some moment of the road or other, which decided what the road saw as active.
    await app.internalPlugins.getPluginById('file-explorer').instance.revealInFolder(chat)
    app.workspace.setActiveLeaf(middle(), { focus: true })
    const found = await until(() => document.querySelector('.nav-file-title[data-path="' + chatPath + '"]'))
    if (!found) throw new Error('no explorer row for the chat')
    // Obsidian stamps the leaf made active with the time in whole milliseconds, and which leaf was
    // active last is read from those stamps: a press in the same millisecond as the note's focus
    // tied with it, and the note won. No hand presses that fast.
    await wait(50)
    return document.querySelector('.nav-file-title[data-path="' + chatPath + '"]')
  }
  // Pressed the way a pointer presses: the press makes the explorer the active leaf, as a real
  // one does, before the click opens the file.
  const press = (el, keys = {}) => {
    const o = { bubbles: true, cancelable: true, button: 0, ...keys }
    el.dispatchEvent(new PointerEvent('pointerdown', o))
    el.dispatchEvent(new MouseEvent('mousedown', o))
    el.dispatchEvent(new PointerEvent('pointerup', o))
    el.dispatchEvent(new MouseEvent('mouseup', o))
    el.dispatchEvent(new MouseEvent('click', o))
  }
  const noteLink = async (index = 0) => {
    const view = () => middle().view.containerEl
    const found = await until(() => view().querySelector('.markdown-preview-view a.internal-link'))
    if (!found) throw new Error('no link in the note')
    return view().querySelectorAll('.markdown-preview-view a.internal-link')[index]
  }
  const switcher = async (keys) => {
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
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, ...keys }))
  }

  try {
    // A user may also keep a chat view in a main-area tab. File opens still belong to the sidebar.
    mainChat = app.workspace.getLeaf('tab')
    await mainChat.setViewState({ type: 'abele-ai-sidebar-view', active: true })
    // ── seed ──
    let dir = ''
    for (const part of base.split('/')) {
      dir = dir ? dir + '/' + part : part
      if (!app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir)
        createdDirs.unshift(dir)
      }
    }
    for (const path of notePaths) {
      await app.vault.create(path, 'Open the chat: [[' + ${JSON.stringify(CHAT)} + '.abchat]]\\n')
      created.push(path)
    }
    const meta = (title) => JSON.stringify({ v: 2, k: 'meta', type: 'abele-chat', created: '2026-09-26', title,
      summary: 'A chat the open probe wrote.' })
    const msg = { k: 'msg', id: 'a0', role: 'user', content: 'Hello', timestamp: 1790000000000 }
    const chat = await app.vault.create(chatPath, meta(${JSON.stringify(CHAT)}) + '\\n' + JSON.stringify(msg) + '\\n')
    created.push(chatPath)
    const withChat = { ...msg, content: 'Look at this one', attachments: [chatPath] }
    const host = await app.vault.create(hostPath, meta(${JSON.stringify(HOST)}) + '\\n' + JSON.stringify(withChat) + '\\n')
    created.push(hostPath)
    await svc.openChatFile(chat)
    const selectionSession=svc.getSessionByFile(chatPath)
    let sequence=0
    const revision=await selectionSession.ensureSelectionRevision('a0',{nextId:()=> 'sample-open-'+(++sequence),project:text=>({version:'chat-text-v1',text})})
    const range={space:'rendered',start:0,end:5}
    const snapshot={text:'Hello',sentence:'Hello',title:'Sample chat',pathHint:chatPath,source:{kind:'chat',...revision.reference,role:'user',author:'user',quote:'Hello',range,projectionVersion:'chat-text-v1',context:{before:'',after:''}}}
    const anchor=await selectionSession.ensureChatAnchor(snapshot)
    const note=app.vault.getAbstractFileByPath(notePaths[1])
    await app.vault.modify(note,(await app.vault.read(note))+'\\n[['+chatPath+'#abele-selection='+revision.reference.chatId+'/'+anchor.id+'|Return to selection]]\\n')
    await closeChats()
    await storage.refreshHistory()

    await tryRoad('explorer', 'source', async () => press(await explorerRow(chat)))
    await tryRoad('explorerNewTab', 'source', async () => press(await explorerRow(chat), mod))
    await tryRoad('link', 'preview', async () => (await noteLink()).click())
    await tryRoad('selectionLink', 'preview', async () => (await noteLink(1)).click())
    await tryRoad('linkNewTab', 'preview', async () =>
      (await noteLink()).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mod })))
    await tryRoad('switcher', 'source', () => switcher({}))
    await tryRoad('switcherNewTab', 'source', () => switcher(mod))
    await tryRoad('newTab', 'source', async () => { await app.workspace.getLeaf('tab').openFile(chat) })
    // A chat attached to a message, clicked in the chat panel: the focus is in the panel then.
    await tryRoad('attached', 'source', async () => {
      await svc.openChatFile(host)
      await svc.revealSidebar()
      const panel = app.workspace.getLeavesOfType('abele-ai-sidebar-view')
        .find(l => l.getRoot() === app.workspace.rightSplit || l.getRoot() === app.workspace.leftSplit)
      const chip = () => panel?.view.containerEl.querySelector('.abele-chat-msg__attachment-chip')
      if (!(await until(() => chip()))) throw new Error('no attached chat in the message')
      app.workspace.setActiveLeaf(panel, { focus: true })
      chip().click()
    })
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    await closeChats()
    for (const l of tabs) l.detach()
    mainChat?.detach()
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

/** The three tabs as they were, the middle one still in front, and the chat in the panel only. */
const untouched = (
  road: Road | string | undefined,
  focus: 'note' | 'panel' | 'explorer' = 'note'
) => {
  expect(typeof road).toBe('object')
  const r = road as Road
  expect(r.tabs).toEqual(NOTES.map((n) => `${n}.md`))
  expect(r.inFront).toBe(`${NOTES[1]}.md`)
  expect(r.mostRecent).toBe(`${NOTES[1]}.md`)
  // The focus stays where the click was: the note, or the side panel clicked in.
  const focused = {
    note: `${NOTES[1]}.md`,
    panel: 'abele-ai-sidebar-view',
    explorer: 'file-explorer',
  }
  expect(r.active).toBe(focused[focus])
  expect(r.tabsAfter).toBe(r.tabsBefore)
  expect(r.inPanel).toBe(true)
  expect(r.chatLeaves).toBe(0)
  expect(r.mainChatKept).toBe(true)
}

describe.skipIf(!available)('opening a chat file the ways Obsidian opens files, in the app', () => {
  let report: Report = {}

  beforeAll(() => {
    const raw = evalRaw(script, 120_000)
    report = JSON.parse(raw) as Report
    console.info(`\n  vault ${activeVaultName()}\n  ${JSON.stringify(report, null, 2)}\n`)
  }, 135_000)

  it('runs to the end', () => {
    expect(report.error ?? '').toBe('')
  })

  // A plain click: Obsidian makes the tab it asked to open the file active, as for any file, and
  // that tab still holds its note. Asking for a new tab gives the focus back to the explorer, as
  // the blank tab that goes gives it back to whatever had it.
  it('from the file explorer: to the chat panel, the tabs left as they were', () => {
    untouched(report.explorer)
  })

  it('from the file explorer, asking for a new tab: the same', () => {
    untouched(report.explorerNewTab, 'explorer')
  })

  it('from a link in the note: to the chat panel, the tabs left as they were', () => {
    untouched(report.link)
  })

  it('from a selection backlink: leaves the note in place and highlights only the verified range', () => {
    untouched(report.selectionLink)
    expect((report.selectionLink as Road).selection).toBe('Hello')
  })

  it('from a link in the note, asking for a new tab: the same', () => {
    untouched(report.linkNewTab)
  })

  it('from the quick switcher: to the chat panel, the tabs left as they were', () => {
    untouched(report.switcher)
  })

  it('from the quick switcher, asking for a new tab: the same', () => {
    untouched(report.switcherNewTab)
  })

  it('into a new tab: to the chat panel, no blank tab left behind, the same tab in front', () => {
    untouched(report.newTab)
  })

  it('a chat attached to a message: a tab in the panel, the note tabs left as they were', () => {
    untouched(report.attached, 'panel')
  })
})

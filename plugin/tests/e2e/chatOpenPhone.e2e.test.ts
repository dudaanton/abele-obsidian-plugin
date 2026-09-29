/**
 * A chat opened on a phone, with a tap, goes to the chat panel, and the note in front stays in
 * front.
 *
 * A phone shows one tab at a time and keeps the chat panel and the file list in drawers, so a tap
 * takes other roads than a desktop click: the drawer closes as the file opens, the chat panel
 * comes out of its drawer. Three notes are open in three tabs with the middle one in front, and
 * three taps are tried — a chat attached to a message, in the chat panel; a chat file in the file
 * list; a link to a chat in the note — each asked afterwards whether the same three tabs hold the
 * same notes, with the middle one still the tab in front.
 *
 * Under `emulateMobile` in a 390×844 window on the desktop the taps are clicks; on a real phone
 * they would be fingers, through the harness's host. Writes three notes and two
 * chats of its own and removes them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

// Written for the phone too (the taps go through the harness's host there), but not yet run
// there, so it names only the desktop until it is green on a real phone.
targets('desktop')

const NOTES = ['Phone probe first', 'Phone probe note', 'Phone probe last']
const CHAT = 'Phone open probe chat'
const HOST = 'Phone message with an attachment'

interface Road {
  tabs: (string | null)[]
  inFront: string | null
  mostRecent: string | null
  tabsBefore: number
  tabsAfter: number
  inPanel: boolean
  chatLeaves: number
}

type Report = Partial<Record<'attached' | 'explorer' | 'link', Road | string>> & {
  error?: string
  mobile?: boolean
}

const script = `(async () => {
  const T = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 5000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const v = fn()
      if (v) return v
      await wait(100)
    }
    return null
  }
  // A finger on a phone, a click under emulation.
  const tap = async (el) => {
    el.scrollIntoView({ block: 'center' })
    await wait(200)
    const r = el.getBoundingClientRect()
    if (window.__e2eHost) await window.__e2eHost.tap(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    else el.click()
  }
  const report = { mobile: !!app.isMobile }
  const created = []
  const createdDirs = []
  const svc = T.ChatService.getInstance()
  const storage = T.ChatStorage.getInstance()
  const tabs = []

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
  const closeDrawers = async () => {
    app.workspace.leftSplit.collapse()
    app.workspace.rightSplit.collapse()
    await wait(400)
  }
  const describeLeaf = (l) => (l ? (l.view?.file?.path ?? l.view?.getViewType() ?? null) : null)
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
    await wait(400)
  }
  const middle = () => tabs[1]
  const road = async (name, mode, act) => {
    try {
      await closeChats()
      await closeDrawers()
      await openNotes(mode)
      const tabsBefore = mainTabs().length
      await act()
      await until(() => !!svc.getSessionByFile(chatPath), 5000)
      await wait(1000)
      const attached = new Set(mainTabs())
      const group = middle().parent
      report[name] = {
        tabs: tabs.map((l) => (attached.has(l) ? (l.view?.file?.path ?? null) : null)),
        inFront: describeLeaf(group?.children?.[group.currentTab]),
        mostRecent: describeLeaf(app.workspace.getMostRecentLeaf(app.workspace.rootSplit)),
        tabsBefore,
        tabsAfter: attached.size,
        inPanel: !!svc.getSessionByFile(chatPath),
        chatLeaves: chatLeaves(),
      }
    } catch (e) {
      report[name] = String((e && e.message) || e)
    }
  }

  try {
    let dir = ''
    for (const part of base.split('/')) {
      dir = dir ? dir + '/' + part : part
      if (!app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir)
        createdDirs.unshift(dir)
      }
    }
    for (const path of notePaths) {
      if (app.vault.getAbstractFileByPath(path)) await app.vault.delete(app.vault.getAbstractFileByPath(path))
      await app.vault.create(path, 'Open the chat: [[' + ${JSON.stringify(CHAT)} + '.abchat]]\\n')
      created.push(path)
    }
    const meta = (title) => JSON.stringify({ v: 2, k: 'meta', type: 'abele-chat', created: '2026-09-26', title,
      summary: 'A chat the phone probe wrote.' })
    const msg = { k: 'msg', id: 'a0', role: 'user', content: 'Hello', timestamp: 1790000000000 }
    for (const path of [chatPath, hostPath]) {
      const old = app.vault.getAbstractFileByPath(path)
      if (old) await app.vault.delete(old)
    }
    const chat = await app.vault.create(chatPath, meta(${JSON.stringify(CHAT)}) + '\\n' + JSON.stringify(msg) + '\\n')
    created.push(chatPath)
    const withChat = { ...msg, content: 'Look at this one', attachments: [chatPath] }
    const host = await app.vault.create(hostPath, meta(${JSON.stringify(HOST)}) + '\\n' + JSON.stringify(withChat) + '\\n')
    created.push(hostPath)
    await storage.refreshHistory()

    // A chat attached to a message, tapped in the chat panel's drawer.
    await road('attached', 'source', async () => {
      await svc.openChatFile(host)
      await svc.revealSidebar()
      const panel = app.workspace.getLeavesOfType('abele-ai-sidebar-view')[0]
      const chip = await until(() => panel?.view.containerEl.querySelector('.abele-chat-msg__attachment-chip'))
      if (!chip) throw new Error('no attached chat in the message')
      await wait(600)
      await tap(chip)
    })

    // A chat file tapped in the file list's drawer.
    await road('explorer', 'source', async () => {
      const explorer = app.workspace.getLeavesOfType('file-explorer')[0]
      if (!explorer) throw new Error('no file list')
      if (explorer.loadIfDeferred) await explorer.loadIfDeferred()
      app.workspace.revealLeaf(explorer)
      app.internalPlugins.getPluginById('file-explorer').instance.revealInFolder(chat)
      const row = await until(() => document.querySelector('.nav-file-title[data-path="' + chatPath + '"]'))
      if (!row) throw new Error('no row for the chat in the file list')
      await wait(600)
      await tap(row)
    })

    // A link to the chat, tapped in the note in reading mode.
    await road('link', 'preview', async () => {
      const link = await until(() => middle().view.containerEl.querySelector('.markdown-preview-view a.internal-link'))
      if (!link) throw new Error('no link in the note')
      await tap(link)
    })
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    await closeChats()
    await closeDrawers()
    for (const l of tabs) l.detach()
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
  return JSON.stringify(report)
})()`

const available = isObsidianRunning() && hasTestApi()

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const windowSize = (): [number, number] =>
  JSON.parse(
    evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
  ) as [number, number]

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

/** The same three tabs, the middle one still in front, and the chat in the panel only. */
const untouched = (road: Road | string | undefined) => {
  expect(typeof road).toBe('object')
  const r = road as Road
  expect(r.tabs).toEqual(NOTES.map((n) => `${n}.md`))
  expect(r.inFront).toBe(`${NOTES[1]}.md`)
  expect(r.mostRecent).toBe(`${NOTES[1]}.md`)
  expect(r.tabsAfter).toBe(r.tabsBefore)
  expect(r.inPanel).toBe(true)
  expect(r.chatLeaves).toBe(0)
}

describe.skipIf(!available)('opening a chat with a tap on a phone', () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    if (!onPhone()) {
      size = windowSize()
      await reloadApp('app.emulateMobile(true)')
      await setWindowSize(390, 844)
      await reloadApp('window.location.reload()')
    }
    report = JSON.parse(await evalLong(script, 120_000)) as Report
    console.info(`\n  ${JSON.stringify(report, null, 2)}\n`)
  }, 300_000)

  afterAll(async () => {
    if (onPhone()) return
    if (size[0]) await setWindowSize(size[0], size[1])
    await reloadApp('app.emulateMobile(false)')
  }, 180_000)

  it('runs to the end, in the phone layout', () => {
    expect(report.error ?? '').toBe('')
    expect(report.mobile).toBe(true)
  })

  it('a chat attached to a message: to the chat panel, the note left in front', () => {
    untouched(report.attached)
  })

  it('a chat file in the file list: to the chat panel, the note left in front', () => {
    untouched(report.explorer)
  })

  it('a link to a chat in the note: to the chat panel, the note left in front', () => {
    untouched(report.link)
  })
})

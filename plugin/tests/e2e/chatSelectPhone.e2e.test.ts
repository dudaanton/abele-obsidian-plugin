/**
 * Selecting words in a chat with a finger, under `emulateMobile` at 390×844, touches sent through
 * the app's own input pipeline (the DevTools protocol).
 *
 * The owner, 2026-09-27: on the phone the words could not be selected, "Ask here" jumped up at
 * once. Now nothing shows while the finger is down, whatever the selection does under it, nor on
 * the long press's menu event; once the finger is lifted and the words stay put, a bar with
 * "Ask here" comes up under them, clear of the handles; the words moving again without a touch
 * (an iOS handle) take it down until they stop; a tap on it opens a comment on those words.
 * Pictures go to `/tmp/abele-phone/chat-select-*.png`.
 *
 * What cannot be checked here: iOS's own handles and callout, which WebKit draws itself. The
 * selection they would make is set by the test while the finger moves.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const CHAT = 'AI/Chats/Abele chat select phone probe.abchat'
const PHONE = { width: 390, height: 844 }
const SHOTS = shotDir('abele-phone')

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const windowSize = (): [number, number] =>
  evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}
const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
  runCli(['dev:debug', 'on'], 30_000)
}

interface Report {
  error?: string
  /** Bars or menus seen at any moment while the finger was down. */
  whileDown: number
  /** A bar 300 ms after the finger came up — before the words have settled. */
  tooSoon: boolean
  /** The bar once settled, and the words it belongs to, in the window. */
  bar?: { top: number; bottom: number; left: number; right: number; text: string }
  words?: { top: number; bottom: number }
  /** Right after the words moved without a touch, and once they had stopped again. */
  duringHandle: boolean
  afterHandle: boolean
  /** The comment the bar's tap opened. */
  asked?: { kind: string; quote: string }
  leftBehind: string[]
}

const script = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const touch = (type, x, y) =>
    cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] })
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/chat-select-' + name + '.png', img.toPNG()) }
  }
  const chats = window.__abeleTest.ChatService.getInstance()
  const service = window.__abeleTest.CommentService.getInstance()
  const CHAT = ${JSON.stringify(CHAT)}
  const report = { whileDown: 0, tooSoon: false, duringHandle: true, afterHandle: false, leftBehind: [] }
  const made = []
  const bar = () => {
    const el = document.querySelector('.abele-chat-selection.abele-chat-selection_placed')
    return el && el.getClientRects().length ? el : null
  }
  const popped = () => (bar() ? 1 : 0) + document.querySelectorAll('.menu').length
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }

  try {
    for (const dir of ['AI', 'AI/Chats']) if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
    const stale = app.vault.getAbstractFileByPath(CHAT)
    if (stale) await app.vault.delete(stale)
    const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Chat select phone probe', providerId: '', modelId: '', created: '2026-09-27' }
    const u1 = { k: 'msg', id: 'u1', role: 'user', content: 'How do I get to Riga?', timestamp: 1790000000000 }
    const a1 = { k: 'msg', id: 'a1', role: 'assistant', parentId: 'u1', content: 'Take the night train from Vilnius, it arrives in the morning and the station is in the old town.', timestamp: 1790000001000 }
    const file = await app.vault.create(CHAT, [meta, u1, a1].map((r) => JSON.stringify(r)).join('\\n') + '\\n')
    await chats.openChatFile(file)
    await chats.revealSidebar()
    const md = await until(() => document.querySelector('.abele-ai-chat [data-message-id="a1"] [data-ask-message="a1"]'))
    if (!md) throw new Error('the answer is not on screen')
    await wait(800)

    const text = [...md.querySelectorAll('p')].map((p) => p.firstChild).find((n) => n && n.nodeValue.includes('night train'))
    const range = (from, to) => { const r = document.createRange(); r.setStart(text, text.nodeValue.indexOf(from)); r.setEnd(text, text.nodeValue.indexOf(to) + to.length); return r }
    const select = (r) => { const s = document.getSelection(); s.removeAllRanges(); s.addRange(r) }
    const start = range('night', 'night').getBoundingClientRect()
    const x = start.left + 4, y = (start.top + start.bottom) / 2

    // A long press, then the finger drags the words out word by word.
    await touch('touchStart', x, y)
    await wait(500)
    select(range('night', 'night'))
    md.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    for (const to of ['train', 'from', 'Vilnius', 'train']) {
      await wait(350)
      const r = range('night', to)
      const end = r.getBoundingClientRect()
      await touch('touchMove', end.right - 2, (end.top + end.bottom) / 2)
      select(r)
      report.whileDown = Math.max(report.whileDown, popped())
    }
    await wait(900)
    report.whileDown = Math.max(report.whileDown, popped())
    await shoot('finger-down')
    await touch('touchEnd')

    await wait(300)
    report.tooSoon = !!bar()
    const shown = await until(() => bar(), 3000)
    await wait(150)
    if (shown) report.bar = { ...box(shown), text: shown.textContent.trim() }
    report.words = box(document.getSelection().getRangeAt(0))
    await shoot('settled')

    // An iOS handle: the words move and the page hears no touch.
    select(range('night', 'Vilnius'))
    await wait(50)
    report.duringHandle = !!bar()
    report.afterHandle = !!(await until(() => bar(), 3000))

    const b = bar()
    if (b) {
      const r = b.querySelector('button').getBoundingClientRect()
      const before = chats.activeSession.value
      await touch('touchStart', r.left + r.width / 2, r.top + r.height / 2)
      await wait(60)
      await touch('touchEnd')
      const s = await until(() => chats.activeSession.value !== before && chats.activeSession.value.kind === 'comment' && chats.activeSession.value, 8000)
      if (s) { made.push(s.commentId); report.asked = { kind: s.kind, quote: (s.anchor.value && s.anchor.value.quote) || '' } }
      await shoot('asked')
    }
  } catch (e) {
    report.error = String((e && e.stack) || e)
  } finally {
    try {
      document.getSelection().removeAllRanges()
      const chat = chats.getSessionByFile(CHAT)
      if (chat) await chats.deleteChat(chat.id)
      else {
        await service.removeCommentsOn(CHAT)
        const f = app.vault.getAbstractFileByPath(CHAT)
        if (f) await app.vault.delete(f)
      }
      report.leftBehind = made.filter((id) => id && app.vault.getAbstractFileByPath(service.commentPath(id)))
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
  }
  return JSON.stringify(report)
})()`

describe.runIf(available)('selecting words in a chat with a finger', () => {
  let report: Report
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await reload('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reload('window.location.reload()')
    report = evalAsync<Report>(script, 120_000)
  }, 240_000)

  afterAll(async () => {
    if (evalJson<boolean>('app.isMobile')) await reload('app.emulateMobile(false)')
    if (size[0]) await setWindowSize(size[0], size[1])
  }, 180_000)

  it('got through without an error of its own', () => {
    expect(report.error).toBeUndefined()
  })

  it('shows nothing while the finger is down, nor the long press’s menu', () => {
    expect(report.whileDown).toBe(0)
  })

  it('waits for the words to settle after the finger is lifted', () => {
    expect(report.tooSoon).toBe(false)
    expect(report.bar?.text).toContain('Ask here')
  })

  it('sits clear of the handles: a finger’s width under the words, or over the system menu', () => {
    const { bar, words } = report
    const under = bar!.top - words!.bottom
    const over = words!.top - bar!.bottom
    expect(under >= 30 || over >= 60).toBe(true)
    expect(bar!.left).toBeGreaterThanOrEqual(0)
    expect(bar!.right).toBeLessThanOrEqual(PHONE.width)
  })

  it('goes while a handle moves the words, and comes back once they stop', () => {
    expect(report.duringHandle).toBe(false)
    expect(report.afterHandle).toBe(true)
  })

  it('a tap on it opens a comment on the words, and nothing is left behind', () => {
    expect(report.asked).toEqual({ kind: 'comment', quote: 'night train from Vilnius' })
    expect(report.leftBehind).toEqual([])
  })
})

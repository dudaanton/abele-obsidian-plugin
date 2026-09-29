/**
 * Finding words in the running app: in one long chat with the find bar, then across every chat
 * from the history, on a desktop and under `emulateMobile` at 390×844.
 *
 * A long chat holds the probe word four times: in its third message, far above what is mounted;
 * in an answer's reasoning, folded away; in a tool's result, shown only under the call's details, a screen or more above the end;
 * and in its last answer. Cmd/Ctrl+F in the chat (the header's button on a phone) opens the bar,
 * and the bar has to count all four, start at the reader, and walk up and down to each, mounting
 * and unfolding what it has to and painting the one shown inside the visible part of the chat.
 *
 * Then the command that searches every chat opens the history on its search. Typed there, the
 * word finds the long chat and a short one, not a third that does not hold it; the short one's
 * card shows the words around it, and opening it lands on the message with the word shown.
 *
 * The chats are written by the probe and removed afterwards. Requires Obsidian running with the
 * development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
  setBackgroundThrottling,
} from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()
const PHONE = { width: 390, height: 844 }

interface Shown {
  /** The find bar's counter. */
  count: string
  /** The message the painted current match is in. */
  message: string | null
  /** The part of it. */
  part: string | null
  /** The text painted as the current match. */
  text: string
  /** Whether the current match lies inside the visible part of the messages. */
  inView: boolean
}

interface Report {
  error?: string
  /** Whether the bar opened, from the key on a desktop or the button on a phone. */
  opened: boolean
  focused: boolean
  /** The bar straight after typing, and after each step. */
  typed: Shown | null
  up1: Shown | null
  up2: Shown | null
  up3: Shown | null
  down1: Shown | null
  wrapped: Shown | null
  /** Whether the reasoning's fold was open once a match inside it was shown. */
  thinkingOpen: boolean
  /** Whether Esc closed the bar and took the painted matches away. */
  closed: boolean
  cleared: boolean
  /** The chats the history listed for the word, by title. */
  listed: string[]
  snippet: string
  /** The chat in front once the result was opened, and what the bar then showed. */
  openedChat: string | null
  landed: Shown | null
}

const LONG = 'Chat search probe long'
const SHORT = 'Chat search probe short'
const OTHER = 'Chat search probe other'

const script = (phone: boolean) => `(async () => {
  const T = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 5000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const v = fn()
      if (v) return v
      await wait(40)
    }
    return null
  }
  const WORD = 'marigold'
  const report = { opened: false, focused: false, thinkingOpen: false, closed: false, cleared: false, listed: [], snippet: '', openedChat: null }
  const svc = T.ChatService.getInstance()
  const storage = T.ChatStorage.getInstance()
  const cfg = T.AbeleConfig.getInstance().ai
  const base = cfg.chatFolder.replace(/\\/?\\{\\{.*$/, '').replace(/\\/$/, '')
  const paths = [${JSON.stringify(LONG)}, ${JSON.stringify(SHORT)}, ${JSON.stringify(OTHER)}].map((t) => base + '/' + t + '.abchat')
  const createdDirs = []
  const CONTENT_KEY = 'abele-chat-history-content'
  const beforeContent = app.loadLocalStorage(CONTENT_KEY)

  const log = (title, messages) => {
    const meta = { v: 2, k: 'meta', type: 'abele-chat', title, providerId: '', modelId: '', created: '2026-01-02' }
    return [meta, ...messages].map((r, i) => JSON.stringify(i ? { k: 'msg', ...r } : r)).join('\\n') + '\\n'
  }
  const chain = (list) => list.map((m, i) => ({ timestamp: 1767312000000 + i * 60000, ...m, id: 'm' + (i + 1), parentId: i ? 'm' + i : undefined }))
  const filler = (i) => 'Message ' + i + ' about the sample vegetable beds, the paths between them and the order the rows are watered in on a dry week.'
  const long = chain(Array.from({ length: 80 }, (_, i) => {
    const n = i + 1
    if (n === 3) return { role: 'user', content: 'Where do the Marigold seeds go this year?' }
    if (n === 20) return { role: 'assistant', content: 'Along the south edge.', thinking: 'The marigold keeps pests off the beans.' }
    if (n === 60) return { role: 'tool-call', content: '', toolName: 'read', toolParams: { path: 'Garden/sample-beds.md' }, toolResult: 'Bed four: beans, then a marigold border.', toolStatus: 'approved' }
    if (n === 80) return { role: 'assistant', content: 'So: marigolds at the south edge.' }
    return { role: n % 2 ? 'user' : 'assistant', content: filler(n) }
  }))
  const short = chain([
    { role: 'user', content: 'What goes around the herb spiral?' },
    { role: 'assistant', content: 'Thyme at the top, and a low marigold border at the foot of it.' },
  ])
  const other = chain([{ role: 'user', content: 'How deep is the pond?' }, { role: 'assistant', content: 'About a metre.' }])

  const box = () => [...document.querySelectorAll('.abele-ai-chat__messages')].find((el) => el.getClientRects().length)
  const bar = () => [...document.querySelectorAll('.abele-chat-find')].find((el) => el.getClientRects().length)
  const shown = () => {
    const b = bar()
    const count = b ? b.querySelector('.abele-chat-find__count').textContent.trim() : ''
    const h = CSS.highlights.get('abele-chat-find-current')
    const range = h ? [...h][0] : null
    if (!range) return { count, message: null, part: null, text: '', inView: false }
    const el = range.startContainer.parentElement
    const r = range.getBoundingClientRect()
    const bx = box().getBoundingClientRect()
    return {
      count,
      message: el.closest('[data-message-id]')?.dataset.messageId ?? null,
      part: el.closest('[data-find-part]')?.dataset.findPart ?? null,
      text: range.toString(),
      inView: r.height > 0 && r.top >= bx.top && r.bottom <= bx.bottom,
    }
  }
  // Waits for the bar to have moved and the page to have settled under it.
  const settle = async (before) => {
    await until(() => { const s = shown(); return s.message && (!before || s.count !== before.count || s.message !== before.message) }, 4000)
    await wait(700)
    return shown()
  }
  const key = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  const input = () => bar().querySelector('input')

  try {
    if (!CSS.highlights) throw new Error('this window cannot paint highlights')
    for (const dir of base.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))) {
      if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); createdDirs.unshift(dir) }
    }
    const contents = [log(${JSON.stringify(LONG)}, long), log(${JSON.stringify(SHORT)}, short), log(${JSON.stringify(OTHER)}, other)]
    const files = []
    for (let i = 0; i < paths.length; i++) {
      const stale = app.vault.getAbstractFileByPath(paths[i])
      if (stale) await app.vault.delete(stale)
      files.push(await app.vault.create(paths[i], contents[i]))
    }
    await storage.refreshHistory()

    await svc.openChatFile(files[0])
    await svc.revealSidebar()
    const el = await until(() => { const b = box(); return b && b.querySelector('[data-message-id="m80"]') && b })
    if (!el) throw new Error('the long chat did not open')
    await wait(500)

    // ── Find in the chat ──
    ${
      phone
        ? `const button = [...document.querySelectorAll('.abele-ai-chat__find')].find((b) => b.getClientRects().length)
    button.click()`
        : `// A click on the messages, then the key, as a person reading would.
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    // A press on text that takes no focus leaves the cursor nowhere; a dispatched one does not.
    document.activeElement?.blur()
    key(el, { key: 'f', code: 'KeyF', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac') })`
    }
    report.opened = !!(await until(bar, 2000))
    if (!report.opened) throw new Error('the find bar did not open')
    await wait(100)
    report.focused = document.activeElement === input()

    input().value = WORD
    input().dispatchEvent(new Event('input', { bubbles: true }))
    report.typed = await settle(null)
    key(input(), { key: 'Enter', shiftKey: true })
    report.up1 = await settle(report.typed)
    key(input(), { key: 'Enter', shiftKey: true })
    report.up2 = await settle(report.up1)
    report.thinkingOpen = !!box().querySelector('[data-message-id="m20"] details')?.open
    key(input(), { key: 'Enter', shiftKey: true })
    report.up3 = await settle(report.up2)
    key(input(), { key: 'Enter' })
    report.down1 = await settle(report.up3)
    // Up from the first one wraps round to the last.
    key(input(), { key: 'Enter', shiftKey: true })
    await settle(report.down1)
    key(input(), { key: 'Enter', shiftKey: true })
    report.wrapped = await settle(report.up3)

    key(input(), { key: 'Escape' })
    await wait(150)
    report.closed = !bar()
    report.cleared = ['abele-chat-find', 'abele-chat-find-current'].every((n) => !CSS.highlights.get(n)?.size)

    // ── Every chat, from the command ──
    app.commands.executeCommandById('abele:search-all-chats')
    const history = await until(() => document.querySelector('.abele-chat-history__search'), 4000)
    if (!history) throw new Error('the history did not open on its search')
    const contentSwitch = document.querySelector('.abele-chat-history [role="switch"]')
    if (contentSwitch?.getAttribute('aria-checked') !== 'true') contentSwitch?.click()
    history.value = WORD
    history.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => document.querySelectorAll('.abele-chat-history .abele-card').length && document.querySelector('.abele-chat-history__snippet'), 6000)
    await wait(300)
    const cards = [...document.querySelectorAll('.abele-chat-history .abele-card')]
    report.listed = cards.map((c) => c.querySelector('.abele-card__name').textContent.trim()).filter((t) => t.startsWith('Chat search probe')).sort()
    const shortCard = cards.find((c) => c.querySelector('.abele-card__name').textContent.includes(${JSON.stringify(SHORT)}))
    report.snippet = shortCard?.querySelector('.abele-chat-history__snippet')?.textContent.trim() ?? ''
    shortCard?.click()
    await until(() => svc.activeSession.value?.currentChatFile.value?.path === paths[1], 4000)
    report.openedChat = svc.activeSession.value?.currentChatFile.value?.basename ?? null
    report.landed = await settle(null)
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    try {
      app.saveLocalStorage(CONTENT_KEY, beforeContent ?? null)
      document.querySelector('.abele-chat-history')?.closest('.modal-container')?.querySelector('.modal-close-button, .modal-header-button')?.click()
      const b = bar()
      if (b) key(b.querySelector('input'), { key: 'Escape' })
      for (const p of paths) {
        const s = svc.getSessionByFile(p)
        if (s) await svc.closeTab(s.id)
        storage.removeHistoryEntry(p)
        const f = app.vault.getAbstractFileByPath(p)
        if (f) await app.vault.delete(f)
      }
      for (const dir of createdDirs) {
        const d = app.vault.getAbstractFileByPath(dir)
        if (d && d.children && !d.children.length) await app.vault.delete(d, true)
      }
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
  }
  return JSON.stringify(report)
})()`

const run = async (phone: boolean): Promise<Report> =>
  JSON.parse(await evalLong(script(phone), 120_000)) as Report

const expectFound = (get: () => Report) => {
  it('got through without an error of its own', () => {
    expect(get().error).toBeUndefined()
  })

  it('opens the find bar with the cursor in it', () => {
    expect(get().opened).toBe(true)
    expect(get().focused).toBe(true)
  })

  it('counts every match, mounted or not, folded or not, and starts at the reader', () => {
    const typed = get().typed!
    expect(typed.count).toBe('4 of 4')
    expect(typed.message).toBe('m80')
    expect(typed.inView).toBe(true)
  })

  it("walks up into a tool's result, an answer's reasoning, and a message far above", () => {
    const { up1, up2, up3 } = get()
    expect([up1, up2, up3].map((s) => [s!.count, s!.message, s!.part])).toEqual([
      ['3 of 4', 'm60', 'result'],
      ['2 of 4', 'm20', 'thinking'],
      ['1 of 4', 'm3', 'content'],
    ])
    for (const s of [up1, up2, up3]) {
      expect(s!.text.toLowerCase()).toBe('marigold')
      expect(s!.inView).toBe(true)
    }
    expect(get().thinkingOpen).toBe(true)
  })

  it('walks back down, and wraps round from the first to the last', () => {
    expect(get().down1!.count).toBe('2 of 4')
    expect(get().down1!.inView).toBe(true)
    expect(get().wrapped!.count).toBe('4 of 4')
    expect(get().wrapped!.inView).toBe(true)
  })

  it('closes with Esc and takes the marks away', () => {
    expect(get().closed).toBe(true)
    expect(get().cleared).toBe(true)
  })

  it('finds the chats holding the word from the history, with the words around it', () => {
    expect(get().listed).toEqual([LONG, SHORT])
    expect(get().snippet).toContain('a low marigold border')
  })

  it('opens a result on the message the word is in, with the word shown', () => {
    expect(get().openedChat).toBe(SHORT)
    const landed = get().landed!
    expect(landed.message).toBe('m2')
    expect(landed.count).toBe('1 of 1')
    expect(landed.text).toBe('marigold')
    expect(landed.inView).toBe(true)
  })
}

describe.runIf(available)('finding words in chats, on a desktop', () => {
  let report: Report

  beforeAll(async () => {
    setBackgroundThrottling(false)
    report = await run(false)
    console.log('desktop', JSON.stringify(report))
  }, 150_000)

  afterAll(() => {
    if (available) setBackgroundThrottling(true)
  })

  expectFound(() => report)
})

describe.runIf(available)('finding words in chats, on a phone', () => {
  let report: Report
  let size: [number, number] = [0, 0]

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

  beforeAll(async () => {
    size = windowSize()
    await reload('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reload('window.location.reload()')
    report = await run(true)
    console.log('phone', JSON.stringify(report))
  }, 300_000)

  afterAll(async () => {
    try {
      if (evalJson<boolean>('app.isMobile')) await reload('app.emulateMobile(false)')
    } finally {
      if (size[0]) await setWindowSize(size[0], size[1])
    }
  }, 180_000)

  expectFound(() => report)
})

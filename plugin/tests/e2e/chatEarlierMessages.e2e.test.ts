/**
 * The messages a chat holds back above the page it mounts, reached in the running app.
 *
 * A chat mounts the end of a conversation and reveals the rest a page at a time. Revealing used
 * to wait for a scroll near the top and nothing else, and a page of an agent's work, folded into
 * a few runs, can be shorter than the box: nothing to scroll, so nothing was ever revealed, and
 * the marker saying how many were held back could not be pressed. Here every way back is driven
 * to the start of the conversation: scrolling to the top again and again, pressing the marker,
 * and a page too short to scroll, in a chat opened the way history opens one and with a branch
 * that must stay hidden.
 */
import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-phone')

interface EarlierReport {
  error?: string
  markerButton: boolean
  markerFocusable: boolean
  scrollSteps: number
  scrollMaxDrift: number
  scrollReachedStart: boolean
  hiddenBranch: boolean
  clickGrew: boolean
  clickDrift: number
  clickBoxChange: number
  clickLog: string[]
  clickSteps: number
  clickReachedStart: boolean
  shortReachedStart: boolean
  shortMarkerGone: boolean
}

const script = (layout: string) => `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const chats = window.__abeleTest.ChatService.getInstance()
  const box = () => [...document.querySelectorAll('.abele-ai-chat__messages')].find(el => el.getClientRects().length)
  const marker = () => box()?.querySelector('.abele-ai-chat__older button')
  const item = id => box()?.querySelector('[data-message-id="' + id + '"]')
  const mounted = () => box()?.querySelectorAll('[data-message-id]').length ?? 0
  const offset = el => el.getBoundingClientRect().top - box().getBoundingClientRect().top
  const until = async (fn, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(30)) { try { if (fn()) return true } catch {} } return false }
  // The first message in view, the one the reader is looking at.
  const firstInView = () => [...box().querySelectorAll('.abele-chat-msg[data-message-id]')].find(el => el.getBoundingClientRect().bottom > box().getBoundingClientRect().top + 1)
  // Settled: the list holding still for a few polls in a row.
  const settle = async (ms = 3000) => {
    let last = null, count = 0
    for (const end = Date.now() + ms; Date.now() < end; await wait(60)) {
      const key = box() ? box().scrollTop + ':' + box().scrollHeight + ':' + mounted() : ''
      count = key === last ? count + 1 : 0
      last = key
      if (count >= 4) return
    }
  }
  const capture = async name => {
    await wait(300)
    const path = ${JSON.stringify(SHOTS + '/')} + 'earlier-' + ${JSON.stringify(layout.replace(/ /g, '-'))} + '-' + name + '.png'
    if (window.__e2eHost) return window.__e2eHost.shot(path)
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG())
  }
  // The current leaf is explicit: the branch must not become the conversation on screen.
  const meta = (title, activeLeafId) => ({ v: 2, k: 'meta', type: 'abele-chat', title, created: '2023-11-14', activeLeafId })
  const long = () => {
    const records = []
    for (let i = 0; i < 150; i++) {
      records.push({ k: 'msg', id: 'q' + i, parentId: i ? 'a' + (i - 1) : undefined, role: 'user', content: 'Sample question ' + i, timestamp: 1700000000000 + i * 3600000 })
      records.push({ k: 'msg', id: 'a' + i, parentId: 'q' + i, role: 'assistant', content: 'A sample answer about a garden, number ' + i + '.\\n\\n' + 'The beds beside the path need room for the herbs. '.repeat(4), timestamp: 1700000001000 + i * 3600000 })
    }
    // Another answer to the first question: a branch the conversation on screen is not on.
    records.push({ k: 'msg', id: 'other', parentId: 'q0', role: 'assistant', content: 'Hidden alternate answer', timestamp: 1700000002000 })
    return records
  }
  const short = () => {
    // The agent at work: one question, then call after call, folded into a single run.
    const records = [{ k: 'msg', id: 's0', role: 'user', content: 'Sort the sample notes', timestamp: 1700000000000 }]
    for (let i = 1; i <= 120; i++)
      records.push({ k: 'msg', id: 's' + i, parentId: 's' + (i - 1), role: 'tool-call', content: '', toolName: 'read', toolParams: { path: 'Samples/sample-' + i + '.md' }, toolResult: 'Sample note ' + i, toolStatus: 'approved', timestamp: 1700000000000 + i * 1000 })
    records.push({ k: 'msg', id: 's121', parentId: 's120', role: 'assistant', content: 'The sample notes are sorted.', timestamp: 1700000200000 })
    return records
  }
  const fixtures = [
    { path: 'sample-earlier-scroll.abchat', title: 'Sample earlier scroll', leaf: 'a149', records: long() },
    { path: 'sample-earlier-click.abchat', title: 'Sample earlier click', leaf: 'a149', records: long() },
    { path: 'sample-earlier-short.abchat', title: 'Sample earlier short', leaf: 's121', records: short() },
  ]
  const tabs = [...chats.tabOrder.value]
  const active = chats.activeTabId.value
  const files = []
  const report = {}
  // Opened the way the history list opens a chat: into a tab of its own.
  const openAsHistory = async fixture => {
    const file = files.find(f => f.path === fixture.path)
    if (!chats.canCreateTab) throw Error('no room for a scratch chat tab')
    const tab = chats.createTab()
    await chats.openChatInTab(tab, file)
    await chats.revealSidebar({ focus: false })
  }
  try {
    for (const fixture of fixtures) {
      if (app.vault.getAbstractFileByPath(fixture.path)) throw Error('Sample path is occupied: ' + fixture.path)
      files.push(await app.vault.create(fixture.path, [meta(fixture.title, fixture.leaf), ...fixture.records].map(JSON.stringify).join('\\n') + '\\n'))
    }

    // Scrolling to the top, again and again, until the conversation starts.
    await openAsHistory(fixtures[0])
    if (!(await until(() => item('a149')))) throw Error('The long sample chat did not open')
    await settle()
    report.markerButton = marker()?.tagName === 'BUTTON'
    await capture('opened')
    let steps = 0, maxDrift = 0
    while (marker() && steps < 20) {
      steps++
      const before = mounted()
      box().scrollTop = 0
      const anchor = firstInView()
      const at = offset(anchor)
      if (!(await until(() => mounted() > before, 3000))) throw Error('Scrolling to the top revealed nothing at step ' + steps)
      await settle()
      if (anchor.isConnected) maxDrift = Math.max(maxDrift, Math.abs(offset(anchor) - at))
      if (steps === 1) await capture('scrolled-once')
    }
    report.scrollSteps = steps
    report.scrollMaxDrift = maxDrift
    report.scrollReachedStart = !!item('q0') && !marker()
    report.hiddenBranch = !item('other')
    box().scrollTop = 0
    await capture('start')

    // Pressing the marker, which is a button a key can reach.
    await openAsHistory(fixtures[1])
    if (!(await until(() => item('a149')))) throw Error('The click sample chat did not open')
    await settle()
    const button = marker()
    button.focus({ preventScroll: true })
    report.markerFocusable = document.activeElement === button
    button.blur()
    let clicks = 0, clickDrift = 0, boxChange = 0
    report.clickLog = []
    while (marker() && clicks < 20) {
      clicks++
      const before = mounted()
      const anchor = firstInView()
      const at = offset(anchor)
      const height = box().clientHeight
      const focused = document.activeElement?.className || document.activeElement?.tagName
      marker().click()
      if (!(await until(() => mounted() > before, 3000))) break
      await settle()
      boxChange = Math.max(boxChange, Math.abs(box().clientHeight - height))
      report.clickLog.push(clicks + ': ' + anchor.dataset.messageId + ' at ' + Math.round(at) + ' -> ' + Math.round(offset(anchor)) + ', box ' + height + ' -> ' + box().clientHeight + ', focus ' + focused)
      if (anchor.isConnected) clickDrift = Math.max(clickDrift, Math.abs(offset(anchor) - at))
      if (clicks === 1) report.clickGrew = true
    }
    report.clickGrew = !!report.clickGrew
    report.clickSteps = clicks
    report.clickDrift = clickDrift
    report.clickBoxChange = boxChange
    report.clickReachedStart = !!item('q0') && !marker()

    // A page too short to scroll: the earlier pages come by themselves.
    await openAsHistory(fixtures[2])
    if (!(await until(() => item('s121')))) throw Error('The short sample chat did not open')
    report.shortMarkerGone = await until(() => !marker(), 6000)
    await settle()
    report.shortReachedStart = !!item('s0')
    await capture('short')
  } catch (e) { report.error = String(e?.message || e) }
  finally {
    for (const id of [...chats.tabOrder.value]) if (!tabs.includes(id)) await chats.closeTab(id)
    if (active) chats.activeTabId.value = active
    chats.saveTabs()
    for (const file of files) {
      const left = app.vault.getAbstractFileByPath(file.path)
      if (left) await app.vault.delete(left)
    }
  }
  return JSON.stringify(report)
})()`

describe.skipIf(!available)('earlier messages of a chat', () => {
  it.each(onPhone() ? ['phone'] : ['desktop', 'emulated phone'])(
    'are reached by scrolling, by the marker and by themselves on a short page, on %s',
    async (layout) => {
      const run = async () => JSON.parse(await evalLong(script(layout), 120_000)) as EarlierReport
      const result = layout === 'emulated phone' ? await withEmulatedPhone(run) : await run()
      console.warn(`Earlier messages on ${layout}: ${JSON.stringify(result)}`)
      expect(result.error).toBeUndefined()
      expect(result.markerButton).toBe(true)
      // 300 messages, 30 mounted: nine more pages to the start.
      expect(result.scrollSteps).toBe(9)
      expect(result.scrollMaxDrift).toBeLessThan(2)
      expect(result.scrollReachedStart).toBe(true)
      expect(result.hiddenBranch).toBe(true)
      expect(result.markerFocusable).toBe(true)
      expect(result.clickGrew).toBe(true)
      expect(result.clickDrift).toBeLessThan(2)
      expect(result.clickReachedStart).toBe(true)
      expect(result.shortMarkerGone).toBe(true)
      expect(result.shortReachedStart).toBe(true)
    },
    240_000
  )
})

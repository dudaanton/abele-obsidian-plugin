/**
 * The first history opened after the update that keeps each chat's message dates: every entry
 * made before it has its file read once to fill them in. Measured with 500 chats of a realistic
 * size (tool results, reasoning, the agent's own records — about 400 KB each), on the desktop and
 * on the phone: how long the history takes to show its chats, and the longest stretch the page
 * stops answering meanwhile. The same for the fill-in on its own, as it runs at startup.
 *
 * Writes about 200 MB of chats and removes them, so it runs only when asked for
 * (`ABELE_MEASURE_HISTORY=1`, or a phone run, which is started by hand). Requires Obsidian running
 * with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const asked = process.env.ABELE_MEASURE_HISTORY === '1' || onPhone()
const available = asked && isObsidianRunning() && hasTestApi()

interface Report {
  error?: string
  chats: number
  totalMB: number
  /** Opening the history on entries without the dates: until its first card is on screen. */
  openMs: number
  openWorstFreezeMs: number
  /** The fill-in alone, as startup runs it. */
  fillMs: number
  fillWorstFreezeMs: number
  /** Opening it again, the dates in place. */
  againMs: number
  filled: number
}

const script = `(async () => {
  const T = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const DIR = 'AI/Chats/Upgrade timing'
  const storage = T.ChatStorage.getInstance()
  const cfg = T.AbeleConfig.getInstance().ai
  const report = { chats: 500 }
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const WORDS = 'the garden bed path water row seed compost shade sun fence pond herb bean tomato pepper leaf root soil mulch spring summer harvest weed rake hose shed gravel border plan week order sample note list task budget trip train map route book chapter draft review code build test release query index cache file folder'.split(' ')
  const text = (n) => { const out = []; let len = 0; while (len < n) { const w = WORDS[int(0, WORDS.length - 1)]; out.push(w); len += w.length + 1 } return out.join(' ') }
  const ownHistory = () => cfg.chatHistory.filter((e) => e.path.startsWith(DIR + '/'))
  const strip = () => { for (const e of ownHistory()) { delete e.firstMessageAt; delete e.lastMessageAt } }
  // The longest stretch between two timers that asked for 16 ms: how long the page stopped answering.
  const watch = () => {
    let worst = 0, prev = performance.now(), on = true
    ;(async () => { while (on) { await wait(16); const now = performance.now(); worst = Math.max(worst, now - prev - 16); prev = now } })()
    return () => { on = false; return Math.round(worst) }
  }
  const modal = () => document.querySelector('.abele-chat-history')
  const closeHistory = async () => {
    modal()?.closest('.modal-container')?.querySelector('.modal-close-button, .modal-header-button')?.click()
    for (let i = 0; i < 50 && modal(); i++) await wait(60)
  }
  const openAndTime = async () => {
    const stop = watch()
    const t0 = performance.now()
    app.commands.executeCommandById('abele:search-all-chats')
    while (!(modal() && modal().querySelector('.abele-card'))) {
      await wait(10)
      if (performance.now() - t0 > 120000) throw new Error('the history never showed its chats')
    }
    const ms = Math.round(performance.now() - t0)
    return { ms, freeze: stop() }
  }

  try {
    for (const d of ['AI', 'AI/Chats', DIR]) if (!app.vault.getAbstractFileByPath(d)) await app.vault.createFolder(d)
    let total = 0
    const day = 86400000, start = Date.now() - 600 * day
    for (let c = 0; c < 500; c++) {
      const turns = rnd() < 0.1 ? int(40, 120) : int(4, 30)
      const lines = [JSON.stringify({ v: 2, k: 'meta', type: 'abele-chat', title: 'Upgrade chat ' + c, providerId: 'p', modelId: 'm', created: '2025-06-01', summary: text(120) })]
      let prev, ts = start + c * day, n = 0
      const msg = (m) => { const id = 'm' + (++n); lines.push(JSON.stringify({ k: 'msg', id, parentId: prev, timestamp: ts += 30000, ...m })); prev = id }
      const intl = (m) => lines.push(JSON.stringify({ k: 'int', timestamp: ts, ...m }))
      for (let t = 0; t < turns; t++) {
        const q = text(int(60, 400)); msg({ role: 'user', content: q }); intl({ role: 'user', content: q })
        for (let k = int(0, 4); k > 0; k--) {
          const res = text(int(500, 4000))
          msg({ role: 'tool-call', content: '', toolName: 'read', toolParams: { path: 'Notes/x.md' }, toolResult: res, toolStatus: 'approved' })
          intl({ role: 'toolResult', toolName: 'read', content: [{ type: 'text', text: res }], isError: false })
        }
        const a = text(int(300, 2000)), th = text(int(200, 1500))
        msg({ role: 'assistant', content: a, thinking: th }); intl({ role: 'assistant', content: [{ type: 'thinking', thinking: th }, { type: 'text', text: a }] })
      }
      const body = lines.join('\\n') + '\\n'
      total += body.length
      await app.vault.create(DIR + '/Upgrade chat ' + String(c).padStart(3, '0') + '.abchat', body)
    }
    report.totalMB = +(total / 1048576).toFixed(1)
    await storage.refreshHistory()

    // As an index written before the dates were kept: the files known, their times current.
    strip()
    const open = await openAndTime()
    report.openMs = open.ms
    report.openWorstFreezeMs = open.freeze
    report.filled = ownHistory().filter((e) => e.lastMessageAt !== undefined).length
    await closeHistory()

    const again = await openAndTime()
    report.againMs = again.ms
    await closeHistory()

    strip()
    const stop = watch()
    const t0 = performance.now()
    await storage.refreshHistory()
    report.fillMs = Math.round(performance.now() - t0)
    report.fillWorstFreezeMs = stop()
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    try {
      await closeHistory()
      const d = app.vault.getAbstractFileByPath(DIR)
      if (d) {
        for (const f of [...d.children]) storage.removeHistoryEntry(f.path)
        await app.vault.delete(d, true)
      }
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
  }
  return JSON.stringify(report)
})()`

describe.skipIf(!available)('the first history opened after the dates are kept', () => {
  let report: Report

  beforeAll(async () => {
    report = JSON.parse(await evalLong(script, 900_000))
    console.log('MEASURE', JSON.stringify(report))
  }, 960_000)

  it('fills in every chat and shows them', () => {
    expect(report.error).toBeUndefined()
    expect(report.filled).toBe(500)
  })
})

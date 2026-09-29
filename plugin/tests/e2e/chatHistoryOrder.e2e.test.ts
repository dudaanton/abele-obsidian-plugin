/**
 * The history of chats in the running app, ordered by the chats' own messages.
 *
 * Three chats are written with messages days apart: one started first and written in last, one
 * in the middle, one started last and written in once. Then the one written in longest ago is
 * touched the way sync or a summary touches a file — a record appended, no message — so its file
 * is the newest of the three. The history has to keep it last all the same, with a day over each
 * chat by its last message; switched to the date created, the order turns round and the days
 * follow; what a search finds keeps the order; and the choice is still there when the history is
 * opened again. The order the device had before is put back, and the chats removed.
 *
 * Runs on the desktop and on the phone. Requires Obsidian running with the development build —
 * see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const PREFIX = 'History order probe'
const SHOTS = shotDir('abele-chat-history')

interface Seen {
  titles: string[]
  days: string[]
}

interface Report {
  error?: string
  /** Whether the touched chat's file really was the newest of the three. */
  touchedNewest: boolean
  byLast: Seen | null
  byCreated: Seen | null
  searched: string[]
  reopened: string[]
  saved: unknown
  contentDefault: string | null
  metadataMatches: string[]
  metadataOnly: string[]
  contentRemembered: string | null
  contentOff: string[]
}

const script = `(async () => {
  const T = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 5000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const v = fn()
      if (v) return v
      await wait(60)
    }
    return null
  }
  const PREFIX = ${JSON.stringify(PREFIX)}
  const KEY = 'abele-chat-history-order'
  const report = { touchedNewest: false, byLast: null, byCreated: null, searched: [], reopened: [], saved: null }
  const storage = T.ChatStorage.getInstance()
  const cfg = T.AbeleConfig.getInstance().ai
  const base = cfg.chatFolder.replace(/\\/?\\{\\{.*$/, '').replace(/\\/$/, '')
  const dir = base + '/' + PREFIX
  const before = app.loadLocalStorage(KEY)
  const CONTENT_KEY = 'abele-chat-history-content'
  const beforeContent = app.loadLocalStorage(CONTENT_KEY)
  const createdDirs = []

  const DAY = 86400000
  const noon = new Date(); noon.setHours(12, 0, 0, 0)
  const T0 = noon.getTime() - 20 * DAY
  const chats = [
    { name: 'garden', first: T0, last: T0 + 5 * DAY },
    { name: 'pond', first: T0 + DAY, last: T0 + 3 * DAY },
    { name: 'trip', first: T0 + 2 * DAY, last: T0 + 2 * DAY + 3600000 },
  ]
  const title = (c) => PREFIX + ' ' + c.name
  const path = (c) => dir + '/' + title(c) + '.abchat'
  const meta = (c, extra) => JSON.stringify({ v: 2, k: 'meta', type: 'abele-chat', title: title(c), providerId: '', modelId: '', created: new Date(c.first).toISOString().slice(0, 10), ...extra })
  const log = (c) => [
    meta(c, {}),
    JSON.stringify({ k: 'msg', id: 'u', role: 'user', content: 'Sketch the ' + c.name + ' plan', timestamp: c.first }),
    JSON.stringify({ k: 'msg', id: 'a', parentId: 'u', role: 'assistant', content: 'Here is the ' + c.name + ' plan.', timestamp: c.last }),
  ].join('\\n') + '\\n'

  const day = (at) => { const d = new Date(at); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear() }
  const modal = () => document.querySelector('.abele-chat-history')
  const seen = () => {
    const out = { titles: [], days: [] }
    let dayNow = null
    for (const el of modal().querySelectorAll('.abele-date-divider, .abele-card')) {
      if (el.classList.contains('abele-date-divider')) { dayNow = el.querySelector('.abele-date-divider__label').textContent.split(' ')[0]; continue }
      const t = el.querySelector('.abele-card__name').textContent.trim()
      if (!t.startsWith(PREFIX)) continue
      out.titles.push(t.slice(PREFIX.length + 1))
      out.days.push(dayNow)
    }
    return out
  }
  const openHistory = async () => {
    app.commands.executeCommandById('abele:search-all-chats')
    if (!(await until(() => modal() && modal().querySelectorAll('.abele-card').length))) throw new Error('the history did not open')
    await wait(300)
  }
  const closeHistory = async () => {
    modal()?.closest('.modal-container')?.querySelector('.modal-close-button, .modal-header-button')?.click()
    return !!(await until(() => !modal(), 3000))
  }
  const choose = async (value) => {
    const select = modal().querySelector('.abele-chat-history__order select')
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(300)
  }

  try {
    app.saveLocalStorage(KEY, null)
    app.saveLocalStorage(CONTENT_KEY, null)
    for (const d of dir.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))) {
      if (!app.vault.getAbstractFileByPath(d)) { await app.vault.createFolder(d); createdDirs.unshift(d) }
    }
    for (const c of chats) {
      const stale = app.vault.getAbstractFileByPath(path(c))
      if (stale) await app.vault.delete(stale)
      await app.vault.create(path(c), log(c))
      await wait(50)
    }
    await storage.refreshHistory()
    // Touched later without a new message, as a summary or sync would touch it.
    await wait(1100)
    const trip = app.vault.getAbstractFileByPath(path(chats[2]))
    await app.vault.append(trip, meta(chats[2], { summary: 'A summary written afterwards.' }) + '\\n' +
      JSON.stringify({ k: 'msg', id: 'compact', parentId: 'a', role: 'system', content: 'A compaction recap', timestamp: Date.now() }) + '\\n')
    const mtimes = chats.map((c) => app.vault.getAbstractFileByPath(path(c)).stat.mtime)
    report.touchedNewest = mtimes[2] > mtimes[0] && mtimes[2] > mtimes[1]

    await openHistory()
    report.byLast = seen()
    report.expectLast = chats.map((c) => day(c.last))
    await choose('created')
    report.byCreated = seen()
    report.expectCreated = chats.map((c) => day(c.first))
    const search = modal().querySelector('.abele-chat-history__search')
    const scope = modal().querySelector('[role="switch"]')
    report.contentDefault = scope?.getAttribute('aria-checked') ?? null
    search.value = PREFIX
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(350)
    report.metadataMatches = seen().titles
    search.value = 'plan'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(350)
    report.metadataOnly = seen().titles
    if (!scope) throw new Error('the content switch is missing')
    scope.click()
    await until(() => modal().querySelector('.abele-chat-history__snippet'), 6000)
    if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(SHOTS)} + '/history-content.png')
    await wait(300)
    report.searched = seen().titles
    report.saved = app.loadLocalStorage(KEY)
    if (!(await closeHistory())) throw new Error('the history did not close')
    await openHistory()
    if (modal().querySelector('.abele-chat-history__search').value) throw new Error('the old history is still open')
    report.reopened = seen().titles
    const reopenedScope = modal().querySelector('[role="switch"]')
    report.contentRemembered = reopenedScope?.getAttribute('aria-checked') ?? null
    const reopenedSearch = modal().querySelector('.abele-chat-history__search')
    reopenedSearch.value = 'plan'
    reopenedSearch.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => modal().querySelector('.abele-chat-history__snippet'), 6000)
    reopenedScope.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await wait(150)
    report.contentOff = seen().titles
    if (!(await closeHistory())) throw new Error('the history did not close')
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    try {
      await closeHistory()
      app.saveLocalStorage(KEY, before ?? null)
      app.saveLocalStorage(CONTENT_KEY, beforeContent ?? null)
      for (const c of chats) {
        storage.removeHistoryEntry(path(c))
        const f = app.vault.getAbstractFileByPath(path(c))
        if (f) await app.vault.delete(f)
      }
      for (const d of createdDirs.concat([dir])) {
        const f = app.vault.getAbstractFileByPath(d)
        if (f && f.children && !f.children.length) await app.vault.delete(f, true)
      }
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
  }
  return JSON.stringify(report)
})()`

describe.skipIf(!available)('the order of the chat history', () => {
  let report: Report & { expectLast?: string[]; expectCreated?: string[] }

  beforeAll(async () => {
    report = JSON.parse(await evalLong(script, 90_000))
    console.log(JSON.stringify(report))
  }, 120_000)

  it('got through without an error of its own, on a file really touched last', () => {
    expect(report.error).toBeUndefined()
    expect(report.touchedNewest).toBe(true)
  })

  it('goes by the last message: a chat touched later without one does not jump to the top', () => {
    expect(report.byLast!.titles).toEqual(['garden', 'pond', 'trip'])
    expect(report.byLast!.days).toEqual(report.expectLast)
  })

  it('goes by when each chat was started once that is chosen, the days with it', () => {
    expect(report.byCreated!.titles).toEqual(['trip', 'pond', 'garden'])
    expect(report.byCreated!.days).toEqual([...report.expectCreated!].reverse())
  })

  it('searches only titles and descriptions until content is explicitly enabled', () => {
    expect(report.contentDefault).toBe('false')
    expect(report.metadataMatches).toEqual(['trip', 'pond', 'garden'])
    expect(report.metadataOnly).toEqual([])
    expect(report.contentRemembered).toBe('true')
    expect(report.contentOff).toEqual([])
  })

  it('keeps that order for what a search finds', () => {
    expect(report.searched).toEqual(['trip', 'pond', 'garden'])
  })

  it('remembers the choice on the device', () => {
    expect(report.saved).toBe('created')
    expect(report.reopened).toEqual(['trip', 'pond', 'garden'])
  })
})

/**
 * Search in the task and log lists, in the running app, on the scale vault.
 *
 * The component tier proves the search reaches entries far past the first page and reads each
 * note once. What it cannot show is how long that takes against a real vault — the group note
 * here gathers over a thousand tasks and logs — whether the marks land on the words in what
 * Obsidian actually rendered, and what the header and the field look like at a phone's width.
 *
 * For the footer of a group note, on the desktop and then in the layout Obsidian gives a phone
 * (`app.emulateMobile(true)`, 390×844):
 *
 * - the search finds the last task in the calendar list and the oldest log, both far past the
 *   first page, and the time from typing to their showing is recorded;
 * - every task left on screen carries the words searched for, and they are marked;
 * - Escape closes the field and the whole list comes back;
 * - on the phone, nothing in the list's header or field reaches past the edge of the screen.
 *
 * Pictures go to `/tmp/abele-phone/list-search-*.png`; look at them. They are never committed.
 * Reads the vault only. Requires Obsidian running on the e2e fixture vault with the development
 * build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  isObsidianRunning,
  hasTestApi,
  evalRaw,
  evalJson,
  activeVaultName,
  setBackgroundThrottling,
} from './helpers/obsidianCli'

const GROUP_NOTE = process.env.OBSIDIAN_TEST_GROUP ?? 'ScaleTest/Notes/Projects.md'
const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'

/**
 * Typing to results, the first search included — it reads every note in the list once. Coarse:
 * a background window on a loaded machine is slow, and what matters is that it is not the
 * tens of seconds reading every note on every keystroke would cost.
 */
const MAX_FIRST_SEARCH_MS = 5_000

interface ListReport {
  /** Entries in the list before searching. */
  before: number
  /** Entries after the search settled. */
  after: number
  /** Whether the entry searched for is among them. */
  found: boolean
  /** Entries shown that do not hold the words searched for. */
  strays: string[]
  /** Ranges marked in the list. */
  marked: number
  /** Milliseconds from typing to the entry showing. */
  ms: number
  /** Entries after Escape. */
  restored: number
  /** Whether the field went away on Escape. */
  closed: boolean
  /** Elements of the header and the field past the right edge of the screen. */
  over: string[]
  shot: string
  error: string
}

type Report = Record<string, ListReport>

const probeScript = (tag: string): string => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(50)
    }
    return false
  }
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
  const report = {}

  let nudged = false
  const shoot = async (label) => {
    // The first capture after a reload can hang until the window produces a frame; a nudge of
    // its size makes one. See taskDatePhone.e2e.test.ts.
    if (!nudged) {
      nudged = true
      const [w, h] = win.getContentSize()
      win.setContentSize(w + 2, h + 2)
      await wait(300)
      win.setContentSize(w, h)
    }
    await wait(400)
    let img
    try {
      img = await win.webContents.capturePage()
    } catch (error) {
      if (!String(error && error.message).includes('UnknownVizError')) throw error
      await wait(300)
      img = await win.webContents.capturePage()
    }
    const path = ${JSON.stringify(SHOTS)} + '/list-search-${tag}-' + label + '.png'
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  const type = (input, text) => {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const overEdge = (els) => {
    const out = []
    for (const root of els) {
      if (!root) continue
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect()
        if (r.width && r.right > window.innerWidth + 0.5) {
          out.push(((el.className || el.tagName) + '').split(' ')[0] + ' +' + Math.round(r.right - window.innerWidth))
        }
      }
    }
    return out
  }

  const marked = () => {
    const h = CSS.highlights && CSS.highlights.get('abele-list-search')
    return h ? h.size : 0
  }

  const file = app.vault.getAbstractFileByPath(${JSON.stringify(GROUP_NOTE)})
  const leaf = app.workspace.getLeaf(false)
  await leaf.openFile(file)
  const footer = () => leaf.view.containerEl.querySelector('.abele-footer-view')
  await until(() => footer() && footer().querySelector('.abele-timeline') && footer().querySelector('.abele-logs-list'), 30000)
  await wait(1500)

  // What to look for comes from the notes, not from the list: the calendar task with the
  // latest date and the oldest log both sort last, far past the first page.
  const body = async (path) => (await app.vault.cachedRead(app.vault.getAbstractFileByPath(path))).replace(/^---\\n[\\s\\S]*?\\n---\\n/, '')

  const probe = async (label, listSel, entrySel, query, isTarget, holds) => {
    const entry = { before: 0, after: 0, found: false, strays: [], marked: 0, ms: 0, restored: 0, closed: false, over: [], shot: '', error: '' }
    report[label] = entry
    window.__abeleListSearchStep = label
    try {
      const list = footer().querySelector(listSel)
      list.scrollIntoView({ block: 'start' })
      const entries = () => [...list.querySelectorAll(entrySel)]
      entry.before = entries().length
      const icon = [...list.querySelectorAll('.abele-obsidian-icon')].find((i) => i.querySelector('.lucide-search'))
      if (!icon) throw new Error('no search icon')
      icon.click()
      if (!(await until(() => list.querySelector('input[type="search"]'), 3000))) throw new Error('no search field')
      const input = list.querySelector('input[type="search"]')
      entry.over = overEdge([list.firstElementChild, input.closest('.abele-obsidian-search')])
      const started = performance.now()
      type(input, query)
      if (!(await until(() => entries().some(isTarget), 20000))) throw new Error('the entry searched for never showed')
      entry.ms = Math.round(performance.now() - started)
      await wait(600)
      entry.after = entries().length
      entry.found = entries().some(isTarget)
      entry.strays = entries().filter((e) => !holds(e)).map((e) => e.textContent.trim().slice(0, 60))
      entry.marked = marked()
      window.__abeleListSearchStep = label + ' shoot'
      // The lists above this one grow a page whenever the scroll passes their end — the
      // backlinks run to thousands — which keeps pushing this one down. Hidden for the picture.
      const above = []
      for (let el = list.previousElementSibling; el; el = el.previousElementSibling) above.push(el)
      for (const el of above) el.style.display = 'none'
      list.scrollIntoView({ block: 'start' })
      await wait(300)
      entry.shot = await shoot(label)
      for (const el of above) el.style.display = ''
      window.__abeleListSearchStep = label + ' escape'
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      await until(() => !list.querySelector('input[type="search"]'), 3000)
      await wait(600)
      entry.closed = !list.querySelector('input[type="search"]')
      entry.restored = entries().length
    } catch (e) {
      entry.error = String((e && e.message) || e)
    }
  }

  try {
    // What to look for comes from the footer's own relations, not from the screen: the open
    // calendar task that sorts last, and the oldest log — both far past the first page.
    const store = window.__abeleTest.GlobalStore.getInstance()
    const entity = store.footersContainers.value.find((f) => f.filePath === ${JSON.stringify(GROUP_NOTE)})
    if (!entity) throw new Error('no footer for the group note')
    const relations = entity.noteRelations

    const open = [...relations.tasks.values()].filter((t) => !t.taskNotFound && !t.completedAt && t.dates.length)
    open.sort((a, b) => a.dates[a.dates.length - 1] < b.dates[b.dates.length - 1] ? -1 : 1)
    const lastTask = open[open.length - 1]
    if (!lastTask) throw new Error('the footer holds no open calendar task')
    const title = (await body(lastTask.taskPath)).split('\\n').find((l) => l.trim()).trim()
    // Plain words of the title, in capitals: the search ignores case.
    const words = title.replace(/\\[\\[([^\\]|]*\\|)?|\\]\\]/g, '').split(/\\s+/).filter((w) => /^[\\p{L}\\d]+$/u.test(w)).slice(0, 4)
    const taskQuery = words.join(' ').toUpperCase()
    const lower = words.map((w) => w.toLowerCase())
    await probe(
      'tasks',
      '.abele-timeline',
      '.abele-task-view',
      taskQuery,
      (e) => e.textContent.includes(words.join(' ')),
      // A card reads its note only once it scrolls into sight; one below the fold shows no
      // title yet, which says nothing about whether it matched.
      (e) =>
        !e.querySelector('.abele-markdown') ||
        lower.every((w) => e.textContent.toLowerCase().includes(w))
    )
    report['tasks'].query = taskQuery

    const logs = [...relations.logs.values()].filter((l) => !l.noteNotFound)
    logs.sort((a, b) => a.getLogDateOrToday().unix() - b.getLogDateOrToday().unix())
    const oldest = logs[0]
    if (!oldest) throw new Error('the footer holds no log')
    await probe(
      'logs',
      '.abele-logs-list',
      '.abele-log',
      oldest.name,
      (e) => e.textContent.includes(oldest.name),
      () => true
    )
    report['logs'].query = oldest.name
  } catch (e) {
    report['run'] = { error: String((e && e.message) || e) }
  }
  return report
})()`

const setMobile = async (on: boolean): Promise<void> => {
  evalRaw(`(() => { app.emulateMobile(${on}); return 'ok' })()`, 30_000)
  await new Promise((resolve) => setTimeout(resolve, 4000))
}

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

/**
 * Runs the probe detached and polls for its report: one CLI call gives up after 45 seconds, and
 * opening the group note and both searches together take longer than that.
 */
const run = async (tag: string): Promise<Report> => {
  const started = evalRaw(
    `(() => {
      window.__abeleListSearch = null;
      ${probeScript(tag)}.then(
        (r) => { window.__abeleListSearch = r },
        (e) => { window.__abeleListSearch = { run: { error: String((e && e.message) || e) } } }
      )
      return 'started'
    })()`,
    30_000
  )
  if (!started.includes('started')) throw new Error(`the ${tag} probe did not start: ${started}`)
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const report = evalJson<Report | null>('window.__abeleListSearch ?? null', 30_000)
    if (report) return report
  }
  throw new Error(`the ${tag} probe did not finish`)
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('searching the task and log lists', () => {
  let desktop: Report = {}
  let phone: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    setBackgroundThrottling(false)
    desktop = await run('desktop')

    size = windowSize()
    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
    // A resize leaves the viewport stale until the app reloads.
    evalRaw(`(() => { location.reload(); return 'ok' })()`, 30_000)
    await new Promise((resolve) => setTimeout(resolve, 6000))
    setBackgroundThrottling(false)
    phone = await run('phone')

    const lines = Object.entries({ ...desktop, ...prefixed(phone) }).map(
      ([label, r]) =>
        `  ${label.padEnd(14)} ${r.ms}ms marked=${r.marked} ${r.before}->${r.after}  ${r.shot || r.error}`
    )
    console.info(`\n  vault ${activeVaultName()}\n${lines.join('\n')}\n`)
  }, 400_000)

  afterAll(async () => {
    if (!available) return
    if (size[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
    setBackgroundThrottling(true)
  }, 120_000)

  const prefixed = (r: Report): Report =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [`phone ${k}`, v]))

  const both = (): Array<[string, ListReport]> =>
    Object.entries({ ...desktop, ...prefixed(phone) }).filter(([k]) => !k.endsWith('run'))

  it('runs through both lists on both layouts', () => {
    expect(desktop.run?.error ?? '').toBe('')
    expect(phone.run?.error ?? '').toBe('')
    for (const key of ['tasks', 'logs']) {
      expect(desktop[key]?.error, key).toBe('')
      expect(phone[key]?.error, `phone ${key}`).toBe('')
    }
  })

  it('finds the entry sorted last, past the first page', () => {
    for (const [label, r] of both()) {
      expect(r.found, label).toBe(true)
      expect(r.after, label).toBeLessThan(r.before + 1)
    }
  })

  it('answers the first search within a few seconds', () => {
    for (const [label, r] of both()) expect(r.ms, label).toBeLessThan(MAX_FIRST_SEARCH_MS)
  })

  it('shows only tasks holding every word, and marks the words', () => {
    for (const r of [desktop.tasks, phone.tasks]) {
      expect(r.strays).toEqual([])
      expect(r.marked).toBeGreaterThan(0)
    }
  })

  it('brings the whole list back on Escape', () => {
    for (const [label, r] of both()) {
      expect(r.closed, label).toBe(true)
      expect(r.restored, label).toBe(r.before)
    }
  })

  it('keeps the header and the field inside a phone screen', () => {
    expect(phone.tasks?.over ?? ['no report']).toEqual([])
    expect(phone.logs?.over ?? ['no report']).toEqual([])
  })
})

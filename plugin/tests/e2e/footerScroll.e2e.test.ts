/**
 * The note stays where it was when a list under it shrinks, in the running app, on the scale vault.
 *
 * The lists under a note sit in one block at the end of the editor. When that block gets shorter
 * than what is scrolled past, the browser pulls the scroll back to the new end, and the editor
 * then took that for "scrolled to the bottom" and pulled it up again by the whole difference —
 * searching a long list threw the note back to its top about a fifth of a second after typing,
 * the found entry somewhere below, never drawn because it was never on screen. Only the app can
 * show this: it takes the real editor, its measuring and the browser's own scroll.
 *
 * Under an account note, its chart widened back to the first transaction so the list runs long,
 * scrolled until the list's header is near the top of the window:
 *
 * - a search that matches nothing, then one that finds the oldest transaction, leave the search
 *   field where it was, and the found entry is on screen with its title;
 * - folding the list leaves its heading where it was;
 * - scrolling back up afterwards gives up the room kept below, so nothing is left hanging.
 *
 * Reads the vault only; puts the fold and the period back. Requires Obsidian running on the e2e
 * fixture vault with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  setBackgroundThrottling,
} from './helpers/obsidianCli'

/** An account with a hundred and more transactions, none of them this month. */
const ACCOUNT_NOTE = 'ScaleTest/Finance/Accounts/Gifts.md'

interface Step {
  /** Where the field or heading was, and where it ended up, from the top of the window. */
  before: number
  after: number
  /** The editor's scroll, before and after. */
  topBefore: number
  topAfter: number
  /** The window's height, to tell whether it is still in sight. */
  height: number
}

interface Report {
  nothing?: Step
  found?: Step & { visible: boolean; title: string }
  fold?: Step
  /** Room below the lists left over after scrolling back up, in pixels. */
  leftover?: number
  error?: string
}

const probeScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(50)
    }
    return false
  }
  const report = {}
  const path = ${JSON.stringify(ACCOUNT_NOTE)}
  const leaf = app.workspace.getLeaf(false)
  await leaf.openFile(app.vault.getAbstractFileByPath(path), { state: { mode: 'source', source: false } })
  const footer = () => leaf.view.containerEl.querySelector('.abele-footer-view')
  const scroller = leaf.view.containerEl.querySelector('.cm-scroller')
  const selector = () => footer() && footer().querySelector('.abele-period-selector')
  let restorePeriod = null
  try {
    if (!(await until(selector, 30000))) throw new Error('the account note shows no balance chart')
    const store = window.__abeleTest.GlobalStore.getInstance()
    const account = store.footersContainers.value.find((f) => f.filePath === path)
    const own = [...account.noteRelations.transactions.values()].filter((t) => !t.transactionNotFound && t.date)
    own.sort((a, b) => a.date.valueOf() - b.date.valueOf())
    const emit = selector().__vueParentComponent.emit
    restorePeriod = () => emit('update:start', window.moment().startOf('month'))
    emit('update:start', own[0].date.startOf('month'))
    if (!(await until(() => footer().querySelector('.abele-transactions-list .abele-transaction-view'), 30000)))
      throw new Error('the account note never listed its transactions')
    await wait(1500)
    const list = footer().querySelector('.abele-transactions-list')
    const container = footer().closest('.abele-footer-widget-container')
    // What the block holds beyond the lists themselves, before anything happens.
    const extra = () => container.getBoundingClientRect().height - container.firstElementChild.getBoundingClientRect().height
    const extraBefore = extra()
    const rows = () => [...list.querySelectorAll('.abele-transaction-view')]
    const title = (await app.vault.cachedRead(app.vault.getAbstractFileByPath(own[0].transactionPath)))
      .replace(/^---\\n[\\s\\S]*?\\n---\\n/, '').split('\\n').find((l) => l.trim()).trim()

    // The list's header a little below the top of the window, the list running on far below.
    const bringUp = async () => {
      list.scrollIntoView({ block: 'start' })
      scroller.scrollTop -= 60
      await wait(800)
    }
    await bringUp()
    const icon = [...list.querySelectorAll('.abele-obsidian-icon')].find((i) => i.querySelector('.lucide-search'))
    if (!icon) throw new Error('no search icon')
    icon.click()
    if (!(await until(() => list.querySelector('input[type="search"]'), 3000))) throw new Error('no search field')
    const input = list.querySelector('input[type="search"]')
    await wait(400)

    const search = async (query, settled) => {
      const step = { before: input.getBoundingClientRect().top, topBefore: scroller.scrollTop, height: window.innerHeight }
      input.value = query
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await until(settled, 10000)
      // The editor measures a frame or several after the list shrinks; the jump came ~200 ms in.
      await wait(1200)
      step.after = input.getBoundingClientRect().top
      step.topAfter = scroller.scrollTop
      return step
    }
    report.nothing = await search('zzqqxx nothing like this', () => rows().length === 0)
    report.found = await search(title, () => rows().some((r) => r.textContent.includes(title)))
    const hit = rows().find((r) => r.textContent.includes(title))
    const r = hit ? hit.getBoundingClientRect() : null
    report.found.visible = !!r && r.top >= 0 && r.bottom <= window.innerHeight
    report.found.title = hit ? hit.textContent.trim().slice(0, 60) : ''

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await until(() => !list.querySelector('input[type="search"]'), 3000)
    await wait(1200)

    // Folding the whole list shrinks the block the same way.
    await bringUp()
    const heading = list.querySelector('.abele-fold-heading')
    if (!heading) throw new Error('the list has no fold heading')
    const fold = { before: heading.getBoundingClientRect().top, topBefore: scroller.scrollTop, height: window.innerHeight }
    heading.click()
    await until(() => heading.getAttribute('aria-expanded') === 'false', 3000)
    await wait(1200)
    fold.after = heading.getBoundingClientRect().top
    fold.topAfter = scroller.scrollTop
    report.fold = fold

    // Scrolling up gives the room kept below the lists back.
    scroller.scrollTop = 0
    await wait(800)
    report.leftover = Math.round(extra() - extraBefore)

    heading.click()
    await wait(300)
  } catch (e) {
    report.error = String((e && e.message) || e)
  }
  if (restorePeriod) restorePeriod()
  return report
})()`

const run = async (): Promise<Report> => {
  const started = evalRaw(
    `(() => {
      window.__abeleFooterScroll = null;
      ${probeScript}.then(
        (r) => { window.__abeleFooterScroll = r },
        (e) => { window.__abeleFooterScroll = { error: String((e && e.message) || e) } }
      )
      return 'started'
    })()`,
    30_000
  )
  if (!started.includes('started')) throw new Error(`the probe did not start: ${started}`)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const report = evalJson<Report | null>('window.__abeleFooterScroll ?? null', 30_000)
    if (report) return report
  }
  throw new Error('the probe did not finish')
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('the note keeps its place when a list under it shrinks', () => {
  let report: Report = {}

  beforeAll(async () => {
    setBackgroundThrottling(false)
    report = await run()
    console.info(`\n  ${JSON.stringify(report)}\n`)
  }, 200_000)

  afterAll(() => {
    if (available) setBackgroundThrottling(true)
  })

  it('runs through', () => {
    expect(report.error ?? '').toBe('')
  })

  it('keeps the search field in place when nothing matches', () => {
    const s = report.nothing!
    expect(s.topAfter).toBeGreaterThan(0)
    expect(Math.abs(s.after - s.before)).toBeLessThan(3)
  })

  it('keeps the search field in place and shows what it found', () => {
    const s = report.found!
    expect(Math.abs(s.after - s.before)).toBeLessThan(3)
    expect(s.after).toBeGreaterThanOrEqual(0)
    expect(s.after).toBeLessThan(s.height)
    expect(s.visible).toBe(true)
  })

  it('keeps the heading in place when the list is folded', () => {
    const s = report.fold!
    expect(s.topAfter).toBeGreaterThan(0)
    expect(Math.abs(s.after - s.before)).toBeLessThan(3)
  })

  it('gives the room back once scrolled up', () => {
    expect(report.leftover).toBe(0)
  })
})

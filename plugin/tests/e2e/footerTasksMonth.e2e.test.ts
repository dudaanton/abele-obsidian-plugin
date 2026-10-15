/**
 * A note's calendar tasks read as a month in the real note footer, on a wide window and on a
 * phone (emulated on a desktop, the real one with `E2E_TARGET=phone`).
 *
 * A synthetic group note with dated tasks in the current month: today two open tasks, another day
 * an open and a done one, a third day only done ones. In the footer the switch beside the
 * completed switch turns the list into the month; then:
 *
 * - the days carry an open box while a task is left, and the done-only day carries nothing while
 *   done tasks are hidden, a ticked box once the completed switch shows them;
 * - the month opens on today, the chosen day's tasks stand beside the month on a wide page and
 *   under it on a phone, nothing spills past the section's edge;
 * - a day with nothing and a month with nothing say so;
 * - the choice is kept for the note: opened again, the note shows the month;
 * - back to the list, its rows stand apart without a line between them.
 *
 * Pictures of the month, a chosen day, an empty month and the list. Writes its own folder and
 * removes it; the footer memory and the window are put back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  enterPhone,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { TIMELINE_FIXTURE_PROBE } from './helpers/timelineFixture'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('footer-tasks-month')
const FOLDER = 'Sample tasks month'
const LABEL = 'sample-tasks-month'

interface Report {
  label?: string
  toggle?: boolean
  marksHidden?: Record<string, string>
  marksShown?: Record<string, string>
  opened?: string
  todayDay?: string
  dayRows?: number
  mixedRows?: number
  stacked?: boolean
  headerAbove?: string[]
  overflow?: string[]
  listOverflow?: string[]
  searchInMonth?: boolean
  emptyDay?: string
  emptyMonth?: string
  saved?: boolean
  reopened?: boolean
  list?: boolean
  listRows?: number
  lines?: number
  shots?: string[]
  error?: string
}

const script = (label: string) => String.raw`(async function* () {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (fn, what) => { for (let i = 0; i < 300; i++) { const v = fn(); if (v) return v; await wait(50) } throw Error('not ready: ' + what) }
  ${TIMELINE_FIXTURE_PROBE}
  const folder = ${JSON.stringify(FOLDER)}
  const tag = ${JSON.stringify(LABEL)}
  const shots = ${JSON.stringify(SHOTS)}
  const label = ${JSON.stringify(label)}
  const phone = ${JSON.stringify(onPhone())}
  const report = { label, shots: [], headerAbove: [] }
  const config = window.__abeleTest.AbeleConfig.getInstance()
  const remembered = config.rememberNotePlaces
  const memory = app.loadLocalStorage('abele-footer-view')
  const pad = n => String(n).padStart(2, '0')
  const now = new Date()
  const date = d => now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(d)
  const today = now.getDate()
  // Three other days of this month, none of them today.
  const others = [3, 10, 17, 24, 27].filter(d => d !== today)
  const mixed = others[0], doneDay = others[1], emptyDay = others[2]
  let leaf
  const shoot = async name => {
    await wait(600)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const path = shots + '/' + label + '-' + name + '.png'
    report.shots.push(path)
    if (phone) return path
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG())
    return null
  }
  const open = async () => {
    // With every tab closed, the leaf Obsidian puts in their place has no group a new tab could
    // join ("No tab group found"): that leaf is used instead.
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
    await leaf.setViewState({ type: 'markdown', state: { file: folder + '/Sample month group.md', mode: 'source', source: false }, active: true })
    app.workspace.setActiveLeaf(leaf, { focus: true })
    const s = await until(() => leaf.view.containerEl.querySelector('.cm-scroller'), 'editor')
    const root = await until(() => { s.scrollTop = s.scrollHeight; return leaf.view.containerEl.querySelector('.abele-timeline') }, 'footer timeline')
    return root
  }
  // The section header stands over the month's own row (month name, arrows, Today), never under it.
  const order = async name => {
    await wait(300)
    const head = root => root.querySelector('.abele-timeline__pinned')?.getBoundingClientRect()
    const nav = root.querySelector('.abele-tasks-calendar .abele-calendar__header')?.getBoundingClientRect()
    const h = head(root)
    if (!h || !nav) return report.headerAbove.push(name + ': missing')
    if (h.bottom > nav.top + 1) report.headerAbove.push(name + ': header ' + Math.round(h.top) + '..' + Math.round(h.bottom) + ', month row ' + Math.round(nav.top))
  }
  const reveal = el => { el.scrollIntoView({ block: 'start' }) }
  try {
    config.rememberNotePlaces = false
    app.saveLocalStorage('abele-footer-view', {})
    yield 'fixture'
    await app.vault.createFolder(folder)
    await app.vault.create(folder + '/Sample month group.md', 'Sample month group\n')
    const task = (name, d, done) => createTask(folder + '/' + name + '.md',
      '---\ntype: task\ndate: ' + date(d) + '\n' + (done ? 'completed: ' + date(d) + '\n' : '') +
      'labels:\n  - ' + tag + '\ngroups:\n  - "[[' + folder + '/Sample month group]]"\n---\n' + name + '\n')
    await task('Sample water the plants', today, false)
    await task('Sample feed the cat', today, false)
    await task('Sample call the plumber', mixed, false)
    await task('Sample pay the bill', mixed, true)
    await task('Sample return the books', doneDay, true)
    await task('Sample sort the shelf', doneDay, true)

    yield 'month'
    let root = await open()
    const toggle = () => root.querySelector('.abele-timeline__view')
    report.toggle = !!toggle()
    toggle().click()
    let month = await until(() => root.querySelector('.abele-tasks-calendar'), 'month')
    const cell = d => [...month.querySelectorAll('.abele-calendar__day:not(.abele-calendar__day_other-month)')]
      .find(el => el.querySelector('.abele-calendar__day-number')?.textContent.trim() === String(d))
    const marks = () => Object.fromEntries([...month.querySelectorAll('.abele-calendar__day:not(.abele-calendar__day_other-month)')]
      .filter(el => el.querySelector('.abele-calendar__day-log'))
      .map(el => [el.querySelector('.abele-calendar__day-number').textContent.trim(),
        el.querySelector('.abele-calendar__day-log_done') ? 'done' : el.querySelector('.abele-calendar__day-log_open') ? 'open' : 'entry']))
    await until(() => Object.keys(marks()).length >= 2, 'marks')
    report.marksHidden = marks()
    report.searchInMonth = !!root.querySelector('.abele-timeline__search-toggle')
    report.opened = month.querySelector('.abele-calendar__day_selected .abele-calendar__day-number')?.textContent.trim()
    report.todayDay = String(today)
    report.dayRows = month.querySelectorAll('.abele-tasks-calendar__items .abele-task-view').length
    root.querySelector('.abele-timeline__completed-toggle').click()
    await until(() => marks()[String(doneDay)] === 'done', 'done day shown')
    report.marksShown = marks()
    reveal(root)
    await order('month')
    yield 'shoot:' + (await shoot('month') ?? '')

    yield 'chosen day'
    cell(mixed).click()
    await until(() => month.querySelectorAll('.abele-tasks-calendar__items .abele-task-view').length === 2, 'chosen day rows')
    report.mixedRows = 2
    const monthBox = month.querySelector('.abele-tasks-calendar__month').getBoundingClientRect()
    const dayBox = month.querySelector('.abele-tasks-calendar__day').getBoundingClientRect()
    report.stacked = dayBox.top >= monthBox.bottom - 1
    const edge = month.getBoundingClientRect().right
    // In a note a row's light, and the inset that keeps its words off the light's edge, hang out
    // into the note's margin by that inset, the list's rows as much as the month's: past that is a spill.
    const hang = parseFloat(getComputedStyle(document.body).getPropertyValue('--size-2-3')) || 6
    const spill = (scope, right) => [...scope.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > right + hang + 1)
      .map(el => String(el.className) + ' +' + Math.round(el.getBoundingClientRect().right - right) + 'px').slice(0, 5)
    report.overflow = spill(month, edge)
    reveal(root)
    await order('chosen day')
    yield 'shoot:' + (await shoot('chosen-day') ?? '')

    cell(emptyDay).click()
    await until(() => month.querySelector('.abele-tasks-calendar__none'), 'empty day')
    report.emptyDay = month.querySelector('.abele-tasks-calendar__none').textContent.trim()

    yield 'empty month'
    month.querySelector('[aria-label="Next month"]').click()
    await until(() => month.querySelector('.abele-tasks-calendar__none')?.textContent.includes('Nothing planned in'), 'empty month')
    report.emptyMonth = month.querySelector('.abele-tasks-calendar__none').textContent.trim()
    reveal(root)
    await order('empty month')
    yield 'shoot:' + (await shoot('empty-month') ?? '')

    yield 'reopen'
    report.saved = app.loadLocalStorage('abele-footer-view')?.[folder + '/Sample month group.md']?.tasksCalendar === true
    leaf.detach()
    root = await open()
    month = await until(() => root.querySelector('.abele-tasks-calendar'), 'month again')
    report.reopened = !!month

    yield 'list'
    root.querySelector('.abele-timeline__view').click()
    await until(() => !root.querySelector('.abele-tasks-calendar') && root.querySelector('.abele-timeline__blocks'), 'list again')
    report.list = true
    // Done tasks shown, so today's and the coming days' rows stand together in the list.
    if (root.querySelector('.abele-timeline__completed-toggle').getAttribute('aria-checked') !== 'true')
      root.querySelector('.abele-timeline__completed-toggle').click()
    const rows = await until(() => { const r = root.querySelectorAll('.abele-entry-row + .abele-entry-row'); return r.length ? r : null }, 'list rows')
    report.listRows = root.querySelectorAll('.abele-entry-row').length
    report.listOverflow = spill(root, root.getBoundingClientRect().right)
    report.lines = [...rows].filter(row => {
      const before = getComputedStyle(row, '::before')
      return parseFloat(getComputedStyle(row).borderTopWidth) > 0 ||
        (before.content !== 'none' && parseFloat(before.borderTopWidth) > 0)
    }).length
    reveal(root)
    yield 'shoot:' + (await shoot('list') ?? '')
  } catch (e) {
    report.error = String((e && e.stack) || e)
  } finally {
    leaf?.detach()
    const scratch = app.vault.getAbstractFileByPath(folder)
    if (scratch) await app.vault.delete(scratch, true)
    app.saveLocalStorage('abele-footer-view', memory ?? {})
    config.rememberNotePlaces = remembered
  }
  return JSON.stringify(report)
})()`

async function runProbe(label: string): Promise<Report> {
  let phase = 'starting'
  evalRaw(`(() => { window.__tasksMonthProbe = (${script(label)}); return 'started' })()`)
  try {
    for (;;) {
      const raw = await evalLong('window.__tasksMonthProbe.next()', 120_000)
      if (raw.startsWith('Error:')) throw new Error(raw)
      const step = JSON.parse(raw) as { done: boolean; value: string }
      if (step.done) return JSON.parse(step.value) as Report
      phase = step.value
      // On the phone the picture is taken by its driver, from here, while the probe waits.
      if (phase.startsWith('shoot:') && phase.length > 'shoot:'.length) screenshot(phase.slice(6))
    }
  } catch (error) {
    throw new Error(`Tasks month ${label}, phase ${phase}: ${String(error)}`)
  } finally {
    await evalLong(
      `(async () => { await window.__tasksMonthProbe?.return(); delete window.__tasksMonthProbe; return 'closed' })()`,
      60_000
    )
  }
}

const check = (r: Report, phone: boolean) => {
  expect(r.error).toBeUndefined()
  expect(r.toggle).toBe(true)
  const today = r.todayDay!
  // Done tasks hidden: today and the mixed day are open, the done-only day carries nothing.
  expect(r.marksHidden![today]).toBe('open')
  expect(Object.values(r.marksHidden!).filter((m) => m === 'open')).toHaveLength(2)
  expect(Object.values(r.marksHidden!)).not.toContain('done')
  // Shown: the done-only day is ticked, the others stay open.
  expect(Object.values(r.marksShown!).filter((m) => m === 'done')).toHaveLength(1)
  expect(Object.values(r.marksShown!).filter((m) => m === 'open')).toHaveLength(2)
  expect(r.opened).toBe(today)
  expect(r.dayRows).toBe(2)
  expect(r.mixedRows).toBe(2)
  expect(r.searchInMonth).toBe(false)
  expect(r.stacked).toBe(phone)
  expect(r.overflow).toEqual([])
  expect(r.headerAbove).toEqual([])
  expect(r.listOverflow).toEqual([])
  expect(r.emptyDay).toBe('Nothing planned this day.')
  expect(r.emptyMonth).toMatch(/^Nothing planned in /)
  expect(r.saved).toBe(true)
  expect(r.reopened).toBe(true)
  expect(r.list).toBe(true)
  expect(r.listRows).toBeGreaterThan(1)
  expect(r.lines).toBe(0)
}

describe.skipIf(!available)('calendar tasks as a month in the note footer', () => {
  let size: number[] | null = null
  let desktop: Report | null = null
  let phone: Report | null = null

  beforeAll(async () => {
    if (onPhone()) return
    size = JSON.parse(
      evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
    ) as number[]
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(1440, 1000); 'ok'`)
    desktop = await runProbe('desktop')
    console.info(JSON.stringify({ desktop }))
  }, 300_000)

  afterAll(async () => {
    if (size) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size.join(',')}); 'ok'`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 180_000)

  it.skipIf(onPhone())(
    'on a wide note: marks, the chosen day beside the month, kept for the note',
    () => {
      check(desktop!, false)
    }
  )

  // Its own block: where the real phone covers the emulated one, entering it skips only this.
  describe('on a phone', () => {
    beforeAll(async () => {
      await enterPhone(390, 844)
      phone = await runProbe('phone')
      console.info(JSON.stringify({ phone }))
    }, 300_000)

    it('the same, the chosen day under the month', () => {
      check(phone!, true)
    })
  })
})

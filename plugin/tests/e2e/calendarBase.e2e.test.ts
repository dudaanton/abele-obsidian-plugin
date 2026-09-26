/**
 * The calendar view of a base in the running app: a folder of task notes and a `.base` file
 * over it are made here, the base is opened, and each layout is asked where the notes landed —
 * on their day in the month, on their hour in the week, as a tint in the year. Then the same on
 * a phone (390×844 under `emulateMobile`): nothing past the right edge, the month as dots with
 * the picked day listed under it, the week scrolling within itself, a picture of each in
 * `/tmp/abele-phone/calendar-base-*.png`.
 *
 * Everything made is removed afterwards: the fixture vault holds `ScaleTest/` and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'

const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'
const FOLDER = 'CalendarBaseE2E'
const available = isObsidianRunning() && hasTestApi()

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const evalAsync = <T>(script: string, timeoutMs = 60_000): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const now = new Date()
const today = dayOf(now)
const plus = (n: number) => dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))
/** A day of this month other than today, for the day that holds too much to show. */
const busyDay = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() === 15 ? 16 : 15))

const note = (fm: Record<string, string>) =>
  `---\ntype: task\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---\n\n`

const FILES: Record<string, string> = {
  'Standup.md': note({ date: today, dateTime: '09:00' }),
  'Dentist.md': note({ date: plus(1), dateTime: '15:00', due: plus(1), dueTime: '16:30' }),
  'Trip.md': note({ date: plus(2), due: plus(4) }),
  'Only a deadline.md': note({ due: plus(1) }),
  'Done already.md': note({ date: today, completed: today }),
  'Undated.md': note({}),
  ...Object.fromEntries(
    ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((n) => [
      `Busy ${n}.md`,
      note({ date: busyDay }),
    ])
  ),
}

const BASE = `filters:
  and:
    - file.inFolder("${FOLDER}/Tasks")
views:
  - type: abele-calendar
    name: Calendar
`

/** Shared by every script: waiting, measuring what reaches past an edge, taking a picture. */
const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(100) }
    return null
  }
  const name = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
  const overEdge = (root, skip) => {
    const edge = Math.min(root.getBoundingClientRect().right, window.innerWidth)
    const over = []
    for (const el of root.querySelectorAll('*')) {
      if (skip && el.closest(skip)) continue
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') continue
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > edge + 1) over.push(name(el) + ' +' + Math.round(r.right - edge))
    }
    return over.slice(0, 12)
  }
  const picture = async (file) => {
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
        if (img) { require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + file, img.toPNG()); return file }
      } catch (e) { await wait(500) }
    }
    return 'no picture'
  }
  const openBase = async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(`${FOLDER}/Calendar.base`)})
    if (!file) return null
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
    app.workspace.setActiveLeaf(leaf, { focus: true })
    return await until(() => leaf.view.containerEl.querySelector('.abele-calendar-base'), 15000)
  }
  const tab = async (root, label) => {
    const t = [...root.querySelectorAll('.abele-calendar-base__modes .abele-tabs__tab')].find((x) => x.textContent.trim() === label)
    t.click()
    await wait(600)
  }
  const chips = (el) => el ? [...el.querySelectorAll('.abele-calendar-chip__title')].map((c) => c.textContent.trim()) : []
`

/** Reloads the page and waits for the plugin to be back. */
const reload = async (how: string): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
  await pause(4000)
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) await pause(1000)
}

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

interface Desktop {
  error?: string
  month?: Record<string, string[]>
  more?: string
  undated?: string
  done?: boolean
  weekBlocks?: Record<string, string[]>
  weekAllDay?: Record<string, string[]>
  heat?: string
  stored?: string
}

interface Phone {
  error?: string
  phone?: boolean
  narrow?: boolean
  dots?: number
  agenda?: string[]
  over?: Record<string, string[]>
  weekScrolls?: boolean
  shots?: string[]
}

describe.skipIf(!available)('the calendar view of a base', () => {
  let size: [number, number] = [0, 0]
  let desktop: Desktop = {}
  let phone: Phone = {}

  beforeAll(async () => {
    evalAsync<string>(`(async () => {
      await app.vault.adapter.mkdir(${JSON.stringify(`${FOLDER}/Tasks`)})
      const files = ${JSON.stringify(FILES)}
      for (const [name, content] of Object.entries(files)) {
        await app.vault.create(${JSON.stringify(`${FOLDER}/Tasks/`)} + name, content)
      }
      await app.vault.create(${JSON.stringify(`${FOLDER}/Calendar.base`)}, ${JSON.stringify(BASE)})
      return JSON.stringify('ok')
    })()`)
    // The metadata cache has to have read the notes before the base can filter on them.
    await pause(2000)

    desktop = evalAsync<Desktop>(`(async () => {
      ${PRELUDE}
      const report = {}
      try {
        const root = await openBase()
        if (!root) return { error: 'the calendar did not open' }
        await wait(1000)
        const cell = (d) => root.querySelector('.abele-calendar-month__day[data-day="' + d + '"]')
        report.month = {}
        for (const d of ${JSON.stringify([today, plus(1), plus(3), busyDay])}) report.month[d] = chips(cell(d))
        report.more = cell(${JSON.stringify(busyDay)})?.querySelector('.abele-calendar-month__more')?.textContent.trim()
        report.undated = root.querySelector('.abele-calendar-base__undated')?.textContent.trim()
        report.done = !!cell(${JSON.stringify(today)})?.querySelector('.abele-calendar-chip_done')
        await picture('calendar-base-desktop-month.png')

        await tab(root, 'Week')
        report.weekBlocks = {}
        report.weekAllDay = {}
        for (const col of root.querySelectorAll('.abele-calendar-week__column')) {
          const list = chips(col)
          if (list.length) report.weekBlocks[col.dataset.day] = list
        }
        for (const cellEl of root.querySelectorAll('.abele-calendar-week__all-day-cell')) {
          const list = chips(cellEl)
          if (list.length) report.weekAllDay[cellEl.dataset.day] = list
        }
        await picture('calendar-base-desktop-week.png')

        await tab(root, 'Year')
        report.heat = root.querySelector('.abele-calendar-year__day[data-day="' + ${JSON.stringify(busyDay)} + '"]')?.className
        await picture('calendar-base-desktop-year.png')
        await wait(1500)
        report.stored = await app.vault.adapter.read(${JSON.stringify(`${FOLDER}/Calendar.base`)})
        await tab(root, 'Month')
      } catch (e) {
        report.error = String((e && e.message) || e)
      }
      return JSON.stringify(report)
    })()`)

    size = windowSize()
    await reload('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reload('window.location.reload()')

    phone = evalAsync<Phone>(`(async () => {
      ${PRELUDE}
      const report = { phone: document.body.classList.contains('is-phone'), over: {}, shots: [] }
      try {
        app.workspace.leftSplit?.collapse?.()
        app.workspace.rightSplit?.collapse?.()
        const root = await openBase()
        if (!root) return { ...report, error: 'the calendar did not open' }
        await wait(1200)
        // The base opens in whatever layout it was left in; the phone checks start on the month.
        await tab(root, 'Month')
        report.narrow = root.classList.contains('abele-calendar-base_narrow')
        report.dots = root.querySelectorAll('.abele-calendar-month__dot').length
        report.agenda = chips(root.querySelector('.abele-calendar-base__agenda'))
        report.over.month = overEdge(root)
        report.shots.push(await picture('calendar-base-month.png'))

        const tomorrow = root.querySelector('.abele-calendar-month__day[data-day="' + ${JSON.stringify(plus(1))} + '"]')
        if (tomorrow) {
          tomorrow.click()
          await wait(500)
          root.querySelector('.abele-calendar-base__agenda')?.scrollIntoView({ block: 'end' })
          await wait(500)
          report.shots.push(await picture('calendar-base-month-day.png'))
        }

        await tab(root, 'Week')
        const week = root.querySelector('.abele-calendar-week')
        report.weekScrolls = !!week && week.scrollWidth > week.clientWidth
        // The week moves sideways within itself on purpose; everything else must fit.
        report.over.week = overEdge(root, '.abele-calendar-week__inner')
        report.shots.push(await picture('calendar-base-week.png'))

        await tab(root, 'Year')
        report.over.year = overEdge(root)
        report.shots.push(await picture('calendar-base-year.png'))
        await tab(root, 'Month')
      } catch (e) {
        report.error = String((e && e.message) || e)
      }
      return JSON.stringify(report)
    })()`)
    console.info(`\n  ${JSON.stringify({ desktop, phone })}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    try {
      evalRaw(
        `(async () => {
          for (const leaf of app.workspace.getLeavesOfType('bases')) {
            if (leaf.view.file?.path?.startsWith(${JSON.stringify(FOLDER + '/')})) leaf.detach()
          }
          const folder = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})
          if (folder) await app.vault.delete(folder, true)
          return 'removed'
        })()`,
        60_000
      )
    } catch (e) {
      console.warn('[abele e2e] calendar base fixture not removed', e)
    }
    if (size[0]) await setWindowSize(size[0], size[1])
    await reload('app.emulateMobile(false)')
  }, 180_000)

  it('puts each note on its day in the month, a span on every day of it', () => {
    expect(desktop.error).toBeUndefined()
    expect(desktop.month?.[today]).toEqual(expect.arrayContaining(['Standup', 'Done already']))
    expect(desktop.month?.[plus(1)]).toEqual(expect.arrayContaining(['Dentist', 'Only a deadline']))
    expect(desktop.month?.[plus(3)] ?? ['Trip']).toContain('Trip')
    expect(desktop.done).toBe(true)
  })

  it('folds a full day and counts the notes with no date', () => {
    expect(desktop.month?.[busyDay]).toHaveLength(3)
    expect(desktop.more).toBe('+3 more')
    expect(desktop.undated).toBe('1 note has no date')
  })

  it('puts timed notes on the hours of the week and the rest at the top', () => {
    expect(desktop.weekBlocks?.[today]).toEqual(['Standup'])
    expect(desktop.weekAllDay?.[today]).toEqual(['Done already'])
  })

  it('tints a busy day in the year, and remembers the layout in the base', () => {
    expect(desktop.heat).toContain('abele-calendar-year__day_heat-4')
    expect(desktop.stored).toMatch(/mode: year/)
  })

  it('on a phone: dots, the picked day listed, the week scrolling within itself', () => {
    expect(phone.error).toBeUndefined()
    expect(phone.phone).toBe(true)
    expect(phone.narrow).toBe(true)
    expect(phone.dots).toBeGreaterThan(0)
    expect(phone.agenda).toEqual(expect.arrayContaining(['Standup']))
    expect(phone.weekScrolls).toBe(true)
  })

  it.each(['month', 'week', 'year'])('on a phone, %s: nothing reaches past the edge', (m) => {
    expect(phone.over?.[m] ?? ['no report']).toEqual([])
  })
})
